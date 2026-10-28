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
  /** Bound on each gate write/close toward the peer, so a peer that stops reading cannot stall the server. Default 10s. */
  ioTimeoutMs?: number
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
 * Run requirements through the scheme server, as x402's HTTP middleware does via buildPaymentRequirements:
 * that is where a scheme adds what the payer needs from the facilitator (svm: extra.feePayer, a recent blockhash).
 * The exact amount and asset pass through unchanged.
 */
async function enhance (server: x402ResourceServer, accepts: PaymentRequirements[]): Promise<PaymentRequirements[]> {
  const out: PaymentRequirements[] = []
  for (const r of accepts) {
    out.push(...await server.buildPaymentRequirements({
      scheme: r.scheme,
      network: r.network,
      payTo: r.payTo,
      price: { amount: r.amount, asset: r.asset, extra: r.extra },
      maxTimeoutSeconds: r.maxTimeoutSeconds
    }))
  }
  return out
}

/**
 * Gate a libp2p protocol behind an x402 payment: the libp2p counterpart of
 * `@x402/express`. Nothing paid may be delivered before `settle()` resolves.
 */
export function paid (server: x402ResourceServer, opts: PaidOptions, handler: (ctx: PaidContext) => Promise<void>): StreamHandler {
  const timeout = (): AbortSignal => AbortSignal.timeout(opts.paymentTimeoutMs ?? 30_000)
  const io = (): AbortSignal => AbortSignal.timeout(opts.ioTimeoutMs ?? 10_000)

  return async (stream, connection) => {
    const lp = lpStream(stream, { maxDataLength: MAX_FRAME_BYTES })
    let reported = false
    const fail = async (code: string, message?: string, paymentRequired?: PaymentRequired): Promise<void> => {
      await writeFrame(lp, { type: 'x402/error', code, message, paymentRequired }, io())
      await stream.close({ signal: io() }) // close, not abort: a reset could drop the error frame in flight
      reported = true // only once the peer has it; if either step threw, the catch resets the stream
    }

    try {
      // Server speaks first: the rate card is both the challenge and the free quote.
      let paymentRequired = await server.createPaymentRequiredResponse(await enhance(server, opts.accepts), opts.resource)
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
        paymentRequired = await server.createPaymentRequiredResponse(await enhance(server, accepts), opts.resource)
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
            const declined = new X402Error(settlement.errorReason ?? 'settlement_failed', settlement.errorMessage)
            // A decline is always reported to the caller as X402Error (callers roll back on it),
            // even if telling the peer fails; the stream is then reset by the outer catch.
            await fail(declined.code, declined.message, paymentRequired).catch(() => { stream.abort(new Error('could not deliver x402/error')) })
            throw declined
          }
          await writeFrame(lp, { type: 'x402/settlement', settlementResponse: settlement }, io())
          return settlement
        })()
        return await settled
      }

      // Verify -> settle -> deliver: delivered bytes cannot be recalled.
      if ((opts.settle ?? 'before') === 'before') await settle()
      await handler({ lp, stream, connection, payment, requirements, request, settle, fail: async (code, message) => { await fail(code, message) } })
    } catch (err) {
      if (reported) return // the peer already has an x402/error frame and the stream is closed
      stream.abort(err as Error) // garbage frame, timeout, handler bug: reset, never leave it open
    }
  }
}
