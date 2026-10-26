// The browser seller behind js/apps/web /sell. Browser-safe (no Node APIs); the swarm tests run it in Node too.
import { createHelia } from 'helia'
import type { HeliaWithLibp2p } from '@helia/libp2p'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify, identifyPush } from '@libp2p/identify'
import type { PrivateKey } from '@libp2p/interface'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { noise } from '@libp2p/noise'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { yamux } from '@libp2p/yamux'
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { registerExactSvmScheme } from '@x402/svm/exact/server'
import { FETCH_PROTOCOL, fetchHandler, type FetchHooks } from 'ipfs-x402'
import { payeeFromPeerId } from 'x402-libp2p'
import { addContent, dataset, mockSchemeServer, priceFor, type SellConfig } from './shared.ts'

export interface TabSeller {
  helia: HeliaWithLibp2p<any>
  config: SellConfig
  /** This tab's Solana address: its PeerId key. */
  payee: string
  stop: () => Promise<void>
}

/**
 * Reserve a slot on the swarm's relay and sell the demo dataset over paid fetch.
 * The tab holds no fee-payer key: verify and settle go to the swarm's facilitator over loopback HTTP.
 */
export async function startTabSeller (opts: { swarmUrl: string, token: string, privateKey: PrivateKey, onSettled?: FetchHooks['onSettled'] }): Promise<TabSeller> {
  const res = await fetch(`${opts.swarmUrl}/sell/config`)
  if (!res.ok) throw new Error(`swarm answered ${res.status} for /sell/config`)
  const config = await res.json() as SellConfig

  // Prove the control token before reserving: the swarm only buys from tabs that registered.
  const auth = { Authorization: `Bearer ${opts.token}` }
  const reg = await fetch(`${opts.swarmUrl}/sell/register`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ peerId: peerIdFromPrivateKey(opts.privateKey).toString() })
  })
  if (!reg.ok) throw new Error(reg.status === 401 ? 'the swarm rejected the token: check NEXT_PUBLIC_SWARM_TOKEN' : `swarm answered ${reg.status} for /sell/register`)

  const helia = createHelia({
    libp2p: {
      privateKey: opts.privateKey,
      // A relay reservation makes us dialable at <relay>/p2p-circuit; '/webrtc' accepts the direct upgrade.
      addresses: { listen: [`${config.relay}/p2p-circuit`, '/webrtc'] },
      transports: [webSockets(), circuitRelayTransport(), webRTC()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [],
      // Browsers refuse private addresses by default; the relay is on 127.0.0.1.
      connectionGater: { denyDialMultiaddr: () => false },
      services: { identify: identify(), identifyPush: identifyPush() }
    } as any
  })
  await helia.start()
  try {
    const root = await addContent(helia, dataset())
    if (root.toString() !== config.root) throw new Error(`dataset root ${root} differs from the swarm's ${config.root}`)

    const server = new x402ResourceServer(new HTTPFacilitatorClient({
      url: `${opts.swarmUrl}/facilitator`,
      createAuthHeaders: async () => ({ verify: auth, settle: auth, supported: auth })
    }))
    if (config.mode === 'devnet') registerExactSvmScheme(server, { networks: [config.network], rpcUrl: config.rpcUrl })
    else server.register(config.network, mockSchemeServer)
    await server.initialize()

    const payee = payeeFromPeerId(helia.libp2p.peerId)!
    // Registering the protocol pushes it to the relay (identify-push): that is how the swarm learns a tab sells.
    await helia.libp2p.handle(FETCH_PROTOCOL, fetchHandler(helia, server, priceFor(config.scheme, config.network, config.asset)(payee), { maxBytes: 8 * 1024 * 1024 }, { onSettled: opts.onSettled }))
    return { helia, config, payee, stop: async () => { await helia.stop() } }
  } catch (err) {
    await helia.stop()
    throw err
  }
}
