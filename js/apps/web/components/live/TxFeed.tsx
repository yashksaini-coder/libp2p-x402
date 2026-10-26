'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight } from '@phosphor-icons/react/ssr'
import type { LiveState, Payment, Stage } from '@/lib/reduce'
import { edgeKey } from '@/lib/reduce'
import { explorerTx } from '@/lib/config'
import { Eyebrow, Mono, Panel, cx, short, usdc } from '@/components/ui'

const STAGES: Stage['status'][] = ['processed', 'confirmed', 'finalized']
// Grey while processing, white once confirmed, green only when finalized: green always means settled.
const DOT: Record<Stage['status'], string> = { processed: 'bg-muted', confirmed: 'bg-white', finalized: 'bg-settled' }

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    let raf = 0
    const loop = () => { setNow(Date.now()); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active])
  return now
}

function Row({ p, state, linkable, onHover }: { p: Payment, state: LiveState, linkable: boolean, onHover?: (k?: string) => void }) {
  const pending = !!p.submittedAt && !p.stages.some((s) => s.status === 'finalized')
  const now = useNow(pending)
  const next = STAGES.find((st) => !p.stages.some((s) => s.status === st))
  const label = (id: string) => state.peers[id]?.label ?? short(id)
  const done = p.stages.some((s) => s.status === 'finalized')

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -12, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      className="flex flex-col gap-3 rounded-xl border border-line bg-raised p-4 transition-colors duration-300 ease-out hover:bg-hover"
      onMouseEnter={() => onHover?.(edgeKey(p.from, p.to))}
      onMouseLeave={() => onHover?.(undefined)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <Mono className={cx('text-3xl font-semibold', done ? 'text-settled' : 'text-white')}>{usdc(p.amount)}<span className="ml-2 text-xl text-muted">USDC</span></Mono>
        <span className="truncate text-xl text-muted">{label(p.from)} → {label(p.to)}</span>
      </div>
      {p.memo && <Mono className="truncate text-xl text-muted">memo {short(p.memo, 16, 6)}</Mono>}
      {p.unsettled ? (
        <p className="text-xl text-rejected">Not settled. No transaction was sent.</p>
      ) : (
        <ol className="grid grid-cols-3 gap-2" aria-label="Settlement stages">
          {STAGES.map((st) => {
            const hit = p.stages.find((s) => s.status === st)
            const running = !hit && st === next && p.submittedAt
            return (
              <li key={st} className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-xl">
                  <span className={cx('size-3 rounded-full border border-white/30 transition-colors duration-300 ease-out', hit ? DOT[st] : 'bg-transparent')} aria-hidden />
                  <span className={hit ? 'text-white' : 'text-muted'}>{st}</span>
                </span>
                <Mono className={cx('text-xl', hit ? 'text-white' : 'text-muted')}>
                  {hit ? `${hit.ms.toLocaleString('en-US')} ms` : running ? `${Math.max(0, now - p.submittedAt!).toLocaleString('en-US')} ms` : '—'}
                </Mono>
              </li>
            )
          })}
        </ol>
      )}
      {p.signature && (
        linkable ? (
          <a href={explorerTx(p.signature)} target="_blank" rel="noreferrer" className="inline-flex w-max items-center gap-1 rounded-md font-mono text-xl text-muted underline-offset-4 hover:text-white hover:underline">
            tx {short(p.signature, 8, 6)} <ArrowUpRight size={20} aria-hidden /><span className="sr-only">(opens Solana Explorer)</span>
          </a>
        ) : (
          <Mono className="text-xl text-muted">tx {short(p.signature, 8, 6)}</Mono>
        )
      )}
    </motion.li>
  )
}

export function TxFeed({ state, linkable, filter, onHover, onClearFilter }: {
  state: LiveState, linkable: boolean, filter?: string, onHover?: (k?: string) => void, onClearFilter?: () => void
}) {
  const rows = filter ? state.payments.filter((p) => p.from === filter || p.to === filter) : state.payments
  return (
    <Panel className="col-span-4 flex min-h-0 flex-col gap-4 overflow-hidden p-6" aria-label="Transaction feed">
      <div className="flex items-center justify-between" data-load>
        <Eyebrow>Payments · Solana</Eyebrow>
        {filter && (
          <button onClick={onClearFilter} className="rounded-md font-mono text-xs uppercase tracking-widest text-white underline-offset-4 hover:underline">
            {state.peers[filter]?.label ?? 'Peer'} only · show all
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="grid flex-1 place-items-center text-center text-xl text-muted" data-load>
          No payments yet. Each one appears here with its processed, confirmed and finalized times.
        </div>
      ) : (
        <ul className="flex min-h-0 flex-col gap-3 overflow-hidden" data-load>
          <AnimatePresence initial={false}>
            {rows.map((p) => <Row key={p.id} p={p} state={state} linkable={linkable} onHover={onHover} />)}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  )
}
