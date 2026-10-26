import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLibp2p, type Libp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@libp2p/noise'
import { yamux } from '@libp2p/yamux'
import { generateKeyPair, privateKeyFromRaw } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { x402Client } from '@x402/core/client'
import { x402ResourceServer } from '@x402/core/server'
import type { FacilitatorClient } from '@x402/core/server'
import type { PaymentRequirements, SchemeNetworkClient, SchemeNetworkServer } from '@x402/core/types'
import { awaitSettlement, paid, payAndOpen, payeeFromPeerId, X402Error, type PaidContext, type PaidOptions } from '../src/index.ts'

const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const
const PROTOCOL = '/x402-test/echo/1.0.0'

// Mock scheme: stands in for @x402/svm so the test needs no chain. The wire format is real.
const mockSchemeServer: SchemeNetworkServer = {
  scheme: 'mock',
  defaultAssetTransferMethod: 'default',
  paymentFlows: { default: { supported: ['authorization'], default: 'authorization' } },
  parsePrice: async () => ({ amount: '1000', asset: 'USDC' }),
  enhancePaymentRequirements: async (r: PaymentRequirements) => r
}
function mockFacilitator (): FacilitatorClient & { settles: () => number } {
  let n = 0
  return {
    verify: async (p) => p.payload.sig === 'ok' ? { isValid: true, payer: 'agent' } : { isValid: false, invalidReason: 'invalid_signature' },
    settle: async (_p, r) => { n++; return { success: true, transaction: 'mocktx', network: r.network, payer: 'agent' } },
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'mock', network: DEVNET }], extensions: [], signers: {} }),
    settles: () => n
  }
}
function payer (sig: string): { client: x402Client, calls: () => number } {
  let n = 0
  const scheme: SchemeNetworkClient = {
    scheme: 'mock',
    createPaymentPayload: async () => { n++; return { x402Version: 2, payload: { sig } } }
  }
  return { client: new x402Client().register(DEVNET, scheme).setSpendControls(false), calls: () => n }
}

const node = async (): Promise<Libp2p> => createLibp2p({
  addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()]
})

const req = (payTo: string, amount = '1000'): PaymentRequirements =>
  ({ scheme: 'mock', network: DEVNET, amount, asset: 'USDC', payTo, maxTimeoutSeconds: 60, extra: {} })
const echo = async ({ lp }: PaidContext): Promise<void> => { await lp.write(await lp.read()) }

interface SetupOpts {
  payTo?: string
  settle?: PaidOptions['settle']
  invoice?: (payee: string) => PaidOptions['invoice']
  handler?: (ctx: PaidContext) => Promise<void>
}

async function setup (opts: SetupOpts = {}): Promise<{ provider: Libp2p, agent: Libp2p, settles: () => number, close: () => Promise<void> }> {
  const [provider, agent] = await Promise.all([node(), node()])
  const facilitator = mockFacilitator()
  const server = new x402ResourceServer(facilitator).register(DEVNET, mockSchemeServer)
  await server.initialize()
  const payee = payeeFromPeerId(provider.peerId)!
  await provider.handle(PROTOCOL, paid(server, {
    accepts: [req(opts.payTo ?? payee)],
    resource: { url: `libp2p://${provider.peerId}${PROTOCOL}` },
    settle: opts.settle,
    invoice: opts.invoice?.(payee)
  }, opts.handler ?? echo))
  return { provider, agent, settles: facilitator.settles, close: async () => { await Promise.all([provider.stop(), agent.stop()]) } }
}

test('payeeFromPeerId gives the Solana address of the Ed25519 key', async () => {
  // RFC 8032 §7.1 test 1 key. Expected value: plain base58 (bitcoin alphabet) of its public key, computed outside this codebase.
  const sk = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex')
  const key = await privateKeyFromRaw(new Uint8Array([...sk, ...Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex')]))
  assert.equal(payeeFromPeerId(peerIdFromPrivateKey(key)), 'FVen3X669xLzsi6N2V91DoiyzHzg1uAgqiT8jZ9nS96Z')
})

test('agent pays provider, gets settlement, then the gated protocol runs', async () => {
  const { provider, agent, close } = await setup()
  try {
    const { client } = payer('ok')
    const { lp, settlement } = await payAndOpen(agent, provider.getMultiaddrs()[0], PROTOCOL, client)
    assert.equal(settlement?.transaction, 'mocktx')
    await lp.write(new TextEncoder().encode('hello'))
    assert.equal(new TextDecoder().decode((await lp.read()).subarray()), 'hello')
  } finally { await close() }
})

test('agent refuses to sign when payTo is not the remote peer key', async () => {
  const other = payeeFromPeerId(peerIdFromPrivateKey(await generateKeyPair('Ed25519')))
  const { provider, agent, close } = await setup({ payTo: other })
  try {
    const { client, calls } = payer('ok')
    await assert.rejects(payAndOpen(agent, provider.getMultiaddrs()[0], PROTOCOL, client),
      (e: X402Error) => e.code === 'payee_mismatch')
    assert.equal(calls(), 0, 'no payment may be created for a mismatched payee')
  } finally { await close() }
})

test('invalid payment gets an x402/error frame carrying a fresh PaymentRequired', async () => {
  const { provider, agent, close } = await setup()
  try {
    await assert.rejects(payAndOpen(agent, provider.getMultiaddrs()[0], PROTOCOL, payer('bad').client),
      (e: X402Error) => e.code === 'invalid_signature' && e.paymentRequired?.accepts.length === 1)
  } finally { await close() }
})

test('request frame yields an invoice that is paid instead of the rate card', async () => {
  let seen: unknown
  const { provider, agent, close } = await setup({
    invoice: (payee) => async (request) => { seen = request.root; return [req(payee, '2500')] }
  })
  try {
    const { settlement, paymentRequired } = await payAndOpen(agent, provider.getMultiaddrs()[0], PROTOCOL, payer('ok').client, { request: { root: 'bafyroot' } })
    assert.equal(settlement?.transaction, 'mocktx')
    assert.equal(paymentRequired.accepts[0].amount, '2500')
    assert.equal(seen, 'bafyroot')
  } finally { await close() }
})

test('invoice with foreign payTo is refused', async () => {
  const other = payeeFromPeerId(peerIdFromPrivateKey(await generateKeyPair('Ed25519')))!
  const { provider, agent, close } = await setup({ invoice: () => async () => [req(other, '2500')] })
  try {
    const { client, calls } = payer('ok')
    await assert.rejects(payAndOpen(agent, provider.getMultiaddrs()[0], PROTOCOL, client, { request: { root: 'bafyroot' } }),
      (e: X402Error) => e.code === 'payee_mismatch')
    assert.equal(calls(), 0)
  } finally { await close() }
})

test('manual settle: handler fails before settle and no settlement happens', async () => {
  const { provider, agent, settles, close } = await setup({
    settle: 'manual',
    handler: async (ctx) => { await ctx.lp.read(); await ctx.fail('resource_invalid', 'block 3 hash mismatch') }
  })
  try {
    const { lp } = await payAndOpen(agent, provider.getMultiaddrs()[0], PROTOCOL, payer('ok').client, { settle: 'manual' })
    await lp.write(new TextEncoder().encode('tampered car'))
    await assert.rejects(awaitSettlement(lp), (e: X402Error) => e.code === 'resource_invalid')
    assert.equal(settles(), 0)
  } finally { await close() }
})

test('manual settle: handler settles then replies', async () => {
  const { provider, agent, settles, close } = await setup({
    settle: 'manual',
    handler: async (ctx) => { const body = await ctx.lp.read(); await ctx.settle(); await ctx.lp.write(body) }
  })
  try {
    const { lp } = await payAndOpen(agent, provider.getMultiaddrs()[0], PROTOCOL, payer('ok').client, { settle: 'manual' })
    await lp.write(new TextEncoder().encode('good car'))
    assert.equal((await awaitSettlement(lp)).transaction, 'mocktx')
    assert.equal(new TextDecoder().decode((await lp.read()).subarray()), 'good car')
    assert.equal(settles(), 1)
  } finally { await close() }
})

test('garbage first frame resets the stream instead of leaving it open', async () => {
  const { provider, agent, close } = await setup()
  try {
    const stream = await agent.dialProtocol(provider.getMultiaddrs()[0], PROTOCOL)
    const { lpStream } = await import('@libp2p/utils')
    const lp = lpStream(stream)
    await lp.read() // rate card
    await lp.write(new TextEncoder().encode('not json'))
    await assert.rejects(lp.read({ signal: AbortSignal.timeout(5000) }), (e: Error) => e.name !== 'TimeoutError' && e.name !== 'AbortError')
  } finally { await close() }
})
