'use client'

import { useEffect, useRef, useState } from 'react'
import { DashboardView } from '@/components/live/Dashboard'
import { initialState, reduce } from '@/lib/reduce'
import { REPLAY, stamp } from '@/lib/fixtures'
import { useInViewOnce } from './Reveal'

// The dashboard after all three recorded scenes. Labelled REPLAY, as on /live.
const STATE = stamp(REPLAY).reduce(reduce, initialState)

/** The real /live layout at 1920×1080, scaled to fit. Loading intro only: panels stay, contents load in. */
export function HeroMockup() {
  const [ref, inView] = useInViewOnce<HTMLDivElement>(0.3)
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / 1920))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <figure ref={ref} className="flex flex-col gap-3">
      <div ref={box} className="relative aspect-video w-full overflow-hidden rounded-2xl border border-line bg-black" aria-hidden inert>
        <div className={`mock ${inView ? 'in' : ''} absolute left-0 top-0 origin-top-left`} style={{ transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}>
          <DashboardView state={STATE} label="REPLAY" linkable={false} className="h-[1080px] w-[1920px]" />
        </div>
      </div>
      <figcaption className="font-mono text-xs text-muted">
        Fig 0.1 The stage dashboard after all three scenes, replayed from a recorded event stream
      </figcaption>
    </figure>
  )
}
