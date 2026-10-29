import { createHelia } from 'helia'
import type { HeliaWithLibp2p } from '@helia/libp2p'
import { car } from '@helia/car'
import { tcp } from '@libp2p/tcp'
import { noise } from '@libp2p/noise'
import { yamux } from '@libp2p/yamux'
import { identify } from '@libp2p/identify'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import type { PrivateKey } from '@libp2p/interface'
import type { CID } from 'multiformats/cid'
import { localOnlyRouting } from 'ipfs-x402'

export type Node = HeliaWithLibp2p<any>

/** The public ws seller's connection caps. inboundConnectionThreshold is per host per second, and every visitor is 127.0.0.1. */
export const WS_LIMITS = { maxConnections: 200, maxIncomingPendingConnections: 32, inboundConnectionThreshold: 30 }

export { addContent, dataset } from './shared.ts'

/**
 * A Helia node on loopback TCP whose PeerId is `privateKey` (= its Solana wallet). No discovery.
 * `dialsTabs`: can also reach a browser tab: WebSockets to the relay, /p2p-circuit, then a WebRTC upgrade.
 * `wsPort`: also listens on loopback WebSockets (visitors arrive through a tunnel), advertising `announce` too.
 * Every tunnelled visitor comes from loopback, so per host limits act as global ones: no allow list
 * (it would bypass every cap), explicit caps sized for one booth instead.
 */
export async function heliaNode (privateKey: PrivateKey, opts: { dialsTabs?: boolean, wsPort?: number, announce?: string[] } = {}): Promise<Node> {
  const ws = opts.wsPort != null
  const transports = opts.dialsTabs === true ? [tcp(), webSockets(), circuitRelayTransport(), webRTC()] : ws ? [tcp(), webSockets()] : [tcp()]
  const helia = createHelia({
    libp2p: {
      privateKey,
      // appendAnnounce, not announce: announce would replace the loopback addresses the agent dials in scene 1.
      addresses: { listen: ['/ip4/127.0.0.1/tcp/0', ...(ws ? [`/ip4/127.0.0.1/tcp/${opts.wsPort}/ws`] : [])], appendAnnounce: opts.announce ?? [] },
      ...(ws ? { connectionManager: WS_LIMITS } : {}),
      transports,
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [],
      services: { identify: identify(), routing: localOnlyRouting() }
    } as any
  })
  await helia.start()
  return helia
}

export async function carBytes (node: Node, root: CID): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for await (const b of car(node).export(root, { offline: true })) parts.push(b)
  return Buffer.concat(parts)
}

/** Non-repeating pseudo-random bytes (xorshift32, fixed seed): every chunk is a distinct block. */
export function checkpoint (): Uint8Array {
  const out = new Uint8Array(420_000)
  let x = 0x2f6b9a1d
  for (let i = 0; i < out.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; out[i] = x & 0xff }
  return out
}

/** Flip one byte in block `index`'s payload; the CAR still parses but that block no longer matches its hash. */
export async function tamper (bytes: Uint8Array, index: number): Promise<Uint8Array> {
  const { CarIndexer } = await import('@ipld/car')
  let i = 0
  for await (const { blockOffset, blockLength } of await CarIndexer.fromBytes(bytes)) {
    if (i++ !== index) continue
    const out = Uint8Array.from(bytes)
    out[blockOffset + blockLength - 1] ^= 0xff // exact position from the CAR index, not a byte search
    return out
  }
  throw new Error(`CAR has no block ${index}`)
}
