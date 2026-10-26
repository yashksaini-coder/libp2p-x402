import * as dagJson from '@ipld/dag-json'
import type { Helia } from 'helia'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'

/** Proof of a paid pin. Anyone can check `tx` on-chain: its memo names `cid`. */
export interface Receipt {
  cid: string
  payer: string
  payee: string
  network: string
  tx: string
  bytes: number
  expiresAt: string
}

export async function putReceipt (helia: Helia, receipt: Receipt): Promise<CID> {
  const bytes = dagJson.encode(receipt)
  const cid = CID.createV1(dagJson.code, await sha256.digest(bytes))
  await helia.blockstore.put(cid, bytes)
  for await (const _ of helia.pins.add(cid, { signal: AbortSignal.timeout(5_000) })) { /* drain */ }
  return cid
}

export async function getReceipt (helia: Helia, cid: CID): Promise<Receipt> {
  const chunks: Uint8Array[] = []
  for await (const c of helia.blockstore.get(cid, { offline: true } as any)) chunks.push(c)
  return dagJson.decode(Buffer.concat(chunks))
}
