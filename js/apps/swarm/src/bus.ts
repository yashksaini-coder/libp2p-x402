import { appendFileSync } from 'node:fs'
import type { SwarmEvent, SwarmEventBody } from './events.ts'

const BACKLOG = 500

/** In-process event bus: numbers events, keeps a backlog for late subscribers, optionally records. */
export class Bus {
  private seq = 0
  private readonly backlog: SwarmEvent[] = []
  private readonly subs = new Set<(e: SwarmEvent) => void>()
  private readonly recordTo?: string

  constructor (opts: { recordTo?: string } = {}) {
    this.recordTo = opts.recordTo
  }

  emit (body: SwarmEventBody): SwarmEvent {
    const e = { ...body, seq: ++this.seq, at: Date.now() } as SwarmEvent
    this.backlog.push(e)
    if (this.backlog.length > BACKLOG) this.backlog.shift()
    if (this.recordTo != null) appendFileSync(this.recordTo, JSON.stringify(e) + '\n')
    for (const fn of this.subs) fn(e)
    return e
  }

  /** Calls `fn` with the backlog first, then live events. Returns unsubscribe. */
  subscribe (fn: (e: SwarmEvent) => void): () => void {
    for (const e of this.backlog) fn(e)
    this.subs.add(fn)
    return () => { this.subs.delete(fn) }
  }

  events (): readonly SwarmEvent[] { return this.backlog }
}
