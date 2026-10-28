// The replay: real devnet runs of 2026-10-28 (lib/recorded.ts, generated from captures/). Used by
// `/live?demo=fixture` (labelled REPLAY), by the landing page visuals, and by lib/reduce.test.ts.
// Keys, CIDs, memos and transaction signatures are real and resolve on the devnet explorer.
import type { SwarmEvent, SwarmEventBody } from '@swarm/events'
import { RECORDED_PEERS, RECORDED_SCENE1, RECORDED_SCENE2, RECORDED_SCENE3 } from './recorded.ts'

const peer = (role: string) => {
  const e = RECORDED_PEERS.find((s) => s.e.kind === 'peer' && s.e.role === role)!.e as Extract<SwarmEventBody, { kind: 'peer' }>
  return { addr: e.payee ?? '', peer: e.id }
}
export const KEYS = { agent: peer('agent'), seller: peer('seller'), provider: peer('provider'), kubo: peer('kubo') }

const memoOf = (steps: Step[]) => (steps.find((s) => s.e.kind === 'quote' && s.e.invoice)!.e as Extract<SwarmEventBody, { kind: 'quote' }>).memo!
/** What each scene's payment memo carries: its root as CIDv0 (ipfs-x402 memoFor). */
export const MEMOS = [memoOf(RECORDED_SCENE1), memoOf(RECORDED_SCENE2), memoOf(RECORDED_SCENE3)]

export const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
export const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'

/** A body plus the delay (ms) since the previous event, so a player can pace it like the recording. */
export type Step = { dt: number, e: SwarmEventBody }

export const PEERS: Step[] = RECORDED_PEERS
export const SCENE1: Step[] = RECORDED_SCENE1
export const SCENE2: Step[] = RECORDED_SCENE2
export const SCENE3: Step[] = RECORDED_SCENE3

export const HELLO: SwarmEventBody = { kind: 'hello', mode: 'replay', network: DEVNET, explorer: 'https://explorer.solana.com' }

/** The full replay: hello, the standing peers, then scenes 1 to 3 with a pause between them. */
export const REPLAY: Step[] = [
  { dt: 0, e: HELLO },
  ...PEERS,
  { dt: 2700, e: SCENE1[0].e },
  ...SCENE1.slice(1),
  { dt: 3500, e: SCENE2[0].e },
  ...SCENE2.slice(1),
  { dt: 4000, e: SCENE3[0].e },
  ...SCENE3.slice(1),
]

/** Stamp steps with seq and at, as the swarm would. */
export function stamp(steps: Step[], t0 = 1793000000000): SwarmEvent[] {
  let at = t0
  return steps.map((s, i) => {
    at += s.dt
    return { ...s.e, seq: i + 1, at } as SwarmEvent
  })
}
