import type { Connection, Stream, StreamHandler } from '@libp2p/interface'
import { lpStream, type LengthPrefixedStream } from '@libp2p/utils'
import type { x402ResourceServer } from '@x402/core/server'
import type { PaymentPayload, PaymentRequired, PaymentRequirements, ResourceInfo, SettleResponse } from '@x402/core/types'
import { MAX_FRAME_BYTES, readFrame, writeFrame } from './frames.ts'

export interface PaidOptions {
  accepts: PaymentRequirements[]
  resource: ResourceInfo
  /** How long to wait for the client's payment frame. Default 30s. */
  paymentTimeoutMs?: number
}

export interface PaidContext {
  /** The same framed stream, positioned after the settlement frame. */
  lp: LengthPrefixedStream<Stream>
  stream: Stream
  connection: Connection
  payment: PaymentPayload
  settlement: SettleResponse
}

/**
 * Gate a libp2p protocol behind an x402 payment: the libp2p counterpart of
 * `@x402/express`. The handler runs only after the payment has settled.
 */
export function paid (server: x402ResourceServer, opts: PaidOptions, handler: (ctx: PaidContext) => Promise<void>): StreamHandler {
  return async (stream, connection) => {
    const lp = lpStream(stream, { maxDataLength: MAX_FRAME_BYTES })
    const fail = async (code: string, message?: string, paymentRequired?: PaymentRequired): Promise<void> => {
      await writeFrame(lp, { type: 'x402/error', code, message, paymentRequired })
      await stream.close() // close, not abort: a reset could drop the error frame in flight
    }

    try {
      // Server speaks first: the PaymentRequired frame is both the challenge and the quote.
      const paymentRequired = await server.createPaymentRequiredResponse(opts.accepts, opts.resource)
      await writeFrame(lp, { type: 'x402/payment-required', paymentRequired })

      const frame = await readFrame(lp, AbortSignal.timeout(opts.paymentTimeoutMs ?? 30_000))
      if (frame.type !== 'x402/payment') return await fail('invalid_frame', `expected x402/payment, got ${frame.type}`)

      const payment = frame.paymentPayload
      const requirements = server.findMatchingRequirements(paymentRequired.accepts, payment)
      if (requirements == null) return await fail('no_matching_requirements', undefined, paymentRequired)

      const verified = await server.verifyPayment(payment, requirements)
      if (!verified.isValid) return await fail(verified.invalidReason ?? 'invalid_payment', verified.invalidMessage, paymentRequired)

      // Verify -> settle -> deliver: delivered bytes cannot be recalled, so settle first.
      const settlement = await server.settlePayment(payment, requirements)
      if (!settlement.success) return await fail(settlement.errorReason ?? 'settlement_failed', settlement.errorMessage, paymentRequired)

      await writeFrame(lp, { type: 'x402/settlement', settlementResponse: settlement })
      await handler({ lp, stream, connection, payment, settlement })
    } catch (err) {
      stream.abort(err as Error)
    }
  }
}
