// End to end: a real headless Chromium runs /sell, and scene 1 buys from it over circuit, then WebRTC.
//   npm run e2e:sell            (CHROME=/path/to/chrome to override, DEBUG=1 for next dev output)
// Runs beside your own `next dev` and swarm: its own ports and its own .next-e2e dir.
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '../../swarm/src/http.ts'
import { startSwarm } from '../../swarm/src/swarm.ts'

const CHROME = process.env.CHROME ?? 'chromium'
const token = 'e2e-' + Math.random().toString(36).slice(2)
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
const chrome = (args: string[]): ChildProcess => spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sell-e2e-'))}`, ...args], { stdio: 'ignore' })

const swarm = await startSwarm({ mode: 'mock', kubo: false })
const { server } = await serve({ ...swarm, token }, 0)
const swarmUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const webPort = await freePort()
const web = `http://localhost:${webPort}`
const next = spawn('node_modules/.bin/next', ['dev', '-p', String(webPort)], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, NEXT_DIST_DIR: '.next-e2e', NEXT_PUBLIC_SWARM_URL: swarmUrl, NEXT_PUBLIC_SWARM_TOKEN: token },
  stdio: process.env.DEBUG != null ? 'inherit' : 'ignore',
  detached: true
})
let nextExit: number | null | undefined
next.on('exit', code => { nextExit = code })
const procs: ChildProcess[] = []

try {
  console.log(`swarm ${swarmUrl}, next dev ${web}`)
  await until('next dev to serve /sell', 120_000, async () => {
    if (nextExit !== undefined) throw new Error(`next dev exited (${nextExit}); rerun with DEBUG=1 to see why`)
    return await fetch(`${web}/sell`).then(r => r.ok, () => false)
  })
  console.log('/sell compiled; opening it in headless Chromium')
  procs.push(chrome([`${web}/sell`]))
  await until('the tab to reserve a relay slot', 90_000, () => swarm.bus.events().some(e => e.kind === 'peer' && e.label === 'Browser tab'))
  const tab = swarm.bus.events().find(e => e.kind === 'peer' && e.label === 'Browser tab')!
  const tabId = tab.kind === 'peer' ? tab.id : ''
  console.log(`tab ${tabId} holds a slot on the relay`)

  await swarm.runScene(1)
  const ev = swarm.bus.events()
  const failed = ev.filter(e => e.kind === 'error')
  assert.ok(ev.some(e => e.kind === 'scene' && e.n === 1 && e.state === 'done' && /browser tab/.test(e.title)), `scene 1 did not finish against the tab: ${JSON.stringify(failed)}`)
  const opened = ev.filter(e => e.kind === 'connection' && e.to === tabId && e.state === 'open')
  assert.deepEqual(opened.map(e => e.kind === 'connection' && e.transport), ['circuit', 'webrtc'])
  assert.ok(ev.some(e => e.kind === 'payee-check' && e.ok && e.to === tabId && tab.kind === 'peer' && e.payTo === tab.payee), 'paid the tab key')
  const blocks = ev.filter(e => e.kind === 'block')
  assert.ok(blocks.length > 10 && blocks.every(b => b.kind === 'block' && b.ok), 'every block verified')
  console.log(`ok: circuit +${opened[0].at - ev.find(e => e.kind === 'scene')!.at} ms, webrtc +${opened[1].at - opened[0].at} ms, ${blocks.length} blocks verified, paid ${tab.kind === 'peer' ? tab.payee : ''}`)

} finally {
  for (const p of procs) p.kill()
  try { process.kill(-next.pid!) } catch {}
  server.close()
  await swarm.stop()
}
process.exit(0)
