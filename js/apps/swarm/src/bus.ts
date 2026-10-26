import { appendFileSync } from 'node:fs'
import type { SwarmEvent, SwarmEventBody } from './events.ts'

const BACKLOG = 500

/** In-process event bus: numbers events, keeps a backlog for late subscribers, optionally records. */
export class Bus {
  private seq = 0
  private readonly backlog: SwarmEvent[] = []
  // Peers are standing state, not history: keep them out of the rolling window so a
  // dashboard opened after hundreds of events still sees every node.
  private readonly peers = new Map<string, SwarmEvent>()
  private readonly subs = new Set<(e: SwarmEvent) => void>()
  private readonly recordTo?: string

  constructor (opts: { recordTo?: string } = {}) {
    this.recordTo = opts.recordTo
  }

  emit (body: SwarmEventBody): SwarmEvent {
    const e = { ...body, seq: ++this.seq, at: Date.now() } as SwarmEvent
    if (e.kind === 'peer') this.peers.set(e.id, e)
    this.backlog.push(e)
    if (this.backlog.length > BACKLOG) this.backlog.shift()
    if (this.recordTo != null) appendFileSync(this.recordTo, JSON.stringify(e) + '\n')
    for (const fn of this.subs) fn(e)
    return e
  }

  /** Calls `fn` with the backlog first, then live events. Returns unsubscribe. */
  subscribe (fn: (e: SwarmEvent) => void): () => void {
    const oldest = this.backlog[0]?.seq ?? Infinity
    for (const p of this.peers.values()) if (p.seq < oldest) fn(p) // rolled out of the window; still replayed, in seq order
    for (const e of this.backlog) fn(e)
    this.subs.add(fn)
    return () => { this.subs.delete(fn) }
  }

  events (): readonly SwarmEvent[] { return this.backlog }
}
