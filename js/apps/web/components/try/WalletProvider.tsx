'use client'

import { useEffect } from 'react'
import { SelectedWalletAccountContextProvider, useWalletAccountTransactionSigner } from '@solana/react'
import type { UiWallet, UiWalletAccount } from '@wallet-standard/react'
import type { TransactionModifyingSigner } from '@solana/kit'
import { WALLET_CHAIN } from '@/lib/try/wallet'

const KEY = 'libp2p-x402/try-wallet'

// Storage can throw (private windows, blocked site data): the page works without it, it only forgets the wallet.
const stateSync = {
  getSelectedWallet: () => { try { return localStorage.getItem(KEY) } catch { return null } },
  storeSelectedWallet: (k: string) => { try { localStorage.setItem(KEY, k) } catch {} },
  deleteSelectedWallet: () => { try { localStorage.removeItem(KEY) } catch {} },
}

/** Wallets that can connect and speak Solana. Whether an account can pay is decided later (accountUsable). */
const solanaWallets = (w: UiWallet) => w.features.includes('standard:connect') && w.chains.some((c) => c.startsWith('solana:'))

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return <SelectedWalletAccountContextProvider filterWallets={solanaWallets} stateSync={stateSync}>{children}</SelectedWalletAccountContextProvider>
}

/** The signer hook needs an account, so it lives in a component that renders only once one is selected. */
export function SignerBridge({ account, onSigner }: { account: UiWalletAccount, onSigner: (s: TransactionModifyingSigner | undefined) => void }) {
  const signer = useWalletAccountTransactionSigner(account, WALLET_CHAIN)
  useEffect(() => {
    onSigner(signer)
    return () => onSigner(undefined)
  }, [signer, onSigner])
  return null
}
