import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateKeyPair, privateKeyFromRaw } from '@libp2p/crypto/keys'
import type { Ed25519PrivateKey } from '@libp2p/interface'
import { base58btc } from 'multiformats/bases/base58'

export const ROLES = ['agent', 'seller', 'provider', 'feepayer'] as const
export type KeyRole = typeof ROLES[number]

/**
 * One Ed25519 key per role, stored in Solana's keypair format (JSON array of
 * the 64-byte secret+public). The same bytes are the libp2p identity and the
 * Solana wallet: that is the whole point.
 */
export interface RoleKey { role: KeyRole, secret: Uint8Array, address: string, libp2p: Ed25519PrivateKey }

export async function loadKeys (dir: string): Promise<Record<KeyRole, RoleKey>> {
  const missing = ROLES.filter(r => !existsSync(join(dir, `${r}.json`)))
  if (missing.length > 0) {
    throw new Error(`missing key files in ${dir}: ${missing.map(r => `${r}.json`).join(', ')}. Run: node src/main.ts keys`)
  }
  const out = {} as Record<KeyRole, RoleKey>
  for (const role of ROLES) {
    const secret = Uint8Array.from(JSON.parse(readFileSync(join(dir, `${role}.json`), 'utf8')) as number[])
    if (secret.length !== 64) throw new Error(`${role}.json is not a 64-byte Solana keypair`)
    out[role] = { role, secret, address: base58btc.baseEncode(secret.subarray(32)), libp2p: privateKeyFromRaw(secret) as Ed25519PrivateKey }
  }
  return out
}

/** Create any missing key files (mode 0600). Returns public addresses only. */
export async function ensureKeys (dir: string): Promise<Array<{ role: KeyRole, address: string, created: boolean }>> {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const result = []
  for (const role of ROLES) {
    const file = join(dir, `${role}.json`)
    const created = !existsSync(file)
    if (created) {
      const key = await generateKeyPair('Ed25519')
      writeFileSync(file, JSON.stringify(Array.from(key.raw)), { mode: 0o600 })
    }
    const secret = Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')) as number[])
    result.push({ role, address: base58btc.baseEncode(secret.subarray(32)), created })
  }
  return result
}

/** Ephemeral keys for mock mode and tests. */
export async function ephemeralKeys (): Promise<Record<KeyRole, RoleKey>> {
  const out = {} as Record<KeyRole, RoleKey>
  for (const role of ROLES) {
    const key = await generateKeyPair('Ed25519')
    out[role] = { role, secret: key.raw, address: base58btc.baseEncode(key.publicKey.raw), libp2p: key }
  }
  return out
}
