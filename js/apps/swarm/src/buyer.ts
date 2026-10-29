// The visitor's buyer. Browser-safe (no Node APIs); the swarm tests run it in Node too.
import { createHelia } from 'helia'
import { unixfs } from '@helia/unixfs'
import { identify } from '@libp2p/identify'
import type { Libp2p } from '@libp2p/interface'
import { noise } from '@libp2p/noise'
import { webSockets } from '@libp2p/websockets'
import { yamux } from '@libp2p/yamux'
import { multiaddr } from '@multiformats/multiaddr'
import type { TransactionSigner } from '@solana/kit'
import { x402Client } from '@x402/core/client'
import type { PaymentRequired, SettleResponse } from '@x402/core/types'
import { ExactSvmScheme } from '@x402/svm/exact/client'
import { fetchPaid, parseRoot, type BlockCheck } from 'ipfs-x402'
import type { PayHooks } from 'x402-libp2p'
import { mockSchemeClient, type VisitorConfig } from './shared.ts'

export interface Buyer { libp2p: Libp2p, stop: () => Promise<void> }

export type Payer = { kind: 'wallet', signer: TransactionSigner } | { kind: 'mock' }

export interface BuyHooks { pay?: PayHooks, onBlock?: (b: BlockCheck) => void, onDial?: (ms: number) => void }

export interface Bought { bytes: number, blocks: number, data: Uint8Array, settlement: SettleResponse, paymentRequired: PaymentRequired }

/** A dial-only node: WebSockets out to the seller, nothing listening, no discovery. */
export async function startBuyer (): Promise<Buyer> {
  const helia = createHelia({
    libp2p: {
      addresses: { listen: [] },
      transports: [webSockets()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [],
      // Browsers deny private addresses by default; the only address this node dials is the configured seller (loopback in local runs).
      connectionGater: { denyDialMultiaddr: () => false },
      services: { identify: identify() }
    } as any
  })
  await helia.start()
  // Kept on the Buyer so `buy` can reassemble the file from the verified blocks.
  const buyer: Buyer & { helia: typeof helia } = { libp2p: helia.libp2p as unknown as Libp2p, helia, stop: async () => { await helia.stop() } }
  return buyer
}

/** Pay the seller for the dataset and return its bytes, hash-verified block by block. */
export async function buy (buyer: Buyer, config: VisitorConfig, payer: Payer, hooks: BuyHooks, signal?: AbortSignal): Promise<Bought> {
  const helia = (buyer as Buyer & { helia: Awaited<ReturnType<typeof createHelia>> }).helia
  const client = payer.kind === 'wallet'
    ? new x402Client().register(config.network, new ExactSvmScheme(payer.signer, { rpcUrl: config.rpcUrl }))
    : new x402Client().register(config.network, mockSchemeClient).setSpendControls(false)
  const addr = multiaddr(config.seller.addrs[0])
  const dialStart = Date.now()
  await buyer.libp2p.dial(addr, { signal })
  hooks.onDial?.(Date.now() - dialStart)

  const root = parseRoot(config.root)
  const res = await fetchPaid(buyer.libp2p, addr, root, client, { onBlock: hooks.onBlock, signal, hooks: hooks.pay })
  for (const b of res.blocks) await helia.blockstore.put(b.cid, b.bytes, { signal })
  const parts: Uint8Array[] = []
  for await (const chunk of unixfs(helia).cat(root, { offline: true, signal })) parts.push(chunk)
  const data = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const p of parts) { data.set(p, at); at += p.byteLength }
  return { bytes: res.bytes, blocks: res.blocks.length, data, settlement: res.settlement, paymentRequired: res.paymentRequired }
}
