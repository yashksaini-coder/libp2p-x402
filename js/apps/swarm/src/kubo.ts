import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'

const run = promisify(execFile)

export interface Kubo {
  id: string
  connect: (multiaddr: string) => Promise<void>
  /** Fetch the whole DAG under `root` (from connected peers, over Bitswap); returns block count. */
  fetchDag: (root: string) => Promise<{ blocks: number, bytes: number }>
  stop: () => Promise<void>
}

/**
 * A stock Kubo node (the official binary from the `kubo` npm package) on
 * loopback, with no bootstrap peers and no public routing: it can only get
 * blocks from peers we connect it to. That makes the scene-3 claim exact.
 */
export async function startKubo (): Promise<Kubo> {
  const bin: string = createRequire(import.meta.url)('kubo').path()
  const repo = mkdtempSync(join(tmpdir(), 'swarm-kubo-'))
  const env = { ...process.env, IPFS_PATH: repo }
  await run(bin, ['init', '--profile=test', '--empty-repo'], { env })
  const set = async (key: string, json: string): Promise<void> => { await run(bin, ['config', '--json', key, json], { env }) }
  await set('Addresses.API', '"/ip4/127.0.0.1/tcp/0"')
  await set('Addresses.Gateway', '"/ip4/127.0.0.1/tcp/0"')
  await set('Addresses.Swarm', '["/ip4/127.0.0.1/tcp/0"]')
  await set('Bootstrap', '[]')
  await set('Routing.Type', '"none"')

  const daemon: ChildProcess = spawn(bin, ['daemon'], { env, stdio: 'ignore' })
  const apiFile = join(repo, 'api')
  const started = Date.now()
  while (!existsSync(apiFile)) {
    if (Date.now() - started > 30_000) { daemon.kill(); throw new Error('kubo daemon did not start within 30s') }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const [, , host, , port] = readFileSync(apiFile, 'utf8').trim().split('/')
  const api = async (path: string, timeoutMs = 20_000): Promise<any> => {
    const res = await fetch(`http://${host}:${port}/api/v0/${path}`, { method: 'POST', signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`kubo ${path.split('?')[0]}: ${res.status} ${await res.text()}`)
    return await res.json()
  }

  const { ID } = await api('id')
  return {
    id: ID,
    connect: async (multiaddr) => { await api(`swarm/connect?arg=${encodeURIComponent(multiaddr)}`) },
    fetchDag: async (root) => {
      const stat = await api(`dag/stat?arg=${encodeURIComponent(root)}&progress=false`)
      return { blocks: Number(stat.UniqueBlocks ?? stat.NumBlocks ?? 0), bytes: Number(stat.TotalSize ?? stat.Size ?? 0) }
    },
    stop: async () => {
      daemon.kill('SIGINT')
      await new Promise(resolve => daemon.once('exit', resolve))
      rmSync(repo, { recursive: true, force: true })
    }
  }
}
