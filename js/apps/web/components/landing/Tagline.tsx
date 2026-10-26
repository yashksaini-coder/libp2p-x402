'use client'

import { useEffect, useRef, useState } from 'react'
import { cubicBezier, motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react'

const LINES = ['The payment points at the content.', 'The receipt points at the payment.']
const ease = cubicBezier(0.32, 0.72, 0, 1)

function Word({ word, i, n, progress, still }: { word: string, i: number, n: number, progress: MotionValue<number>, still: boolean }) {
  // Each word owns a slice of the scroll range, so words light up one at a time in reading order.
  const opacity = useTransform(progress, [i / n, (i + 1) / n], [0.3, 1], { ease })
  return <motion.span style={{ opacity: still ? 1 : opacity }}>{word} </motion.span>
}

export function Tagline() {
  const ref = useRef<HTMLHeadingElement>(null)
  const reduced = useReducedMotion()
  // Read the preference only after hydration so server and client markup match.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.45'] })
  const words = LINES.map((l) => l.split(' '))
  const n = words.flat().length
  let i = 0
  return (
    <h2 ref={ref} className="max-w-[680px] text-4xl font-semibold tracking-tight md:text-6xl">
      {words.map((line, li) => (
        <span key={li} className="block">
          {line.map((w) => {
            const idx = i++
            return <Word key={idx} word={w} i={idx} n={n} progress={scrollYProgress} still={mounted && !!reduced} />
          })}
        </span>
      ))}
    </h2>
  )
}
