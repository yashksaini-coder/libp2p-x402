'use client'

import { useMemo, useState } from 'react'
import { ArrowClockwise, ArrowUpRight, DownloadSimple, SealCheck } from '@phosphor-icons/react'
import type { FlowState } from '@/lib/try/flow'
import { explorerTx } from '@/lib/config'
import { Mono, cx, short } from '@/components/ui'

const btn = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold transition-all duration-300 ease-out active:scale-[0.98]'

/** What the visitor bought and proof it was paid for: every row comes from the purchase that just finished. */
export function Receipt({ state, payer, tx, ms, onAgain }: { state: FlowState, payer: string, tx?: string, ms?: number, onAgain: () => void }) {
  const p = state.purchase!
  const mock = state.mode === 'mock'
  const [preview, setPreview] = useState(false)
  const lines = useMemo(() => (p.data ? new TextDecoder().decode(p.data.subarray(0, 4096)).split('\n').slice(0, 10) : []), [p.data])
  const signature = p.tx?.signature ?? tx
  const verified = p.blocks.filter((b) => b.ok).length

  const download = () => {
    if (!p.data) return
    const url = URL.createObjectURL(new Blob([p.data as BlobPart], { type: 'application/x-ndjson' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'air-quality.jsonl' })
    a.click()
    URL.revokeObjectURL(url)
  }

  const rows: Array<[string, React.ReactNode]> = [
    ['Amount', <><Mono>{p.quote?.amount.toFixed(6) ?? '—'}</Mono> USDC{mock && <Mono className="ml-2 text-muted">MOCK</Mono>}</>],
    ['Payer (you)', <Mono key="payer">{short(payer, 6, 4)}</Mono>],
    ['Payee (seller key)', <Mono key="payee">{short(p.seller.payee, 6, 4)}</Mono>],
    ['Memo (root CID)', <Mono key="memo">{p.quote?.memo ? short(p.quote.memo, 8, 6) : '—'}</Mono>],
    ['Transaction', !signature ? <Mono key="tx" className="text-muted">—</Mono> : mock ? (
      <Mono key="tx" className="text-muted">MOCK {short(signature, 6, 4)}</Mono>
    ) : (
      <a key="tx" href={explorerTx(signature)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-md font-mono underline-offset-4 hover:underline">
        {short(signature, 6, 4)} <ArrowUpRight size={16} aria-hidden /><span className="sr-only">(opens Solana Explorer)</span>
      </a>
    )],
    ['Blocks verified', <Mono key="blocks">{verified} of {p.total ?? verified}</Mono>],
    ['Total time', <Mono key="ms">{ms != null ? `${(ms / 1000).toFixed(1)} s` : '—'}</Mono>],
  ]

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-base font-semibold">
        <SealCheck size={20} weight="fill" className="text-settled" aria-hidden />
        All {verified} blocks match the root CID
      </p>
      <dl className="flex flex-col divide-y divide-line rounded-xl border border-line bg-raised px-4 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-h-11 items-center justify-between gap-4 py-2">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPreview((v) => !v)} aria-expanded={preview} className={cx(btn, 'border border-line hover:bg-hover')}>
          {preview ? 'Hide the data' : 'Preview the data'}
        </button>
        <button type="button" onClick={download} className={cx(btn, 'border border-line hover:bg-hover')}>
          <DownloadSimple size={18} aria-hidden />Download
        </button>
        <button type="button" onClick={onAgain} className={cx(btn, 'bg-white text-black hover:bg-white/85')}>
          <ArrowClockwise size={18} aria-hidden />Buy again
        </button>
      </div>
      {preview && (
        <pre className="overflow-x-auto rounded-xl border border-line bg-black p-3 font-mono text-xs leading-relaxed text-white/80">{lines.join('\n')}</pre>
      )}
    </div>
  )
}
