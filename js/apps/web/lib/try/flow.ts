// The /try page is a pure function of real signals: state = events.reduce(reduceFlow, initialFlow).
// Keep this file free of non erasable TypeScript so `node --test lib/try/flow.test.ts` runs it directly.
export type Step = 'connect' | 'fund' | 'buy' | 'done'
export type TxStage = { status: 'processed' | 'confirmed' | 'finalized', ms: number }
export type Purchase = {
  seller: { peerId: string, payee: string }, dialMs?: number, quote?: { amount: number, memo?: string },
  payeeOk?: boolean, signing?: { since: number }, paid?: { id?: string },
  tx?: { signature?: string, stages: TxStage[] },
  blocks: Array<{ index: number, ok: boolean }>, total?: number, bytes?: number, data?: Uint8Array,
}
export type FlowState = {
  step: Step, mode: 'mock' | 'devnet' | null,
  wallet?: { address: string, usdc: number },
  drip?: { status: 'idle' | 'sending' | 'sent' | 'error', signature?: string, error?: string },
  purchase?: Purchase, error?: { code: string, message: string },
}
export type FlowEvent =
  | { kind: 'config', mode: 'mock' | 'devnet' }
  | { kind: 'wallet-connected', address: string, usdc: number }
  | { kind: 'wallet-disconnected' }
  | { kind: 'balance', usdc: number }
  | { kind: 'drip-sending' }
  | { kind: 'drip-sent', signature: string }
  | { kind: 'drip-failed', code: string, message: string }
  | { kind: 'dialed', ms: number, seller: { peerId: string, payee: string } }
  | { kind: 'quote', amount: number, memo?: string, invoice?: unknown }
  | { kind: 'payee-check', ok: boolean }
  | { kind: 'signing', at: number }
  | { kind: 'paid', id?: string }
  | { kind: 'tx', signature?: string, status: TxStage['status'], ms: number }
  | { kind: 'block', index: number, total: number, ok: boolean }
  | { kind: 'received', bytes: number, data: Uint8Array }
  | { kind: 'failed', code: string, message: string }
  | { kind: 'retry' }

export const initialFlow: FlowState = { step: 'connect', mode: null }

/** One purchase costs 0.002124 USDC; a wallet holding that much skips the fund step. */
export const PURCHASE_USDC = 0.002124
const RANK = { processed: 0, confirmed: 1, finalized: 2 }

export function reduceFlow(s: FlowState, e: FlowEvent): FlowState {
  const p = s.purchase
  const withP = (patch: Partial<Purchase>): FlowState => (p ? { ...s, purchase: { ...p, ...patch } } : s)
  switch (e.kind) {
    case 'config': return { ...s, mode: e.mode }
    case 'wallet-connected':
      return { step: e.usdc >= PURCHASE_USDC ? 'buy' : 'fund', mode: s.mode, wallet: { address: e.address, usdc: e.usdc }, drip: { status: 'idle' } }
    case 'wallet-disconnected': return { ...initialFlow, mode: s.mode }
    case 'balance': {
      if (!s.wallet) return s
      const step = s.step === 'fund' && e.usdc >= PURCHASE_USDC ? 'buy' : s.step
      return { ...s, step, wallet: { ...s.wallet, usdc: e.usdc } }
    }
    case 'drip-sending': return { ...s, drip: { status: 'sending' } }
    case 'drip-sent': return { ...s, drip: { status: 'sent', signature: e.signature } }
    case 'drip-failed': return { ...s, drip: { status: 'error', error: e.message } }
    case 'dialed': return { ...s, error: undefined, purchase: { seller: e.seller, dialMs: e.ms, blocks: [] } }
    case 'quote': return withP({ quote: { amount: e.amount, memo: e.memo } })
    case 'payee-check': return withP({ payeeOk: e.ok })
    case 'signing': return s.mode === 'mock' ? s : withP({ signing: { since: e.at } }) // mock: no signature requested
    case 'paid': return withP({ paid: { id: e.id } })
    case 'tx': {
      if (!p) return s
      const stages = p.tx?.stages ?? []
      const last = stages[stages.length - 1]
      const next = last && RANK[e.status] <= RANK[last.status] ? stages : [...stages, { status: e.status, ms: e.ms }]
      return withP({ tx: { signature: e.signature ?? p.tx?.signature, stages: next } })
    }
    case 'block': {
      if (!p) return s
      const blocks = [...p.blocks.filter(b => b.index !== e.index), { index: e.index, ok: e.ok }].sort((a, b) => a.index - b.index)
      const next = withP({ blocks, total: e.total })
      return e.ok ? next : { ...next, error: { code: 'bad-block', message: `Block ${e.index} failed its hash check. Nothing was kept, so buy again.` } }
    }
    case 'received': {
      if (!p || s.error) return s
      const whole = p.blocks.length > 0 && p.blocks.every(b => b.ok) && (p.total === undefined || p.blocks.length === p.total)
      const next = withP({ bytes: e.bytes, data: e.data })
      return whole ? { ...next, step: 'done' } : { ...next, error: { code: 'incomplete', message: 'The data arrived without every block verified. Buy again.' } }
    }
    case 'failed': return { ...s, error: { code: e.code, message: e.message } } // step stays; timeout lands here too
    case 'retry': return { ...s, step: 'buy', purchase: undefined, error: undefined }
  }
}
