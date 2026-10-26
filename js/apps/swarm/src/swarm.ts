import { FETCH_PROTOCOL, PIN_PROTOCOL, fetchHandler, fetchPaid, pinHandler, pinPaid } from 'ipfs-x402'
import { X402Error, payeeFromPeerId, type PayHooks } from 'x402-libp2p'
import type { CID } from 'multiformats/cid'
import { Bus } from './bus.ts'
import type { Mode, Role, SwarmEventBody } from './events.ts'
import { ephemeralKeys, loadKeys } from './keys.ts'
import { startKubo, type Kubo } from './kubo.ts'
import { addContent, carBytes, checkpoint, dataset, heliaNode, tamper, type Node } from './nodes.ts'
import { devnetPayments, mockPayments, type Payments } from './payments.ts'
import { watchDevnet, watchMock } from './txwatch.ts'

export interface SwarmOptions {
  mode: Exclude<Mode, 'replay' | 'local'>
  keysDir?: string
  kubo?: boolean
  recordTo?: string
}

export interface Swarm {
  bus: Bus
  hello: SwarmEventBody & { kind: 'hello' }
  /** Runs a scene; rejects with SceneBusy if one is already running. */
  runScene: (n: 1 | 2 | 3) => Promise<void>
  busy: () => boolean
  stop: () => Promise<void>
}

export class SceneBusy extends Error {}

const MAX_BYTES = 8 * 1024 * 1024
const TITLES = { 1: 'An agent buys a dataset from a peer', 2: 'A tampered upload is rejected before payment', 3: 'Pay a peer to keep it, then a stock IPFS node fetches it' } as const

export async function startSwarm (opts: SwarmOptions): Promise<Swarm> {
  const bus = new Bus({ recordTo: opts.recordTo })
  const keys = opts.mode === 'devnet' ? await loadKeys(opts.keysDir ?? '.keys') : await ephemeralKeys()

  // Every settlement transaction is attributed to the payment in flight when it was submitted.
  let currentPayment = ''
  const watch = opts.mode === 'devnet' ? watchDevnet : watchMock
  const onSubmit = (signature: string, submittedAt: number): void => {
    const paymentId = currentPayment
    bus.emit({ kind: 'tx', paymentId, signature, status: 'submitted', ms: 0 })
    watch(signature, submittedAt, (status, ms) => bus.emit({ kind: 'tx', paymentId, signature, status, ms }))
      .catch(err => bus.emit({ kind: 'error', code: 'tx_watch_failed', message: String(err?.message ?? err), settled: false }))
  }
  const payments: Payments = opts.mode === 'devnet' ? await devnetPayments(keys, onSubmit) : await mockPayments(onSubmit)

  const hello = { kind: 'hello', mode: payments.mode, network: payments.network, explorer: 'https://explorer.solana.com/tx/{sig}?cluster=devnet' } as const
  bus.emit(hello)

  const [agent, seller, provider] = await Promise.all([heliaNode(keys.agent.libp2p), heliaNode(keys.seller.libp2p), heliaNode(keys.provider.libp2p)])
  const kubo: Kubo | undefined = opts.kubo === true ? await startKubo() : undefined
  const id = (n: Node): string => n.libp2p.peerId.toString()

  const announce = (n: Node, role: Role, label: string): void => {
    bus.emit({ kind: 'peer', id: id(n), role, label, addrs: n.libp2p.getMultiaddrs().map(String), payee: payeeFromPeerId(n.libp2p.peerId) })
  }
  announce(agent, 'agent', 'Agent')
  announce(seller, 'seller', 'Data seller')
  announce(provider, 'provider', 'Storage provider')
  if (kubo != null) bus.emit({ kind: 'peer', id: kubo.id, role: 'kubo', label: 'Stock Kubo node', addrs: [] })

  // Seller sells a dataset over paid fetch; provider sells pinning.
  const datasetRoot = await addContent(seller, dataset())
  const checkpointRoot = await addContent(agent, checkpoint())
  await seller.libp2p.handle(FETCH_PROTOCOL, fetchHandler(seller, await payments.server(), payments.pricing(payeeFromPeerId(seller.libp2p.peerId)!), { maxBytes: MAX_BYTES }))
  await provider.libp2p.handle(PIN_PROTOCOL, pinHandler(provider, await payments.server(), payments.pricing(payeeFromPeerId(provider.libp2p.peerId)!), { maxBytes: MAX_BYTES, durationDays: 30 }, {
    onBlock: b => bus.emit({ kind: 'block', requestId: currentPayment, cid: b.cid.toString(), index: b.index, total: b.total, ok: b.ok }),
    onPinned: p => bus.emit({ kind: 'pinned', root: p.root.toString(), provider: id(provider), receiptCid: p.receipt.toString(), expiresAt: p.receiptBody.expiresAt, receipt: p.receiptBody })
  }))

  let paymentSeq = 0
  const agentHooks = (to: Node, protocol: string): PayHooks => ({
    onPaymentRequired: (pr, invoice) => {
      const r = pr.accepts[0]
      bus.emit({ kind: 'quote', from: id(to), to: id(agent), protocol, amount: r.amount, asset: r.asset, memo: r.extra?.memo as string | undefined, invoice })
    },
    onPayeeCheck: ({ payTo, remotePeer, ok }) => {
      bus.emit({ kind: 'payee-check', from: id(agent), to: id(to), payTo, remoteKey: payeeFromPeerId(remotePeer) ?? '', ok })
    },
    onPayment: (p) => {
      currentPayment = `pay-${++paymentSeq}`
      const r = p.accepted
      bus.emit({ kind: 'payment', id: currentPayment, from: id(agent), to: id(to), protocol, amount: r.amount, asset: r.asset, network: r.network, memo: r.extra?.memo as string | undefined })
    }
  })
  const connected = (to: Node): void => { bus.emit({ kind: 'connection', from: id(agent), to: id(to), transport: 'tcp', state: 'open' }) }

  const scenes: Record<1 | 2 | 3, () => Promise<void>> = {
    1: async () => {
      connected(seller)
      await fetchPaid(agent.libp2p, seller.libp2p.getMultiaddrs()[0], datasetRoot, payments.client, {
        hooks: agentHooks(seller, FETCH_PROTOCOL),
        onBlock: b => bus.emit({ kind: 'block', requestId: currentPayment, cid: b.cid.toString(), index: b.index, total: b.total, ok: b.ok })
      })
    },
    2: async () => {
      connected(provider)
      const bad = await tamper(await carBytes(agent, checkpointRoot), 13)
      try {
        await pinPaid(agent.libp2p, provider.libp2p.getMultiaddrs()[0], bad, checkpointRoot, payments.client, { hooks: agentHooks(provider, PIN_PROTOCOL) })
        throw new Error('provider accepted a tampered CAR')
      } catch (err) {
        if (!(err instanceof X402Error)) throw err
        bus.emit({ kind: 'error', code: err.code, message: err.message, scene: 2, settled: false })
      }
    },
    3: async () => {
      connected(provider)
      await pinPaid(agent.libp2p, provider.libp2p.getMultiaddrs()[0], await carBytes(agent, checkpointRoot), checkpointRoot, payments.client, { hooks: agentHooks(provider, PIN_PROTOCOL) })
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
      bus.emit({ kind: 'scene', n, state: 'start', title: TITLES[n] })
      try {
        await scenes[n]()
        bus.emit({ kind: 'scene', n, state: 'done', title: TITLES[n] })
      } catch (err: any) {
        bus.emit({ kind: 'error', code: err?.code ?? 'scene_failed', message: String(err?.message ?? err), scene: n, settled: false })
        bus.emit({ kind: 'scene', n, state: 'failed', title: TITLES[n] })
      } finally {
        running = false
      }
    },
    stop: async () => {
      await Promise.all([agent.stop(), seller.stop(), provider.stop(), kubo?.stop()])
    }
  }
}
