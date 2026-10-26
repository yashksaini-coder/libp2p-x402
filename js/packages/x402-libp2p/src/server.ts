import type { Connection, PeerId, Stream, StreamHandler } from '@libp2p/interface'
import { lpStream, type LengthPrefixedStream } from '@libp2p/utils'
import type { x402ResourceServer } from '@x402/core/server'
import type { PaymentPayload, PaymentRequired, PaymentRequirements, ResourceInfo, SettleResponse } from '@x402/core/types'
import { MAX_FRAME_BYTES, X402Error, readFrame, writeFrame } from './frames.ts'

export interface PaidOptions {
  /** The rate card: sent as the first frame on every stream. */
  accepts: PaymentRequirements[]
  resource: ResourceInfo
  /**
   * `before` (default): settle before the handler runs (deliveries).
   * `manual`: the handler calls `ctx.settle()` once it has checked what it was sent.
   */
  settle?: 'before' | 'manual'
  /**
   * Price a specific request. When set, a client may send `x402/request` after the
   * rate card and gets back an invoice (a second `x402/payment-required`) to pay.
   * Throw an X402Error to refuse the request.
   */
  invoice?: (request: Record<string, unknown>, peer: PeerId) => Promise<PaymentRequirements[]>
  /** How long to wait for each client control frame. Default 30s. */
  paymentTimeoutMs?: number
}

export interface PaidContext {
  /** The same framed stream, positioned after the client's payment frame. */
  lp: LengthPrefixedStream<Stream>
  stream: Stream
  connection: Connection
  payment: PaymentPayload
  requirements: PaymentRequirements
  /** The client's `x402/request` body, when the invoice step ran. */
  request?: Record<string, unknown>
  /** Settle (once) and send `x402/settlement`. On failure reports `x402/error`, closes, and throws. */
  settle: () => Promise<SettleResponse>
  /** Report an error, close the stream. Nothing is settled unless settle() already ran. */
  fail: (code: string, message?: string) => Promise<void>
}

/**
 * Gate a libp2p protocol behind an x402 payment: the libp2p counterpart of
 * `@x402/express`. Nothing paid may be delivered before `settle()` resolves.
 */
export function paid (server: x402ResourceServer, opts: PaidOptions, handler: (ctx: PaidContext) => Promise<void>): StreamHandler {
  const timeout = (): AbortSignal => AbortSignal.timeout(opts.paymentTimeoutMs ?? 30_000)

  return async (stream, connection) => {
    const lp = lpStream(stream, { maxDataLength: MAX_FRAME_BYTES })
    const fail = async (code: string, message?: string, paymentRequired?: PaymentRequired): Promise<void> => {
      await writeFrame(lp, { type: 'x402/error', code, message, paymentRequired })
      await stream.close() // close, not abort: a reset could drop the error frame in flight
    }

    try {
      // Server speaks first: the rate card is both the challenge and the free quote.
      let paymentRequired = await server.createPaymentRequiredResponse(opts.accepts, opts.resource)
      await writeFrame(lp, { type: 'x402/payment-required', paymentRequired })

      let frame = await readFrame(lp, timeout())
      let request: Record<string, unknown> | undefined
      if (frame.type === 'x402/request' && opts.invoice != null) {
        request = frame.request
        let accepts: PaymentRequirements[]
        try {
          accepts = await opts.invoice(request, connection.remotePeer)
        } catch (err) {
          if (err instanceof X402Error) return await fail(err.code, err.message)
          throw err
        }
        // A later payment-required supersedes the rate card.
        paymentRequired = await server.createPaymentRequiredResponse(accepts, opts.resource)
        await writeFrame(lp, { type: 'x402/payment-required', paymentRequired })
        frame = await readFrame(lp, timeout())
      }
      if (frame.type !== 'x402/payment') return await fail('invalid_frame', `expected x402/payment, got ${frame.type}`)

      const payment = frame.paymentPayload
      const requirements = server.findMatchingRequirements(paymentRequired.accepts, payment)
      if (requirements == null) return await fail('no_matching_requirements', undefined, paymentRequired)

      const verified = await server.verifyPayment(payment, requirements)
      if (!verified.isValid) return await fail(verified.invalidReason ?? 'invalid_payment', verified.invalidMessage, paymentRequired)

      let settled: Promise<SettleResponse> | undefined
      const settle = async (): Promise<SettleResponse> => {
        settled ??= (async () => {
          const settlement = await server.settlePayment(payment, requirements)
          if (!settlement.success) {
            await fail(settlement.errorReason ?? 'settlement_failed', settlement.errorMessage, paymentRequired)
            throw new X402Error(settlement.errorReason ?? 'settlement_failed', settlement.errorMessage)
          }
          await writeFrame(lp, { type: 'x402/settlement', settlementResponse: settlement })
          return settlement
        })()
        return await settled
      }

      // Verify -> settle -> deliver: delivered bytes cannot be recalled.
      if ((opts.settle ?? 'before') === 'before') await settle()
      await handler({ lp, stream, connection, payment, requirements, request, settle, fail: async (code, message) => { await fail(code, message) } })
    } catch (err) {
      if (err instanceof X402Error) return // already reported to the peer
      stream.abort(err as Error)
    }
  }
}
