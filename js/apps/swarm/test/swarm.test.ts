import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SwarmEvent } from '../src/events.ts'
import { serve } from '../src/http.ts'
import { startSwarm } from '../src/swarm.ts'

const kinds = (events: readonly SwarmEvent[]): string[] => events.map(e => e.kind)
const settle = async (ms: number): Promise<void> => { await new Promise(resolve => setTimeout(resolve, ms)) }

test('scene 1 emits quote, payee-check ok, payment, tx finalized, blocks all ok, in order', async () => {
  const swarm = await startSwarm({ mode: 'mock' })
  try {
    await swarm.runScene(1)
    await settle(1000) // mock tx statuses arrive over ~800 ms
    const ev = swarm.bus.events()
    const order = ['quote', 'payee-check', 'payment', 'tx', 'block'].map(k => kinds(ev).indexOf(k))
    assert.deepEqual([...order].sort((a, b) => a - b), order, `out of order: ${order}`)
    const quotes = ev.filter(e => e.kind === 'quote')
    assert.deepEqual(quotes.map(q => q.kind === 'quote' && q.invoice), [false, true])
    assert.match(String(quotes[1].kind === 'quote' && quotes[1].memo), /^ipfs:baf/)
    assert.ok(ev.some(e => e.kind === 'payee-check' && e.ok && e.payTo === e.remoteKey))
    const payment = ev.find(e => e.kind === 'payment')!
    const tx = ev.filter(e => e.kind === 'tx')
    assert.deepEqual(tx.map(t => t.kind === 'tx' && t.status), ['submitted', 'processed', 'confirmed', 'finalized'])
    assert.ok(tx.every(t => t.kind === 'tx' && payment.kind === 'payment' && t.paymentId === payment.id))
    const blocks = ev.filter(e => e.kind === 'block')
    assert.ok(blocks.length > 10 && blocks.every(b => b.kind === 'block' && b.ok))
    assert.ok(ev.some(e => e.kind === 'scene' && e.n === 1 && e.state === 'done'))
  } finally { await swarm.stop() }
})

test('scene 2 emits a block ok:false and an error resource_invalid and no tx event', async () => {
  const swarm = await startSwarm({ mode: 'mock' })
  try {
    await swarm.runScene(2)
    await settle(300)
    const ev = swarm.bus.events()
    const blocks = ev.filter(e => e.kind === 'block')
    assert.equal(blocks.filter(b => b.kind === 'block' && !b.ok).length, 1)
    assert.ok(blocks.at(-1)?.kind === 'block' && blocks.at(-1)!.kind === 'block' && (blocks.at(-1) as any).index === 13)
    assert.ok(ev.some(e => e.kind === 'error' && e.code === 'resource_invalid' && e.settled === false))
    assert.equal(ev.filter(e => e.kind === 'tx').length, 0, 'a tampered upload must not produce a transaction')
  } finally { await swarm.stop() }
})

test('scene 3 pins and emits a receipt whose tx is the settlement signature', async () => {
  const swarm = await startSwarm({ mode: 'mock' })
  try {
    await swarm.runScene(3)
    const ev = swarm.bus.events()
    const pinned = ev.find(e => e.kind === 'pinned')
    const submitted = ev.find(e => e.kind === 'tx')
    assert.ok(pinned?.kind === 'pinned' && submitted?.kind === 'tx')
    assert.equal(pinned.receipt.tx, submitted.signature)
    assert.match(pinned.receiptCid, /^bag/) // dag-json CIDv1
  } finally { await swarm.stop() }
})

async function readFirstEvents (url: string, n: number): Promise<SwarmEvent[]> {
  const res = await fetch(url)
  const reader = res.body!.getReader()
  let text = ''
  const out: SwarmEvent[] = []
  while (out.length < n) {
    const { value, done } = await reader.read()
    if (done) break
    text += new TextDecoder().decode(value)
    const parts = text.split('\n\n'); text = parts.pop()!
    for (const p of parts) if (p.startsWith('data: ')) out.push(JSON.parse(p.slice(6)))
  }
  await reader.cancel()
  return out
}

test('late subscriber receives hello then the backlog', async () => {
  const swarm = await startSwarm({ mode: 'mock' })
  const { server, port } = await serve({ ...swarm, token: 't0ken' }, 0)
  try {
    await swarm.runScene(2)
    const events = await readFirstEvents(`http://127.0.0.1:${port}/events`, 8)
    assert.equal(events[0].kind, 'hello')
    assert.ok(events.slice(1).some(e => e.kind === 'peer'))
  } finally { server.close(); await swarm.stop() }
})

test('second scene trigger returns 409, bad token 401', async () => {
  const swarm = await startSwarm({ mode: 'mock' })
  const { server, port } = await serve({ ...swarm, token: 't0ken' }, 0)
  try {
    const post = async (n: number, token: string): Promise<number> =>
      (await fetch(`http://127.0.0.1:${port}/scenes/${n}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status
    assert.equal(await post(1, 'wrong'), 401)
    assert.equal(await post(1, 't0ken'), 202)
    assert.equal(await post(2, 't0ken'), 409)
    while (swarm.busy()) await settle(50)
  } finally { server.close(); await swarm.stop() }
})

test('devnet without keys fails with guidance', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'swarm-nokeys-'))
  await assert.rejects(startSwarm({ mode: 'devnet', keysDir: empty }),
    (e: Error) => /missing key files/.test(e.message) && /node src\/main\.ts keys/.test(e.message))
})

test('scene 1 buys from a tab seller: circuit, then webrtc, payee is the tab key', async () => {
  const { generateKeyPair } = await import('@libp2p/crypto/keys')
  const { startTabSeller } = await import('../src/tab.ts')
  const swarm = await startSwarm({ mode: 'mock' })
  const { server, port } = await serve({ ...swarm, token: 't0ken' }, 0)
  const swarmUrl = `http://127.0.0.1:${port}`
  let sold = 0
  const tab = await startTabSeller({ swarmUrl, token: 't0ken', privateKey: await generateKeyPair('Ed25519'), onSettled: () => { sold++ } })
  try {
    const tabId = tab.helia.libp2p.peerId.toString()
    while (!swarm.bus.events().some(e => e.kind === 'peer' && e.id === tabId)) await settle(50)
    await swarm.runScene(1)
    const ev = swarm.bus.events()
    assert.ok(ev.some(e => e.kind === 'scene' && e.n === 1 && e.state === 'done' && /browser tab/.test(e.title)), JSON.stringify(ev.filter(e => e.kind === 'error')))
    const opened = ev.filter(e => e.kind === 'connection' && e.to === tabId && e.state === 'open').map(e => e.kind === 'connection' && e.transport)
    assert.deepEqual(opened, ['circuit', 'webrtc'])
    assert.ok(ev.some(e => e.kind === 'payee-check' && e.ok && e.to === tabId && e.payTo === tab.payee))
    assert.ok(ev.some(e => e.kind === 'payment' && e.to === tabId))
    assert.equal(sold, 1)
    assert.equal((await fetch(`${swarmUrl}/facilitator/supported`)).status, 401, 'facilitator needs the token')
  } finally { await tab.stop(); server.close(); await swarm.stop() }
})
