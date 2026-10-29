import type { Libp2p, PeerId, StreamHandler } from '@libp2p/interface'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { x402Client } from '@x402/core/client'
import type { x402ResourceServer } from '@x402/core/server'
import type { PaymentPayload, PaymentRequired, SettleResponse } from '@x402/core/types'
import type { HeliaWithLibp2p } from '@helia/libp2p'
type Helia = HeliaWithLibp2p<any>
import { CID } from 'multiformats/cid'
import { X402Error, paid, payAndOpen, type GateHooks, type PaidOptions, type PayHooks } from 'x402-libp2p'
import { exportCar, receiveCar, sendCar, verifyCar, type Block, type BlockCheck } from './car.ts'
import { FETCH_PROTOCOL, memoFor, price, rateCard, type Pricing } from './pricing.ts'

export interface FetchHooks extends GateHooks {
  onSettled?: (info: { root: CID, peer: PeerId, settlement: SettleResponse, payment: PaymentPayload, bytes: number }) => void
}

export function parseRoot (value: unknown): CID {
  try {
    return CID.parse(String(value))
  } catch {
    throw new X402Error('invalid_request', 'request.root is not a CID')
  }
}

/**
 * Serve `/ipfs-x402/fetch/1.0.0`: request `{ root }`, priced `exact` on the CAR
 * size, memo the root as CIDv0 (see memoFor). Settles before streaming the CAR.
 */
export function fetchHandler (helia: Helia, server: x402ResourceServer, pricing: Pricing, opts: { maxBytes: number, paymentTimeoutMs?: number, maxStreams?: PaidOptions['maxStreams'] }, hooks: FetchHooks = {}): StreamHandler {
  // Invoices are free to request, so never re-export a DAG per request: cache its size.
  // ponytail: unbounded per-root cache; fine for a node serving a known catalogue.
  const sizes = new Map<string, number>()
  const sizeOf = async (root: CID): Promise<number> => {
    const known = sizes.get(root.toString())
    if (known != null) return known
    const size = (await exportCar(helia, root, opts.maxBytes)).byteLength
    sizes.set(root.toString(), size)
    return size
  }

  return paid(server, {
    accepts: [rateCard(pricing)],
    resource: { url: `libp2p://${helia.libp2p.peerId}${FETCH_PROTOCOL}`, mimeType: 'application/vnd.ipld.car' },
    settle: 'before',
    paymentTimeoutMs: opts.paymentTimeoutMs,
    maxStreams: opts.maxStreams,
    hooks: { onInvoice: hooks.onInvoice, onVerified: hooks.onVerified },
    invoice: async (request) => {
      const root = parseRoot(request.root)
      return [price(pricing, await sizeOf(root), memoFor(root))]
    }
  }, async (ctx) => {
    if (ctx.request == null) return await ctx.fail('invalid_request', 'fetch needs an x402/request with a root')
    const root = parseRoot(ctx.request.root)
    const car = await exportCar(helia, root, opts.maxBytes)
    hooks.onSettled?.({ root, peer: ctx.connection.remotePeer, settlement: await ctx.settle(), payment: ctx.payment, bytes: car.byteLength })
    await sendCar(ctx.lp, car)
    await ctx.stream.close()
  })
}

export interface FetchResult {
  blocks: Block[]
  bytes: number
  settlement: SettleResponse
  paymentRequired: PaymentRequired
}

/** Pay a peer for a DAG and get it back hash-verified. */
export async function fetchPaid (node: Libp2p, peer: PeerId | Multiaddr, root: CID, client: x402Client, opts: { onBlock?: (b: BlockCheck) => void, maxBytes?: number, signal?: AbortSignal, hooks?: PayHooks } = {}): Promise<FetchResult> {
  const { lp, stream, settlement, paymentRequired } = await payAndOpen(node, peer, FETCH_PROTOCOL, client, { request: { root: root.toString() }, signal: opts.signal, hooks: opts.hooks })
  try {
    const car = await receiveCar(lp, opts.maxBytes ?? 64 * 1024 * 1024, opts.signal)
    const { blocks, bytes } = await verifyCar(car, root, opts.onBlock)
    return { blocks, bytes, settlement: settlement!, paymentRequired }
  } finally {
    await stream.close().catch(() => {})
  }
}
