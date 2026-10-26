import type { Stream } from '@libp2p/interface'
import type { LengthPrefixedStream } from '@libp2p/utils'
import { car } from '@helia/car'
import { CarReader } from '@ipld/car'
import * as dagCbor from '@ipld/dag-cbor'
import * as dagJson from '@ipld/dag-json'
import * as dagPb from '@ipld/dag-pb'
import { createUnsafe } from 'multiformats/block'
import * as raw from 'multiformats/codecs/raw'
import type { Helia } from 'helia'
import { equals } from 'multiformats/bytes'
import type { CID } from 'multiformats/cid'
import { identity } from 'multiformats/hashes/identity'
import { sha256 } from 'multiformats/hashes/sha2'
import { X402Error } from 'x402-libp2p'

export interface BlockCheck { cid: CID, index: number, total: number, ok: boolean }
export interface Block { cid: CID, bytes: Uint8Array }

/** Largest app frame we send; stays under x402-libp2p's 64 KiB frame cap. */
const CHUNK = 60 * 1024

/**
 * Check a CAR against the root the client asked for: one root, equal to `root`,
 * and every block's bytes hash to its CID. @helia/car import does not verify;
 * this is the check that makes "you pay for verified bytes" true.
 */
export async function verifyCar (bytes: Uint8Array, root: CID, onBlock?: (b: BlockCheck) => void): Promise<{ blocks: Block[], bytes: number }> {
  let reader: CarReader
  try {
    reader = await CarReader.fromBytes(bytes)
  } catch {
    throw new X402Error('resource_invalid', 'not a CAR file')
  }
  const roots = await reader.getRoots()
  if (roots.length !== 1 || !roots[0].equals(root)) throw new X402Error('resource_invalid', `CAR root is not ${root}`)

  const blocks: Block[] = []
  for await (const b of reader.blocks()) blocks.push(b)
  if (!blocks.some(b => b.cid.equals(root))) throw new X402Error('resource_invalid', 'CAR does not contain its root block')

  for (const [index, { cid, bytes: data }] of blocks.entries()) {
    const ok = await hashMatches(cid, data)
    onBlock?.({ cid, index, total: blocks.length, ok })
    if (!ok) throw new X402Error('resource_invalid', `block ${index} (${cid}) does not match its hash`)
  }
  assertComplete(blocks, root)
  return { blocks, bytes: bytes.byteLength }
}

const codecs = new Map<number, { code: number, decode: (b: Uint8Array) => unknown }>(
  [dagPb, raw, dagCbor, dagJson].map(c => [c.code, c])
)

/**
 * The CAR must be exactly the DAG under `root`: every linked block present (so
 * pinning never fetches unpaid data from the network) and no unreachable extras
 * (so the paid byte count is the DAG's).
 */
function assertComplete (blocks: Block[], root: CID): void {
  const byCid = new Map(blocks.map(b => [b.cid.toString(), b]))
  const seen = new Set<string>()
  const queue: CID[] = [root]
  while (queue.length > 0) {
    const cid = queue.pop()!
    const key = cid.toString()
    if (seen.has(key)) continue
    seen.add(key)
    if (cid.multihash.code === identity.code) continue // data is inline in the CID
    const block = byCid.get(key)
    if (block == null) throw new X402Error('resource_invalid', `DAG is incomplete: ${key} is missing`)
    const codec = codecs.get(cid.code)
    if (codec == null) throw new X402Error('resource_invalid', `unsupported codec 0x${cid.code.toString(16)} in ${key}`)
    for (const [, link] of createUnsafe({ bytes: block.bytes, cid, codec: codec as any }).links()) queue.push(link)
  }
  if (seen.size < byCid.size) throw new X402Error('resource_invalid', `${byCid.size - seen.size} blocks are not part of the DAG`)
}

async function hashMatches (cid: CID, data: Uint8Array): Promise<boolean> {
  const code = cid.multihash.code
  if (code === identity.code) return equals(cid.multihash.digest, data)
  if (code !== sha256.code) return false // unsupported hash: treat as unverifiable
  return equals((await sha256.digest(data)).digest, cid.multihash.digest)
}

/**
 * Serialize a locally held DAG as a CAR, refusing past `maxBytes` before
 * buffering more. Never touches the network.
 */
export async function exportCar (helia: Helia, root: CID, maxBytes: number): Promise<Uint8Array> {
  if (!(await helia.blockstore.has(root))) throw new X402Error('resource_not_found', `${root} is not held here`)
  const parts: Uint8Array[] = []
  let total = 0
  for await (const buf of car(helia).export(root, { offline: true, signal: AbortSignal.timeout(10_000) })) {
    total += buf.byteLength
    if (total > maxBytes) throw new X402Error('resource_too_large', `${root} exceeds ${maxBytes} bytes`)
    parts.push(buf)
  }
  return concat(parts)
}

export async function sendCar (lp: LengthPrefixedStream<Stream>, bytes: Uint8Array): Promise<void> {
  for (let i = 0; i < bytes.byteLength; i += CHUNK) await lp.write(bytes.subarray(i, i + CHUNK))
  await lp.write(new Uint8Array(0)) // end marker
}

/** Read CAR chunks until the end marker; refuse to buffer more than `maxBytes`. */
export async function receiveCar (lp: LengthPrefixedStream<Stream>, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let total = 0
  while (true) {
    const chunk = (await lp.read({ signal })).subarray()
    if (chunk.byteLength === 0) return concat(parts)
    total += chunk.byteLength
    if (total > maxBytes) throw new X402Error('resource_too_large', `CAR exceeds ${maxBytes} bytes`)
    parts.push(chunk)
  }
}

function concat (parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.byteLength }
  return out
}
