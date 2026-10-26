'use client'

import { useState } from 'react'
import { Accordion, type QA } from './Accordion'
import { DotRipple } from './DotRipple'

/** FAQ list beside a dot-matrix panel that answers each opened question with its number and a ripple. */
export function FaqSection({ items }: { items: readonly QA[] }) {
  const [opened, setOpened] = useState<number[]>([]) // most recent last
  const [pulse, setPulse] = useState(0)
  const current = opened.at(-1)

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
      <figure className="flex flex-col gap-3 lg:sticky lg:top-28 lg:col-span-5 lg:self-start">
        <div className="relative h-56 overflow-hidden rounded-2xl border border-line bg-stage sm:h-72 lg:h-96">
          <DotRipple glyph={current == null ? '?' : String(current + 1)} pulse={pulse} className="absolute inset-0 h-full w-full" />
        </div>
        <figcaption className="font-mono text-xs text-muted">
          Fig 0.3 {current == null ? 'Open a question' : `Question ${String(current + 1).padStart(2, '0')}`}
        </figcaption>
      </figure>
      <Accordion
        items={items}
        className="lg:col-span-7"
        onToggle={(i, open) => {
          setOpened(list => open ? [...list.filter(x => x !== i), i] : list.filter(x => x !== i))
          if (open) setPulse(p => p + 1)
        }}
      />
    </div>
  )
}
