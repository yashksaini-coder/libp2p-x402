'use client'

import { useEffect, useState } from 'react'
import type { PrivateKey } from '@libp2p/interface'
import { SWARM_TOKEN, SWARM_URL } from '@/lib/config'
import { Eyebrow, Mono, Panel, short } from '@/components/ui'

const KEY = 'libp2p-x402/sell-key'

type Sale = { at: number, bytes: number, tx: string }
type View =
  | { status: 'starting' }
  | { status: 'error', message: string }
  | { status: 'live', peerId: string, payee: string, mode: string, relay: string, transports: string[], persisted: boolean }

/** The tab's key lives in localStorage: its PeerId and its Solana payee survive reloads. Private windows get a fresh one. */
async function tabKey(): Promise<{ key: PrivateKey, persisted: boolean }> {
  const { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } = await import('@libp2p/crypto/keys')
  const { base64 } = await import('multiformats/bases/base64')
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) return { key: privateKeyFromProtobuf(base64.baseDecode(saved)), persisted: true }
  } catch {}
  const key = await generateKeyPair('Ed25519')
  try {
    localStorage.setItem(KEY, base64.baseEncode(privateKeyToProtobuf(key)))
    return { key, persisted: true }
  } catch {
    return { key, persisted: false }
  }
}

export function SellTab() {
  const [view, setView] = useState<View>({ status: 'starting' })
  const [sales, setSales] = useState<Sale[]>([])

  useEffect(() => {
    let stop: (() => Promise<void>) | undefined
    let cancelled = false
    ;(async () => {
      const { startTabSeller } = await import('@swarm/tab')
      const { key, persisted } = await tabKey()
      const seller = await startTabSeller({
        swarmUrl: SWARM_URL,
        token: SWARM_TOKEN,
        privateKey: key,
        onSettled: ({ settlement, bytes }) => setSales((s) => [{ at: Date.now(), bytes, tx: settlement.transaction }, ...s]),
      })
      stop = seller.stop
      if (cancelled) return stop()
      const lib = seller.helia.libp2p
      const refresh = () => {
        const transports = lib.getConnections().map((c) => c.remoteAddr.toString().includes('/webrtc') ? 'webrtc' : c.remoteAddr.toString().includes('/p2p-circuit') ? 'circuit' : 'ws')
        setView({ status: 'live', peerId: lib.peerId.toString(), payee: seller.payee, mode: seller.config.mode, relay: seller.config.relay, transports, persisted })
      }
      lib.addEventListener('connection:open', refresh)
      lib.addEventListener('connection:close', refresh)
      refresh()
    })().catch((err) => { if (!cancelled) setView({ status: 'error', message: String(err?.message ?? err) }) })
    return () => {
      cancelled = true
      void stop?.()
    }
  }, [])

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <Eyebrow>Browser seller · libp2p</Eyebrow>
        <h1 className="text-4xl font-semibold tracking-tight">This tab sells a dataset</h1>
        <p className="text-xl text-muted">
          A Helia node runs in this tab. It reserves a slot on the swarm&apos;s relay, so the agent can dial it, then upgrades to a direct WebRTC
          connection and pays this tab&apos;s own key in USDC.
        </p>
      </header>

      {view.status === 'starting' && <Panel className="p-6 text-xl text-muted" role="status">Starting the node and reserving a relay slot</Panel>}

      {view.status === 'error' && (
        <Panel className="flex flex-col gap-2 p-6" role="alert">
          <h2 className="text-2xl font-semibold">Not selling</h2>
          <p className="text-xl text-muted">{view.message}</p>
          <p className="text-xl text-muted">
            Check the swarm is running at <Mono className="text-white">{SWARM_URL}</Mono>, then reload.
          </p>
        </Panel>
      )}

      {view.status === 'live' && (
        <Panel className="flex flex-col gap-4 p-6" data-state="live">
          <Row label="PeerId"><Mono>{short(view.peerId, 10, 6)}</Mono></Row>
          <Row label="Paid at (Solana)"><Mono>{view.payee}</Mono></Row>
          <Row label="Relay"><Mono>{short(view.relay.split('/p2p/')[0], 30, 0)}</Mono></Row>
          <Row label="Connections">
            <Mono>{view.transports.length ? view.transports.join(' · ') : 'none'}</Mono>
          </Row>
          <Row label="Mode"><Mono>{view.mode}</Mono></Row>
          {!view.persisted && <p className="text-base text-muted">This browser blocks storage, so this key and address last only until the tab closes.</p>}
          {view.mode === 'devnet' && (
            <p className="text-base text-muted">
              On devnet this address needs a USDC account before it can be paid: request devnet USDC for it once at faucet.circle.com.
            </p>
          )}
        </Panel>
      )}

      <Panel className="flex flex-col gap-3 p-6" aria-live="polite">
        <Eyebrow>Sales</Eyebrow>
        {!sales.length ? (
          <p className="text-xl text-muted">No sales yet. Run scene 1 from the live dashboard.</p>
        ) : (
          sales.map((s) => (
            <p key={s.at} className="text-xl">
              Sold <Mono>{(s.bytes / 1024).toFixed(0)} KiB</Mono>
              {' '}· tx <Mono className="text-muted">{short(s.tx, 8, 6)}</Mono>
            </p>
          ))
        )}
      </Panel>
    </main>
  )
}

function Row({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xl">
      <span className="text-muted">{label}</span>
      <span className="break-all text-right">{children}</span>
    </div>
  )
}
