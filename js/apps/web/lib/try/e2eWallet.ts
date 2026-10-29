// A fake Wallet Standard wallet for the headless /try end to end run (scripts/try-e2e.ts).
// Imported only when NEXT_PUBLIC_E2E_WALLET=1 at build time, so public builds never contain it.
import { generateKeyPair, getAddressEncoder, getAddressFromPublicKey, getTransactionDecoder, getTransactionEncoder, signTransaction } from '@solana/kit'
import { E2E_WALLET, WALLET_CHAIN } from './wallet'

const ICON = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#272727"/></svg>')}` as const

type Account = { address: string, publicKey: Uint8Array, chains: readonly string[], features: readonly string[] }

/** Registers the wallet with the page's Wallet Standard registry; it signs with a key generated per page load. */
export async function registerE2EWallet(): Promise<void> {
  const keys = await generateKeyPair()
  const address = await getAddressFromPublicKey(keys.publicKey)
  const account: Account = { address, publicKey: getAddressEncoder().encode(address) as Uint8Array, chains: [WALLET_CHAIN], features: ['solana:signTransaction'] }
  const listeners = new Set<(p: { accounts?: Account[] }) => void>()
  const wallet = {
    version: '1.0.0' as const,
    name: E2E_WALLET,
    icon: ICON,
    chains: [WALLET_CHAIN],
    accounts: [] as Account[],
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          wallet.accounts = [account]
          for (const l of listeners) l({ accounts: wallet.accounts })
          return { accounts: wallet.accounts }
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (_event: 'change', l: (p: { accounts?: Account[] }) => void) => { listeners.add(l); return () => listeners.delete(l) },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...inputs: Array<{ transaction: Uint8Array }>) => await Promise.all(inputs.map(async ({ transaction }) => {
          const signed = await signTransaction([keys], getTransactionDecoder().decode(transaction))
          return { signedTransaction: getTransactionEncoder().encode(signed) as Uint8Array }
        })),
      },
    },
  }
  const register = ({ register }: { register: (w: typeof wallet) => void }) => register(wallet)
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }))
  window.addEventListener('wallet-standard:app-ready', ((e: CustomEvent) => register(e.detail)) as EventListener)
}
