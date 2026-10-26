'use client'

import { useCallback, useEffect, useState } from 'react'
import { SWARM_TOKEN, SWARM_URL } from '@/lib/config'
import { cx } from '@/components/ui'

const SCENES = [
  { n: 1, title: 'Buy a dataset', tab: 'Sell from a tab' },
  { n: 2, title: 'Tamper' },
  { n: 3, title: 'Pay to keep it' },
] as const

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Presenter controls. Rendered only when /live is served from localhost; keys 1, 2, 3 trigger the same POST. */
/** `tabLive`: a browser tab holds a relay slot, so scene 1 really buys from it. Only then does the label say so. */
export function SceneControls({ running, tabLive }: { running?: number, tabLive?: boolean }) {
  const [local, setLocal] = useState(false)
  const [msg, setMsg] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => setLocal(LOCAL.has(window.location.hostname)), [])

  const start = useCallback(async (n: number) => {
    setBusy(true)
    setMsg(undefined)
    try {
      const res = await fetch(`${SWARM_URL}/scenes/${n}`, { method: 'POST', headers: { Authorization: `Bearer ${SWARM_TOKEN}` } })
      if (res.status === 409) setMsg('A scene is already running. Wait for it to finish.')
      else if (res.status === 401) setMsg('The swarm rejected the token. Check NEXT_PUBLIC_SWARM_TOKEN.')
      else if (!res.ok) setMsg(`The swarm answered ${res.status}.`)
    } catch {
      setMsg('Could not reach the swarm.')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!local) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest('input,textarea,[contenteditable]')) return
      if (e.key === '1' || e.key === '2' || e.key === '3') start(Number(e.key))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [local, start])

  if (!local) return null
  return (
    <div className="flex items-center gap-3">
      {msg && <p role="status" className="max-w-xs text-sm text-rejected">{msg}</p>}
      {SCENES.map((s) => (
        <button
          key={s.n}
          disabled={busy}
          onClick={() => start(s.n)}
          aria-keyshortcuts={String(s.n)}
          className={cx(
            'flex items-center gap-2 rounded-full border border-line px-3 py-2 text-base font-semibold transition-all duration-300 ease-out hover:bg-hover active:scale-[0.98] disabled:opacity-50',
            running === s.n ? 'bg-white text-black hover:bg-white' : 'bg-raised text-white',
          )}
        >
          <kbd className="font-mono text-sm text-muted">{s.n}</kbd>
          {tabLive && 'tab' in s ? s.tab : s.title}
        </button>
      ))}
    </div>
  )
}
