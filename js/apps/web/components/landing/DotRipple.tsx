'use client'

import { useEffect, useRef } from 'react'
import { Buckets, drawText, hash, useDotCanvas, type Grid } from '@/lib/dotmatrix'

/**
 * Dot-matrix ripple: diamond rings of pixels drift out from a glyph at the
 * centre; `pulse` (a changing number) fires a bright ring and swaps the glyph.
 * Plumbing (fps cap, offscreen pause, reduced motion) lives in lib/dotmatrix.
 */
export function DotRipple ({ glyph, pulse, className }: { glyph: string, pulse: number, className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const live = useRef({ glyph, pulseAt: -1e9 })
  const field = useRef({ dist: new Float32Array(0), noise: new Float32Array(0), cx: 0, cy: 0 })
  const buckets = useRef(new Buckets())

  const redraw = useDotCanvas(canvasRef, (ctx, g, now, reduced) => {
    const { dist, noise, cx, cy } = field.current
    const t = reduced ? 0 : now / 1000
    const since = reduced ? Infinity : (now - live.current.pulseAt) / 1000
    const pulseR = since * 26 // cells per second
    const pulseLife = Math.max(0, 1 - since / 1.6)
    const gx = cx - 2; const gy = cy - 3
    const b = buckets.current
    b.clear()
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
      if (x >= gx - 1 && x <= gx + 5 && y >= gy - 1 && y <= gy + 7) continue // clear frame around the glyph
      const i = y * g.cols + x
      const d = dist[i]
      // Slow outward rings, fading with distance, thresholded against per-cell noise (dither).
      let v = (0.5 + 0.5 * Math.sin(d * 0.55 - t * 1.6)) * Math.max(0.25, 1 - d / (g.cols + g.rows) * 1.2)
      if (pulseLife > 0) v += pulseLife * Math.exp(-((d - pulseR) ** 2) / 6) * 1.4
      if (v >= noise[i] * 0.9 + 0.08) b.add(x, y, v)
    }
    b.paint(ctx, g)
    drawText(ctx, g, live.current.glyph, gx, gy)
  }, {
    onResize: (g: Grid) => {
      const cx = Math.floor(g.cols / 2); const cy = Math.floor(g.rows / 2)
      const dist = new Float32Array(g.cols * g.rows); const noise = new Float32Array(g.cols * g.rows)
      for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
        dist[y * g.cols + x] = Math.abs(x - cx) + Math.abs(y - cy) // Manhattan: diamond rings
        noise[y * g.cols + x] = hash(x, y)
      }
      field.current = { dist, noise, cx, cy }
    }
  })

  useEffect(() => { live.current.glyph = glyph; redraw() }, [glyph]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pulse > 0) live.current.pulseAt = performance.now() }, [pulse])

  return <canvas ref={canvasRef} aria-hidden className={className} />
}
