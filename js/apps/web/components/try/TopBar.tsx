'use client'

import { useState } from 'react'
import NextLink from 'next/link'
import { ArrowUpRight, CaretDown, Copy, SignOut } from '@phosphor-icons/react'
import type { FlowState } from '@/lib/try/flow'
import { Mono, cx, short } from '@/components/ui'

const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`
const item = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors duration-300 ease-out hover:bg-hover'

export function TopBar({ state, offline, address, booth, onDisconnect }: { state: FlowState, offline: boolean, address?: string, booth?: boolean, onDisconnect: () => void }) {
  const [copied, setCopied] = useState(false)
  const badge = offline ? 'OFFLINE' : state.mode === 'devnet' ? 'DEVNET' : state.mode === 'mock' ? 'MOCK' : 'CONNECTING'
  const copy = async () => {
    try { await navigator.clipboard.writeText(address ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }
  return (
    <header className="flex items-center justify-between gap-3">
      <nav aria-label="Main" className="flex items-center gap-3 sm:gap-4">
        <NextLink href="/" className="flex min-h-11 items-center whitespace-nowrap rounded-md font-mono text-sm font-semibold">libp2p x402</NextLink>
        <NextLink href="/live" className="hidden min-h-11 items-center rounded-md text-sm text-muted transition-colors duration-300 ease-out hover:text-white sm:flex">Live</NextLink>
        <span
          data-testid="mode-badge"
          className={cx('rounded-full px-2 py-1 font-mono text-xs font-semibold tracking-wide', badge === 'DEVNET' ? 'bg-white text-black' : 'border border-line bg-raised text-muted')}
        >
          {badge}
        </span>
      </nav>
      {!address && (
        <a href="#step-1" className="flex min-h-11 items-center whitespace-nowrap rounded-full bg-white px-4 text-sm font-semibold text-black transition-colors duration-300 ease-out hover:bg-white/85 active:scale-[0.98]">
          Connect wallet
        </a>
      )}
      {address && (
        <details className="relative">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 whitespace-nowrap rounded-full border border-line bg-raised px-3 text-sm transition-colors duration-300 ease-out hover:bg-hover [&::-webkit-details-marker]:hidden">
            {booth && <span className="font-semibold">Booth wallet</span>}
            <Mono>{short(address, 4, 4)}</Mono>
            <Mono className="text-muted">{state.mode === 'mock' ? 'MOCK' : <>{(state.wallet?.usdc ?? 0).toFixed(4)}<span className="hidden sm:inline"> USDC</span></>}</Mono>
            <CaretDown size={14} aria-hidden />
          </summary>
          <div className="absolute right-0 z-10 mt-2 flex w-56 flex-col rounded-xl border border-line bg-raised p-1">
            <button type="button" onClick={copy} className={item}>
              <Copy size={18} aria-hidden />{copied ? 'Copied' : 'Copy address'}
            </button>
            <a href={explorerAddress(address)} target="_blank" rel="noreferrer" className={item}>
              <ArrowUpRight size={18} aria-hidden />View on Explorer<span className="sr-only">(opens Solana Explorer)</span>
            </a>
            <button type="button" onClick={onDisconnect} className={item}>
              <SignOut size={18} aria-hidden />Disconnect
            </button>
          </div>
        </details>
      )}
    </header>
  )
}
