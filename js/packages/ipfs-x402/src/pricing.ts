import type { Network, PaymentRequirements } from '@x402/core/types'

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

/** Memo written into the payment transaction: links the on-chain tx to the IPFS root. */
export const memoFor = (root: { toString: () => string }): string => `ipfs:${root.toString()}`
