import { createHelia } from 'helia'
import type { HeliaWithLibp2p } from '@helia/libp2p'
import { unixfs } from '@helia/unixfs'
import { car } from '@helia/car'
import { tcp } from '@libp2p/tcp'
import { noise } from '@libp2p/noise'
import { yamux } from '@libp2p/yamux'
import { identify } from '@libp2p/identify'
import type { PrivateKey } from '@libp2p/interface'
import { fixedSize } from 'ipfs-unixfs-importer/chunker'
import type { CID } from 'multiformats/cid'

export type Node = HeliaWithLibp2p<any>

/** A Helia node on loopback TCP whose PeerId is `privateKey` (= its Solana wallet). No discovery. */
export async function heliaNode (privateKey: PrivateKey): Promise<Node> {
  const helia = createHelia({
    libp2p: {
      privateKey,
      addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
      transports: [tcp()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [],
      services: { identify: identify() }
    } as any
  })
  await helia.start()
  return helia
}

/** Add bytes as a UnixFS file in small chunks, so the CAR has enough blocks to watch verify. */
export async function addContent (node: Node, data: Uint8Array): Promise<CID> {
  return await unixfs(node).addBytes(data, { chunker: fixedSize({ chunkSize: 16_384 }) })
}

export async function carBytes (node: Node, root: CID): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for await (const b of car(node).export(root, { offline: true })) parts.push(b)
  return Buffer.concat(parts)
}

/** Demo payloads: readable, deterministic, a few hundred KB. */
export function dataset (): Uint8Array {
  const lines = Array.from({ length: 4200 }, (_, i) =>
    JSON.stringify({ i, city: ['Mumbai', 'Pune', 'Bengaluru', 'Delhi', 'Chennai'][i % 5], aqi: 40 + ((i * 37) % 260), at: 1793000000 + i * 600 }))
  return new TextEncoder().encode(lines.join('\n'))
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
