import { createServer, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { Bus } from './bus.ts'
import type { SwarmEventBody } from './events.ts'

export interface Control {
  bus: Bus
  hello: SwarmEventBody & { kind: 'hello' }
  token: string
  busy: () => boolean
  runScene?: (n: 1 | 2 | 3) => Promise<void>
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

function tokenOk (header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer /, '') ?? '')
  const want = Buffer.from(token)
  return given.length === want.length && timingSafeEqual(given, want)
}

/** GET /events (SSE), POST /scenes/:n (token), GET /health. Bind to loopback only. */
export async function serve (c: Control, port: number, host = '127.0.0.1'): Promise<{ server: Server, port: number }> {
  const server = createServer((req, res) => {
    const origin = req.headers.origin
    if (origin != null && LOCAL_ORIGIN.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Headers', 'Authorization')
      res.setHeader('Vary', 'Origin')
    }
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(`data: ${JSON.stringify({ ...c.hello, seq: 0, at: Date.now() })}\n\n`)
      const unsubscribe = c.bus.subscribe(e => { if (e.kind !== 'hello') res.write(`data: ${JSON.stringify(e)}\n\n`) })
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
      req.on('close', () => { clearInterval(ping); unsubscribe() })
      return
    }

    const scene = url.pathname.match(/^\/scenes\/([123])$/)
    if (req.method === 'POST' && scene != null) {
      if (!tokenOk(req.headers.authorization, c.token)) { res.writeHead(401).end('bad token'); return }
      if (c.runScene == null) { res.writeHead(409).end('replay mode has no scenes'); return }
      if (c.busy()) { res.writeHead(409).end('a scene is running'); return }
      void c.runScene(Number(scene[1]) as 1 | 2 | 3)
      res.writeHead(202).end('started')
      return
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ mode: c.hello.mode, busy: c.busy() }))
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>(resolve => server.listen(port, host, resolve))
  const address = server.address()
  return { server, port: typeof address === 'object' && address != null ? address.port : port }
}
