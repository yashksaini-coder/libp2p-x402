'use client'

import { useRef } from 'react'
import { Buckets, LEVELS, WHITE, drawText, hash, textWidth, useDotCanvas, type Grid } from '@/lib/dotmatrix'

/**
 * The tagline, acted out in pixels: a packet runs TX -> CID along the top lane
 * (the payment's memo points at the content), then CID -> TX along the bottom
 * lane (the receipt points at the payment). Each block flashes and sends a
 * ring out when its packet lands.
 */

const CYCLE = 5.2 // seconds
// [start, end] of each phase within the cycle, in seconds.
const TOP = [0.3, 1.7]
const BOTTOM = [2.7, 4.1]

const ease = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2)
const phase = (t: number, [a, b]: number[]): number => Math.min(1, Math.max(0, (t - a) / (b - a)))

interface Layout { tx: Box, cid: Box, topY: number, botY: number, noise: Float32Array }
interface Box { x: number, y: number, w: number, h: number, label: string }

function layout (g: Grid): Layout {
  const box = (label: string, centerX: number): Box => {
    const w = textWidth(label) + 4; const h = 11
    return { x: Math.round(centerX - w / 2), y: Math.floor(g.rows / 2 - h / 2), w, h, label }
  }
  const tx = box('TX', g.cols * 0.22)
  const cid = box('CID', g.cols * 0.76)
  const noise = new Float32Array(g.cols * g.rows)
  for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) noise[y * g.cols + x] = hash(x + 91, y + 17)
  return { tx, cid, topY: tx.y + 2, botY: tx.y + tx.h - 3, noise }
}

export function DotLink ({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lay = useRef<Layout | null>(null)
  const buckets = useRef(new Buckets())

  useDotCanvas(canvasRef, (ctx, g, now, reduced) => {
    const L = lay.current
    if (L == null) return
    const t = reduced ? 1.2 : (now / 1000) % CYCLE // reduced motion: a still frame mid-flight on the top lane
    const top = ease(phase(t, TOP))
    const bot = ease(phase(t, BOTTOM))
    // Arrival flashes: 0..1, decaying over 0.9 s after each packet lands.
    const flashCid = t >= TOP[1] ? Math.max(0, 1 - (t - TOP[1]) / 0.9) : 0
    const flashTx = t >= BOTTOM[1] ? Math.max(0, 1 - (t - BOTTOM[1]) / 0.9) : 0
    const { tx, cid, topY, botY, noise } = L
    const laneA = tx.x + tx.w + 1; const laneB = cid.x - 2 // lane spans these columns

    // 1. Faint dithered field, with a ring leaving whichever block just received a packet.
    const b = buckets.current
    b.clear()
    const ring = (box: Box, k: number, x: number, y: number): number => {
      if (k <= 0) return 0
      const d = Math.abs(x - (box.x + box.w / 2)) + Math.abs(y - (box.y + box.h / 2))
      return k * Math.exp(-((d - (1 - k) * 22 - box.w / 2) ** 2) / 5)
    }
    const shimmer = reduced ? 0 : now / 1000
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
      const inBox = (bx: Box): boolean => x >= bx.x - 1 && x <= bx.x + bx.w && y >= bx.y - 1 && y <= bx.y + bx.h
      if (inBox(tx) || inBox(cid) || ((y === topY || y === botY) && x >= laneA - 1 && x <= laneB + 1)) continue
      const v = 0.18 + 0.12 * Math.sin(x * 0.4 + y * 0.3 + shimmer * 0.8) + ring(cid, flashCid, x, y) + ring(tx, flashTx, x, y)
      if (v >= noise[y * g.cols + x] * 0.9 + 0.1) b.add(x, y, v)
    }
    b.paint(ctx, g)

    // 2. Lanes: dotted, with an arrowhead at the receiving end.
    ctx.fillStyle = LEVELS[2]
    for (let x = laneA; x <= laneB; x += 2) {
      ctx.fillRect(x * g.cell, topY * g.cell, g.size, g.size)
      ctx.fillRect(x * g.cell, botY * g.cell, g.size, g.size)
    }
    ctx.fillStyle = LEVELS[4]
    for (const [dx, dy] of [[0, 0], [-1, -1], [-1, 1]]) ctx.fillRect((laneB + 1 + dx) * g.cell, (topY + dy) * g.cell, g.size, g.size)
    for (const [dx, dy] of [[0, 0], [1, -1], [1, 1]]) ctx.fillRect((laneA - 1 + dx) * g.cell, (botY + dy) * g.cell, g.size, g.size)

    // 3. Packets: a white head with a fading three-cell tail.
    const packet = (k: number, y: number, dir: 1 | -1): void => {
      if (k <= 0 || k >= 1) return
      const head = Math.round(dir === 1 ? laneA + (laneB - laneA) * k : laneB - (laneB - laneA) * k)
      for (let tail = 3; tail >= 0; tail--) {
        ctx.fillStyle = tail === 0 ? WHITE : LEVELS[LEVELS.length - tail]
        ctx.fillRect((head - dir * tail) * g.cell, y * g.cell, g.size, g.size)
      }
    }
    packet(top, topY, 1)
    packet(bot, botY, -1)

    // 4. Blocks: outline brightens on arrival, label in white.
    const block = (box: Box, flash: number): void => {
      ctx.fillStyle = flash > 0.05 ? (flash > 0.5 ? WHITE : LEVELS[5]) : LEVELS[3]
      for (let x = box.x; x < box.x + box.w; x++) {
        ctx.fillRect(x * g.cell, box.y * g.cell, g.size, g.size)
        ctx.fillRect(x * g.cell, (box.y + box.h - 1) * g.cell, g.size, g.size)
      }
      for (let y = box.y + 1; y < box.y + box.h - 1; y++) {
        ctx.fillRect(box.x * g.cell, y * g.cell, g.size, g.size)
        ctx.fillRect((box.x + box.w - 1) * g.cell, y * g.cell, g.size, g.size)
      }
      drawText(ctx, g, box.label, box.x + 2, box.y + 2)
    }
    block(tx, flashTx)
    block(cid, flashCid)
  }, {
    // Keep ~60 columns at any width so both blocks and the lanes always fit.
    cell: (width) => Math.max(5, Math.min(10, width / 60)),
    onResize: (g) => { lay.current = layout(g) }
  })

  return <canvas ref={canvasRef} aria-hidden className={className} />
}
