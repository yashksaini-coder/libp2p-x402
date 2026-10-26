import type { LengthPrefixedStream } from '@libp2p/utils'
import type { PaymentPayload, PaymentRequired, SettleResponse } from '@x402/core/types'

/** One JSON object per unsigned-varint length-prefixed frame (spec/libp2p.md §Framing). */
export type Frame =
  | { type: 'x402/payment-required', paymentRequired: PaymentRequired }
  | { type: 'x402/request', request: Record<string, unknown> }
  | { type: 'x402/payment', paymentPayload: PaymentPayload }
  | { type: 'x402/settlement', settlementResponse: SettleResponse }
  | { type: 'x402/error', code: string, message?: string, paymentRequired?: PaymentRequired }

/** Upper bound on an x402 control frame. App frames after settlement are the app's business. */
export const MAX_FRAME_BYTES = 64 * 1024

export class X402Error extends Error {
  readonly code: string
  readonly paymentRequired?: PaymentRequired

  constructor (code: string, message?: string, paymentRequired?: PaymentRequired) {
    super(message ?? code)
    this.name = 'X402Error'
    this.code = code
    this.paymentRequired = paymentRequired
  }
}

export async function writeFrame (lp: LengthPrefixedStream, frame: Frame, signal?: AbortSignal): Promise<void> {
  await lp.write(new TextEncoder().encode(JSON.stringify(frame)), { signal })
}

export async function readFrame (lp: LengthPrefixedStream, signal?: AbortSignal): Promise<Frame> {
  const buf = await lp.read({ signal })
  let frame: unknown
  try {
    frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray()))
  } catch {
    throw new X402Error('invalid_frame', 'frame is not UTF-8 JSON')
  }
  if (typeof frame !== 'object' || frame === null || typeof (frame as any).type !== 'string' || !(frame as any).type.startsWith('x402/')) {
    throw new X402Error('invalid_frame', 'frame has no x402 type')
  }
  return frame as Frame
}
