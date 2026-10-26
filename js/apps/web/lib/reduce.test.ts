import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reduce, initialState } from './reduce.ts'
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
