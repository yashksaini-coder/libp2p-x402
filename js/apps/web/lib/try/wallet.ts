export const WALLET_CHAIN = 'solana:devnet'

export type AccountUsable = { ok: true } | { ok: false, reason: 'not_devnet' | 'no_sign_transaction' }

/** A wallet account can pay only if it is on devnet and can sign (not send) a transaction: the facilitator submits it. */
export function accountUsable(account: { chains: readonly string[], features: readonly string[] }): AccountUsable {
  if (!account.chains.includes(WALLET_CHAIN)) return { ok: false, reason: 'not_devnet' }
  if (!account.features.includes('solana:signTransaction')) return { ok: false, reason: 'no_sign_transaction' }
  return { ok: true }
}
