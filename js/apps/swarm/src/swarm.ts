import { FETCH_PROTOCOL, PIN_PROTOCOL, fetchHandler, fetchPaid, pinHandler, pinPaid, type FetchHooks } from 'ipfs-x402'
import { X402Error, payeeFromPeerId, type PayHooks } from 'x402-libp2p'
import type { PeerId } from '@libp2p/interface'
import type { FacilitatorClient } from '@x402/core/server'
import { peerIdFromString } from '@libp2p/peer-id'
import { multiaddr } from '@multiformats/multiaddr'
import type { CID } from 'multiformats/cid'
import { join } from 'node:path'
import { Bus } from './bus.ts'
import { DRIP_AMOUNT, DRIP_LIMITS, createDrip, devnetDrip, type Drip } from './drip.ts'
import type { Mode, Role, SwarmEventBody } from './events.ts'
import { ephemeralKeys, loadKeys } from './keys.ts'
import { startKubo, type Kubo } from './kubo.ts'
import { addContent, carBytes, checkpoint, dataset, heliaNode, tamper, type Node } from './nodes.ts'
import { startRelay } from './relay.ts'
import type { SellConfig, VisitorConfig } from './shared.ts'
import { devnetPayments, mockPayments, PUBLIC_RPC, setPending, tagPayment, type Payments, type Pending } from './payments.ts'
import { watchDevnet, watchMock } from './txwatch.ts'

export interface SwarmOptions {
  mode: Exclude<Mode, 'replay' | 'local'>
  keysDir?: string
  kubo?: boolean
  recordTo?: string
  /** Loopback WebSockets port of the circuit relay browser sellers reserve on. 0 = any. */
  relayPort?: number
  /** Loopback WebSockets port visitors reach the seller on (through the tunnel). 0 = any. */
  sellerWsPort?: number
  /** The seller's public multiaddr behind the tunnel, without /p2p. */
  sellerPublicAddr?: string
}

export interface Swarm {
  bus: Bus
  hello: SwarmEventBody & { kind: 'hello' }
  /** Runs a scene; rejects with SceneBusy if one is already running. */
  runScene: (n: 1 | 2 | 3) => Promise<void>
  busy: () => boolean
  /** For browser sellers: GET /sell/config, and /facilitator/* to verify and settle. */
  sellConfig: () => SellConfig
  /** GET /visitor/config: how a visitor's browser reaches and pays the seller. */
  visitorConfig: () => VisitorConfig
  /** POST /sell/register: a tab proves the control token before the relay treats it as a seller. */
  allowTab: (peerId: string) => Promise<void>
  facilitator: FacilitatorClient
  /** POST /visitor/drip and /visitor/pause: test USDC for visitors (mock: limits apply, nothing is sent). */
  drip: Drip
  stop: () => Promise<void>
}

export class SceneBusy extends Error {}

const MAX_BYTES = 8 * 1024 * 1024
/** Each paid stream may wait 120 s for its payment: bound how many one peer, and everyone, can hold open. */
export const VISITOR_STREAMS = { perPeer: 2, total: 32 }
const TAB_TITLE = 'An agent buys a dataset from a browser tab'
const TITLES = { 1: 'An agent buys a dataset from a peer', 2: 'A tampered upload is rejected before payment', 3: 'Pay a peer to keep it, then a stock IPFS node fetches it' } as const

export async function startSwarm (opts: SwarmOptions): Promise<Swarm> {
  const bus = new Bus({ recordTo: opts.recordTo })
  const keys = opts.mode === 'devnet' ? await loadKeys(opts.keysDir ?? '.keys') : await ephemeralKeys()

  // Every settlement transaction is attributed to the payment in flight when it was submitted.
  let currentPayment = ''
  const watch = opts.mode === 'devnet' ? watchDevnet : watchMock
  const onSubmit = (signature: string, submittedAt: number, tagged?: string): void => {
    const paymentId = tagged ?? currentPayment
    bus.emit({ kind: 'tx', paymentId, signature, status: 'submitted', ms: 0 })
    watch(signature, submittedAt, (status, ms) => bus.emit({ kind: 'tx', paymentId, signature, status, ms }))
      .catch(err => bus.emit({ kind: 'error', code: 'tx_watch_failed', message: String(err?.message ?? err), settled: false }))
  }
  const payments: Payments = opts.mode === 'devnet' ? await devnetPayments(keys, onSubmit) : await mockPayments(onSubmit)

  // Devnet: the seller and provider must hold USDC accounts before anyone can pay them.
  const dev = opts.mode === 'devnet' ? await devnetDrip(keys, onSubmit) : undefined
  if (dev != null) await dev.ensurePayeeAccounts([keys.seller.address, keys.provider.address])
  const drip = dev != null
    ? createDrip({ send: dev.send, feePayerLamports: dev.feePayerLamports, ledgerFile: join(opts.keysDir ?? '.keys', 'drip-ledger.json') })
    : createDrip({ send: async () => '', feePayerLamports: async () => DRIP_LIMITS.minFeePayerLamports })
  // lowSol follows the real balance, so drip.enabled recovers after a top-up without any visitor request.
  await drip.refresh().catch(err => console.error(`drip balance check failed: ${String(err)}`))
  const balanceTimer = setInterval(() => { drip.refresh().catch(() => {}) }, 30_000)
  balanceTimer.unref()

  const hello = { kind: 'hello', mode: payments.mode, network: payments.network, explorer: 'https://explorer.solana.com/tx/{sig}?cluster=devnet' } as const
  bus.emit(hello)

  const [agent, seller, provider] = await Promise.all([heliaNode(keys.agent.libp2p, { dialsTabs: true }), heliaNode(keys.seller.libp2p, { wsPort: opts.sellerWsPort ?? 0, announce: opts.sellerPublicAddr != null ? [opts.sellerPublicAddr] : undefined }), heliaNode(keys.provider.libp2p)])
  const kubo: Kubo | undefined = opts.kubo === true ? await startKubo() : undefined
  const id = (n: { libp2p: { peerId: PeerId } }): string => n.libp2p.peerId.toString()

  const announce = (n: Node, role: Role, label: string): void => {
    bus.emit({ kind: 'peer', id: id(n), role, label, addrs: n.libp2p.getMultiaddrs().map(String), payee: payeeFromPeerId(n.libp2p.peerId) })
  }
  announce(agent, 'agent', 'Agent')
  announce(seller, 'seller', 'Data seller')
  announce(provider, 'provider', 'Storage provider')
  if (kubo != null) bus.emit({ kind: 'peer', id: kubo.id, role: 'kubo', label: 'Stock Kubo node', addrs: [] })

  // A browser tab can only be dialled through a relay: it reserves a slot here, then serves paid fetch.
  const relay = await startRelay(opts.relayPort ?? 0, (tab: PeerId, up: boolean) => {
    if (up) bus.emit({ kind: 'peer', id: tab.toString(), role: 'seller', label: 'Browser tab', addrs: [], payee: payeeFromPeerId(tab) })
    bus.emit({ kind: 'connection', from: tab.toString(), to: id(relay), transport: 'ws', state: up ? 'open' : 'closed' })
  })
  bus.emit({ kind: 'peer', id: id(relay), role: 'relay', label: 'Relay', addrs: [relay.addr] })

  // Visitors buy from the seller too (over WebSockets): the seller's own hooks report them, each payment under its own id.
  // Read (and removed) in onVerified right after; capped for verifies that never get there.
  const payers: Pending<string> = new Map()
  const visitorSellerServer = async (): Promise<Awaited<ReturnType<Payments['server']>>> => {
    const server = await payments.server()
    // The gate's hook gets the payload, not the facilitator's answer: keep the payer it verified.
    return server.onAfterVerify(async ({ paymentPayload, result }) => { if (result.payer != null) setPending(payers, JSON.stringify(paymentPayload.payload), result.payer) })
  }
  // Visitors already announced; one evicted is simply announced again.
  const visitors: Pending<true> = new Map()
  let visitSeq = 0
  const fromVisitor = (peer: PeerId): boolean => !peer.equals(agent.libp2p.peerId)
  const visitorHooks: FetchHooks = {
    onInvoice: ({ accepts, peer }) => {
      if (!fromVisitor(peer)) return
      const r = accepts[0]
      bus.emit({ kind: 'quote', from: id(seller), to: peer.toString(), protocol: FETCH_PROTOCOL, amount: r.amount, asset: r.asset, memo: r.extra?.memo as string | undefined, invoice: true })
    },
    onVerified: ({ payment, requirements: r, peer }) => {
      const key = JSON.stringify(payment.payload)
      const payer = payers.get(key)?.value ?? ''
      payers.delete(key) // the agent's too: onAfterVerify recorded every payer
      if (!fromVisitor(peer)) return
      const from = peer.toString()
      if (!visitors.has(from)) {
        setPending(visitors, from, true)
        bus.emit({ kind: 'peer', id: from, role: 'visitor', label: `Visitor ${payer.slice(0, 4)}…${payer.slice(-4)}`, addrs: [], payee: payer })
      }
      const paymentId = `visit-${++visitSeq}`
      tagPayment(payment, paymentId)
      bus.emit({ kind: 'payment', id: paymentId, from, to: id(seller), protocol: FETCH_PROTOCOL, amount: r.amount, asset: r.asset, network: r.network, memo: r.extra?.memo as string | undefined })
    }
  }

  // Seller sells a dataset over paid fetch; provider sells pinning.
  const datasetRoot = await addContent(seller, dataset())
  const checkpointRoot = await addContent(agent, checkpoint())
  await seller.libp2p.handle(FETCH_PROTOCOL, fetchHandler(seller, await visitorSellerServer(), payments.pricing(payeeFromPeerId(seller.libp2p.peerId)!), { maxBytes: MAX_BYTES, paymentTimeoutMs: 120_000, maxStreams: { ...VISITOR_STREAMS, exempt: p => !fromVisitor(p) } }, visitorHooks))
  await provider.libp2p.handle(PIN_PROTOCOL, pinHandler(provider, await payments.server(), payments.pricing(payeeFromPeerId(provider.libp2p.peerId)!), { maxBytes: MAX_BYTES, durationDays: 30 }, {
    onBlock: b => bus.emit({ kind: 'block', requestId: currentPayment, cid: b.cid.toString(), index: b.index, total: b.total, ok: b.ok }),
    onPinned: p => bus.emit({ kind: 'pinned', root: p.root.toString(), provider: id(provider), receiptCid: p.receipt.toString(), expiresAt: p.receiptBody.expiresAt, receipt: p.receiptBody })
  }))

  let paymentSeq = 0
  const agentHooks = (toId: string, protocol: string): PayHooks => ({
    onPaymentRequired: (pr, invoice) => {
      const r = pr.accepts[0]
      bus.emit({ kind: 'quote', from: toId, to: id(agent), protocol, amount: r.amount, asset: r.asset, memo: r.extra?.memo as string | undefined, invoice })
    },
    onPayeeCheck: ({ payTo, remotePeer, ok }) => {
      bus.emit({ kind: 'payee-check', from: id(agent), to: toId, payTo, remoteKey: payeeFromPeerId(remotePeer) ?? '', ok })
    },
    onPayment: (p) => {
      currentPayment = `pay-${++paymentSeq}`
      tagPayment(p, currentPayment)
      const r = p.accepted
      bus.emit({ kind: 'payment', id: currentPayment, from: id(agent), to: toId, protocol, amount: r.amount, asset: r.asset, network: r.network, memo: r.extra?.memo as string | undefined })
    }
  })
  const connected = (to: Node): void => { bus.emit({ kind: 'connection', from: id(agent), to: id(to), transport: 'tcp', state: 'open' }) }

  const scenes: Record<1 | 2 | 3, () => Promise<void>> = {
    1: async () => {
      const tab = relay.tab()
      const onBlock = (b: { cid: CID, index: number, total: number, ok: boolean }): void => { bus.emit({ kind: 'block', requestId: currentPayment, cid: b.cid.toString(), index: b.index, total: b.total, ok: b.ok }) }
      if (tab == null) {
        connected(seller)
        await fetchPaid(agent.libp2p, seller.libp2p.getMultiaddrs()[0], datasetRoot, payments.client, { hooks: agentHooks(id(seller), FETCH_PROTOCOL), onBlock })
        return
      }
      // Fresh connections every run, so the stage sees the upgrade happen.
      const to = tab.toString()
      await agent.libp2p.hangUp(tab)
      for (const transport of ['circuit', 'webrtc'] as const) bus.emit({ kind: 'connection', from: id(agent), to, transport, state: 'closed' })
      await agent.libp2p.dial(multiaddr(`${relay.addr}/p2p-circuit/p2p/${to}`))
      bus.emit({ kind: 'connection', from: id(agent), to, transport: 'circuit', state: 'open' })
      // The relayed connection is limited (time and bytes): it only carries WebRTC signalling.
      const direct = multiaddr(`${relay.addr}/p2p-circuit/webrtc/p2p/${to}`)
      await agent.libp2p.dial(direct)
      bus.emit({ kind: 'connection', from: id(agent), to, transport: 'webrtc', state: 'open' })
      await fetchPaid(agent.libp2p, direct, datasetRoot, payments.client, { hooks: agentHooks(to, FETCH_PROTOCOL), onBlock })
    },
    2: async () => {
      connected(provider)
      const bad = await tamper(await carBytes(agent, checkpointRoot), 13)
      try {
        await pinPaid(agent.libp2p, provider.libp2p.getMultiaddrs()[0], bad, checkpointRoot, payments.client, { hooks: agentHooks(id(provider), PIN_PROTOCOL) })
        throw new Error('provider accepted a tampered CAR')
      } catch (err) {
        if (!(err instanceof X402Error)) throw err
        bus.emit({ kind: 'error', code: err.code, message: err.message, scene: 2, settled: false })
      }
    },
    3: async () => {
      connected(provider)
      await pinPaid(agent.libp2p, provider.libp2p.getMultiaddrs()[0], await carBytes(agent, checkpointRoot), checkpointRoot, payments.client, { hooks: agentHooks(id(provider), PIN_PROTOCOL) })
      if (kubo != null) await kuboFetch(kubo, provider, checkpointRoot)
    }
  }

  const kuboFetch = async (k: Kubo, from: Node, root: CID): Promise<void> => {
    await k.connect(`${from.libp2p.getMultiaddrs()[0]}`)
    bus.emit({ kind: 'connection', from: k.id, to: id(from), transport: 'tcp', state: 'open' })
    const started = Date.now()
    const { blocks } = await k.fetchDag(root.toString())
    bus.emit({ kind: 'provided', root: root.toString(), via: 'kubo-bitswap', by: k.id, blocks, ms: Date.now() - started })
  }

  let running = false
  return {
    bus,
    hello,
    busy: () => running,
    runScene: async (n) => {
      if (running) throw new SceneBusy(`scene already running`)
      running = true
      const title = n === 1 && relay.tab() != null ? TAB_TITLE : TITLES[n]
      bus.emit({ kind: 'scene', n, state: 'start', title })
      try {
        await scenes[n]()
        bus.emit({ kind: 'scene', n, state: 'done', title })
      } catch (err: any) {
        bus.emit({ kind: 'error', code: err?.code ?? 'scene_failed', message: String(err?.message ?? err), scene: n, settled: false })
        bus.emit({ kind: 'scene', n, state: 'failed', title })
      } finally {
        running = false
      }
    },
    sellConfig: () => ({ mode: payments.mode as 'mock' | 'devnet', scheme: payments.scheme, network: payments.network, asset: payments.asset, rpcUrl: payments.rpcUrl != null ? PUBLIC_RPC : undefined, relay: relay.addr, root: datasetRoot.toString() }),
    visitorConfig: () => {
      const peerId = id(seller)
      const loopback = seller.libp2p.getMultiaddrs().map(String).find(a => a.includes('/ws/'))!
      const d = drip.status()
      return {
        mode: payments.mode as 'mock' | 'devnet',
        network: payments.network,
        asset: payments.asset,
        rpcUrl: payments.rpcUrl != null ? PUBLIC_RPC : undefined,
        root: datasetRoot.toString(),
        seller: { peerId, payee: payeeFromPeerId(seller.libp2p.peerId)!, addrs: [opts.sellerPublicAddr != null ? `${opts.sellerPublicAddr}/p2p/${peerId}` : loopback] },
        drip: { amount: DRIP_AMOUNT.toString(), enabled: !d.paused && d.remaining > 0 && !d.lowSol }
      }
    },
    allowTab: async (peerId) => { await relay.allow(peerIdFromString(peerId)) },
    facilitator: payments.facilitator,
    drip,
    stop: async () => {
      clearInterval(balanceTimer)
      await Promise.all([relay.libp2p.stop(), agent.stop(), seller.stop(), provider.stop(), kubo?.stop()])
    }
  }
}
