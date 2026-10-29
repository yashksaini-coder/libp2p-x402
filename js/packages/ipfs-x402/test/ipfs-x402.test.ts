import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unixfs } from '@helia/unixfs'
import { X402Error } from 'x402-libp2p'
import { CID } from 'multiformats/cid'
import { FETCH_PROTOCOL, PIN_PROTOCOL, fetchHandler, fetchPaid, getReceipt, memoFor, pinHandler, pinPaid, verifyCar, type BlockCheck } from '../src/index.ts'
import { addFile, carOf, heliaNode, mockClient, mockServer, pricingFor, tamper } from './helpers.ts'

test('verifyCar accepts an untouched CAR and reports every block ok', async () => {
  const h = await heliaNode()
  try {
    const { root } = await addFile(h)
    const seen: BlockCheck[] = []
    const { blocks } = await verifyCar(await carOf(h, root), root, b => seen.push(b))
    assert.ok(blocks.length > 10, `expected many blocks, got ${blocks.length}`)
    assert.equal(seen.length, blocks.length)
    assert.ok(seen.every(b => b.ok && b.total === blocks.length))
  } finally { await h.stop() }
})

test('verifyCar rejects a CAR with one flipped byte at that block index', async () => {
  const h = await heliaNode()
  try {
    const { root } = await addFile(h)
    const seen: BlockCheck[] = []
    await assert.rejects(verifyCar(await tamper(await carOf(h, root), 5), root, b => seen.push(b)),
      (e: X402Error) => e.code === 'resource_invalid')
    assert.deepEqual(seen.map(b => b.ok), [true, true, true, true, true, false])
  } finally { await h.stop() }
})

test('fetchPaid returns blocks whose bytes equal the source file, invoice memo is the root as CIDv0', async () => {
  const [seller, agent] = await Promise.all([heliaNode(), heliaNode()])
  try {
    const { root, data } = await addFile(seller)
    const { server, memos } = await mockServer()
    await seller.libp2p.handle(FETCH_PROTOCOL, fetchHandler(seller, server, pricingFor(seller), { maxBytes: 1_000_000 }))
    const { blocks, settlement, paymentRequired } = await fetchPaid(agent.libp2p, seller.libp2p.getMultiaddrs()[0], root, mockClient())
    assert.equal(settlement.transaction, 'mocktx1')
    assert.equal(paymentRequired.accepts[0].extra?.memo, root.toV0().toString())
    assert.deepEqual(memos, [root.toV0().toString()])
    for (const b of blocks) await agent.blockstore.put(b.cid, b.bytes)
    const chunks: Uint8Array[] = []
    for await (const c of unixfs(agent).cat(root, { offline: true })) chunks.push(c)
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(data))
  } finally { await Promise.all([seller.stop(), agent.stop()]) }
})

test('fetch: paymentTimeoutMs and seller hooks reach the gate', async () => {
  const [seller, agent] = await Promise.all([heliaNode(), heliaNode()])
  try {
    const { root } = await addFile(seller)
    const { server } = await mockServer()
    const seen = { invoice: 0, verified: 0, settled: [] as any[] }
    await seller.libp2p.handle(FETCH_PROTOCOL, fetchHandler(seller, server, pricingFor(seller), { maxBytes: 1_000_000, paymentTimeoutMs: 120_000 }, {
      onInvoice: () => { seen.invoice++ },
      onVerified: () => { seen.verified++ },
      onSettled: (info) => { seen.settled.push(info) }
    }))
    await fetchPaid(agent.libp2p, seller.libp2p.getMultiaddrs()[0], root, mockClient())
    assert.equal(seen.invoice, 1)
    assert.equal(seen.verified, 1)
    assert.equal(seen.settled.length, 1)
    assert.ok(seen.settled[0].payment != null)
  } finally { await Promise.all([seller.stop(), agent.stop()]) }
})

async function pinSetup () {
  const [provider, agent] = await Promise.all([heliaNode(), heliaNode()])
  const mock = await mockServer()
  await provider.libp2p.handle(PIN_PROTOCOL, pinHandler(provider, mock.server, pricingFor(provider), { maxBytes: 1_000_000, durationDays: 30 }))
  const addr = provider.libp2p.getMultiaddrs()[0]
  return { provider, agent, addr, settles: mock.settles, stop: async () => { await Promise.all([provider.stop(), agent.stop()]) } }
}

test('pin happy path stores blocks, pins root, returns receipt whose tx equals settlement.transaction', async () => {
  const { provider, agent, addr, settles, stop } = await pinSetup()
  try {
    const { root } = await addFile(agent)
    const reply = await pinPaid(agent.libp2p, addr, await carOf(agent, root), root, mockClient())
    assert.equal(reply.pinned, root.toString())
    assert.ok(await provider.pins.isPinned(root))
    const { CID } = await import('multiformats/cid')
    const receipt = await getReceipt(provider, CID.parse(reply.receipt))
    assert.equal(receipt.tx, reply.settlement.transaction)
    assert.equal(receipt.cid, root.toString())
    assert.equal(settles(), 1)
  } finally { await stop() }
})

test('pin with tampered CAR returns resource_invalid and facilitator settle is never called', async () => {
  const { agent, addr, settles, stop } = await pinSetup()
  try {
    const { root } = await addFile(agent)
    await assert.rejects(pinPaid(agent.libp2p, addr, await tamper(await carOf(agent, root), 7), root, mockClient()),
      (e: X402Error) => e.code === 'resource_invalid')
    assert.equal(settles(), 0)
  } finally { await stop() }
})

test('pin larger than declared bytes returns resource_too_large, no settle', async () => {
  const { agent, addr, settles, stop } = await pinSetup()
  try {
    const { root } = await addFile(agent, 2_000_000) // over maxBytes 1_000_000
    await assert.rejects(pinPaid(agent.libp2p, addr, await carOf(agent, root), root, mockClient()),
      (e: X402Error) => e.code === 'resource_too_large')
    assert.equal(settles(), 0)
  } finally { await stop() }
})

test('pin aborted mid-CAR settles nothing and provider keeps serving', async () => {
  const { agent, addr, settles, stop } = await pinSetup()
  try {
    const { root } = await addFile(agent)
    const car = await carOf(agent, root)
    const { payAndOpen } = await import('x402-libp2p')
    const { lp, stream } = await payAndOpen(agent.libp2p, addr, PIN_PROTOCOL, mockClient(), { request: { root: root.toString(), bytes: car.byteLength }, settle: 'manual' })
    await lp.write(car.subarray(0, 20_000))
    stream.abort(new Error('agent went away'))
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(settles(), 0)
    const reply = await pinPaid(agent.libp2p, addr, car, root, mockClient())
    assert.equal(reply.pinned, root.toString())
    assert.equal(settles(), 1)
  } finally { await stop() }
})

test('pin with an incomplete DAG is rejected before settlement, without fetching from the network', async () => {
  const { agent, addr, settles, stop } = await pinSetup()
  try {
    const { root } = await addFile(agent)
    const { CarReader, CarWriter } = await import('@ipld/car')
    const reader = await CarReader.fromBytes(await carOf(agent, root))
    const { writer, out } = CarWriter.create([root])
    const collected = (async () => { const p: Uint8Array[] = []; for await (const c of out) p.push(c); return Buffer.concat(p) })()
    let i = 0
    for await (const b of reader.blocks()) if (i++ !== 4) await writer.put(b) // drop one leaf
    await writer.close()
    const started = Date.now()
    await assert.rejects(pinPaid(agent.libp2p, addr, await collected, root, mockClient()),
      (e: X402Error) => e.code === 'resource_invalid' && /incomplete/.test(e.message))
    assert.equal(settles(), 0)
    assert.ok(Date.now() - started < 5000, 'must fail fast, not wait on a network fetch')
  } finally { await stop() }
})

test('fetch of a DAG over maxBytes is refused at the invoice, before payment', async () => {
  const [seller, agent] = await Promise.all([heliaNode(), heliaNode()])
  try {
    const { root } = await addFile(seller, 2_000_000)
    const { server, settles } = await mockServer()
    await seller.libp2p.handle(FETCH_PROTOCOL, fetchHandler(seller, server, pricingFor(seller), { maxBytes: 1_000_000 }))
    await assert.rejects(fetchPaid(agent.libp2p, seller.libp2p.getMultiaddrs()[0], root, mockClient()),
      (e: X402Error) => e.code === 'resource_too_large')
    assert.equal(settles(), 0)
  } finally { await Promise.all([seller.stop(), agent.stop()]) }
})

test('pinning the same root twice succeeds both times (renewal), never charging for a failed pin', async () => {
  const { agent, addr, settles, stop } = await pinSetup()
  try {
    const { root } = await addFile(agent)
    const car = await carOf(agent, root)
    const first = await pinPaid(agent.libp2p, addr, car, root, mockClient())
    const second = await pinPaid(agent.libp2p, addr, car, root, mockClient())
    assert.equal(second.pinned, root.toString())
    assert.notEqual(second.receipt, first.receipt, 'a renewal gets its own receipt')
    assert.equal(settles(), 2)
  } finally { await stop() }
})

test('declined settlement leaves no pin and no new blocks behind', async () => {
  const [provider, agent] = await Promise.all([heliaNode(), heliaNode()])
  try {
    const mock = await mockServer({ settleOk: false })
    await provider.libp2p.handle(PIN_PROTOCOL, pinHandler(provider, mock.server, pricingFor(provider), { maxBytes: 1_000_000, durationDays: 30 }))
    const { root } = await addFile(agent)
    await assert.rejects(pinPaid(agent.libp2p, provider.libp2p.getMultiaddrs()[0], await carOf(agent, root), root, mockClient()),
      (e: X402Error) => e.code === 'insufficient_funds')
    assert.equal(mock.settles(), 1)
    // The error frame reaches the client before the provider finishes rolling back: wait for it, bounded.
    for (let i = 0; i < 40 && await provider.blockstore.has(root); i++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(await provider.pins.isPinned(root), false)
    assert.equal(await provider.blockstore.has(root), false, 'unpaid blocks must not stay in the store')
  } finally { await Promise.all([provider.stop(), agent.stop()]) }
})

test('a peer that pays and then goes silent cannot hold the provider lock', async () => {
  const [provider, agent] = await Promise.all([heliaNode(), heliaNode()])
  try {
    const mock = await mockServer({ settleOk: false })
    await provider.libp2p.handle(PIN_PROTOCOL, pinHandler(provider, mock.server, pricingFor(provider), { maxBytes: 1_000_000, durationDays: 30 }))
    const addr = provider.libp2p.getMultiaddrs()[0]
    const { root } = await addFile(agent)
    const car = await carOf(agent, root)
    // Silent peer: pays, sends the whole CAR, then never reads and never closes.
    const { payAndOpen } = await import('x402-libp2p')
    const { sendCar } = await import('../src/index.ts')
    const silent = await payAndOpen(agent.libp2p, addr, PIN_PROTOCOL, mockClient(), { request: { root: root.toString(), bytes: car.byteLength }, settle: 'manual' })
    await sendCar(silent.lp, car)
    // An honest upload right after must still get its answer promptly.
    const started = Date.now()
    await assert.rejects(pinPaid(agent.libp2p, addr, car, root, mockClient()), (e: X402Error) => e.code === 'insufficient_funds')
    assert.ok(Date.now() - started < 15_000, `second upload waited ${Date.now() - started} ms behind a silent peer`)
  } finally { await Promise.all([provider.stop(), agent.stop()]) }
})

// First devnet run (2026-10-28): devnet's Memo program costs ~355 CU per byte and x402 exact caps a payment at
// 20,000 CU, so the 64-byte 'ipfs:<CIDv1>' memo ran out of compute; the 46-byte CIDv0 lands with ~1,500 CU spare.
test('memoFor: dag-pb sha-256 roots become 46-byte CIDv0, other roots get no memo', () => {
  const unixfsRoot = CID.parse('bafybeigs34rvgpu2tieobp2hgh53j4m673maw7ml6ousm5tevdj6lkjioe')
  assert.equal(memoFor(unixfsRoot), 'QmcXofqbpDDSmWA9p2kjPzVk67eFrFKDtRyHX2GdLG7AqE')
  assert.equal(new TextEncoder().encode(memoFor(unixfsRoot)).byteLength, 46)
  assert.equal(memoFor(CID.parse('bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku')), undefined, 'dag-cbor has no CIDv0 form')
  assert.equal(memoFor(CID.parse('bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku')), undefined, 'raw has no CIDv0 form')
})
