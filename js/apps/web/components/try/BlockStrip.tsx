import { Mono, cx } from '@/components/ui'

/** One cell per block of the CAR: grey until its hash is checked, green when it matched, red when it did not. */
export function BlockStrip({ blocks, total }: { blocks: Array<{ index: number, ok: boolean }>, total?: number }) {
  const n = total ?? blocks.length
  const ok = blocks.filter((b) => b.ok).length
  const at = new Map(blocks.map((b) => [b.index, b.ok]))
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-wrap gap-1" aria-label={`${ok} of ${n} blocks verified`}>
        {Array.from({ length: n }, (_, i) => {
          const b = at.get(i)
          return <li key={i} className={cx('size-4 rounded-sm transition-colors duration-500 ease-out', b === true && 'bg-settled', b === false && 'shake bg-rejected', b == null && 'border border-line bg-hover')} />
        })}
      </ol>
      <Mono className="text-sm text-muted"><span className="text-white">{ok}</span> of {n} blocks verified</Mono>
    </div>
  )
}
