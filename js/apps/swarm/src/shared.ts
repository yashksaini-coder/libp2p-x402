// Code the browser seller (js/apps/web, /sell) shares with the swarm. Browser-safe: no Node APIs.
import { unixfs } from '@helia/unixfs'
import type { HeliaWithLibp2p } from '@helia/libp2p'
import type { Network, PaymentRequirements, SchemeNetworkClient, SchemeNetworkServer } from '@x402/core/types'
import type { Pricing } from 'ipfs-x402'
import { fixedSize } from 'ipfs-unixfs-importer/chunker'
import type { CID } from 'multiformats/cid'

/** Add bytes as a UnixFS file in small chunks, so the CAR has enough blocks to watch verify. Same bytes, same CID, on any node. */
export async function addContent (node: HeliaWithLibp2p<any>, data: Uint8Array): Promise<CID> {
  return await unixfs(node).addBytes(data, { chunker: fixedSize({ chunkSize: 16_384 }) })
}

/** Demo payloads: readable, deterministic, a few hundred KB. */
export function dataset (): Uint8Array {
  const lines = Array.from({ length: 4200 }, (_, i) =>
    JSON.stringify({ i, city: ['Mumbai', 'Pune', 'Bengaluru', 'Delhi', 'Chennai'][i % 5], aqi: 40 + ((i * 37) % 260), at: 1793000000 + i * 600 }))
  return new TextEncoder().encode(lines.join('\n'))
}

export const priceFor = (scheme: string, network: Network, asset: string) => (payTo: string): Pricing => ({
  scheme, network, asset, payTo,
  perMiB: 10_000n, // 0.01 USDC per MiB
  minAmount: 1_000n, // 0.001 USDC
  maxTimeoutSeconds: 60
})

/** Mock mode's scheme: the x402 wire flow is real, the chain is not. */
export const mockSchemeServer: SchemeNetworkServer = {
  scheme: 'mock',
  defaultAssetTransferMethod: 'default',
  paymentFlows: { default: { supported: ['authorization'], default: 'authorization' } },
  parsePrice: async (price: any) => ({ amount: price.amount, asset: price.asset, extra: price.extra }), // exact amounts pass through, as in @x402/svm
  enhancePaymentRequirements: async (r: PaymentRequirements) => r
}

/**
 * Mock mode's paying side. The nonce mirrors real payloads, so two buyers never share an attribution tag queue (payments.ts tagPayment).
 * globalThis.crypto: browser-safe, no node:crypto.
 */
export const mockSchemeClient: SchemeNetworkClient = {
  scheme: 'mock',
  createPaymentPayload: async () => ({ x402Version: 2, payload: { sig: 'mock', nonce: globalThis.crypto.randomUUID() } })
}

/** GET /sell/config: what a browser seller needs to price, settle through the swarm, and reach the relay. */
export interface SellConfig { mode: 'mock' | 'devnet', scheme: string, network: Network, asset: string, rpcUrl?: string, relay: string, root: string }

/** GET /visitor/config: what a visitor's browser needs to buy from the seller over WebSockets. */
export interface VisitorConfig {
  mode: 'mock' | 'devnet'
  network: Network
  asset: string
  rpcUrl?: string
  root: string
  seller: { peerId: string, payee: string, addrs: string[] }
  drip: { amount: string, enabled: boolean }
}
