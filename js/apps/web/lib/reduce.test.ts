import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bestTransport, edgeKey, initialState, liveTab, reduce } from './reduce.ts'
import { HELLO, PEERS, SCENE1, SCENE2, REPLAY, stamp } from './fixtures.ts'

const fold = (steps: Parameters<typeof stamp>[0]) => stamp(steps).reduce(reduce, initialState)

test('scene 1 folds into one payment with three ascending stages and every block verified', () => {
  const s = fold([{ dt: 0, e: HELLO }, ...PEERS, ...SCENE1])
  assert.equal(s.payments.length, 1)
  const [p] = s.payments
  assert.deepEqual(p.stages.map((x) => x.status), ['processed', 'confirmed', 'finalized'])
  const ms = p.stages.map((x) => x.ms)
  assert.deepEqual(ms, [...ms].sort((a, b) => a - b))
  assert.ok(ms[0] < ms[1] && ms[1] < ms[2])
  assert.equal(s.counters.blocksVerified, s.blocks.length)
  assert.ok(s.blocks.every((b) => b.ok === true))
  assert.equal(s.counters.usdc, 2417)
  assert.equal(s.counters.p50FinalizeMs, 12947)
  assert.equal(s.mode, 'replay')
})

test('scene 2 leaves payments unchanged and marks exactly one red cell', () => {
  const after1 = fold([{ dt: 0, e: HELLO }, ...PEERS, ...SCENE1])
  const events = stamp([{ dt: 0, e: HELLO }, ...PEERS, ...SCENE1, ...SCENE2])
  const s = events.reduce(reduce, initialState)
  assert.deepEqual(s.payments, after1.payments)
  assert.equal(s.blocks.filter((b) => b.ok === false).length, 1)
  assert.equal(s.blocks.findIndex((b) => b.ok === false), 13)
  assert.equal(s.error?.code, 'resource_invalid')
  assert.equal(s.error?.settled, false)
})

test('duplicate events from a reconnect are ignored; hello rebuilds from the backlog', () => {
  const events = stamp(REPLAY)
  const once = events.reduce(reduce, initialState)
  const twice = events.slice(5).reduce(reduce, once)
  assert.deepEqual(twice, once)
  const rebuilt = events.reduce(reduce, once)
  assert.deepEqual(rebuilt, once)
})

test('a browser tab: label only while it holds the relay, and the edge flips circuit to webrtc', () => {
  const [agent, relay, tab] = ['12D3agent', '12D3relay', '12D3tab']
  const conn = (from: string, to: string, transport: 'ws' | 'circuit' | 'webrtc', state: 'open' | 'closed') => ({ dt: 0, e: { kind: 'connection' as const, from, to, transport, state } })
  const base = [
    { dt: 0, e: HELLO },
    { dt: 0, e: { kind: 'peer' as const, id: agent, role: 'agent' as const, label: 'Agent', addrs: [] } },
    { dt: 0, e: { kind: 'peer' as const, id: relay, role: 'relay' as const, label: 'Relay', addrs: [] } },
  ]
  assert.equal(liveTab(fold(base)), undefined)
  const joined = [...base, { dt: 0, e: { kind: 'peer' as const, id: tab, role: 'seller' as const, label: 'Browser tab', addrs: [] } }, conn(tab, relay, 'ws', 'open')]
  assert.equal(liveTab(fold(joined))?.id, tab)
  const edge = (steps: typeof joined) => fold(steps).edges.find((e) => e.key === edgeKey(agent, tab))!
  const circuit = [...joined, conn(agent, tab, 'circuit', 'open')]
  assert.equal(bestTransport(edge(circuit)), 'circuit')
  assert.equal(bestTransport(edge([...circuit, conn(agent, tab, 'webrtc', 'open')])), 'webrtc')
  assert.equal(liveTab(fold([...joined, conn(tab, relay, 'ws', 'closed')])), undefined, 'tab closed: back to the Node seller label')
})
