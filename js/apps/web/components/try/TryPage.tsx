'use client'

import { useEffect, useState } from 'react'
import { useConnect, type UiWallet, type UiWalletAccount } from '@wallet-standard/react'
import { ArrowUpRight } from '@phosphor-icons/react'
import { LOCAL_HOSTS, TRY_URL, explorerTx } from '@/lib/config'
import { E2E_WALLET, accountUsable } from '@/lib/try/wallet'
import { walletBrowseLinks } from '@/lib/try/deeplinks'
import { PURCHASE_USDC, type FlowState, type Step } from '@/lib/try/flow'
import { useVisitor, type VisitorConfig } from '@/lib/try/useVisitor'
import { Eyebrow, Mono, Panel, cx, short } from '@/components/ui'
import { E2EConnect, SignerBridge, WalletProvider, e2eFlags } from './WalletProvider'
import { StepCard, type CardState } from './StepCard'
import { TopBar } from './TopBar'
import { Receipt } from './Receipt'
import { Sequence } from './Sequence'
import { BlockStrip } from './BlockStrip'

const ORDER: Step[] = ['connect', 'fund', 'buy', 'done']
const btn = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold transition-all duration-300 ease-out active:scale-[0.98] disabled:opacity-50'
const primary = cx(btn, 'bg-white text-black hover:bg-white/85')
const quiet = cx(btn, 'border border-line hover:bg-hover')

function cardState(s: FlowState, step: Step, error: boolean): CardState {
  const at = ORDER.indexOf(s.step)
  const i = ORDER.indexOf(step)
  if (i < at || (step === 'done' && s.step === 'done')) return 'done'
  if (i > at) return 'waiting'
  return error ? 'error' : 'active'
}

export function TryPage() {
  return (
    <WalletProvider>
      <Visitor />
    </WalletProvider>
  )
}

function Visitor() {
  const v = useVisitor()
  const { state, config, account } = v
  const usable = account ? accountUsable(account) : undefined
  const address = usable?.ok ? account!.address : undefined
  const p = state.purchase
  const [e2e] = useState(e2eFlags)
  // On the booth laptop (the venue fallback) the wallet is the booth's demo wallet: say so, never pass it off as the visitor's.
  const [booth, setBooth] = useState(false)
  useEffect(() => setBooth(LOCAL_HOSTS.has(window.location.hostname)), [])
  const e2eWallet = e2e.e2e && !account ? v.wallets.find((w) => w.name === E2E_WALLET) : undefined
  // ?autobuy=1: drip as soon as the fund step shows; the buy then starts by itself (mock pays without a click).
  const { drip } = v
  useEffect(() => {
    if (e2e.autobuy && state.step === 'fund' && state.drip?.status === 'idle') void drip()
  }, [e2e.autobuy, state.step, state.drip?.status, drip])

  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-4 sm:py-8 lg:max-w-6xl">
      {e2eWallet && <E2EConnect wallet={e2eWallet} onAccount={v.connect} />}
      {account && usable?.ok && config?.mode === 'devnet' && <SignerBridge account={account} onSigner={v.setSigner} />}
      <TopBar state={state} offline={v.offline} address={address} booth={booth} onDisconnect={v.disconnect} />
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] lg:items-start lg:gap-10">
      <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 pt-4">
        <Eyebrow>{state.mode === 'mock' ? 'Try it · MOCK payments' : 'Try it · Solana devnet'}</Eyebrow>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Buy a dataset with your own wallet</h1>
        <p className="text-base text-muted">
          Your browser runs a libp2p node, pays the seller in test USDC, and checks every block of the data as it arrives. Nothing here is a recording.
        </p>
      </header>

      <StepCard
        n={1}
        title="Connect a wallet"
        state={v.offline || (usable && !usable.ok) ? 'error' : cardState(state, 'connect', false)}
        sentence={
          v.offline ? 'The booth engine is not answering. Check your connection, then reload this page.'
            : usable?.ok === false && usable.reason === 'not_devnet' ? 'Your wallet is not on devnet. Switch it to devnet, then connect again.'
            : usable?.ok === false ? 'This wallet cannot sign a transaction for the booth to submit. Connect Phantom, Solflare or Backpack instead.'
            : address && booth ? <>Booth wallet <Mono>{short(address, 4, 4)}</Mono> connected. This is the booth&apos;s demo wallet, not yours.</>
            : address ? <>Connected <Mono>{short(address, 4, 4)}</Mono>.</>
            : 'Pick the wallet you want to pay with. Your key stays in your wallet.'
        }
        hood="Wallets are found through the Wallet Standard. Paying needs solana:signTransaction on solana:devnet: your wallet signs, the booth's facilitator submits and pays the fee."
      >
        {usable?.ok === false && usable.reason === 'not_devnet' && (
          <p className="rounded-lg border border-line bg-raised p-3 text-sm">Phantom: Settings, Developer settings, Testnet mode.</p>
        )}
        {!address && !v.offline && usable?.ok !== false && <WalletList wallets={v.wallets} onAccount={v.connect} />}
        {usable?.ok === false && <button type="button" className={quiet} onClick={v.disconnect}>Use another wallet</button>}
      </StepCard>

      <StepCard
        n={2}
        title="Get test USDC"
        state={cardState(state, 'fund', state.drip?.status === 'error')}
        sentence={fundSentence(state, config)}
        hood="POST /visitor/drip. One transaction creates your USDC account if it is missing, then transferChecked sends 10,000 atomic USDC (6 decimals). The booth's fee payer signs and pays."
      >
        {state.step === 'fund' && state.drip?.status === 'late' && (
          <button type="button" className={primary} onClick={v.checkBalance}>Check balance again</button>
        )}
        {state.step === 'fund' && state.drip?.status !== 'sent' && state.drip?.status !== 'late' && (
          <button type="button" className={primary} disabled={state.drip?.status === 'sending' || config?.drip.enabled === false} onClick={v.drip}>
            {state.drip?.status === 'sending' ? 'Sending' : state.drip?.status === 'error' ? 'Try again' : 'Get test USDC'}
          </button>
        )}
        {state.mode === 'devnet' && state.drip?.signature && <ExplorerLink sig={state.drip.signature} />}
      </StepCard>

      <StepCard
        n={3}
        title="Buy the dataset"
        state={cardState(state, 'buy', state.step === 'buy' && state.error != null)}
        sentence={buySentence(state)}
        hood="Protocol /x402/fetch over WebSockets and Noise. Rate card, then x402/request for an invoice whose memo is the root CID. The payTo must equal the seller's PeerId key before anything is signed. Then x402 exact on Solana devnet, and the CAR streams with each block hashed against its CID."
      >
        {p && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Seller</dt><dd className="text-right">Node seller</dd>
            <dt className="text-muted">PeerId</dt><dd className="text-right"><Mono>{short(p.seller.peerId, 8, 4)}</Mono></dd>
            <dt className="text-muted">Paid at</dt><dd className="text-right"><Mono>{short(p.seller.payee, 6, 4)}</Mono></dd>
            {p.quote && <><dt className="text-muted">Price</dt><dd className="text-right"><Mono>{p.quote.amount.toFixed(6)}</Mono> USDC{state.mode === 'mock' && <Mono className="ml-2 text-muted">MOCK</Mono>}</dd></>}
          </dl>
        )}
        {state.step === 'buy' && !state.error && state.mode === 'devnet' && p?.quote && p.payeeOk && !p.signing && (
          <button type="button" className={primary} onClick={v.pay}>Pay {p.quote.amount.toFixed(6)} USDC</button>
        )}
        {state.step === 'buy' && !state.error && p?.signing && !p.paid && v.deadline && (
          <p className="flex items-center justify-between rounded-lg border border-line bg-raised p-3 text-base font-semibold" role="status">
            Approve in your wallet <Countdown until={v.deadline} />
          </p>
        )}
        {p?.tx && <Stages stages={p.tx.stages} mock={state.mode === 'mock'} />}
        {p && p.blocks.length > 0 && <div className="lg:hidden"><BlockStrip blocks={p.blocks} total={p.total} /></div>}
        {state.step === 'buy' && state.error && <button type="button" className={primary} onClick={v.retry}>Buy again</button>}
      </StepCard>

      <StepCard
        n={4}
        title="Verified and yours"
        state={cardState(state, 'done', false)}
        sentence={state.step === 'done' ? (state.mode === 'mock' ? 'MOCK: no USDC moved. Every block matched its hash, and the data is in this browser.' : 'You paid from your own address and every block matched its hash. The data is in this browser.') : 'Your receipt and the data appear here once every block is verified.'}
        hood="The verified blocks go into this browser's Helia blockstore and the file is read back from them, so what you download is exactly what was hashed."
      >
        {state.step === 'done' && p && address && (
          <Receipt state={state} payer={address} tx={v.settledTx} ms={v.timing?.end != null ? v.timing.end - v.timing.start : undefined} onAgain={v.retry} />
        )}
      </StepCard>
      </div>
      <Panel className={cx('flex-col gap-4 p-4 sm:p-6 lg:sticky lg:top-8', p ? 'flex' : 'hidden lg:flex')} aria-label="The exchange, event by event">
        <Eyebrow>The exchange{state.mode === 'mock' && ' · MOCK payments'}</Eyebrow>
        {p ? <Sequence purchase={p} mode={state.mode === 'devnet' ? 'devnet' : 'mock'} />
          : <p className="text-base text-muted">Every message between your browser, the seller, the facilitator and Solana devnet appears here as it happens, once your browser dials the seller.</p>}
      </Panel>
      </div>
    </main>
  )
}

function fundSentence(s: FlowState, config?: VisitorConfig): React.ReactNode {
  const d = s.drip
  if (s.step === 'connect') return 'Test money from the booth, once per wallet.'
  if (d?.status === 'sent') return s.mode === 'mock' ? 'MOCK: no USDC sent. Mock payments need none.' : <>Sent. Your balance is <Mono>{(s.wallet?.usdc ?? 0).toFixed(4)}</Mono> USDC.</>
  if (s.step !== 'fund') return 'Your wallet already holds enough test USDC for a purchase.'
  if (d?.status === 'late') return <>Sent, but devnet has not shown it yet: your balance reads <Mono>{(s.wallet?.usdc ?? 0).toFixed(4)}</Mono> USDC. Wait a minute, then check your balance again.</>
  if (d?.status === 'sending') return 'Sending 0.01 test USDC to your wallet.'
  if (d?.status === 'error') return `${d.error} Devnet USDC is also free at faucet.circle.com.`
  if (config?.drip.enabled === false) return 'The booth has paused test USDC. Ask at the booth, or get devnet USDC at faucet.circle.com.'
  return 'The booth sends you 0.01 devnet USDC, enough for four purchases. You need no SOL: the booth pays every fee.'
}

function buySentence(s: FlowState): React.ReactNode {
  const p = s.purchase
  if (s.step === 'connect' || s.step === 'fund') return `One purchase costs about ${PURCHASE_USDC} USDC, paid straight to the seller's key.`
  if (s.step === 'done') return s.mode === 'mock' ? 'MOCK: no signature requested. Delivered.' : 'Paid and delivered.'
  if (s.error) return s.error.message
  if (!p) return 'Dialing the seller over WebSockets.'
  if (!p.quote) return <>Connected to the seller in <Mono>{p.dialMs}</Mono> ms. Asking for the price.</>
  if (p.payeeOk == null) return 'Checking that the seller is paid at its own key.'
  if (p.blocks.length > 0) return 'Checking each block as it arrives.'
  if (p.paid) return s.mode === 'mock' ? 'MOCK: no signature requested. Waiting for the data.' : 'Paid. Settling on Solana devnet.'
  if (s.mode === 'mock') return 'MOCK: no signature requested. Paying with the mock scheme.'
  if (p.signing) return 'Your wallet shows the transaction. Approve it to pay.'
  return "The payee matches the seller's key. Press Pay to approve it in your wallet."
}

function WalletList({ wallets, onAccount }: { wallets: UiWallet[], onAccount: (a: UiWalletAccount) => void }) {
  const phone = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  if (wallets.length) return <div className="flex flex-col gap-2">{wallets.map((w) => <WalletOption key={w.name} wallet={w} onAccount={onAccount} />)}</div>
  if (!phone) return <p className="text-sm text-muted">No Solana wallet in this browser. Install Phantom, Solflare or Backpack, then reload this page.</p>
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">No wallet in this browser. Open this page inside your wallet app:</p>
      {walletBrowseLinks(TRY_URL).map((l) => <a key={l.name} href={l.href} className={quiet}>Open in {l.name}</a>)}
    </div>
  )
}

function WalletOption({ wallet, onAccount }: { wallet: UiWallet, onAccount: (a: UiWalletAccount) => void }) {
  const [connecting, connect] = useConnect(wallet)
  const [error, setError] = useState<string>()
  const go = async () => {
    setError(undefined)
    try {
      const accounts = await connect()
      if (accounts[0]) onAccount(accounts[0])
      else setError(`${wallet.name} shared no account. Unlock it, then try again.`)
    } catch (err: any) {
      setError(`${wallet.name} did not connect (${String(err?.message ?? err)}). Try again.`)
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={cx(quiet, 'justify-start')} disabled={connecting} onClick={go}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={wallet.icon} alt="" width={24} height={24} className="size-6 rounded-md" />
        {connecting ? `Connecting to ${wallet.name}` : wallet.name}
      </button>
      {error && <p className="text-sm text-rejected" role="alert">{error}</p>}
    </div>
  )
}

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.ceil((until - now) / 1000))
  return <Mono className="text-muted">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</Mono>
}

function Stages({ stages, mock }: { stages: Array<{ status: string, ms: number }>, mock: boolean }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Settlement stages">
      {stages.map((t) => (
        <li key={t.status} className={cx('rounded-full border px-3 py-1 font-mono text-xs', t.status === 'finalized' && !mock ? 'border-transparent bg-settled text-black' : t.status === 'confirmed' ? 'border-line text-white' : 'border-line text-muted')}>
          {mock && 'MOCK '}{t.status} {t.ms} ms
        </li>
      ))}
    </ol>
  )
}


function ExplorerLink({ sig }: { sig: string }) {
  return (
    <a href={explorerTx(sig)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 self-start rounded-md font-mono text-sm underline-offset-4 hover:underline">
      {short(sig, 6, 4)} <ArrowUpRight size={16} aria-hidden /><span className="sr-only">(opens Solana Explorer)</span>
    </a>
  )
}
