'use client'

import { MotionConfig } from 'motion/react'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}>
      {children}
    </MotionConfig>
  )
}
