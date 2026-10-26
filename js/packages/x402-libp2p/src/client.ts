import type { Libp2p, PeerId, Stream } from '@libp2p/interface'
import type { Multiaddr } from '@multiformats/multiaddr'
import { lpStream, type LengthPrefixedStream } from '@libp2p/utils'
import type { x402Client } from '@x402/core/client'
import type { PaymentRequired, SettleResponse } from '@x402/core/types'
import { MAX_FRAME_BYTES, X402Error, readFrame, writeFrame } from './frames.ts'
import { selectPayable } from './identity.ts'

export interface PaidStream {
  /** Framed stream positioned after the settlement frame; the app protocol continues here. */
  lp: LengthPrefixedStream<Stream>
  stream: Stream
  paymentRequired: PaymentRequired
  settlement: SettleResponse
}

/**
 * Open `protocol` on `peer`, pay what it asks, and return the stream once the
 * server has settled. The libp2p counterpart of `@x402/fetch`.
 */
export async function payAndOpen (node: Libp2p, peer: PeerId | Multiaddr, protocol: string, client: x402Client, opts: { signal?: AbortSignal } = {}): Promise<PaidStream> {
  const connection = await node.dial(peer, opts)
  const stream = await connection.newStream(protocol, opts)
  const lp = lpStream(stream, { maxDataLength: MAX_FRAME_BYTES })

  try {
    const first = await readFrame(lp, opts.signal)
    if (first.type !== 'x402/payment-required') throw new X402Error('invalid_frame', `expected x402/payment-required, got ${first.type}`)
    const paymentRequired = first.paymentRequired

    // Check the payee against the authenticated remote peer *before* signing anything.
    const accepts = selectPayable(paymentRequired.accepts, connection.remotePeer)
    if (accepts.length === 0) throw new X402Error('payee_mismatch', 'no requirement pays the remote peer', paymentRequired)

    const paymentPayload = await client.createPaymentPayload({ ...paymentRequired, accepts })
    await writeFrame(lp, { type: 'x402/payment', paymentPayload })

    const reply = await readFrame(lp, opts.signal)
    if (reply.type === 'x402/error') throw new X402Error(reply.code, reply.message, reply.paymentRequired)
    if (reply.type !== 'x402/settlement') throw new X402Error('invalid_frame', `expected x402/settlement, got ${reply.type}`)
    return { lp, stream, paymentRequired, settlement: reply.settlementResponse }
  } catch (err) {
    await stream.close().catch(() => stream.abort(err as Error))
    throw err
  }
}
