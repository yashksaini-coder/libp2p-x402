import { createHelia } from 'helia'
import type { HeliaWithLibp2p } from '@helia/libp2p'
type Helia = HeliaWithLibp2p<any>
import { tcp } from '@libp2p/tcp'
import { noise } from '@libp2p/noise'
import { yamux } from '@libp2p/yamux'
import { identify } from '@libp2p/identify'
import { unixfs } from '@helia/unixfs'
import { car } from '@helia/car'
import { x402Client } from '@x402/core/client'
import { x402ResourceServer, type FacilitatorClient } from '@x402/core/server'
import type { PaymentRequirements, SchemeNetworkClient, SchemeNetworkServer } from '@x402/core/types'
import type { CID } from 'multiformats/cid'
import { payeeFromPeerId } from 'x402-libp2p'
import type { Pricing } from '../src/index.ts'

export const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const

export async function heliaNode (): Promise<Helia> {
  const helia = createHelia({
    libp2p: {
      addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
      transports: [tcp()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [],
      services: { identify: identify() }
    } as any
  })
  await helia.start()
  return helia
}

// Mock x402 scheme: the wire format and payment flow are real, the chain is not.
const schemeServer: SchemeNetworkServer = {
  scheme: 'mock',
  defaultAssetTransferMethod: 'default',
  paymentFlows: { default: { supported: ['authorization'], default: 'authorization' } },
  parsePrice: async () => ({ amount: '1000', asset: 'USDC' }),
  enhancePaymentRequirements: async (r: PaymentRequirements) => r
}

export async function mockServer (): Promise<{ server: x402ResourceServer, settles: () => number, memos: string[] }> {
  let n = 0
  const memos: string[] = []
  const facilitator: FacilitatorClient = {
    verify: async () => ({ isValid: true, payer: 'agentAddr' }),
    settle: async (_p, r) => { n++; memos.push(String(r.extra?.memo)); return { success: true, transaction: `mocktx${n}`, network: r.network, payer: 'agentAddr' } },
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'mock', network: DEVNET }], extensions: [], signers: {} })
  }
  const server = new x402ResourceServer(facilitator).register(DEVNET, schemeServer)
  await server.initialize()
  return { server, settles: () => n, memos }
}

export function mockClient (): x402Client {
  const scheme: SchemeNetworkClient = { scheme: 'mock', createPaymentPayload: async () => ({ x402Version: 2, payload: { sig: 'ok' } }) }
  return new x402Client().register(DEVNET, scheme).setSpendControls(false)
}

export const pricingFor = (helia: Helia): Pricing => ({
  scheme: 'mock', network: DEVNET, asset: 'USDC', payTo: payeeFromPeerId(helia.libp2p.peerId)!,
  perMiB: 10_000n, minAmount: 1_000n, maxTimeoutSeconds: 60
})

/** A multi-block UnixFS file (small chunks so the CAR has many blocks). */
export async function addFile (helia: Helia, size = 300_000): Promise<{ root: CID, data: Uint8Array }> {
  const data = new Uint8Array(size).map((_, i) => (i * 31 + 7) % 251)
  const { fixedSize } = await import('ipfs-unixfs-importer/chunker')
  const root = await unixfs(helia).addBytes(data, { chunker: fixedSize({ chunkSize: 16_384 }) })
  return { root, data }
}

export async function carOf (helia: Helia, root: CID): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for await (const b of car(helia).export(root, { offline: true })) parts.push(b)
  return Buffer.concat(parts)
}

/** Flip one byte inside the payload of block `index`; returns a CAR that still parses. */
export async function tamper (carBytes: Uint8Array, index: number): Promise<Uint8Array> {
  const { CarReader } = await import('@ipld/car')
  const reader = await CarReader.fromBytes(carBytes)
  let i = 0
  for await (const b of reader.blocks()) {
    if (i++ !== index) continue
    const at = Buffer.from(carBytes).indexOf(Buffer.from(b.bytes))
    const out = Uint8Array.from(carBytes)
    out[at + b.bytes.byteLength - 1] ^= 0xff
    return out
  }
  throw new Error('no such block')
}
