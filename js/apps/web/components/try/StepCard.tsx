import { CaretDown, Check, WarningCircle } from '@phosphor-icons/react'
import { Panel, cx } from '@/components/ui'

export type CardState = 'waiting' | 'active' | 'done' | 'error'

/** One step of the visitor flow: a state, one plain sentence, the work area, and the protocol detail on request. */
export function StepCard({ n, title, state, sentence, hood, children }: {
  n: number, title: string, state: CardState, sentence: React.ReactNode, hood: React.ReactNode, children?: React.ReactNode
}) {
  return (
    <Panel
      aria-labelledby={`step-${n}`}
      data-state={state}
      className={cx('flex flex-col gap-4 p-4 transition-colors duration-500 ease-out sm:p-6', state === 'active' && 'border-white/20', state === 'error' && 'border-rejected/40')}
    >
      <header className="flex items-center gap-3">
        <span
          aria-hidden
          className={cx(
            'grid size-8 shrink-0 place-items-center rounded-full border font-mono text-sm font-semibold transition-colors duration-500 ease-out',
            state === 'waiting' && 'border-line text-muted',
            state === 'active' && 'border-white text-white',
            state === 'done' && 'border-transparent bg-white text-black',
            state === 'error' && 'border-transparent bg-rejected text-black',
          )}
        >
          {state === 'done' ? <Check size={16} weight="bold" /> : state === 'error' ? <WarningCircle size={18} weight="bold" /> : n}
        </span>
        <h2 id={`step-${n}`} className={cx('text-lg font-semibold', state === 'waiting' && 'text-muted')}>{title}</h2>
        <span className="sr-only">({state})</span>
      </header>
      <p className={cx('text-base', state === 'waiting' ? 'text-muted' : 'text-white/90')} aria-live="polite">{sentence}</p>
      {children}
      <details className="group text-sm text-muted">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md transition-colors duration-300 ease-out hover:text-white [&::-webkit-details-marker]:hidden">
          Under the hood
          <CaretDown size={14} aria-hidden className="transition-transform duration-300 ease-out group-open:rotate-180" />
        </summary>
        <div className="pb-1 font-mono text-xs leading-relaxed">{hood}</div>
      </details>
    </Panel>
  )
}
