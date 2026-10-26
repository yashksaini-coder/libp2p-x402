'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Shared plumbing for the dot-matrix canvases: DPR (capped at 2), a 30 fps
 * cap, a full pause offscreen and in hidden tabs, and one still frame under
 * reduced motion. Each visual only supplies `render`.
 */

export const GAP = 2
const FPS = 30
// Monochrome on purpose: on this site colour is status (green = settled, red = rejected).
export const LEVELS = ['#1a1a1a', '#262626', '#3a3a3a', '#555555', '#7a7a7a', '#a8a8a8']
export const WHITE = '#ffffff'

export interface Grid { cols: number, rows: number, cell: number, size: number }

/** 5x7 pixel font. */
export const FONT: Record<string, string[]> = {
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110']
}

/** Width in cells of `text` set in FONT with 1-cell letter spacing. */
export const textWidth = (text: string): number => text.length * 6 - 1

export function drawText (ctx: CanvasRenderingContext2D, g: Grid, text: string, x: number, y: number, color = WHITE): void {
  ctx.fillStyle = color
  for (const [k, ch] of [...text].entries()) {
    const rows = FONT[ch] ?? FONT['?']
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (rows[r][c] === '1') ctx.fillRect((x + k * 6 + c) * g.cell, (y + r) * g.cell, g.size, g.size)
    }
  }
}

/** Cheap stable per-cell noise in [0,1): the dithered, sparse texture. */
export const hash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Collects cells per brightness level so a frame needs one fillStyle change per level. */
export class Buckets {
  private readonly b: number[][] = LEVELS.map(() => [])
  clear (): void { for (const l of this.b) l.length = 0 }
  /** v in [0,1+]: brighter values land in higher levels. */
  add (x: number, y: number, v: number): void {
    this.b[Math.max(0, Math.min(LEVELS.length - 1, Math.floor(v * (LEVELS.length - 0.01))))].push(x, y)
  }
  paint (ctx: CanvasRenderingContext2D, g: Grid): void {
    for (let l = 0; l < LEVELS.length; l++) {
      const cells = this.b[l]
      if (cells.length === 0) continue
      ctx.fillStyle = LEVELS[l]
      for (let k = 0; k < cells.length; k += 2) ctx.fillRect(cells[k] * g.cell, cells[k + 1] * g.cell, g.size, g.size)
    }
  }
}

export interface DotCanvasOptions {
  /** CSS px per cell (incl. gap) for a given canvas width. Default 10. */
  cell?: (width: number) => number
  /** Called after every resize with the new grid, before the first draw. */
  onResize?: (g: Grid) => void
}

/**
 * Drives `render(ctx, grid, nowMs, reduced)` on the canvas. Returns a function
 * that forces one redraw (used by reduced-motion visuals when their props change).
 */
export function useDotCanvas (
  ref: RefObject<HTMLCanvasElement | null>,
  render: (ctx: CanvasRenderingContext2D, g: Grid, now: number, reduced: boolean) => void,
  opts: DotCanvasOptions = {}
): () => void {
  const renderRef = useRef(render)
  renderRef.current = render
  const optsRef = useRef(opts)
  optsRef.current = opts
  const redraw = useRef<() => void>(() => {})

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (canvas == null || ctx == null) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let g: Grid = { cols: 0, rows: 0, cell: 10, size: 10 - GAP }

    const draw = (now: number): void => {
      ctx.clearRect(0, 0, (g.cols + 1) * g.cell, (g.rows + 1) * g.cell)
      renderRef.current(ctx, g, now, reduced)
    }
    const resize = (): void => {
      const { width, height } = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const cell = Math.round(optsRef.current.cell?.(width) ?? 10)
      g = { cols: Math.floor(width / cell), rows: Math.floor(height / cell), cell, size: cell - GAP }
      optsRef.current.onResize?.(g)
      draw(performance.now())
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
    const ro = new ResizeObserver(resize)
    const onVis = (): void => { if (document.hidden) stop(); else start() }
    io.observe(canvas)
    ro.observe(canvas)
    document.addEventListener('visibilitychange', onVis)
    redraw.current = () => { if (reduced) draw(performance.now()) }
    resize()
    return () => { stop(); io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); redraw.current = () => {} }
  }, [ref])

  return () => redraw.current()
}
