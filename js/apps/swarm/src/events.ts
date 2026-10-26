// The contract between the swarm (engine) and the dashboard.
// Every event carries `seq` (monotonic) and `at` (ms since epoch). Public data only: never secrets.

export type Role = 'agent' | 'provider' | 'seller' | 'kubo' | 'relay'
export type Mode = 'mock' | 'devnet' | 'local' | 'replay'
export type TxStatus = 'submitted' | 'processed' | 'confirmed' | 'finalized'

export type SwarmEventBody =
  | { kind: 'hello', mode: Mode, network: string, explorer: string }
  | { kind: 'scene', n: 1 | 2 | 3, state: 'start' | 'done' | 'failed', title: string }
  | { kind: 'peer', id: string, role: Role, label: string, addrs: string[], payee?: string }
  | { kind: 'connection', from: string, to: string, transport: 'tcp' | 'webrtc' | 'circuit' | 'ws', state: 'open' | 'closed' }
  | { kind: 'quote', from: string, to: string, protocol: string, amount: string, asset: string, memo?: string, invoice: boolean }
  | { kind: 'payee-check', from: string, to: string, payTo: string, remoteKey: string, ok: boolean }
  | { kind: 'payment', id: string, from: string, to: string, protocol: string, amount: string, asset: string, network: string, memo?: string }
  | { kind: 'tx', paymentId: string, signature: string, status: TxStatus, ms: number }
  | { kind: 'block', requestId: string, cid: string, index: number, total: number, ok: boolean }
  | { kind: 'pinned', root: string, provider: string, receiptCid: string, expiresAt: string, receipt: { cid: string, payer: string, payee: string, network: string, tx: string, bytes: number, expiresAt: string } }
  | { kind: 'provided', root: string, via: 'kubo-bitswap', by: string, blocks: number, ms: number }
  | { kind: 'error', code: string, message: string, scene?: 1 | 2 | 3, settled: false }

export type SwarmEvent = SwarmEventBody & { seq: number, at: number }

/** USDC has 6 decimals; amounts on the wire are atomic-unit strings. */
export const USDC_DECIMALS = 6
