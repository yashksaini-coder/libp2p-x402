'use client'

import { motion } from 'motion/react'
import { CheckCircle, XCircle } from '@phosphor-icons/react/ssr'
import type { Edge, LiveState, PeerNode, Transport } from '@/lib/reduce'
import { Eyebrow, Mono, Panel, cx, short, usdc } from '@/components/ui'

const W = 1000
const H = 520
// Fixed positions per role. The graph never drifts; it moves only when an event arrives.
const SLOTS: Record<string, Array<[number, number]>> = {
  agent: [[160, 220], [160, 370], [160, 80]],
  relay: [[500, 380]],
  seller: [[840, 70]],
  provider: [[840, 220]],
  kubo: [[840, 420]],
}

function layout(peers: Record<string, PeerNode>) {
  const used: Record<string, number> = {}
  const pos: Record<string, [number, number]> = {}
  for (const p of Object.values(peers)) {
    const slots = SLOTS[p.role] ?? SLOTS.agent
    const i = used[p.role] = (used[p.role] ?? -1) + 1
    pos[p.id] = slots[i] ?? [500, 250 + 40 * i]
  }
  return pos
}

const RANK: Transport[] = ['webrtc', 'tcp', 'ws', 'circuit']
const best = (e: Edge) => RANK.find((t) => e.open.includes(t))

export function PeerGraph({ state, highlight, selected, onSelect }: {
  state: LiveState
  highlight?: string // edge key
  selected?: string
  onSelect?: (id: string | undefined) => void
}) {
  const pos = layout(state.peers)
  const relay = Object.values(state.peers).find((p) => p.role === 'relay')
  const peers = Object.values(state.peers)

  return (
    <Panel className="relative col-span-8 flex min-h-0 flex-col overflow-hidden bg-stage" aria-label="Peer graph">
      <div className="flex items-center justify-between px-6 pt-6" data-load>
        <Eyebrow>Peers · libp2p</Eyebrow>
        <Eyebrow>{peers.length ? 'Fixed layout by role · local network' : ''}</Eyebrow>
      </div>
      {!peers.length ? (
        <div className="grid flex-1 place-items-center text-xl text-muted">Waiting for peers to announce themselves</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="min-h-0 w-full flex-1" role="img" aria-label="Peers and their connections" data-load>
          {state.edges.map((e) => {
            const t = best(e)
            const a = pos[e.a], b = pos[e.b]
            if (!a || !b || !t) return null
            const via = t === 'circuit' && relay ? pos[relay.id] : undefined
            const d = via ? `M${a[0]} ${a[1]} Q${via[0]} ${via[1] + 40} ${b[0]} ${b[1]}` : `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`
            const mid = via ? [(a[0] + 2 * via[0] + b[0]) / 4, (a[1] + 2 * (via[1] + 40) + b[1]) / 4] : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
            const lit = highlight === e.key
            const from = e.lastFrom === e.b ? b : a
            const to = e.lastFrom === e.b ? a : b
            return (
              <g key={e.key}>
                <path
                  d={d}
                  fill="none"
                  stroke={lit ? '#fff' : 'rgb(255 255 255 / 0.28)'}
                  strokeWidth={1.5 + Math.min(3, e.usdc / 2000)}
                  strokeDasharray={t === 'circuit' ? '6 6' : undefined}
                  style={{ transition: 'stroke 300ms var(--ease-out), stroke-width 600ms var(--ease-out)' }}
                />
                <g transform={`translate(${mid[0]} ${mid[1]})`}>
                  <rect x={-44} y={-16} width={88} height={32} rx={16} fill="#1F1F1F" stroke="rgb(255 255 255 / 0.08)" />
                  <text textAnchor="middle" dy={6} className="fill-white font-mono" fontSize={20}>{t}</text>
                </g>
                {e.pulses > 0 && !via && (
                  <motion.circle
                    key={e.pulses}
                    r={7}
                    fill="#fff"
                    initial={{ cx: from[0], cy: from[1], opacity: 1 }}
                    animate={{ cx: to[0], cy: to[1], opacity: [1, 1, 0] }}
                    transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1], opacity: { duration: 0.9, times: [0, 0.7, 1] } }}
                  />
                )}
              </g>
            )
          })}
          {peers.map((p) => {
            const [x, y] = pos[p.id]
            const sel = selected === p.id
            return (
              <g
                key={p.id}
                transform={`translate(${x} ${y})`}
                role="button"
                tabIndex={onSelect ? 0 : -1}
                aria-pressed={sel}
                aria-label={`${p.label}, ${p.role}. Filter the transaction feed`}
                className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-white"
                onClick={() => onSelect?.(sel ? undefined : p.id)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect?.(sel ? undefined : p.id) } }}
              >
                <circle r={24} fill={sel ? '#272727' : '#1F1F1F'} stroke={sel ? '#fff' : 'rgb(255 255 255 / 0.24)'} strokeWidth={2} />
                <circle r={5} fill="#fff" />
                <text y={54} textAnchor="middle" className="fill-white" fontSize={24}>{p.label}</text>
                <text y={80} textAnchor="middle" className="fill-[#9B9B9B] font-mono" fontSize={18}>{short(p.id, 8, 4)}</text>
              </g>
            )
          })}
        </svg>
      )}
      <StatusLines state={state} />
    </Panel>
  )
}

function StatusLines({ state }: { state: LiveState }) {
  const { quote, payeeCheck: pc, provided } = state
  const label = (id: string) => state.peers[id]?.label ?? short(id)
  if (!quote && !pc && !provided) return null
  return (
    <div className="flex flex-col gap-2 px-6 pb-6 text-xl" data-load aria-live="polite">
      {quote && (
        <p className="text-muted">
          <span className="text-white">{quote.invoice ? 'Invoice' : 'Rate card'}</span> from {label(quote.from)}:{' '}
          <Mono className="text-white">{usdc(Number(quote.amount))} USDC</Mono>
          {quote.invoice ? '' : ' per MiB'}
          {quote.memo && <> · memo <Mono className="text-white">{short(quote.memo, 14, 4)}</Mono></>}
        </p>
      )}
      {pc && (
        <p className={cx('flex items-center gap-2', pc.ok ? 'text-white' : 'text-rejected')}>
          {pc.ok ? <CheckCircle size={24} weight="fill" className="text-settled" aria-hidden /> : <XCircle size={24} weight="fill" aria-hidden />}
          <span className="text-muted">payTo</span> <Mono>{short(pc.payTo, 6, 4)}</Mono>
          <span className="text-muted">{pc.ok ? 'equals' : 'differs from'} the remote PeerId key</span> <Mono>{short(pc.remoteKey, 6, 4)}</Mono>
        </p>
      )}
      {provided && (
        <p className="text-muted">
          <span className="text-white">{label(provided.by)}</span> fetched <Mono className="text-white">{provided.blocks}</Mono> blocks over Bitswap in{' '}
          <Mono className="text-white">{provided.ms} ms</Mono> · local network
        </p>
      )}
    </div>
  )
}
