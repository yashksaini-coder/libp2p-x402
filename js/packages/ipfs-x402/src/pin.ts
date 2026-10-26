import type { Libp2p, PeerId, StreamHandler } from '@libp2p/interface'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { x402Client } from '@x402/core/client'
import type { x402ResourceServer } from '@x402/core/server'
import type { SettleResponse } from '@x402/core/types'
import type { HeliaWithLibp2p } from '@helia/libp2p'
type Helia = HeliaWithLibp2p<any>
import type { CID } from 'multiformats/cid'
import { X402Error, awaitSettlement, paid, payAndOpen, type PayHooks } from 'x402-libp2p'
import { receiveCar, sendCar, verifyCar, type BlockCheck } from './car.ts'
import { parseRoot } from './fetch.ts'
import { PIN_PROTOCOL, memoFor, price, rateCard, type Pricing } from './pricing.ts'
import { putReceipt, type Receipt } from './receipt.ts'

export interface PinOptions { maxBytes: number, durationDays: number }

/** Best-effort cleanup: the client must still get the original error. */
const ignore = async (fn: () => Promise<void>): Promise<void> => { try { await fn() } catch {} }

/** Runs tasks with the same key one after another (tasks with different keys run concurrently). */
class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>()
  async run<T> (key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(task)
    this.tails.set(key, next)
    try {
      return await next
    } finally {
      if (this.tails.get(key) === next) this.tails.delete(key)
    }
  }
}

export interface PinHooks {
  onBlock?: (b: BlockCheck & { peer: PeerId }) => void
  onRejected?: (info: { root: CID, peer: PeerId, code: string, message: string }) => void
  onPinned?: (info: { root: CID, receipt: CID, receiptBody: Receipt, peer: PeerId, settlement: SettleResponse }) => void
}

export interface PinReply { pinned: string, receipt: string, expiresAt: string }

function declaredBytes (value: unknown): number {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n <= 0) throw new X402Error('invalid_request', 'request.bytes must be a positive integer')
  return n
}

/**
 * Serve `/ipfs-x402/pin/1.0.0`: request `{ root, bytes }`, priced `exact` on the
 * declared size. Order: payment verified, CAR received, every block verified,
 * stored and pinned, then settle (undoing the pin and new blocks if the
 * facilitator declines). A bad CAR, or a
 * pin that cannot be made, is rejected before any money moves. Re-pinning a held
 * root is a renewal: it settles and gets a fresh receipt.
 */
export function pinHandler (helia: Helia, server: x402ResourceServer, pricing: Pricing, opts: PinOptions, hooks: PinHooks = {}): StreamHandler {
  const locks = new KeyedLock()
  return paid(server, {
    accepts: [rateCard(pricing)],
    resource: { url: `libp2p://${helia.libp2p.peerId}${PIN_PROTOCOL}` },
    settle: 'manual',
    invoice: async (request) => {
      const root = parseRoot(request.root)
      const bytes = declaredBytes(request.bytes)
      if (bytes > opts.maxBytes) throw new X402Error('resource_too_large', `pins are limited to ${opts.maxBytes} bytes`)
      return [price(pricing, bytes, memoFor(root))]
    }
  }, async (ctx) => {
    if (ctx.request == null) return await ctx.fail('invalid_request', 'pin needs an x402/request with root and bytes')
    const peer = ctx.connection.remotePeer
    const root = parseRoot(ctx.request.root)

    let checked
    try {
      const car = await receiveCar(ctx.lp, declaredBytes(ctx.request.bytes), AbortSignal.timeout(60_000))
      checked = await verifyCar(car, root, b => hooks.onBlock?.({ ...b, peer }))
    } catch (err) {
      if (!(err instanceof X402Error)) throw err // stream died mid-CAR: nothing settled, gate resets
      hooks.onRejected?.({ root, peer, code: err.code, message: err.message })
      return await ctx.fail(err.code, err.message)
    }

    // Store and pin *before* settling: storage can be undone, a payment cannot. Rollback deletes
    // blocks this upload added, and different DAGs can share blocks, so the whole
    // store -> pin -> settle -> rollback sequence runs one upload at a time per provider.
    // ponytail: provider-wide lock serialises settlements (~1 s each on devnet); per-block
    // reference counts of in-flight uploads would allow concurrency if throughput matters.
    const settlement = await locks.run('store', async () => {
      const added: CID[] = []
      for (const b of checked.blocks) {
        if (!(await helia.blockstore.has(b.cid))) added.push(b.cid)
        await helia.blockstore.put(b.cid, b.bytes)
      }
      const renewal = await helia.pins.isPinned(root)
      if (!renewal) {
        // offline: verifyCar proved the DAG complete, so pinning must never reach the network
        for await (const _ of helia.pins.add(root, { offline: true, signal: AbortSignal.timeout(10_000) } as any)) { /* drain */ }
      }
      try {
        return await ctx.settle()
      } catch (err) {
        // Roll back only when the facilitator declined (X402Error). Any other error may come
        // after money moved (e.g. the settlement frame failed to send): then keep what was paid for.
        if (err instanceof X402Error) {
          // Each step on its own: pins.rm can throw after unpinning (e.g. "no content routers"
          // when cancelling re-announcement on a node without a DHT), which must not skip the deletes.
          if (!renewal) await ignore(async () => { for await (const _ of helia.pins.rm(root)) { /* drain */ } })
          for (const cid of added) await ignore(async () => { await helia.blockstore.delete(cid) })
        }
        throw err
      }
    })

    const receiptBody: Receipt = {
      cid: root.toString(),
      payer: settlement.payer ?? '',
      payee: ctx.requirements.payTo,
      network: settlement.network,
      tx: settlement.transaction,
      bytes: checked.bytes,
      expiresAt: new Date(Date.now() + opts.durationDays * 86_400_000).toISOString()
    }
    const receipt = await putReceipt(helia, receiptBody)
    hooks.onPinned?.({ root, receipt, receiptBody, peer, settlement })
    const reply: PinReply = { pinned: root.toString(), receipt: receipt.toString(), expiresAt: receiptBody.expiresAt }
    await ctx.lp.write(new TextEncoder().encode(JSON.stringify(reply)))
    await ctx.stream.close()
  })
}

/** Pay a peer to pin `car` (a CAR whose single root is `root`). */
export async function pinPaid (node: Libp2p, peer: PeerId | Multiaddr, car: Uint8Array, root: CID, client: x402Client, opts: { signal?: AbortSignal, hooks?: PayHooks } = {}): Promise<PinReply & { settlement: SettleResponse }> {
  const { lp, stream } = await payAndOpen(node, peer, PIN_PROTOCOL, client, { request: { root: root.toString(), bytes: car.byteLength }, settle: 'manual', signal: opts.signal, hooks: opts.hooks })
  try {
    await sendCar(lp, car)
    const settlement = await awaitSettlement(lp, opts.signal)
    const reply = JSON.parse(new TextDecoder().decode((await lp.read({ signal: opts.signal })).subarray())) as PinReply
    return { ...reply, settlement }
  } finally {
    await stream.close().catch(() => {})
  }
}
