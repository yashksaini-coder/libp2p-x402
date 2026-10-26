// The dashboard is a pure function of the swarm's event stream: state = events.reduce(reduce, initialState).
// Keep this file free of non erasable TypeScript so `node --test lib/reduce.test.ts` runs it directly.
import type { Mode, Role, SwarmEvent } from '@swarm/events'

export type Transport = 'tcp' | 'webrtc' | 'circuit' | 'ws'
export type PeerNode = { id: string, role: Role, label: string, payee?: string, addrs: string[] }
export type Edge = { key: string, a: string, b: string, open: Transport[], usdc: number, pulses: number, lastFrom?: string }
export type Stage = { status: 'processed' | 'confirmed' | 'finalized', ms: number }
export type Payment = {
  id: string, from: string, to: string, protocol: string, amount: number, memo?: string, scene?: number,
  signature?: string, submittedAt?: number, stages: Stage[], unsettled?: boolean,
}
export type BlockCell = { index: number, cid?: string, ok: boolean | null }
export type Receipt = Extract<SwarmEvent, { kind: 'pinned' }>['receipt'] & { receiptCid: string }

export type LiveState = {
  mode: Mode | null
  network: string
  connected: boolean
  seq: number
  peers: Record<string, PeerNode>
  edges: Edge[]
  payments: Payment[] // newest first, max 20
  requestId?: string
  blocks: BlockCell[] // current request only
  receipt?: Receipt
  payeeCheck?: Extract<SwarmEvent, { kind: 'payee-check' }>
  quote?: Extract<SwarmEvent, { kind: 'quote' }>
  error?: Extract<SwarmEvent, { kind: 'error' }>
  provided?: Extract<SwarmEvent, { kind: 'provided' }>
  scene?: { n: 1 | 2 | 3, state: 'start' | 'done' | 'failed', title: string }
  finalizeMs: number[]
  counters: { peers: number, usdc: number, p50FinalizeMs: number | null, blocksVerified: number }
}

export const initialState: LiveState = {
  mode: null, network: '', connected: false, seq: 0, peers: {}, edges: [], payments: [], blocks: [], finalizeMs: [],
  counters: { peers: 0, usdc: 0, p50FinalizeMs: null, blocksVerified: 0 },
}

export const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

function upsertEdge(edges: Edge[], a: string, b: string, f: (e: Edge) => Edge): Edge[] {
  const key = edgeKey(a, b)
  const found = edges.find((e) => e.key === key)
  const base: Edge = found ?? { key, a, b, open: [], usdc: 0, pulses: 0 }
  const next = f(base)
  return found ? edges.map((e) => (e.key === key ? next : e)) : [...edges, next]
}

export function reduce(s: LiveState, e: SwarmEvent): LiveState {
  // hello starts a session: the swarm sends its backlog right after, so rebuild from scratch.
  if (e.kind === 'hello') return { ...initialState, connected: s.connected, mode: e.mode, network: e.network, seq: e.seq }
  // Drop duplicates (a reconnect that replays events we already folded).
  if (e.seq <= s.seq) return s
  s = { ...s, seq: e.seq }

  switch (e.kind) {
    case 'scene':
      if (e.state !== 'start') return { ...s, scene: { n: e.n, state: e.state, title: e.title } }
      return { ...s, scene: { n: e.n, state: e.state, title: e.title }, blocks: [], requestId: undefined, error: undefined, payeeCheck: undefined, quote: undefined, provided: undefined }

    case 'peer': {
      const peers = { ...s.peers, [e.id]: { id: e.id, role: e.role, label: e.label, payee: e.payee, addrs: e.addrs } }
      return { ...s, peers, counters: { ...s.counters, peers: Object.keys(peers).length } }
    }

    case 'connection':
      return {
        ...s,
        edges: upsertEdge(s.edges, e.from, e.to, (x) => ({
          ...x,
          open: e.state === 'open' ? [...x.open.filter((t) => t !== e.transport), e.transport] : x.open.filter((t) => t !== e.transport),
        })),
      }

    case 'quote':
      return { ...s, quote: e }

    case 'payee-check':
      return { ...s, payeeCheck: e }

    case 'payment': {
      const p: Payment = { id: e.id, from: e.from, to: e.to, protocol: e.protocol, amount: Number(e.amount), memo: e.memo, scene: s.scene?.n, stages: [] }
      return {
        ...s,
        payments: [p, ...s.payments.filter((x) => x.id !== e.id)].slice(0, 20),
        edges: upsertEdge(s.edges, e.from, e.to, (x) => ({ ...x, usdc: x.usdc + p.amount, pulses: x.pulses + 1, lastFrom: e.from })),
      }
    }

    case 'tx': {
      const p = s.payments.find((x) => x.id === e.paymentId)
      if (!p) return s
      let next: Payment = { ...p, signature: e.signature }
      if (e.status === 'submitted') next.submittedAt = e.at - e.ms
      else if (!p.stages.some((st) => st.status === e.status)) next.stages = [...p.stages, { status: e.status, ms: e.ms }].sort((a, b) => a.ms - b.ms)
      const payments = s.payments.map((x) => (x === p ? next : x))
      if (e.status !== 'finalized' || p.stages.some((st) => st.status === 'finalized')) return { ...s, payments }
      const finalizeMs = [...s.finalizeMs, e.ms]
      return { ...s, payments, finalizeMs, counters: { ...s.counters, usdc: s.counters.usdc + p.amount, p50FinalizeMs: median(finalizeMs) } }
    }

    case 'block': {
      let blocks = s.blocks
      if (s.requestId !== e.requestId || blocks.length !== e.total) {
        blocks = Array.from({ length: e.total }, (_, index) => ({ index, ok: null }))
      }
      const prev = blocks[e.index]
      blocks = blocks.map((b) => (b.index === e.index ? { index: e.index, cid: e.cid, ok: e.ok } : b))
      const gained = e.ok && prev?.ok !== true ? 1 : 0
      return { ...s, requestId: e.requestId, blocks, counters: { ...s.counters, blocksVerified: s.counters.blocksVerified + gained } }
    }

    case 'pinned':
      return { ...s, receipt: { ...e.receipt, receiptCid: e.receiptCid } }

    case 'provided':
      return { ...s, provided: e }

    case 'error':
      // A payment in this scene that never got a signature never settled. Say so instead of leaving it pending.
      return { ...s, error: e, payments: s.payments.map((p) => (!p.signature && p.scene === e.scene ? { ...p, unsettled: true } : p)) }
  }
  return s
}
