import type { Network, PaymentRequirements } from '@x402/core/types'
import type { CID } from 'multiformats/cid'

export const FETCH_PROTOCOL = '/ipfs-x402/fetch/1.0.0'
export const PIN_PROTOCOL = '/ipfs-x402/pin/1.0.0'

const MiB = 1024n * 1024n

export interface Pricing {
  scheme: string
  network: Network
  asset: string
  /** Must be this node's own payee address (payeeFromPeerId) or clients refuse to pay. */
  payTo: string
  /** Atomic units per MiB. */
  perMiB: bigint
  minAmount: bigint
  maxTimeoutSeconds: number
  extra?: Record<string, unknown>
}

/** Requirements for `bytes` of data; the rate card is `price(p, 1 MiB)`. */
export function price (p: Pricing, bytes: number, memo?: string): PaymentRequirements {
  const metered = (BigInt(bytes) * p.perMiB + MiB - 1n) / MiB
  const amount = metered > p.minAmount ? metered : p.minAmount
  return {
    scheme: p.scheme,
    network: p.network,
    asset: p.asset,
    payTo: p.payTo,
    amount: amount.toString(),
    maxTimeoutSeconds: p.maxTimeoutSeconds,
    extra: { ...p.extra, ...(memo != null ? { memo } : {}) }
  }
}

export const rateCard = (p: Pricing): PaymentRequirements => price(p, Number(MiB))

/**
 * Memo written into the payment transaction: links the on-chain tx to the IPFS root, as its CIDv0.
 * Devnet's Memo program costs ~355 CU per byte and x402 exact caps a payment at 20,000 CU, so a
 * 64-byte `ipfs:<CIDv1>` cannot land; the 46-byte CIDv0 can (measured 2026-10-28). Roots with no
 * CIDv0 form (not dag-pb + sha-256) get no memo, and x402 adds its own nonce.
 */
export function memoFor (root: CID): string | undefined {
  try {
    return root.toV0().toString()
  } catch {
    return undefined
  }
}
