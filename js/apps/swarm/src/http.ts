import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { FacilitatorClient } from '@x402/core/server'
import { timingSafeEqual } from 'node:crypto'
import type { Bus } from './bus.ts'
import type { Drip, DripCode } from './drip.ts'
import type { SwarmEventBody } from './events.ts'
import type { SellConfig, VisitorConfig } from './shared.ts'

export interface Control {
  bus: Bus
  hello: SwarmEventBody & { kind: 'hello' }
  token: string
  busy: () => boolean
  runScene?: (n: 1 | 2 | 3) => Promise<void>
  sellConfig?: () => SellConfig
  visitorConfig?: () => VisitorConfig
  allowTab?: (peerId: string) => Promise<void>
  facilitator?: FacilitatorClient
  drip?: Drip
}

const DRIP_STATUS: Record<DripCode, number> = { invalid_address: 400, already_dripped: 409, rate_limited: 429, paused: 503, budget_spent: 503, low_sol: 503, send_failed: 502 }

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

const MAX_BODY = 64 * 1024

async function json (req: IncomingMessage): Promise<any> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > MAX_BODY) throw new Error('body too large')
  }
  return JSON.parse(body)
}

function tokenOk (header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer /, '') ?? '')
  const want = Buffer.from(token)
  return given.length === want.length && timingSafeEqual(given, want)
}

/**
 * GET /events (SSE), POST /scenes/:n (token), GET /health. Bind to loopback only.
 * For visitors: GET /visitor/config and POST /visitor/drip { address } (public), POST /visitor/pause { paused } (token). For browser sellers: GET /sell/config, POST /sell/register { peerId } (token), and the standard x402 facilitator API under
 * /facilitator (verify, settle, supported; token) backed by the in-process facilitator.
 */
export async function serve (c: Control, port: number, host = '127.0.0.1'): Promise<{ server: Server, port: number }> {
  const server = createServer((req, res) => {
    const origin = req.headers.origin
    if (origin != null && LOCAL_ORIGIN.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
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

    if (req.method === 'GET' && url.pathname === '/sell/config' && c.sellConfig != null) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(c.sellConfig()))
      return
    }

    if (req.method === 'GET' && url.pathname === '/visitor/config' && c.visitorConfig != null) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(c.visitorConfig()))
      return
    }

    if (req.method === 'POST' && url.pathname === '/visitor/drip' && c.drip != null) {
      const drip = c.drip
      // Behind the tunnel every request comes from loopback; Cloudflare names the visitor.
      const cf = req.headers['cf-connecting-ip']
      const ip = (Array.isArray(cf) ? cf[0] : cf) ?? req.socket.remoteAddress
      const send = (status: number, body: unknown): void => { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)) }
      json(req).then(async body => await drip.request(String(body?.address ?? ''), ip)).then(
        r => {
          if (r.ok) send(200, c.hello.mode === 'mock' ? { signature: null, mock: true } : { signature: r.signature })
          else send(DRIP_STATUS[r.code], { error: r.code, message: r.message })
        },
        () => send(400, { error: 'bad_request', message: 'The request body is not JSON with an address. Send { "address": "..." }.' })
      )
      return
    }

    if (req.method === 'POST' && url.pathname === '/visitor/pause' && c.drip != null) {
      if (!tokenOk(req.headers.authorization, c.token)) { res.writeHead(401).end('bad token'); return }
      const drip = c.drip
      json(req).then(({ paused }) => {
        if (typeof paused !== 'boolean') throw new Error('paused must be true or false')
        drip.pause(paused)
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(drip.status()))
      }).catch(err => res.writeHead(400).end(String(err?.message ?? err)))
      return
    }

    if (req.method === 'POST' && url.pathname === '/sell/register' && c.allowTab != null) {
      if (!tokenOk(req.headers.authorization, c.token)) { res.writeHead(401).end('bad token'); return }
      const allowTab = c.allowTab
      json(req).then(async ({ peerId }) => { await allowTab(String(peerId)) }).then(
        () => res.writeHead(204).end(),
        err => res.writeHead(400).end(String(err?.message ?? err))
      )
      return
    }

    const fac = url.pathname.match(/^\/facilitator\/(verify|settle|supported)$/)
    if (fac != null && c.facilitator != null) {
      // Settling spends the fee payer's SOL: same token as the scene controls.
      if (!tokenOk(req.headers.authorization, c.token)) { res.writeHead(401).end('bad token'); return }
      const f = c.facilitator
      const op = fac[1]
      void (async () => {
        if (op === 'supported') return await f.getSupported()
        if (req.method !== 'POST') throw new Error('POST only')
        const { paymentPayload, paymentRequirements } = await json(req)
        return op === 'verify' ? await f.verify(paymentPayload, paymentRequirements) : await f.settle(paymentPayload, paymentRequirements)
      })().then(
        out => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out)),
        err => res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(err?.message ?? err) }))
      )
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
