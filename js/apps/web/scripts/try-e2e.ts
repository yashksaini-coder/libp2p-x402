// End to end: a real headless Chromium runs /try with the E2E wallet and buys from the visitor seller (mock payments).
//   npm run e2e:try            (CHROME=/path/to/chrome to override, DEBUG=1 for next dev output)
// Runs beside your own `next dev` and swarm: its own ports and its own .next-e2e-try dir.
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '../../swarm/src/http.ts'
import { startSwarm } from '../../swarm/src/swarm.ts'

const CHROME = process.env.CHROME ?? 'chromium'
const freePort = async (): Promise<number> => await new Promise(resolve => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)) })
})
const until = async (what: string, ms: number, ok: () => boolean | Promise<boolean>): Promise<void> => {
  const end = Date.now() + ms
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}

const swarm = await startSwarm({ mode: 'mock', kubo: false })
// The page gets no token (like the public build): /try needs none.
const { server } = await serve({ ...swarm, token: 'e2e-' + Math.random().toString(36).slice(2) }, 0)
const swarmUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const webPort = await freePort()
const web = `http://localhost:${webPort}`
const next = spawn('node_modules/.bin/next', ['dev', '-p', String(webPort)], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, NEXT_DIST_DIR: '.next-e2e-try', NEXT_PUBLIC_E2E_WALLET: '1', NEXT_PUBLIC_SWARM_URL: swarmUrl, NEXT_PUBLIC_SWARM_TOKEN: '' },
  stdio: process.env.DEBUG != null ? 'inherit' : 'ignore',
  detached: true
})
let nextExit: number | null | undefined
next.on('exit', code => { nextExit = code })
let tab: ChildProcess | undefined

try {
  console.log(`swarm ${swarmUrl}, next dev ${web}`)
  await until('next dev to serve /try', 120_000, async () => {
    if (nextExit !== undefined) throw new Error(`next dev exited (${nextExit}); rerun with DEBUG=1 to see why`)
    return await fetch(`${web}/try`).then(r => r.ok, () => false)
  })
  console.log('/try compiled; opening it in headless Chromium')
  tab = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'try-e2e-'))}`, `${web}/try?e2e=1&autobuy=1`], { stdio: 'ignore' })
  const ev = () => swarm.bus.events()
  await until('the visitor to pay and the payment to settle', 90_000, () => ev().some(e => e.kind === 'tx' && e.paymentId === 'visit-1' && e.status === 'submitted'))
  const visitor = ev().find(e => e.kind === 'peer' && e.role === 'visitor')
  assert.ok(visitor, 'the seller saw a visitor')
  const payment = ev().find(e => e.kind === 'payment' && e.id === 'visit-1')
  assert.ok(payment?.kind === 'payment' && visitor.kind === 'peer' && payment.from === visitor.id, 'visit-1 was paid by the visitor')
  console.log(`ok: ${visitor.kind === 'peer' ? visitor.label : ''} paid visit-1, settlement submitted`)
} finally {
  tab?.kill()
  try { process.kill(-next.pid!) } catch {}
  server.close()
  await swarm.stop()
}
process.exit(0)
