import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { Bus } from './bus.ts'
import type { SwarmEvent } from './events.ts'
import { serve } from './http.ts'
import { ensureKeys } from './keys.ts'
import { startSwarm } from './swarm.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: 'string', default: 'mock' },
    port: { type: 'string', default: '4402' },
    'relay-port': { type: 'string', default: '4403' },
    'seller-ws-port': { type: 'string', default: '4404' },
    keys: { type: 'string', default: '.keys' },
    record: { type: 'string' },
    replay: { type: 'string' },
    'no-kubo': { type: 'boolean', default: false }
  }
})

if (positionals[0] === 'keys') {
  const keys = await ensureKeys(values.keys!)
  console.log(`Keys in ${values.keys}/ (secret files, never share or commit them). Public addresses:\n`)
  for (const k of keys) console.log(`  ${k.role.padEnd(9)} ${k.address}${k.created ? '  (new)' : ''}`)
  const at = Object.fromEntries(keys.map(k => [k.role, k.address]))
  console.log(`
Fund them on Solana devnet:
  1. SOL for the fee payer (it pays every transaction fee):
     https://faucet.solana.com  ->  ${at.feepayer}
  2. USDC for the agent (it pays for data and pinning; it needs no SOL):
     https://faucet.circle.com  ->  Solana Devnet  ->  ${at.agent}   (20 USDC, once per 2 hours)
  3. A USDC account for each seller so they can be paid: request USDC once for each:
     ${at.seller}
     ${at.provider}
Then: node src/main.ts --mode devnet`)
  process.exit(0)
}

const token = process.env.SWARM_TOKEN ?? randomBytes(12).toString('hex')
const port = Number(values.port)

if (values.replay != null) {
  // Replay a recording on a loop, with its original timing. Labelled REPLAY on screen, never "live".
  const recorded = readFileSync(values.replay, 'utf8').trim().split('\n').map(l => JSON.parse(l) as SwarmEvent).filter(e => e.kind !== 'hello')
  const bus = new Bus()
  const hello = { kind: 'hello', mode: 'replay', network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', explorer: 'https://explorer.solana.com/tx/{sig}?cluster=devnet' } as const
  await serve({ bus, hello, token, busy: () => true }, port)
  console.log(`replaying ${recorded.length} events from ${values.replay} on http://127.0.0.1:${port}/events`)
  while (true) {
    for (let i = 0; i < recorded.length; i++) {
      const { seq: _s, at: _a, ...body } = recorded[i]
      bus.emit(body)
      const gap = i + 1 < recorded.length ? recorded[i + 1].at - recorded[i].at : 4000
      await new Promise(resolve => setTimeout(resolve, Math.min(gap, 6000)))
    }
  }
}

const mode = values.mode as 'mock' | 'devnet'
if (mode !== 'mock' && mode !== 'devnet') { console.error('--mode must be mock or devnet'); process.exit(2) }

let swarm
try {
  swarm = await startSwarm({ mode, keysDir: values.keys, kubo: !values['no-kubo'], recordTo: values.record, relayPort: Number(values['relay-port']), sellerWsPort: Number(values['seller-ws-port']), sellerPublicAddr: process.env.SELLER_HOST != null ? `/dns4/${process.env.SELLER_HOST}/tcp/443/tls/ws` : undefined })
} catch (err: any) {
  console.error(`swarm failed to start: ${err?.message ?? err}`)
  process.exit(1)
}
await serve({ ...swarm, token }, port)
console.log(`swarm (${mode}) on http://127.0.0.1:${port}/events`)
console.log(`control token: ${token}   (set NEXT_PUBLIC_SWARM_TOKEN to this in js/apps/web/.env.local, or export SWARM_TOKEN first)`)

const shutdown = async (): Promise<void> => { await swarm.stop(); process.exit(0) }
process.on('SIGINT', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
