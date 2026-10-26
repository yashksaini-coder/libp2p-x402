import { createSolanaRpc, type Signature } from '@solana/kit'
import type { TxStatus } from './events.ts'
import { DEVNET_RPC } from './payments.ts'

export type OnStatus = (status: TxStatus, ms: number) => void

const ORDER: TxStatus[] = ['processed', 'confirmed', 'finalized']
export const POLL_MS = Number(process.env.TX_POLL_MS ?? 250)

/**
 * Report processed -> confirmed -> finalized for `signature`, timed from
 * `submittedAt`. Polls getSignatureStatuses: one cheap call, robust to a
 * status having already passed by the time we look (a subscription opened
 * after submit can miss it). Public devnet allows 40 calls / 10 s per method,
 * so the default interval is 250 ms (TX_POLL_MS lowers it on a paid RPC);
 * timings are accurate to one interval, and the dashboard says so.
 */
export async function watchDevnet (signature: string, submittedAt: number, onStatus: OnStatus, timeoutMs = 60_000): Promise<void> {
  const rpc = createSolanaRpc(DEVNET_RPC)
  let reached = -1
  const deadline = submittedAt + timeoutMs
  while (reached < ORDER.length - 1 && Date.now() < deadline) {
    const { value: [status] } = await rpc.getSignatureStatuses([signature as Signature]).send()
    const level = status == null ? -1 : status.confirmationStatus == null ? 0 : ORDER.indexOf(status.confirmationStatus as TxStatus)
    while (reached < level) onStatus(ORDER[++reached], Date.now() - submittedAt)
    if (reached < ORDER.length - 1) await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
}

/** Mock mode: short real delays so the UI pipeline is exercised. Labelled MOCK on screen. */
export async function watchMock (_signature: string, submittedAt: number, onStatus: OnStatus): Promise<void> {
  for (const [status, delay] of [['processed', 140], ['confirmed', 260], ['finalized', 420]] as const) {
    await new Promise(resolve => setTimeout(resolve, delay))
    onStatus(status, Date.now() - submittedAt)
  }
}
