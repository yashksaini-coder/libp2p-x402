import NextLink from 'next/link'
import { ArrowLeft } from '@phosphor-icons/react/ssr'
import type { LiveState } from '@/lib/reduce'
import type { Link } from '@/lib/useSwarm'
import { GlassPill, Mono, cx, usdc } from '@/components/ui'

export function modeLabel(state: LiveState, link: Link, fixture: boolean) {
  if (fixture) return 'REPLAY'
  if (link.status !== 'live') return link.status === 'offline' ? 'ENGINE OFFLINE' : 'CONNECTING'
  switch (state.mode) {
    case 'devnet': return 'LIVE DEVNET'
    case 'local': return 'LIVE LOCAL VALIDATOR'
    case 'mock': return 'MOCK'
    case 'replay': return 'REPLAY'
    default: return 'CONNECTING'
  }
}

export function ModeBadge({ label }: { label: string }) {
  const live = label.startsWith('LIVE')
  return (
    <span
      data-testid="mode-badge"
      className={cx(
        'inline-flex items-center gap-2 rounded-full px-3 py-2 font-mono text-xl font-semibold tracking-wide',
        live ? 'bg-white text-black' : 'border border-line bg-raised text-muted',
      )}
    >
      <span className={cx('size-2 rounded-full', live ? 'animate-pulse bg-black' : 'bg-muted')} aria-hidden />
      {label}
    </span>
  )
}

function Counter({ label, value, unit }: { label: string, value: string, unit?: string }) {
  return (
    <div className="flex flex-col gap-1 px-6" data-load>
      <span className="font-mono text-xs uppercase tracking-widest text-muted">{label}</span>
      <Mono className="text-3xl font-semibold">
        {value}
        {unit && <span className="ml-1 text-xl text-muted">{unit}</span>}
      </Mono>
    </div>
  )
}

export function HomeLink() {
  return (
    <NextLink
      href="/"
      aria-label="Back to home"
      className="inline-flex items-center gap-2 rounded-full border border-line bg-raised px-3 py-2 text-xl font-semibold text-muted transition-all duration-300 ease-out hover:bg-hover hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.98]"
    >
      <ArrowLeft size={20} aria-hidden />
      Home
    </NextLink>
  )
}

export function TopPill({ state, label, children, home = false }: { state: LiveState, label: string, children?: React.ReactNode, home?: boolean }) {
  const c = state.counters
  return (
    <header className="col-span-12 flex items-center justify-between gap-6">
      <GlassPill className="flex items-center gap-2 py-3 pl-3 pr-3">
        {home && <HomeLink />}
        <ModeBadge label={label} />
        <span className="px-3 text-xl text-muted" data-load aria-live="polite">
          {state.scene ? `Scene ${state.scene.n} · ${state.scene.title}${state.scene.state === 'done' ? ' · done' : ''}` : 'Waiting for a scene'}
        </span>
      </GlassPill>
      <GlassPill className="flex items-center divide-x divide-white/10 py-3">
        <Counter label="Peers" value={String(c.peers)} />
        <Counter label="USDC settled" value={usdc(c.usdc)} />
        <Counter label="p50 to finalized" value={c.p50FinalizeMs == null ? '—' : (c.p50FinalizeMs / 1000).toFixed(1)} unit={c.p50FinalizeMs == null ? undefined : 's'} />
        <Counter label="Blocks verified" value={String(c.blocksVerified)} />
      </GlassPill>
      {children}
    </header>
  )
}
