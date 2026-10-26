'use client'

// Adapted from the Accordion in ui lab by Yash Bavadiya (https://lab.xevrion.dev/lab/accordion):
// panels open independently so a clicked row never moves, and the answer unfolds
// from under its question like a folded flap. Restyled with this site's tokens.

import { useId, useRef, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { cx } from '@/components/ui'

export type QA = readonly [question: string, answer: string]

export function Accordion({ items, className, onToggle }: { items: readonly QA[], className?: string, onToggle?: (index: number, open: boolean) => void }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  const toggle = (i: number) => {
    const opening = !open.has(i)
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(i)) next.add(i)
      return next
    })
    onToggle?.(i, opening)
  }
  const headers = useRef<(HTMLButtonElement | null)[]>([])
  const baseId = useId()
  const focusHeader = (i: number) => headers.current[(i + items.length) % items.length]?.focus()

  return (
    <div className={cx('w-full max-w-3xl divide-y divide-white/10 border-y border-line', className)}>
      {items.map(([question, answer], i) => {
        const isOpen = open.has(i)
        const headerId = `${baseId}-h${i}`
        const panelId = `${baseId}-p${i}`
        return (
          <div key={question}>
            <h3>
              <button
                ref={(el) => { headers.current[i] = el }}
                id={headerId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(i)}
                onKeyDown={(e) => {
                  const target = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key]
                  if (target === undefined) return
                  e.preventDefault()
                  focusHeader(target)
                }}
                className="group flex w-full items-center justify-between gap-6 rounded-md py-6 text-left text-lg font-semibold text-balance text-white outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <span className="flex items-baseline gap-4">
                  <span aria-hidden className={cx('font-mono text-sm tabular-nums transition-colors duration-250', isOpen ? 'text-white' : 'text-muted')}>{String(i + 1).padStart(2, '0')}</span>
                  <span>{question}</span>
                </span>
                <CaretDown
                  size={20}
                  aria-hidden
                  className={cx(
                    'shrink-0 text-muted transition-[rotate,color] duration-250 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:text-white motion-reduce:transition-[color]',
                    isOpen && 'rotate-180 text-white'
                  )}
                />
              </button>
            </h3>
            {/* grid-template-rows 0fr -> 1fr: the row resolves to the content's real height, nothing is measured. */}
            <div
              id={panelId}
              role="region"
              aria-labelledby={headerId}
              inert={!isOpen}
              className={cx(
                'grid ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
                isOpen ? 'grid-rows-[1fr] transition-[grid-template-rows] duration-250' : 'grid-rows-[0fr] transition-[grid-template-rows] duration-200'
              )}
            >
              <div className="min-h-0 overflow-hidden">
                {/* The flap swings down on a hinge at the header's bottom edge; closing folds partway and fades first. */}
                <div
                  className={cx(
                    'relative origin-top transition-[transform,opacity] motion-reduce:transform-none motion-reduce:transition-[opacity]',
                    isOpen
                      ? '[transform:perspective(640px)_rotateX(0deg)] opacity-100 duration-280 ease-[cubic-bezier(0.32,0.72,0,1)]'
                      : '[transform:perspective(640px)_rotateX(-72deg)] opacity-0 duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]'
                  )}
                >
                  <p className="max-w-[680px] pr-10 pb-6 pl-10 text-base text-pretty text-muted">{answer}</p>
                  {/* The crease: text near the hinge stays veiled in the page colour until the flap lies flat. */}
                  <span
                    aria-hidden
                    className={cx(
                      'pointer-events-none absolute inset-0 bg-linear-to-b from-stage to-transparent to-80% transition-opacity ease-out motion-reduce:hidden',
                      isOpen ? 'opacity-0 duration-280' : 'opacity-100 duration-150'
                    )}
                  />
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
