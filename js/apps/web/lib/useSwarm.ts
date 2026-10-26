'use client'

import { useEffect, useState } from 'react'
import type { SwarmEvent } from '@swarm/events'
import { initialState, reduce, type LiveState } from './reduce'
import { REPLAY } from './fixtures'
import { SWARM_URL } from './config'

export type Link = { status: 'connecting' | 'live' | 'offline', retryIn?: number }

/**
 * Live: EventSource on the swarm, with our own backoff so the offline state is visible.
 * Fixture: plays lib/fixtures on a timer, looping. Its hello says mode `replay`, so it is never shown as live.
 */
export function useSwarm(fixture: boolean): { state: LiveState, link: Link } {
  const [state, setState] = useState<LiveState>(initialState)
  const [link, setLink] = useState<Link>({ status: 'connecting' })

  useEffect(() => {
    if (!fixture) return
    setLink({ status: 'live' })
    let i = 0
    let seq = 0
    let timer: ReturnType<typeof setTimeout>
    const next = () => {
      const step = REPLAY[i]
      const e = { ...step.e, seq: ++seq, at: Date.now() } as SwarmEvent
      setState((s) => reduce({ ...s, connected: true }, e))
      i = (i + 1) % REPLAY.length
      timer = setTimeout(next, i === 0 ? 6000 : REPLAY[i].dt)
    }
    timer = setTimeout(next, 300)
    return () => clearTimeout(timer)
  }, [fixture])

  useEffect(() => {
    if (fixture) return
    let es: EventSource | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let tick: ReturnType<typeof setInterval> | undefined
    let attempt = 0
    let closed = false

    const connect = () => {
      clearInterval(tick)
      // Stay in the offline state while retrying, so the overlay does not flicker.
      setLink((l) => (l.status === 'offline' ? l : { status: 'connecting' }))
      es = new EventSource(`${SWARM_URL}/events`)
      es.onopen = () => {
        attempt = 0
        setLink({ status: 'live' })
        setState((s) => ({ ...s, connected: true }))
      }
      es.onmessage = (m) => {
        let e: SwarmEvent
        try { e = JSON.parse(m.data) } catch { return }
        setState((s) => reduce(s, e))
      }
      es.onerror = () => {
        es?.close()
        if (closed) return
        setState((s) => ({ ...s, connected: false }))
        const wait = Math.min(10_000, 1000 * 2 ** attempt++)
        const until = Date.now() + wait
        setLink({ status: 'offline', retryIn: Math.ceil(wait / 1000) })
        tick = setInterval(() => setLink({ status: 'offline', retryIn: Math.max(0, Math.ceil((until - Date.now()) / 1000)) }), 500)
        timer = setTimeout(connect, wait)
      }
    }
    connect()
    return () => {
      closed = true
      es?.close()
      clearTimeout(timer)
      clearInterval(tick)
    }
  }, [fixture])

  return { state, link }
}
