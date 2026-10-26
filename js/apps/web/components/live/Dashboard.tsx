'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { LiveState } from '@/lib/reduce'
import { useSwarm, type Link } from '@/lib/useSwarm'
import { cx } from '@/components/ui'
import { TopPill, modeLabel } from './TopPill'
import { PeerGraph } from './PeerGraph'
import { TxFeed } from './TxFeed'
import { BlockGrid } from './BlockGrid'
import { ReceiptCard } from './ReceiptCard'
import { SceneControls } from './SceneControls'
import { Stage } from './Stage'
import { OfflineState } from './OfflineState'

/** The 12 column stage layout. Pure view of LiveState, also used by the landing page mockup. */
export function DashboardView({ state, label, linkable, controls, className }: {
  state: LiveState, label: string, linkable: boolean, controls?: React.ReactNode, className?: string
}) {
  const [hover, setHover] = useState<string>()
  const [selected, setSelected] = useState<string>()
  return (
    <div className={cx('grid grid-cols-12 grid-rows-[auto_minmax(0,1fr)_minmax(0,0.62fr)] gap-6 bg-black p-8', className)}>
      <TopPill state={state} label={label}>{controls}</TopPill>
      <PeerGraph state={state} highlight={hover} selected={selected} onSelect={setSelected} />
      <TxFeed state={state} linkable={linkable} filter={selected} onHover={setHover} onClearFilter={() => setSelected(undefined)} />
      <BlockGrid state={state} />
      <ReceiptCard state={state} linkable={linkable} />
    </div>
  )
}

export function LiveDashboard() {
  const fixture = useSearchParams().get('demo') === 'fixture'
  const { state, link } = useSwarm(fixture)
  const label = modeLabel(state, link, fixture)
  // Explorer links only for signatures that exist on devnet: never for mock, never for fabricated fixtures.
  const linkable = !fixture && (state.mode === 'devnet' || state.mode === 'replay')
  return (
    <main id="main">
      <h1 className="sr-only">libp2p x402 live dashboard</h1>
      <Stage>
        <DashboardView
          state={state}
          label={label}
          linkable={linkable}
          className="h-full"
          controls={fixture ? null : <SceneControls running={state.scene?.state === 'start' ? state.scene.n : undefined} />}
        />
        {!fixture && link.status === 'offline' && <OfflineState link={link as Link} />}
      </Stage>
    </main>
  )
}
