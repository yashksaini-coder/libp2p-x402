'use client'

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { TransactionModifyingSigner } from '@solana/kit'
import type { SwarmEvent } from '@swarm/events'
import { buy as run, startBuyer, type Buyer, type Payer } from '@swarm/buyer'
import { useSelectedWalletAccount } from '@solana/react'
import { SWARM_URL } from '@/lib/config'
import { PURCHASE_USDC, initialFlow, reduceFlow, type FlowEvent, type FlowState } from './flow'
import { accountUsable } from './wallet'

export type VisitorConfig = Parameters<typeof run>[1]

/** The seller waits this long for the payment after it sends the invoice (swarm `paymentTimeoutMs`). */
export const PAY_WINDOW_MS = 120_000

/** Sum of the owner's token accounts for `mint`, in USDC. */
async function usdcBalance(rpcUrl: string, owner: string, mint: string): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }] }),
  })
  const j = await res.json()
  if (j.error) throw new Error(j.error.message)
  return j.result.value.reduce((n: number, a: any) => n + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0)
}

/** Cause plus next step, for anything a purchase can throw. */
function explain(err: any, timedOut: boolean): { code: string, message: string } {
  const msg = String(err?.message ?? err)
  if (timedOut) return { code: 'timeout', message: 'The invoice expired before your wallet approved it. Buy again for a fresh invoice.' }
  if (err?.code === 'payee_mismatch') return { code: 'payee_mismatch', message: 'The seller asked to be paid at an address that is not its own key, so nothing was signed. Buy again or ask at the booth.' }
  if (/user (rejected|denied|declined|cancel)|rejected the request/i.test(msg)) return { code: 'rejected', message: 'You declined in your wallet, so nothing was paid. Buy again when you are ready.' }
  if (err?.code) return { code: String(err.code), message: `The seller refused the payment (${msg}). Buy again for a fresh invoice.` }
  return { code: 'failed', message: `The purchase stopped (${msg}). Check your connection, then buy again.` }
}

/**
 * The /try page's state: real signals only, folded through reduceFlow.
 * The purchase starts by itself once the buy step is reached (dial, invoice, payee check: nothing is paid);
 * on devnet the wallet is only asked to sign after the visitor presses Pay.
 */
export function useVisitor() {
  const [account, setAccount, wallets] = useSelectedWalletAccount()
  const [signer, setSigner] = useState<TransactionModifyingSigner>()
  const [state, dispatch] = useReducer(reduceFlow, initialFlow)
  const [config, setConfig] = useState<VisitorConfig>()
  const [offline, setOffline] = useState(false)
  const [deadline, setDeadline] = useState<number>()
  const [timing, setTiming] = useState<{ start: number, end?: number }>()
  const [settledTx, setSettledTx] = useState<string>()
  const buyer = useRef<Promise<Buyer>>(undefined)
  const peer = useRef<string>(undefined)
  const payment = useRef<string>(undefined)
  const inflight = useRef<AbortController>(undefined)
  const approve = useRef<() => void>(undefined)
  const signerRef = useRef(signer)
  signerRef.current = signer

  useEffect(() => {
    fetch(`${SWARM_URL}/visitor/config`).then((r) => r.json()).then((c: VisitorConfig) => {
      setConfig(c)
      dispatch({ kind: 'config', mode: c.mode })
    }, () => setOffline(true))
  }, [])

  // The buyer node lives as long as the page.
  useEffect(() => () => { void buyer.current?.then((b) => b.stop()) }, [])

  // Settlement stages for this browser's own payment, matched by the payment id the seller tagged it with.
  useEffect(() => {
    const es = new EventSource(`${SWARM_URL}/events`)
    es.onmessage = (m) => {
      let e: SwarmEvent
      try { e = JSON.parse(m.data) } catch { return }
      if (e.kind === 'payment' && peer.current != null && e.from === peer.current && inflight.current != null) {
        payment.current = e.id
        dispatch({ kind: 'paid', id: e.id })
      }
      if (e.kind === 'tx' && e.paymentId === payment.current && e.status !== 'submitted') dispatch({ kind: 'tx', signature: e.signature, status: e.status, ms: e.ms })
    }
    return () => es.close()
  }, [])

  const refreshBalance = useCallback(async (address: string): Promise<number> => {
    if (!config?.rpcUrl) return 0
    return await usdcBalance(config.rpcUrl, address, config.asset)
  }, [config])

  // A usable account selected (or remembered) means connected; none means disconnected.
  const address = account != null && accountUsable(account).ok ? account.address : undefined
  useEffect(() => {
    if (!config) return
    if (address == null) { inflight.current?.abort(); dispatch({ kind: 'wallet-disconnected' }); return }
    let live = true
    // ponytail: an RPC failure reads as 0 USDC, so the visitor lands on the drip step; add a retry state if the RPC proves flaky.
    refreshBalance(address).catch(() => 0).then((usdc) => { if (live) dispatch({ kind: 'wallet-connected', address, usdc }) })
    return () => { live = false }
  }, [address, config, refreshBalance])

  const drip = useCallback(async () => {
    if (!config || !address) return
    dispatch({ kind: 'drip-sending' })
    try {
      const res = await fetch(`${SWARM_URL}/visitor/drip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }) })
      const j = await res.json()
      // Mock payments move no USDC: the step only needs to know the drip answered (an address seen before is fine too).
      if (j.mock || (config.mode === 'mock' && j.error === 'already_dripped')) {
        dispatch({ kind: 'drip-sent', signature: 'mock' })
        dispatch({ kind: 'balance', usdc: Number(config.drip.amount) / 1e6 })
        return
      }
      if (!res.ok) { dispatch({ kind: 'drip-failed', code: j.error, message: j.message }); return }
      dispatch({ kind: 'drip-sent', signature: j.signature })
      // The RPC sees the new balance once the drip confirms: check a few times, then stop.
      for (let i = 0; i < 15; i++) {
        const usdc = await refreshBalance(address).catch(() => 0)
        dispatch({ kind: 'balance', usdc })
        if (usdc >= PURCHASE_USDC) return
        await new Promise((r) => setTimeout(r, 2000))
      }
    } catch {
      dispatch({ kind: 'drip-failed', code: 'unreachable', message: 'The booth did not answer. Check your connection, then try again.' })
    }
  }, [config, address, refreshBalance])

  const buy = useCallback(async () => {
    if (!config || !address || inflight.current) return
    const ac = new AbortController()
    inflight.current = ac
    payment.current = undefined
    setDeadline(undefined)
    setSettledTx(undefined)
    setTiming({ start: Date.now() })
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    let badBlock = false
    // Devnet: the wallet is asked only after the visitor presses Pay (approve.current).
    const approved = new Promise<void>((resolve, reject) => {
      approve.current = resolve
      ac.signal.addEventListener('abort', () => reject(ac.signal.reason), { once: true })
    })
    approved.catch(() => {})
    try {
      const node = await (buyer.current ??= startBuyer())
      peer.current = node.libp2p.peerId.toString()
      // The wallet's signer is read at signing time: it may arrive after the purchase started.
      const payer: Payer = config.mode === 'mock' ? { kind: 'mock' } : {
        kind: 'wallet',
        signer: {
          address,
          modifyAndSignTransactions: async (txs, c) => {
            await approved
            const s = signerRef.current
            if (!s) throw new Error('the wallet offers no transaction signer')
            return await s.modifyAndSignTransactions(txs, c)
          },
        } as TransactionModifyingSigner,
      }
      // A purchase replaced by a retry keeps running until its abort lands: drop what it reports.
      const d = (e: FlowEvent) => { if (inflight.current === ac) dispatch(e) }
      const got = await run(node, config, payer, {
        onDial: (ms) => d({ kind: 'dialed', ms, seller: { peerId: config.seller.peerId, payee: config.seller.payee } }),
        onBlock: (b) => { if (!b.ok) badBlock = true; d({ kind: 'block', index: b.index, total: b.total, ok: b.ok }) },
        pay: {
          onPaymentRequired: (pr, invoice) => {
            if (!invoice) return
            const r = pr.accepts[0]
            d({ kind: 'quote', amount: Number(r.amount) / 1e6, memo: r.extra?.memo as string | undefined, invoice: pr })
            setDeadline(Date.now() + PAY_WINDOW_MS)
            timer = setTimeout(() => { timedOut = true; ac.abort(new Error('timeout')) }, PAY_WINDOW_MS)
          },
          onPayeeCheck: (c) => d({ kind: 'payee-check', ok: c.ok }),
          onPayment: () => { clearTimeout(timer); d({ kind: 'paid', id: payment.current }) },
        },
      }, ac.signal)
      setSettledTx(got.settlement.transaction)
      setTiming((t) => t && { ...t, end: Date.now() })
      dispatch({ kind: 'received', bytes: got.bytes, data: got.data })
      if (config.rpcUrl) void refreshBalance(address).then((usdc) => dispatch({ kind: 'balance', usdc }), () => {})
    } catch (err) {
      if (!badBlock && !(ac.signal.aborted && !timedOut)) dispatch({ kind: 'failed', ...explain(err, timedOut) })
    } finally {
      clearTimeout(timer)
      approve.current = undefined
      if (inflight.current === ac) inflight.current = undefined
    }
  }, [config, address, refreshBalance])

  // Reaching the buy step (or a retry) starts a purchase; an error waits for the visitor.
  useEffect(() => {
    if (state.step === 'buy' && !state.purchase && !state.error && !inflight.current) void buy()
  }, [state.step, state.purchase, state.error, buy])

  const pay = useCallback(() => {
    if (!approve.current) return
    approve.current()
    dispatch({ kind: 'signing', at: Date.now() })
  }, [])

  const retry = useCallback(() => {
    inflight.current?.abort()
    inflight.current = undefined
    dispatch({ kind: 'retry' })
  }, [])

  const connect = setAccount
  const disconnect = useCallback(() => setAccount(undefined), [setAccount])

  return { state: state as FlowState, config, offline, deadline, timing, settledTx, account, wallets, setSigner, connect, disconnect, drip, buy, pay, retry }
}
