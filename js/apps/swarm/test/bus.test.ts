import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Bus } from '../src/bus.ts'
import type { SwarmEvent } from '../src/events.ts'

test('late subscriber still gets every peer after the backlog window has rolled past them', () => {
  const bus = new Bus()
  bus.emit({ kind: 'peer', id: 'p1', role: 'agent', label: 'Agent', addrs: [] })
  bus.emit({ kind: 'peer', id: 'p2', role: 'provider', label: 'Provider', addrs: [] })
  for (let i = 0; i < 700; i++) bus.emit({ kind: 'block', requestId: 'r', cid: 'c', index: i, total: 700, ok: true })
  const got: SwarmEvent[] = []
  bus.subscribe(e => got.push(e))
  assert.deepEqual(got.filter(e => e.kind === 'peer').map(e => e.kind === 'peer' && e.id), ['p1', 'p2'])
  const seqs = got.map(e => e.seq)
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'replay must stay in seq order')
})
