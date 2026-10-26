import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLibp2p, type Libp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { generateKeyPair, privateKeyFromRaw } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { x402Client } from '@x402/core/client'
import { x402ResourceServer } from '@x402/core/server'
import type { FacilitatorClient } from '@x402/core/server'
import type { PaymentRequirements, SchemeNetworkClient, SchemeNetworkServer } from '@x402/core/types'
import { paid, payAndOpen, payeeFromPeerId, X402Error } from '../src/index.ts'

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
const mockFacilitator: FacilitatorClient = {
  verify: async (p) => p.payload.sig === 'ok' ? { isValid: true, payer: 'agent' } : { isValid: false, invalidReason: 'invalid_signature' },
  settle: async (_p, r) => ({ success: true, transaction: 'mocktx', network: r.network, payer: 'agent' }),
  getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'mock', network: DEVNET }], extensions: [], signers: {} })
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

async function setup (payTo?: string): Promise<{ provider: Libp2p, agent: Libp2p, close: () => Promise<void> }> {
  const [provider, agent] = await Promise.all([node(), node()])
  const server = new x402ResourceServer(mockFacilitator).register(DEVNET, mockSchemeServer)
  await server.initialize()
  const accepts = [{ scheme: 'mock', network: DEVNET, amount: '1000', asset: 'USDC', payTo: payTo ?? payeeFromPeerId(provider.peerId)!, maxTimeoutSeconds: 60, extra: {} }]
  await provider.handle(PROTOCOL, paid(server, { accepts, resource: { url: `libp2p://${provider.peerId}${PROTOCOL}` } }, async ({ lp }) => {
    await lp.write(await lp.read()) // echo one frame
  }))
  return { provider, agent, close: async () => { await Promise.all([provider.stop(), agent.stop()]) } }
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
    assert.equal(settlement.transaction, 'mocktx')
    await lp.write(new TextEncoder().encode('hello'))
    assert.equal(new TextDecoder().decode((await lp.read()).subarray()), 'hello')
  } finally { await close() }
})

test('agent refuses to sign when payTo is not the remote peer key', async () => {
  const other = payeeFromPeerId(peerIdFromPrivateKey(await generateKeyPair('Ed25519')))
  const { provider, agent, close } = await setup(other)
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
