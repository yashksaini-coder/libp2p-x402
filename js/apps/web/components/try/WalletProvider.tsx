'use client'

import { useEffect, useRef } from 'react'
import { SelectedWalletAccountContextProvider, useWalletAccountTransactionSigner } from '@solana/react'
import { useConnect, type UiWallet, type UiWalletAccount } from '@wallet-standard/react'
import type { TransactionModifyingSigner } from '@solana/kit'
import { WALLET_CHAIN } from '@/lib/try/wallet'

// E2E builds only (NEXT_PUBLIC_E2E_WALLET=1, inlined at build time): public builds drop this import.
const E2E = process.env.NEXT_PUBLIC_E2E_WALLET === '1'
if (E2E && typeof window !== 'undefined') void import('@/lib/try/e2eWallet').then((m) => m.registerE2EWallet())

/** ?e2e=1 (and ?autobuy=1) in an E2E build; always empty in any other build. */
export function e2eFlags(): { e2e?: boolean, autobuy?: boolean } {
  if (!E2E) return {}
  const q = new URLSearchParams(location.search)
  return q.get('e2e') === '1' ? { e2e: true, autobuy: q.get('autobuy') === '1' } : {}
}

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

/** Connects the E2E wallet once, through standard:connect like a visitor's click would. */
export function E2EConnect({ wallet, onAccount }: { wallet: UiWallet, onAccount: (a: UiWalletAccount) => void }) {
  const [, connect] = useConnect(wallet)
  const once = useRef(false)
  useEffect(() => {
    if (once.current) return
    once.current = true
    void connect().then((a) => { if (a[0]) onAccount(a[0]) })
  }, [connect, onAccount])
  return null
}
