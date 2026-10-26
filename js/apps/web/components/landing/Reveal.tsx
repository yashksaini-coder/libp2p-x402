'use client'

import { useEffect, useRef, useState, type ElementType, type ComponentPropsWithoutRef } from 'react'

/** Adds `in` once the element is ~30% visible (IntersectionObserver, never a scroll listener). */
export function useInViewOnce<T extends Element>(amount = 0.3) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect() } }, { threshold: amount })
    io.observe(el)
    return () => io.disconnect()
  }, [amount])
  return [ref, inView] as const
}

type Props<T extends ElementType> = { as?: T, delay?: number, kind?: 'reveal' | 'card-rise' } & ComponentPropsWithoutRef<T>

export function Reveal<T extends ElementType = 'div'>({ as, delay = 0, kind = 'reveal', className = '', style, ...p }: Props<T>) {
  const [ref, inView] = useInViewOnce<HTMLElement>(0.2)
  const Tag = (as ?? 'div') as ElementType
  return <Tag ref={ref} className={`${kind} ${inView ? 'in' : ''} ${className}`} style={{ ...style, '--d': `${delay}ms` }} {...p} />
}
