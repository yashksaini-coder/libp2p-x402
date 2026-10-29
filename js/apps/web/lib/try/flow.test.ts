import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialFlow, reduceFlow, type FlowEvent } from './flow.ts'

const seller = { peerId: '12D3KooWseller', payee: 'Payee1111' }
const run = (...es: FlowEvent[]) => es.reduce(reduceFlow, initialFlow)
const buyStart: FlowEvent[] = [
  { kind: 'dialed', ms: 80, seller }, { kind: 'quote', amount: 0.002124, memo: 'Qm', invoice: {} },
  { kind: 'payee-check', ok: true },
]
const blocks = (ok = true): FlowEvent[] => [{ kind: 'block', index: 0, total: 2, ok: true }, { kind: 'block', index: 1, total: 2, ok }]
const got: FlowEvent = { kind: 'received', bytes: 10, data: new Uint8Array(10) }

test('happy path walks connect → fund → buy → done with ascending tx stages', () => {
  let s = run({ kind: 'config', mode: 'devnet' })
  assert.equal(s.step, 'connect')
  s = reduceFlow(s, { kind: 'wallet-connected', address: 'A', usdc: 0 })
  assert.equal(s.step, 'fund')
  s = [{ kind: 'drip-sending' }, { kind: 'drip-sent', signature: 'sig' }, { kind: 'balance', usdc: 0.01 }].reduce((x, e) => reduceFlow(x, e as FlowEvent), s)
  assert.equal(s.step, 'buy')
  assert.equal(s.drip?.status, 'sent')
  const evs: FlowEvent[] = [...buyStart, { kind: 'signing', at: 1 }, { kind: 'paid', id: 'visit-1' },
    { kind: 'tx', signature: 'T', status: 'processed', ms: 400 }, { kind: 'tx', status: 'finalized', ms: 13000 },
    { kind: 'tx', status: 'confirmed', ms: 900 }, ...blocks(), got]
  s = evs.reduce(reduceFlow, s)
  assert.equal(s.step, 'done')
  assert.deepEqual(s.purchase?.tx?.stages.map(t => t.status), ['processed', 'finalized'])
  assert.equal(s.purchase?.tx?.signature, 'T')
  assert.ok(s.purchase?.signing)
})

test('wallet with enough USDC skips fund', () => {
  assert.equal(run({ kind: 'wallet-connected', address: 'A', usdc: 0.002124 }).step, 'buy')
  assert.equal(run({ kind: 'wallet-connected', address: 'A', usdc: 0.002 }).step, 'fund')
})

test('timeout then retry starts a fresh purchase', () => {
  let s = run({ kind: 'wallet-connected', address: 'A', usdc: 1 }, ...buyStart, { kind: 'signing', at: 1 })
  s = reduceFlow(s, { kind: 'failed', code: 'timeout', message: 'took too long' })
  assert.equal(s.step, 'buy')
  assert.equal(s.error?.code, 'timeout')
  s = reduceFlow(s, { kind: 'retry' })
  assert.equal(s.step, 'buy')
  assert.equal(s.purchase, undefined)
  assert.equal(s.error, undefined)
})

test('a bad block ends in failed, never done', () => {
  const s = run({ kind: 'wallet-connected', address: 'A', usdc: 1 }, ...buyStart, ...blocks(false), got)
  assert.notEqual(s.step, 'done')
  assert.equal(s.error?.code, 'bad-block')
})

test('mock mode never enters signing', () => {
  const s = run({ kind: 'config', mode: 'mock' }, { kind: 'wallet-connected', address: 'A', usdc: 1 }, ...buyStart, { kind: 'signing', at: 1 })
  assert.equal(s.purchase?.signing, undefined)
})
