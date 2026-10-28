'use client'

import { useEffect, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { CheckCircle, ProhibitInset } from '@phosphor-icons/react/ssr'
import { KEYS, MEMOS } from '@/lib/fixtures'
import { cx, short } from '@/components/ui'

/**
 * Story clock for one bento visual: loop time in ms. Starts once the card has risen in, pauses off screen,
 * and returns null under reduced motion so the visual shows its rest state.
 */
function useStory(ref: React.RefObject<HTMLElement | null>, period: number, offset: number) {
  const inView = useInView(ref, { amount: 0.3 })
  const reduced = useReducedMotion()
  const [t, setT] = useState(0)
  const [running, setRunning] = useState(false)
  const started = useRef(false)
  const acc = useRef(-offset)

  useEffect(() => {
    if (!inView || reduced) return
    let raf = 0
    let last = performance.now()
    // Let the card rise first (design-to-motion: stories begin once the intro has landed).
    const delay = started.current ? 0 : 1100
    started.current = true
    const begin = performance.now() + delay
    const loop = (now: number) => {
      if (now >= begin) {
        acc.current += now - Math.max(last, begin)
        if (acc.current >= 0) setRunning(true)
        setT(((acc.current % period) + period) % period)
      }
      last = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [inView, reduced, period])

  // null = the rest state (the finished design): before the story starts, and always under reduced motion.
  return running && !reduced ? t : null
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))

/* 1. PeerId = wallet: payTo is compared character by character with the key inside the remote PeerId, then the check ticks. */
function PayeeCheck({ t }: { t: number | null }) {
  const key = short(KEYS.seller.addr, 10, 4)
  const n = key.length
  const k = t == null ? n : Math.floor(clamp((t - 600) / 1800) * n)
  const ok = t == null || (t > 2600 && t < 5800)
  const chars = (s: string) => [...s].map((c, i) => <span key={i} className={i < k ? 'text-white' : 'text-white/30'}>{c}</span>)
  return (
    <div className="flex flex-col gap-3 font-mono text-sm">
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-raised p-3">
        <span className="text-xs uppercase tracking-widest text-muted">Remote PeerId</span>
        <span className="truncate text-white">{short(KEYS.seller.peer, 14, 4)}</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-raised p-3">
        <span className="text-xs uppercase tracking-widest text-muted">Key</span>
        <span>{chars(key)}</span>
        <span className="text-xs uppercase tracking-widest text-muted">payTo</span>
        <span>{chars(key)}</span>
      </div>
      <p className={cx('flex items-center gap-2 font-sans text-sm transition-all duration-500 ease-out', ok ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0')}>
        <CheckCircle size={20} weight="fill" className="text-settled" aria-hidden />
        payTo is the remote key. Safe to sign.
      </p>
    </div>
  )
}

/* 2. CID in memo: the memo field types the root CID glyph by glyph, holds, deletes faster, retypes. */
function MemoTyping({ t }: { t: number | null }) {
  const memo = MEMOS[0]
  let k = memo.length
  if (t != null) {
    if (t < 400) k = 0
    else if (t < 400 + memo.length * 52) k = Math.floor((t - 400) / 52)
    else if (t < 6200) k = memo.length
    else k = Math.max(0, memo.length - Math.floor((t - 6200) / 18))
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-raised p-3 font-mono text-sm">
      <div className="flex justify-between gap-4"><span className="text-muted">Transfer</span><span className="text-white">0.002417 USDC</span></div>
      <div className="flex justify-between gap-4"><span className="text-muted">To</span><span className="text-white">{short(KEYS.seller.addr, 6, 4)}</span></div>
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <span className="text-muted">Memo</span>
        <span className="min-h-10 break-all text-white">
          {memo.slice(0, k)}
          <span className="caret ml-px inline-block h-4 w-px translate-y-0.5 bg-white" aria-hidden />
        </span>
      </div>
    </div>
  )
}

/* 3. Verified bytes: cells turn green in order; block 13 fails, shakes red, and verification stops before any settlement. */
function BlockCheck({ t }: { t: number | null }) {
  const total = 24
  const bad = 13
  const step = 170
  const shown = t == null ? bad + 1 : t > 7000 ? 0 : Math.floor(clamp((t - 300) / step, 0, bad + 1))
  return (
    <div className="flex flex-col gap-3">
      <ol className="grid max-w-sm grid-cols-8 gap-2" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <li
            key={i}
            className={cx(
              'aspect-square rounded-md transition-colors duration-300 ease-out',
              i < shown && i !== bad && 'bg-settled',
              i < shown && i === bad && 'shake bg-rejected',
              i >= shown && 'bg-hover',
            )}
          />
        ))}
      </ol>
      <p className={cx('flex items-center gap-2 text-sm transition-opacity duration-300 ease-out', shown > bad ? 'text-rejected opacity-100' : 'opacity-0')}>
        <ProhibitInset size={20} weight="bold" aria-hidden />
        Block 13 rejected. No settlement transaction.
      </p>
    </div>
  )
}

/* 4. Behind NAT: traffic goes through the relay (circuit), then a direct line draws and the badge flips to webrtc. */
function NatUpgrade({ t }: { t: number | null }) {
  const direct = t == null ? 1 : t < 3000 ? 0 : t < 3800 ? (t - 3000) / 800 : t < 6400 ? 1 : 1 - (t - 6400) / 600
  const upgraded = direct > 0.5
  const pulse = t == null ? -1 : (t % 1000) / 1000
  const relayPath = 'M60 120 Q160 20 260 120'
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <svg viewBox="0 0 320 170" className="w-full max-w-sm" aria-hidden>
        <rect x="216" y="70" width="92" height="92" rx="12" fill="none" stroke="rgb(255 255 255 / 0.24)" strokeDasharray="4 4" />
        <text x="262" y="158" textAnchor="middle" fontSize="11" className="fill-[#9B9B9B] font-mono">NAT</text>
        <path d={relayPath} fill="none" stroke="rgb(255 255 255 / 0.4)" strokeWidth="1.5" strokeDasharray="5 5" style={{ opacity: 1 - direct * 0.8 }} />
        {!upgraded && pulse >= 0 && (
          <circle r="4" fill="#fff">
            <animateMotion dur="1s" repeatCount="indefinite" path={relayPath} />
          </circle>
        )}
        <path d="M60 120 L260 120" fill="none" stroke="#fff" strokeWidth="2" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - direct} />
        <circle cx="160" cy="45" r="10" fill="#1F1F1F" stroke="rgb(255 255 255 / 0.3)" />
        <text x="160" y="24" textAnchor="middle" fontSize="12" className="fill-[#9B9B9B]">Relay</text>
        <circle cx="60" cy="120" r="12" fill="#1F1F1F" stroke="rgb(255 255 255 / 0.4)" />
        <text x="60" y="152" textAnchor="middle" fontSize="12" className="fill-white">Agent</text>
        <circle cx="260" cy="120" r="12" fill="#1F1F1F" stroke="rgb(255 255 255 / 0.4)" />
        <text x="262" y="100" textAnchor="middle" fontSize="12" className="fill-white">Browser tab</text>
      </svg>
      <span
        className="absolute left-1/2 top-[62%] -translate-x-1/2 rounded-full border border-line bg-raised px-3 py-1 font-mono text-sm text-white"
      >
        <span key={upgraded ? 'w' : 'c'} className="flip inline-block">{upgraded ? 'webrtc' : 'circuit'}</span>
      </span>
    </div>
  )
}

const CARDS = [
  {
    title: 'Your PeerId is your wallet',
    body: 'The libp2p identity key and the Solana wallet are one Ed25519 key. The agent refuses any invoice whose payTo is not the key of the peer it is talking to.',
    Visual: PayeeCheck, period: 6400, fig: 'Fig 1.1 Payee check before signing',
  },
  {
    title: 'The memo names the content',
    body: 'Every invoice puts the root CID in the transfer memo, so the transaction on the explorer points at the bytes it paid for.',
    Visual: MemoTyping, period: 7400, fig: 'Fig 1.2 Transfer memo',
  },
  {
    title: 'Bytes are checked, not trusted',
    body: 'Each block is hashed against its CID as it arrives. A pin settles only after every block passes, so one flipped byte means no transaction.',
    Visual: BlockCheck, period: 7600, fig: 'Fig 1.3 Block verification on pin',
  },
  {
    title: 'Works behind NAT',
    body: 'A browser tab reserves a slot on a relay, then upgrades to a direct WebRTC connection. No public IP, no domain, no certificate.',
    Visual: NatUpgrade, period: 7000, fig: 'Fig 1.4 Relay, then direct',
  },
]

function Card({ c, i }: { c: (typeof CARDS)[number], i: number }) {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { amount: 0.3, once: true })
  // Offset each card's story so attention travels across the grid instead of everything moving in unison.
  const t = useStory(ref, c.period, i * 700)
  const { Visual } = c
  return (
    <article
      ref={ref}
      className={cx('card-rise flex flex-col gap-6 rounded-2xl border border-line bg-panel p-6', inView && 'in')}
      style={{ '--d': `${i * 85}ms` } as React.CSSProperties}
    >
      <div className="flex min-h-48 flex-col justify-center">
        <Visual t={t} />
      </div>
      <div className="mt-auto flex flex-col gap-2">
        <p className="font-mono text-xs text-muted">{c.fig}</p>
        <h3 className="text-xl font-semibold">{c.title}</h3>
        <p className="text-base text-muted">{c.body}</p>
      </div>
    </article>
  )
}

export function Bento() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {CARDS.map((c, i) => <Card key={c.title} c={c} i={i} />)}
    </div>
  )
}
