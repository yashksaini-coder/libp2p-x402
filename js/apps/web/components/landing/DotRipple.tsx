'use client'

import { useEffect, useRef } from 'react'

/**
 * Dot-matrix ripple: diamond rings of pixels drift out from a glyph at the
 * centre; `pulse` (a changing number) fires a bright ring and swaps the glyph.
 *
 * Cost: one canvas, ~1-2k cells grouped into 6 brightness levels (6 fillStyle
 * changes per frame), 30 fps cap, DPR capped at 2, fully paused offscreen and
 * when the tab is hidden. Reduced motion: one still frame, glyph swaps only.
 */

const CELL = 10 // css px per cell, including the gap
const GAP = 2
const FPS = 30
// Monochrome on purpose: on this site colour is status (green = settled, red = rejected).
const LEVELS = ['#1a1a1a', '#262626', '#3a3a3a', '#555555', '#7a7a7a', '#a8a8a8']
const GLYPH_COLOR = '#ffffff'

// 5x7 pixel font: '?' and digits 1-9.
const FONT: Record<string, string[]> = {
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
}

/** Cheap stable per-cell noise in [0,1): gives the dithered, sparse texture. */
const hash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function DotRipple ({ glyph, pulse, className }: { glyph: string, pulse: number, className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read by the render loop without restarting it.
  const live = useRef({ glyph, pulseAt: -1e9 })
  const redraw = useRef<() => void>(() => {})

  useEffect(() => { live.current.glyph = glyph; redraw.current() }, [glyph])
  useEffect(() => { if (pulse > 0) live.current.pulseAt = performance.now() }, [pulse])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas == null) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (ctx == null) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let cols = 0; let rows = 0; let cx = 0; let cy = 0
    let dist = new Float32Array(0); let noise = new Float32Array(0)
    const buckets: number[][] = LEVELS.map(() => [])

    const resize = (): void => {
      const { width, height } = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cols = Math.floor(width / CELL); rows = Math.floor(height / CELL)
      cx = Math.floor(cols / 2); cy = Math.floor(rows / 2)
      dist = new Float32Array(cols * rows); noise = new Float32Array(cols * rows)
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        dist[y * cols + x] = Math.abs(x - cx) + Math.abs(y - cy) // Manhattan: diamond rings
        noise[y * cols + x] = hash(x, y)
      }
      draw(performance.now())
    }

    const draw = (now: number): void => {
      const t = reduced ? 0 : now / 1000
      const { glyph: g, pulseAt } = live.current
      const since = reduced ? Infinity : (now - pulseAt) / 1000
      const pulseR = since * 26 // cells per second
      const pulseLife = Math.max(0, 1 - since / 1.6)
      const rows7 = FONT[g] ?? FONT['?']
      const gx = cx - 2; const gy = cy - 3
      for (const b of buckets) b.length = 0

      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        const d = dist[i]
        if (x >= gx - 1 && x <= gx + 5 && y >= gy - 1 && y <= gy + 7) continue // clear frame around the glyph
        // Slow outward rings, fading with distance, thresholded against per-cell noise (dither).
        let v = 0.5 + 0.5 * Math.sin(d * 0.55 - t * 1.6)
        v *= Math.max(0.25, 1 - d / (cols + rows) * 1.2)
        if (pulseLife > 0) v += pulseLife * Math.exp(-((d - pulseR) ** 2) / 6) * 1.4
        if (v < noise[i] * 0.9 + 0.08) continue
        buckets[Math.min(LEVELS.length - 1, Math.floor(v * (LEVELS.length - 0.01)))].push(x, y)
      }

      ctx.clearRect(0, 0, cols * CELL + CELL, rows * CELL + CELL)
      const size = CELL - GAP
      for (let l = 0; l < LEVELS.length; l++) {
        const b = buckets[l]
        if (b.length === 0) continue
        ctx.fillStyle = LEVELS[l]
        for (let k = 0; k < b.length; k += 2) ctx.fillRect(b[k] * CELL, b[k + 1] * CELL, size, size)
      }
      ctx.fillStyle = GLYPH_COLOR
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
        if (rows7[r][c] === '1') ctx.fillRect((gx + c) * CELL, (gy + r) * CELL, size, size)
      }
    }

    let raf = 0; let last = 0; let visible = false
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      if (now - last < 1000 / FPS) return
      last = now
      draw(now)
    }
    const start = (): void => { if (!reduced && raf === 0 && visible && !document.hidden) raf = requestAnimationFrame(loop) }
    const stop = (): void => { cancelAnimationFrame(raf); raf = 0 }

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop() })
    io.observe(canvas)
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const onVis = (): void => { if (document.hidden) stop(); else start() }
    document.addEventListener('visibilitychange', onVis)
    // Reduced motion: no loop; the glyph effect redraws one still frame on change.
    redraw.current = () => { if (reduced) draw(performance.now()) }
    resize()

    return () => { stop(); io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); redraw.current = () => {} }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className={className} />
}
