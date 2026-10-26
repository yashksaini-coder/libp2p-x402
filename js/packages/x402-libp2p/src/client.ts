import type { Libp2p, PeerId, Stream } from '@libp2p/interface'
import type { Multiaddr } from '@multiformats/multiaddr'
import { lpStream, type LengthPrefixedStream } from '@libp2p/utils'
import type { x402Client } from '@x402/core/client'
import type { PaymentPayload, PaymentRequired, SettleResponse } from '@x402/core/types'
import { MAX_FRAME_BYTES, X402Error, readFrame, writeFrame } from './frames.ts'
import { selectPayable } from './identity.ts'

export interface PaidStream {
  /** Framed stream; the app protocol continues here. */
  lp: LengthPrefixedStream<Stream>
  stream: Stream
  /** What was paid: the invoice when a request was sent, else the rate card. */
  paymentRequired: PaymentRequired
  /** Present when the server settles before delivering; in manual mode use awaitSettlement(). */
  settlement?: SettleResponse
}

export interface PayOptions {
  /** Sent as `x402/request` to get an invoice priced for this request. */
  request?: Record<string, unknown>
  /** Must match the protocol's server mode. Default `before`. */
  settle?: 'before' | 'manual'
  signal?: AbortSignal
  /** Observability hooks (dashboards, logs). Called in protocol order. */
  hooks?: PayHooks
}

export interface PayHooks {
  onPaymentRequired?: (paymentRequired: PaymentRequired, invoice: boolean) => void
  onPayeeCheck?: (check: { payTo: string, remotePeer: PeerId, ok: boolean }) => void
  onPayment?: (payload: PaymentPayload) => void
}

/** Read the next frame and expect `x402/settlement`; an `x402/error` frame throws. */
export async function awaitSettlement (lp: LengthPrefixedStream, signal?: AbortSignal): Promise<SettleResponse> {
  const reply = await readFrame(lp, signal)
  if (reply.type === 'x402/error') throw new X402Error(reply.code, reply.message, reply.paymentRequired)
  if (reply.type !== 'x402/settlement') throw new X402Error('invalid_frame', `expected x402/settlement, got ${reply.type}`)
  return reply.settlementResponse
}

async function expectPaymentRequired (lp: LengthPrefixedStream, signal?: AbortSignal): Promise<PaymentRequired> {
  const frame = await readFrame(lp, signal)
  if (frame.type === 'x402/error') throw new X402Error(frame.code, frame.message, frame.paymentRequired)
  if (frame.type !== 'x402/payment-required') throw new X402Error('invalid_frame', `expected x402/payment-required, got ${frame.type}`)
  return frame.paymentRequired
}

/**
 * Open `protocol` on `peer`, pay what it asks, and return the stream. The
 * libp2p counterpart of `@x402/fetch`.
 */
export async function payAndOpen (node: Libp2p, peer: PeerId | Multiaddr, protocol: string, client: x402Client, opts: PayOptions = {}): Promise<PaidStream> {
  const connection = await node.dial(peer, opts)
  const stream = await connection.newStream(protocol, opts)
  const lp = lpStream(stream, { maxDataLength: MAX_FRAME_BYTES })

  try {
    const hooks = opts.hooks ?? {}
    let paymentRequired = await expectPaymentRequired(lp, opts.signal) // the rate card
    hooks.onPaymentRequired?.(paymentRequired, false)
    if (opts.request != null) {
      await writeFrame(lp, { type: 'x402/request', request: opts.request })
      paymentRequired = await expectPaymentRequired(lp, opts.signal) // the invoice supersedes it
      hooks.onPaymentRequired?.(paymentRequired, true)
    }

    // Check the payee against the authenticated remote peer *before* signing anything.
    const accepts = selectPayable(paymentRequired.accepts, connection.remotePeer)
    hooks.onPayeeCheck?.({ payTo: paymentRequired.accepts[0]?.payTo ?? '', remotePeer: connection.remotePeer, ok: accepts.length > 0 })
    if (accepts.length === 0) throw new X402Error('payee_mismatch', 'no requirement pays the remote peer', paymentRequired)

    const paymentPayload = await client.createPaymentPayload({ ...paymentRequired, accepts })
    hooks.onPayment?.(paymentPayload)
    await writeFrame(lp, { type: 'x402/payment', paymentPayload })

    if (opts.settle === 'manual') return { lp, stream, paymentRequired }
    return { lp, stream, paymentRequired, settlement: await awaitSettlement(lp, opts.signal) }
  } catch (err) {
    await stream.close().catch(() => stream.abort(err as Error))
    throw err
  }
}
