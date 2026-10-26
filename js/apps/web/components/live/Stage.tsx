'use client'

import { useEffect, useState, type ReactNode } from 'react'

const W = 1920
const H = 1080

/**
 * The stage is laid out once at 1920×1080 and scaled to fit the window, so a
 * 1366px laptop, a 4K monitor and the venue projector all show the same frame.
 * Letterboxed on black; never scrolls.
 */
export function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black">
      <div className="relative shrink-0 origin-center" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}
