// Booth drip: 0.01 test USDC to a visitor's devnet wallet, once per address, within limits.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  appendTransactionMessageInstructions, createKeyPairSignerFromBytes, createSolanaRpc, createTransactionMessage, fetchEncodedAccounts,
  getBase64EncodedWireTransaction, getSignatureFromTransaction, isAddress, isSolanaError, pipe, setTransactionMessageFeePayerSigner,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, address as toAddress,
  type Address, type Blockhash, type Instruction, type Signature, type TransactionSigner
} from '@solana/kit'
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstructionAsync, getTransferCheckedInstruction } from '@solana-program/token'
import { USDC_DEVNET_ADDRESS } from '@x402/svm'
import { USDC_DECIMALS } from './events.ts'
import type { KeyRole, RoleKey } from './keys.ts'
import { DEVNET_RPC, type OnSubmit } from './payments.ts'

export interface DripLimits { perIpPerHour: number, globalPerHour: number, total: number, minFeePayerLamports: bigint }
export const DRIP_LIMITS: DripLimits = { perIpPerHour: 3, globalPerHour: 60, total: 500, minFeePayerLamports: 100_000_000n }
export const DRIP_AMOUNT = 10_000n // 0.01 USDC

export type DripCode = 'invalid_address' | 'already_dripped' | 'rate_limited' | 'paused' | 'budget_spent' | 'low_sol' | 'send_failed'
export type DripResult = { ok: true, signature: string } | { ok: false, code: DripCode, message: string }

export interface Drip {
  request: (address: string, ip?: string) => Promise<DripResult>
  pause: (on: boolean) => void
  /** lowSol: the last balance check found the fee payer under the minimum. */
  status: () => { paused: boolean, sent: number, remaining: number, lowSol: boolean }
  /** Re-check the fee payer balance so status().lowSol follows top-ups. Throws when the RPC does. */
  refresh: () => Promise<void>
}

/** A send error with `ambiguous: true` may still land on chain: the address stays claimed. */
const isAmbiguous = (err: any): boolean => err?.ambiguous === true

export interface DripOptions {
  send: (address: string) => Promise<string>
  /** address -> ISO time of the drip. Omit to keep the ledger in memory (mock). */
  ledgerFile?: string
  now?: () => number
  feePayerLamports: () => Promise<bigint>
  limits?: Partial<DripLimits>
}

const HOUR = 3_600_000

export function createDrip (opts: DripOptions): Drip {
  const limits = { ...DRIP_LIMITS, ...opts.limits }
  const now = opts.now ?? Date.now
  const ledger: Record<string, string> = opts.ledgerFile != null && existsSync(opts.ledgerFile) ? JSON.parse(readFileSync(opts.ledgerFile, 'utf8')) : {}
  // Sent plus in flight: an address is claimed before its send, so a concurrent duplicate is refused.
  const claimed = new Set(Object.keys(ledger))
  // ponytail: one timestamp list per IP, pruned on lookup; a flood of distinct IPs is capped by the global limit.
  const stamps = new Map<string, number[]>()
  let paused = false
  let lowSol = false
  let queue: Promise<unknown> = Promise.resolve()

  const recent = (key: string, t: number): number[] => {
    const list = (stamps.get(key) ?? []).filter(s => t - s < HOUR)
    if (list.length === 0) stamps.delete(key); else stamps.set(key, list)
    return list
  }
  const refuse = (code: DripCode, message: string): DripResult => ({ ok: false, code, message })

  const save = (address: string): void => {
    ledger[address] = new Date(now()).toISOString()
    if (opts.ledgerFile != null) {
      try { writeFileSync(opts.ledgerFile, JSON.stringify(ledger, null, 1), { mode: 0o600 }) } catch (err) { console.error(`drip ledger not saved: ${String(err)}`) }
    }
  }
  const refresh = async (): Promise<void> => { lowSol = await opts.feePayerLamports() < limits.minFeePayerLamports }

  const run = async (address: string, release: () => void): Promise<DripResult> => {
    try {
      await refresh()
      if (lowSol) { release(); return refuse('low_sol', 'The booth fee payer is low on SOL. Ask the presenter to top it up, then try again.') }
      const signature = await opts.send(address)
      save(address)
      return { ok: true, signature }
    } catch (err: any) {
      // Submitted but not confirmed: it may still land, so keep the address (and its stamps) claimed.
      if (isAmbiguous(err)) {
        save(address)
        return refuse('send_failed', `The drip transaction may still land (${String(err?.message ?? err)}). Check your wallet in a minute before asking again.`)
      }
      release()
      return refuse('send_failed', `The drip transaction failed (${String(err?.message ?? err)}). Try again in a minute.`)
    }
  }

  return {
    request: async (address, ip) => {
      if (!isAddress(address)) return refuse('invalid_address', 'That is not a Solana address. Paste your wallet address and try again.')
      if (paused) return refuse('paused', 'Test USDC is paused at the booth. Try again in a few minutes.')
      if (claimed.has(address)) return refuse('already_dripped', 'This address already got its test USDC. Each address gets one drip.')
      if (claimed.size >= limits.total) return refuse('budget_spent', 'The booth has given out all its test USDC. Get devnet USDC from faucet.circle.com instead.')
      const t = now()
      const global = recent('', t)
      const perIp = ip != null ? recent(`ip:${ip}`, t) : []
      if (global.length >= limits.globalPerHour) return refuse('rate_limited', 'The booth has reached its hourly drip limit. Try again later this hour.')
      if (perIp.length >= limits.perIpPerHour) return refuse('rate_limited', 'Too many drips from your network this hour. Try again in an hour.')
      claimed.add(address)
      stamps.set('', [...global, t])
      if (ip != null) stamps.set(`ip:${ip}`, [...perIp, t])
      const release = (): void => {
        claimed.delete(address)
        for (const key of ip != null ? ['', `ip:${ip}`] : ['']) {
          const list = stamps.get(key)
          const i = list?.indexOf(t) ?? -1
          if (i >= 0) list!.splice(i, 1)
        }
      }
      const result = queue.then(async () => await run(address, release))
      queue = result
      return await result
    },
    pause: (on) => { paused = on },
    refresh,
    status: () => ({ paused, sent: Object.keys(ledger).length, remaining: Math.max(0, limits.total - claimed.size), lowSol })
  }
}

/** Fee payer pays the fees and the visitor's token account rent; the agent's USDC moves. Built offline so tests can decode it. */
export async function buildDripTransaction (o: { feePayer: TransactionSigner, agent: TransactionSigner, owner: Address, mint: Address, lifetime: { blockhash: Blockhash, lastValidBlockHeight: bigint } }) {
  const [source] = await findAssociatedTokenPda({ owner: o.agent.address, mint: o.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS })
  const [destination] = await findAssociatedTokenPda({ owner: o.owner, mint: o.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS })
  const instructions = [
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: o.feePayer, owner: o.owner, mint: o.mint }),
    getTransferCheckedInstruction({ source, mint: o.mint, destination, authority: o.agent, amount: DRIP_AMOUNT, decimals: USDC_DECIMALS })
  ]
  return await signTransactionMessageWithSigners(pipe(
    createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayerSigner(o.feePayer, m),
    m => setTransactionMessageLifetimeUsingBlockhash(o.lifetime, m),
    m => appendTransactionMessageInstructions(instructions as Instruction[], m)
  ))
}

/** Devnet: the real drip send, the fee payer's balance, and the payee token accounts the seller and provider are paid into. */
/** The transaction definitely did not and cannot land (rejected, failed on chain, or expired). */
class Definite extends Error {}

export async function devnetDrip (keys: Record<KeyRole, RoleKey>, onSubmit: OnSubmit) {
  const rpc = createSolanaRpc(DEVNET_RPC)
  const [feePayer, agent] = await Promise.all([createKeyPairSignerFromBytes(keys.feepayer.secret), createKeyPairSignerFromBytes(keys.agent.secret)])
  const mint = toAddress(USDC_DEVNET_ADDRESS)

  const confirm = async (signature: Signature, lastValidBlockHeight: bigint): Promise<void> => {
    for (;;) {
      const { value: [status] } = await rpc.getSignatureStatuses([signature]).send()
      if (status?.err != null) throw new Definite(`transaction ${signature} failed: ${JSON.stringify(status.err, (_k, v) => typeof v === 'bigint' ? String(v) : v)}`)
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return
      if (await rpc.getBlockHeight().send() > lastValidBlockHeight) {
        // Past the last valid block height it can no longer land; one last look closes the race with the check above.
        const { value: [last] } = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send()
        if (last?.err == null && last?.confirmationStatus != null) return
        throw new Definite(`transaction ${signature} expired`)
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  const submit = async (build: (lifetime: { blockhash: Blockhash, lastValidBlockHeight: bigint }) => ReturnType<typeof buildDripTransaction>, paymentId?: string): Promise<string> => {
    const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
    const tx = await build(lifetime)
    const signature = getSignatureFromTransaction(tx)
    try {
      // Preflight at the commitment of the blockhash, or the finalized bank may not know it yet.
      await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: 'base64', preflightCommitment: 'confirmed' }).send()
    } catch (err: any) {
      if (isSolanaError(err, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) throw new Definite(String(err?.message ?? err))
      throw Object.assign(err, { ambiguous: true }) // network failure: the RPC may have accepted it
    }
    if (paymentId != null) onSubmit(signature, Date.now(), paymentId)
    try {
      await confirm(signature, lifetime.lastValidBlockHeight)
    } catch (err: any) {
      throw err instanceof Definite ? err : Object.assign(err, { ambiguous: true })
    }
    return signature
  }

  let n = 0
  return {
    send: async (owner: string): Promise<string> => await submit(async lifetime => await buildDripTransaction({ feePayer, agent, owner: toAddress(owner), mint, lifetime }), `drip-${++n}`),
    feePayerLamports: async (): Promise<bigint> => (await rpc.getBalance(feePayer.address).send()).value,
    /** One transaction of idempotent creates; skipped when every account already exists. */
    ensurePayeeAccounts: async (owners: string[]): Promise<string | undefined> => {
      const atas = await Promise.all(owners.map(async owner => (await findAssociatedTokenPda({ owner: toAddress(owner), mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]))
      if ((await fetchEncodedAccounts(rpc, atas)).every(a => a.exists)) return undefined
      const instructions = await Promise.all(owners.map(async owner => await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: feePayer, owner: toAddress(owner), mint })))
      return await submit(async lifetime => await signTransactionMessageWithSigners(pipe(
        createTransactionMessage({ version: 0 }),
        m => setTransactionMessageFeePayerSigner(feePayer, m),
        m => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
        m => appendTransactionMessageInstructions(instructions as Instruction[], m)
      )))
    }
  }
}
