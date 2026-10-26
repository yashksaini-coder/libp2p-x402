import Link from 'next/link'
import type { ComponentProps } from 'react'

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ')

export function Panel({ className, ...p }: ComponentProps<'section'>) {
  return <section className={cx('rounded-2xl border border-line bg-panel', className)} {...p} />
}

export function Eyebrow({ className, ...p }: ComponentProps<'p'>) {
  return <p className={cx('font-mono text-xs uppercase tracking-widest text-muted', className)} {...p} />
}

export function Mono({ className, ...p }: ComponentProps<'span'>) {
  return <span className={cx('font-mono', className)} {...p} />
}

export function Button({ className, variant = 'primary', ...p }: ComponentProps<typeof Link> & { variant?: 'primary' | 'quiet' }) {
  return (
    <Link
      className={cx(
        'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-base font-semibold transition-all duration-300 ease-out active:scale-[0.98]',
        variant === 'primary' ? 'bg-white text-black hover:bg-white/85' : 'border border-line text-white hover:bg-hover',
        className,
      )}
      {...p}
    />
  )
}

export function GlassPill({ className, ...p }: ComponentProps<'div'>) {
  return <div className={cx('rounded-full border border-line bg-white/5 backdrop-blur-xl', className)} {...p} />
}

/** First and last characters of a long base58 or base32 string. */
export const short = (s: string, head = 6, tail = 4) => (s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`)

/** Atomic USDC (6 decimals) to a display string. */
export const usdc = (atomic: number) => (atomic / 1e6).toFixed(6).replace(/0{1,2}$/, '')

export { cx }
