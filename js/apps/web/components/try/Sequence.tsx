'use client'

import { motion, useReducedMotion } from 'motion/react'
import { Check, X } from '@phosphor-icons/react'
import type { Purchase } from '@/lib/try/flow'
import { Mono, cx, short } from '@/components/ui'
import { BlockStrip } from './BlockStrip'

const LANES = ['You', 'Seller peer', 'Facilitator', 'Solana devnet'] as const
type Lane = 0 | 1 | 2 | 3
type RowState = 'done' | 'active' | 'waiting' | 'error'
type Row = { key: string, from: Lane, to: Lane, label: React.ReactNode, detail?: React.ReactNode, done: boolean, error?: boolean, tone?: 'settled' }

const EASE = [0.32, 0.72, 0, 1] as const
const center = (l: Lane) => `${(l + 0.5) * 25}%`

/**
 * One row per protocol event, in wire order. A row is done only once its own event (or a later one that cannot
 * happen without it) is in the purchase: the invoice implies the rate card and x402/request; the first transaction
 * stage implies verify, settle and submit.
 */
function rows(p: Purchase, mock: boolean): Row[] {
  const tag = mock && <Mono className="ml-1 text-muted">MOCK</Mono>
  const stage = (s: 'processed' | 'confirmed' | 'finalized') => p.tx?.stages.find((x) => x.status === s)
  const sig = p.tx?.signature
  return [
    { key: 'dial', from: 0, to: 1, label: 'Dial over WSS, Noise', detail: <><Mono>{short(p.seller.peerId, 6, 4)}</Mono>{p.dialMs != null && <Mono className="ml-2 text-muted">{p.dialMs} ms</Mono>}</>, done: true },
    { key: 'rate', from: 1, to: 0, label: 'Rate card', done: !!p.quote },
    { key: 'request', from: 0, to: 1, label: <Mono>x402/request</Mono>, done: !!p.quote },
    { key: 'invoice', from: 1, to: 0, label: 'Invoice', detail: p.quote && <><Mono>{p.quote.amount.toFixed(6)}</Mono> USDC{tag}{p.quote.memo && <Mono className="ml-2 text-muted">memo {short(p.quote.memo, 4, 4)}</Mono>}</>, done: !!p.quote },
    {
      key: 'payee', from: 0, to: 0, label: 'Payee check',
      detail: p.payeeOk != null && (p.payeeOk
        ? <span className="inline-flex items-center gap-1"><Check size={14} weight="bold" className="text-settled" aria-hidden />payTo is the PeerId key</span>
        : <span className="inline-flex items-center gap-1 text-rejected"><X size={14} weight="bold" aria-hidden />payTo is not the PeerId key</span>),
      done: p.payeeOk != null, error: p.payeeOk === false,
    },
    { key: 'sign', from: 0, to: 0, label: mock ? 'MOCK: no signature' : 'Wallet signature', detail: !mock && p.signing && !p.paid && <span className="text-muted">waiting for your wallet</span>, done: !!p.paid },
    { key: 'payment', from: 0, to: 1, label: <Mono>x402/payment</Mono>, done: !!p.paid },
    { key: 'verify', from: 1, to: 2, label: 'Verify', done: !!p.tx },
    { key: 'settle', from: 1, to: 2, label: 'Settle', done: !!p.tx },
    { key: 'submit', from: 2, to: 3, label: 'Submitted', detail: sig && <Mono className="text-muted">{mock && 'MOCK '}{short(sig, 4, 4)}</Mono>, done: !!p.tx },
    ...(['processed', 'confirmed', 'finalized'] as const).map((s): Row => ({
      key: s, from: 3, to: 3, label: s[0].toUpperCase() + s.slice(1), detail: stage(s) && <Mono className="text-muted">{mock && 'MOCK '}{stage(s)!.ms} ms</Mono>,
      done: !!stage(s), tone: s === 'finalized' && !mock ? 'settled' : undefined,
    })),
    { key: 'car', from: 1, to: 0, label: 'CAR blocks', detail: p.blocks.length > 0 && <Mono className="text-muted">{p.blocks.filter((b) => b.ok).length} of {p.total ?? p.blocks.length} verified</Mono>, done: p.blocks.length > 0 },
  ]
}

/** done, error, the first row still waiting for its event (active), or waiting. */
function states(list: Row[]): RowState[] {
  const first = list.findIndex((r) => !r.done)
  const stuck = list.some((r) => r.error)
  return list.map((r, i) => (r.error ? 'error' : r.done ? 'done' : i === first && !stuck ? 'active' : 'waiting'))
}

/** The purchase as a sequence diagram (from lg) or a vertical timeline: every mark is an event that already arrived. */
export function Sequence({ purchase, mode }: { purchase: Purchase, mode: 'mock' | 'devnet' }) {
  const list = rows(purchase, mode === 'mock')
  const st = states(list)
  const reduce = useReducedMotion() ?? false
  return (
    <div className="flex flex-col gap-6">
      <Lanes list={list} st={st} reduce={reduce} />
      <Timeline list={list} st={st} reduce={reduce} />
      {/* Below lg the step card shows the strip, so each width shows it once. */}
      {purchase.blocks.length > 0 && <div className="hidden lg:block"><BlockStrip blocks={purchase.blocks} total={purchase.total} /></div>}
    </div>
  )
}

const dot = (s: RowState, tone?: 'settled') =>
  s === 'error' ? 'bg-rejected' : s === 'done' ? (tone === 'settled' ? 'bg-settled' : 'bg-white') : s === 'active' ? 'bg-muted' : 'border border-line bg-black'

function Lanes({ list, st, reduce }: { list: Row[], st: RowState[], reduce: boolean }) {
  return (
    <div className="relative hidden lg:block">
      <div className="grid grid-cols-4 pb-3 text-center text-sm font-semibold" aria-hidden>
        {LANES.map((l) => <span key={l}>{l}</span>)}
      </div>
      {LANES.map((l, i) => <span key={l} aria-hidden className="absolute bottom-0 top-8 w-px bg-line" style={{ left: center(i as Lane) }} />)}
      <ol className="relative flex flex-col" aria-label="Sequence of the purchase across You, Seller peer, Facilitator and Solana devnet">
        {list.map((r, i) => <LaneRow key={r.key} r={r} s={st[i]} reduce={reduce} />)}
      </ol>
    </div>
  )
}

function LaneRow({ r, s, reduce }: { r: Row, s: RowState, reduce: boolean }) {
  const self = r.from === r.to
  const lo = Math.min(r.from, r.to) as Lane
  const hi = Math.max(r.from, r.to) as Lane
  const text = cx('whitespace-nowrap text-sm', s === 'waiting' ? 'text-muted' : s === 'error' ? 'text-rejected' : 'text-white')
  return (
    <li className={cx('relative h-14 rounded-lg transition-colors duration-300 ease-out', s === 'active' && 'bg-raised')}>
      <span className="sr-only">{self ? LANES[r.from] : `${LANES[r.from]} to ${LANES[r.to]}`}: </span>
      {self ? (
        <>
          <span className={cx('absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-300 ease-out', dot(s, r.tone))} style={{ left: center(r.from) }} aria-hidden />
          <div className={cx('absolute top-1/2 flex -translate-y-1/2 flex-col', r.from === 3 ? 'items-end pr-4' : 'pl-4')} style={r.from === 3 ? { right: `${100 - (r.from + 0.5) * 25}%` } : { left: center(r.from) }}>
            <span className={cx(text, r.tone === 'settled' && s === 'done' && 'text-settled')}>{r.label}</span>
            {r.detail && <span className="whitespace-nowrap text-xs">{r.detail}</span>}
          </div>
        </>
      ) : (
        <>
          <div className="absolute top-1 flex flex-col items-center" style={{ left: center(lo), width: `${(hi - lo) * 25}%` }}>
            <span className={text}>{r.label}</span>
          </div>
          <span aria-hidden className={cx('absolute top-7 h-px transition-colors duration-300 ease-out', s === 'done' ? 'bg-white/40' : 'bg-line')} style={{ left: center(lo), width: `${(hi - lo) * 25}%` }} />
          <span aria-hidden className={cx('absolute top-7 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-300 ease-out', dot(s))} style={{ left: center(r.to) }} />
          {s === 'done' && !reduce && (
            <motion.span
              aria-hidden
              className="absolute top-7 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
              initial={{ left: center(r.from), opacity: 1 }}
              animate={{ left: center(r.to), opacity: 0 }}
              transition={{ left: { duration: 0.6, ease: EASE }, opacity: { duration: 0.2, delay: 0.6, ease: EASE } }}
            />
          )}
          {r.detail && (
            <div className="absolute top-8 flex flex-col items-center" style={{ left: center(lo), width: `${(hi - lo) * 25}%` }}>
              <span className="whitespace-nowrap text-xs">{r.detail}</span>
            </div>
          )}
        </>
      )}
    </li>
  )
}

function Timeline({ list, st, reduce }: { list: Row[], st: RowState[], reduce: boolean }) {
  return (
    <ol className="flex flex-col lg:hidden" aria-label="Sequence of the purchase">
      {list.map((r, i) => {
        const s = st[i]
        const last = i === list.length - 1
        return (
          <li key={r.key} className={cx('relative grid grid-cols-[1rem_1fr] gap-x-3 rounded-lg px-2 py-2 transition-colors duration-300 ease-out', s === 'active' && 'bg-raised')}>
            <span aria-hidden className={cx('relative z-10 mt-1.5 size-2.5 justify-self-center rounded-full transition-colors duration-300 ease-out', dot(s, r.tone))} />
            {!last && <span aria-hidden className="absolute -bottom-3.5 left-4 top-5 w-px -translate-x-1/2 bg-line" />}
            {s === 'done' && !reduce && !last && (
              <motion.span
                aria-hidden
                className="absolute left-4 size-1.5 -translate-x-1/2 rounded-full bg-white"
                initial={{ top: '1.25rem', opacity: 1 }}
                animate={{ top: 'calc(100% + 0.875rem)', opacity: 0 }}
                transition={{ top: { duration: 0.6, ease: EASE }, opacity: { duration: 0.2, delay: 0.6, ease: EASE } }}
              />
            )}
            <div className="flex min-w-0 flex-col">
              <span className={cx('text-sm', s === 'waiting' ? 'text-muted' : s === 'error' ? 'text-rejected' : r.tone === 'settled' && s === 'done' ? 'text-settled' : 'text-white')}>{r.label}</span>
              <span className="text-xs text-muted">{r.from === r.to ? LANES[r.from] : `${LANES[r.from]} → ${LANES[r.to]}`}</span>
              {r.detail && <span className="text-xs">{r.detail}</span>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
