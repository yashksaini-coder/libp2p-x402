import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decompileTransactionMessage, generateKeyPairSigner, getAddressDecoder, getCompiledTransactionMessageDecoder, type Blockhash } from '@solana/kit'
import { AssociatedTokenInstruction, TokenInstruction, identifyAssociatedTokenInstruction, identifyTokenInstruction, parseTransferCheckedInstruction } from '@solana-program/token'
import { buildDripTransaction, createDrip, type DripResult } from '../src/drip.ts'
import { serve } from '../src/http.ts'
import { startSwarm } from '../src/swarm.ts'

const HOUR = 3_600_000
const addr = (i: number): string => { const b = new Uint8Array(32); new DataView(b.buffer).setUint32(0, i + 1); return getAddressDecoder().decode(b) }
const SOL = async (): Promise<bigint> => 1_000_000_000n

function fixture (over: Partial<Parameters<typeof createDrip>[0]> = {}): { drip: ReturnType<typeof createDrip>, sent: string[], clock: { t: number } } {
  const sent: string[] = []
  const clock = { t: 1_800_000_000_000 }
  const drip = createDrip({ send: async a => { sent.push(a); return `sig${sent.length}` }, now: () => clock.t, feePayerLamports: SOL, ...over })
  return { drip, sent, clock }
}
const code = (r: DripResult): string => r.ok ? 'ok' : r.code

test('second request for the same address is refused', async () => {
  const { drip, sent } = fixture()
  assert.equal(code(await drip.request(addr(0), '1.1.1.1')), 'ok')
  assert.equal(code(await drip.request(addr(0), '2.2.2.2')), 'already_dripped')
  assert.equal(sent.length, 1)
})

test('fourth request from one IP within an hour is rate limited, allowed after the hour', async () => {
  const { drip, clock } = fixture()
  for (let i = 0; i < 3; i++) assert.equal(code(await drip.request(addr(i), '1.1.1.1')), 'ok')
  assert.equal(code(await drip.request(addr(3), '1.1.1.1')), 'rate_limited')
  clock.t += HOUR
  assert.equal(code(await drip.request(addr(3), '1.1.1.1')), 'ok')
})

test('61st request in an hour is rate limited', async () => {
  const { drip } = fixture()
  for (let i = 0; i < 60; i++) assert.equal(code(await drip.request(addr(i), `10.0.${i}.1`)), 'ok')
  assert.equal(code(await drip.request(addr(60), '10.1.0.1')), 'rate_limited')
})

test('501st request fails with budget_spent', async () => {
  const { drip, clock, sent } = fixture()
  for (let i = 0; i < 500; i++) {
    clock.t += 61_000 // stay under 60 per hour
    assert.equal(code(await drip.request(addr(i), `10.${i >> 8}.${i & 255}.1`)), 'ok')
  }
  clock.t += 61_000
  assert.equal(code(await drip.request(addr(500), '10.9.9.9')), 'budget_spent')
  assert.equal(sent.length, 500)
  assert.deepEqual(drip.status(), { paused: false, sent: 500, remaining: 0, lowSol: false })
})

test('low fee payer SOL refuses', async () => {
  const { drip, sent } = fixture({ feePayerLamports: async () => 99_999_999n })
  assert.equal(code(await drip.request(addr(0), '1.1.1.1')), 'low_sol')
  assert.equal(sent.length, 0)
  assert.equal(drip.status().lowSol, true)
})

test('two concurrent requests for one address send once', async () => {
  const { drip, sent } = fixture()
  const results = await Promise.all([drip.request(addr(0), '1.1.1.1'), drip.request(addr(0), '2.2.2.2')])
  assert.deepEqual(results.map(code).sort(), ['already_dripped', 'ok'])
  assert.equal(sent.length, 1)
})

test('sends run one at a time', async () => {
  let inFlight = 0
  let most = 0
  const drip = createDrip({ feePayerLamports: SOL, send: async () => { most = Math.max(most, ++inFlight); await new Promise(resolve => setTimeout(resolve, 5)); inFlight--; return 's' } })
  await Promise.all([0, 1, 2].map(async i => await drip.request(addr(i), `1.1.1.${i}`)))
  assert.equal(most, 1)
})

test('a failed send releases the address', async () => {
  let fail = true
  const drip = createDrip({ feePayerLamports: SOL, send: async () => { if (fail) throw new Error('blockhash not found'); return 'sig' } })
  const first = await drip.request(addr(0), '1.1.1.1')
  assert.equal(code(first), 'send_failed')
  fail = false
  assert.deepEqual(await drip.request(addr(0), '1.1.1.1'), { ok: true, signature: 'sig' })
})

test('invalid base58 address is refused without sending', async () => {
  const { drip, sent } = fixture()
  for (const bad of ['not-an-address!!', '0OIl', '', '1111']) assert.equal(code(await drip.request(bad, '1.1.1.1')), 'invalid_address')
  assert.equal(sent.length, 0)
})

test('the ledger file survives a restart', async () => {
  const ledgerFile = join(mkdtempSync(join(tmpdir(), 'drip-')), 'drip-ledger.json')
  assert.equal(code(await fixture({ ledgerFile }).drip.request(addr(0), '1.1.1.1')), 'ok')
  const again = fixture({ ledgerFile })
  assert.equal(code(await again.drip.request(addr(0), '1.1.1.1')), 'already_dripped')
  assert.equal(again.drip.status().sent, 1)
})

test('drip transaction has exactly create-idempotent then transferChecked of 10000', async () => {
  const [feePayer, agent, visitor] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()])
  const mint = addr(42) as any
  const lifetime = { blockhash: '11111111111111111111111111111111' as Blockhash, lastValidBlockHeight: 0n }
  const tx = await buildDripTransaction({ feePayer, agent, owner: visitor.address, mint, lifetime })
  const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(tx.messageBytes))
  assert.equal(message.feePayer.address, feePayer.address)
  assert.deepEqual(Object.keys(tx.signatures).sort(), [feePayer.address, agent.address].sort())
  assert.ok(Object.values(tx.signatures).every(s => s != null))
  const [create, transfer, ...rest] = message.instructions as any[]
  assert.equal(rest.length, 0)
  assert.equal(identifyAssociatedTokenInstruction(create), AssociatedTokenInstruction.CreateAssociatedTokenIdempotent)
  assert.equal(create.accounts[2].address, visitor.address) // owner
  assert.equal(identifyTokenInstruction(transfer), TokenInstruction.TransferChecked)
  const parsed = parseTransferCheckedInstruction(transfer)
  assert.equal(parsed.data.amount, 10_000n)
  assert.equal(parsed.data.decimals, 6)
  assert.equal(parsed.accounts.authority.address, agent.address)
  assert.equal(parsed.accounts.destination.address, create.accounts[1].address) // the visitor's ATA
})

test('POST /visitor/drip in mock mode answers mock', async () => {
  const swarm = await startSwarm({ mode: 'mock' })
  const { server, port } = await serve({ ...swarm, token: 't0ken' }, 0)
  try {
    const post = async (body: unknown): Promise<Response> => await fetch(`http://127.0.0.1:${port}/visitor/drip`, { method: 'POST', body: JSON.stringify(body) })
    const ok = await post({ address: addr(7) })
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(), { signature: null, mock: true })
    assert.equal((await post({ address: addr(7) })).status, 409)
    assert.equal((await post({ address: 'nope' })).status, 400)
    assert.equal(swarm.bus.events().filter(e => e.kind === 'tx').length, 0, 'mock drip sends nothing')
  } finally { server.close(); await swarm.stop() }
})

test('pause requires the token', async () => {
  const swarm = await startSwarm({ mode: 'mock' })
  const { server, port } = await serve({ ...swarm, token: 't0ken' }, 0)
  try {
    const base = `http://127.0.0.1:${port}`
    const pause = async (auth?: string): Promise<Response> => await fetch(`${base}/visitor/pause`, { method: 'POST', headers: auth != null ? { Authorization: `Bearer ${auth}` } : {}, body: JSON.stringify({ paused: true }) })
    assert.equal((await pause()).status, 401)
    assert.equal((await pause('wrong')).status, 401)
    assert.equal((await (await fetch(`${base}/visitor/config`)).json()).drip.enabled, true)
    assert.equal((await pause('t0ken')).status, 200)
    assert.equal((await (await fetch(`${base}/visitor/config`)).json()).drip.enabled, false)
    const refused = await fetch(`${base}/visitor/drip`, { method: 'POST', body: JSON.stringify({ address: addr(8) }) })
    assert.equal(refused.status, 503)
    assert.equal((await refused.json()).error, 'paused')
  } finally { server.close(); await swarm.stop() }
})

test('an ambiguous send failure keeps the address claimed', async () => {
  const drip = createDrip({ feePayerLamports: SOL, send: async () => { throw Object.assign(new Error('not confirmed'), { ambiguous: true }) } })
  assert.equal(code(await drip.request(addr(0), '1.1.1.1')), 'send_failed')
  assert.equal(code(await drip.request(addr(0), '1.1.1.1')), 'already_dripped')
  assert.equal(drip.status().sent, 1)
})

test('refresh makes status follow the fee payer balance', async () => {
  let lamports = 1n
  const drip = createDrip({ feePayerLamports: async () => lamports, send: async () => 's' })
  await drip.refresh()
  assert.equal(drip.status().lowSol, true)
  lamports = 1_000_000_000n
  await drip.refresh()
  assert.equal(drip.status().lowSol, false)
})
