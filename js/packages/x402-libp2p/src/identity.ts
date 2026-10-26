import type { PeerId } from '@libp2p/interface'
import type { PaymentRequirements } from '@x402/core/types'
import { base58btc } from 'multiformats/bases/base58'

/**
 * The Solana address a peer can be paid at: its Ed25519 public key, base58
 * (bitcoin alphabet, no multibase prefix). Undefined for non-Ed25519 peers.
 */
export function payeeFromPeerId (peerId: PeerId): string | undefined {
  if (peerId.type !== 'Ed25519') return undefined
  return base58btc.baseEncode(peerId.publicKey.raw)
}

/**
 * Identity rule (spec/libp2p.md §Payee identity): keep only the requirements
 * that pay the peer on the other end of the authenticated connection.
 */
export function selectPayable (accepts: PaymentRequirements[], remotePeer: PeerId): PaymentRequirements[] {
  const payee = payeeFromPeerId(remotePeer)
  return accepts.filter(req => {
    if (req.network.startsWith('solana:')) return payee !== undefined && req.payTo === payee
    // ponytail: non-Solana payees need extra.payeeBinding (signed envelope), not built yet; drop them.
    return false
  })
}
