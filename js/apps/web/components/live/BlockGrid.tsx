'use client'

import { ProhibitInset, SealCheck } from '@phosphor-icons/react/ssr'
import type { LiveState } from '@/lib/reduce'
import { Eyebrow, Mono, Panel, cx, short } from '@/components/ui'

export function BlockGrid({ state }: { state: LiveState }) {
  const { blocks, error } = state
  const ok = blocks.filter((b) => b.ok === true).length
  const bad = blocks.find((b) => b.ok === false)
  const last = [...blocks].reverse().find((b) => b.ok !== null)
  const complete = blocks.length > 0 && ok === blocks.length

  return (
    <Panel className="col-span-8 flex min-h-0 flex-col gap-4 overflow-hidden p-6" aria-label="IPFS block verification">
      <div className="flex items-center justify-between" data-load>
        <Eyebrow>IPFS blocks · each hash checked against its CID</Eyebrow>
        {blocks.length > 0 && <Mono className="text-xl text-muted"><span className="text-white">{ok}</span> / {blocks.length} verified</Mono>}
      </div>
      {blocks.length === 0 ? (
        <div className="grid flex-1 place-items-center text-xl text-muted" data-load>Waiting for blocks. Every block is hashed and checked as it arrives.</div>
      ) : (
        <>
          <ol className="flex flex-wrap content-start gap-2" aria-label={`${ok} of ${blocks.length} blocks verified`} data-load>
            {blocks.map((b) => (
              <li
                key={`${state.requestId}-${b.index}`}
                title={b.cid}
                className={cx(
                  'size-12 rounded-lg border transition-colors duration-500 ease-out',
                  b.ok === true && 'border-transparent bg-settled',
                  b.ok === false && 'shake border-transparent bg-rejected',
                  b.ok === null && 'border-line bg-hover',
                )}
              />
            ))}
          </ol>
          <div className="mt-auto flex flex-col gap-1" data-load aria-live="polite">
            {bad || error ? (
              <>
                <p className="flex items-center gap-2 text-2xl font-semibold text-rejected">
                  <ProhibitInset size={28} weight="bold" aria-hidden />
                  {error && !error.settled ? 'No settlement transaction' : `Block ${bad?.index} rejected`}
                </p>
                <p className="text-xl text-muted">
                  {error ? <><Mono className="text-white">{error.code}</Mono> · {error.message}. </> : null}
                  The provider stopped before settling, so no USDC moved.
                </p>
              </>
            ) : complete ? (
              <p className="flex items-center gap-2 text-xl text-white">
                <SealCheck size={24} weight="fill" className="text-settled" aria-hidden />
                All {blocks.length} blocks match their CIDs
              </p>
            ) : (
              last?.cid && <p className="text-xl text-muted">Last verified <Mono className="text-white">{short(last.cid, 12, 6)}</Mono></p>
            )}
          </div>
        </>
      )}
    </Panel>
  )
}
