# Demo engine and dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working engine (paid IPFS fetch/pin over libp2p, settled on Solana devnet) that streams live events to a Next.js landing page and stage dashboard, all running on one laptop.

**Architecture:**
- **Packages:**
  - `x402-libp2p` is the generic payment gate. It gains two features: the quote→invoice step and manual settlement.
  - `ipfs-x402` adds paid fetch and pin on Helia, with per-block verification and receipts.
- **Swarm** (`js/apps/swarm`) is a long-running Node process.
  - It runs the agent, seller and provider nodes, a self-hosted `@x402/svm` facilitator, and a Kubo node for scene 3.
  - It serves events over SSE and takes scene triggers on a localhost control endpoint.
- **Web app** (`js/apps/web`) renders the event stream. It holds no keys.

**Tech Stack:**
- **Runtime:** Node 26, run as native TypeScript with no build step for the packages or the swarm. npm workspaces.
- **Networking:** libp2p 3.5, `@libp2p/noise` 17, `@libp2p/yamux` 8, `@libp2p/tcp` 11.
- **IPFS:** helia 7.1, @ipld/car 5.4, @ipld/dag-json 11, kubo 0.43 (npm binary).
- **Payments:** @x402/core and @x402/svm 2.28, @solana/kit 8.5.
- **Web:** Next.js 16.4 (App Router), Tailwind 4.3, motion 14, @phosphor-icons/react 2, geist 1.8.

**Spec:** [`docs/superpowers/specs/2026-10-26-demo-app-design.md`](../specs/2026-10-26-demo-app-design.md). The normative wire format is [`spec/libp2p.md`](../../../spec/libp2p.md).

## Global Constraints

- **Network:** everything runs on one laptop; only payments touch Solana devnet (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`).
- **USDC:** devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- **Keys:**
  - Keys live in `js/apps/swarm/.keys/*.json` (gitignored). Never print, log or emit a secret key; events carry public addresses only.
  - Provider and seller PeerIds are derived from their Solana Ed25519 keys (identity = wallet). The agent checks payTo == remote PeerId key before signing.
- **Memo:** `extra.memo = <root as CIDv0>` (46 bytes; see the demo design, Memo) on every invoice.
- **Settlement order:**
  - Fetch: verify → settle → deliver.
  - Pin: verify payment → receive CAR → verify every block → settle → pin. A tampered pin produces **no** settlement transaction.
- **Pin pricing:** pin is priced `exact` on the declared size. A CAR larger than the declaration is rejected with `resource_too_large`.
- **Labelling:** the dashboard never shows replayed or mock data as live; mode and replay are always labelled on screen.
- **Web design rules** (landing-page-design):
  - Type: Geist only, plus Geist Mono for data. No italics, no weight 900. Tailwind type and spacing scales only.
  - Colour: no background gradients. Surfaces are `#000` / `#181818` / `#1F1F1F` / `#272727`, with hairline borders at white 8%. Status colours: `#14F195` = finalized/verified only, `#9B9B9B` processing, white confirmed, `#FF4757` rejected.
  - Icons: Phosphor.
  - Copy: no hyphens in copy, sentence case, `text-wrap: balance` on headings.
  - Motion: custom cubic-bezier easing, and `prefers-reduced-motion` honoured.
- **Projector minimums on `/live`:** 20px text, 30px live numbers.

## Review Focus

1. **The peer closes the stream mid-CAR** (pin or fetch). Expected: no settlement, an `error` event, and the swarm keeps running. Test in Task 3 (`pin aborted mid-CAR settles nothing`).
2. **The dashboard opens before the swarm is up, or the swarm restarts.** Expected: "engine offline" state, auto-reconnect, and the backlog replays on reconnect. Test in Task 4 (`late subscriber receives backlog`) and Task 6 (offline state rendered).
3. **A scene is triggered while one is already running.** Expected: 409, no overlapping payments. Test in Task 4 (`second scene trigger returns 409`).
4. **Keys are missing in devnet mode.** Expected: the swarm exits with a message naming the missing files and the `keys` command, never a stack trace. Test in Task 4 (`devnet without keys fails with guidance`).
5. **The invoice's payTo differs from the rate card's payTo.** Expected: the payee check runs again on the invoice and refuses. Test in Task 1 (`invoice with foreign payTo is refused`).

---

### Task 1: x402-libp2p: quote→invoice and manual settlement, workspace

**Files:**
- Create: `js/package.json` (workspaces `packages/*`, `apps/*`)
- Modify: `js/packages/x402-libp2p/{package.json,src/frames.ts,src/server.ts,src/client.ts,src/index.ts}`; move deps to `@libp2p/noise` / `@libp2p/yamux`
- Modify: `spec/libp2p.md`: add the `x402/request` frame and the "a later `x402/payment-required` supersedes earlier ones" rule
- Test: `js/packages/x402-libp2p/test/x402-libp2p.test.ts`

**Interfaces:**
- Produces:
  - New frame `{ type: 'x402/request', request: Record<string, unknown> }` (client → server, before payment).
  - `paid(server, opts: PaidOptions, handler)` where `PaidOptions` adds:
    - `settle?: 'before' | 'manual'` (default `'before'`)
    - `invoice?: (request: Record<string, unknown>, peer: PeerId) => Promise<PaymentRequirements[]>`. If it throws an `X402Error`, that error is sent as the reply.
  - `PaidContext` adds:
    - `request?: Record<string, unknown>`
    - `settle(): Promise<SettleResponse>`. In manual mode it settles and writes `x402/settlement`. On failure it writes `x402/error`, closes the stream and throws `X402Error`. In `'before'` mode it returns the existing settlement.
    - `fail(code: string, message?: string): Promise<void>`
  - `payAndOpen(node, peer, protocol, client, opts?: { request?: Record<string, unknown>, signal?: AbortSignal })`. It returns the settled `PaidStream` in `'before'` mode. In manual mode, the settlement frame arrives later, so the caller uses `awaitSettlement(lp, signal?)`.
  - `PaidStream` adds `paymentRequired` (the invoice, when one was used).
  - `awaitSettlement(lp, signal?): Promise<SettleResponse>`. It throws `X402Error` on an `x402/error` frame.

- [ ] Step 1: Tests (keep the 4 existing ones):
  - `request frame yields an invoice that is paid instead of the rate card`: the invoice amount `'2500'` ≠ the rate card `'1000'`; assert `settlement` and that the server saw `ctx.request.root`.
  - `invoice with foreign payTo is refused`: zero payments created.
  - `manual settle: handler fails before settle and no settlement happens`: the facilitator `settle` spy count is 0; the client gets `X402Error` with the handler's code.
  - `manual settle: handler settles then replies`.
- [ ] Step 2: Run `npm test -w x402-libp2p`. Expected: the 4 new tests FAIL.
- [ ] Step 3: Implement. Run `selectPayable` on the invoice as well as on the rate card.
- [ ] Step 4: Run `npm test -w x402-libp2p && npm run typecheck -w x402-libp2p`. Expected: 8/8 pass, typecheck clean.
- [ ] Step 5: Commit `feat(x402-libp2p): invoice frame and manual settlement`.

### Task 2: ipfs-x402: CAR verification and paid fetch

**Files:**
- Create: `js/packages/ipfs-x402/{package.json,tsconfig.json,src/car.ts,src/fetch.ts,src/index.ts}`
- Test: `js/packages/ipfs-x402/test/car.test.ts`, `test/fetch.test.ts`

**Interfaces:**
- Consumes: Task 1 `paid`, `payAndOpen`, `X402Error`.
- Produces:
  - `FETCH_PROTOCOL = '/ipfs-x402/fetch/1.0.0'`, `PIN_PROTOCOL = '/ipfs-x402/pin/1.0.0'`.
  - `verifyCar(car: Uint8Array, root: CID, onBlock?: (b: { cid: CID, index: number, total: number, ok: boolean }) => void): Promise<{ blocks: Array<{ cid: CID, bytes: Uint8Array }>, bytes: number }>`.
    - Throws `X402Error('resource_invalid')` on the first block whose sha2-256 digest ≠ the CID multihash, or a CAR root ≠ `root`.
    - Calls `onBlock` with `ok: false` before throwing.
  - `exportCar(helia: Helia, root: CID): Promise<Uint8Array>`.
  - `sendCar(lp, car)` / `receiveCar(lp, maxBytes): Promise<Uint8Array>`: chunks of ≤ 60 KiB, terminated by an empty frame.
  - `Pricing = { network: Network, asset: string, payTo: string, perMiB: bigint, minAmount: bigint, maxTimeoutSeconds: number, extra?: Record<string, unknown> }`.
  - `price(pricing, bytes): PaymentRequirements`. The amount is `max(minAmount, ceil(bytes × perMiB / 2^20))`. `extra.memo` is set by the caller.
  - `fetchHandler(helia, server: x402ResourceServer, pricing, hooks?: { onBlock?, onPaid? }): StreamHandler`, with `settle: 'before'`. The invoice is built from `{ root }` with `extra.memo = memoFor(root)` (CIDv0).
  - `fetchPaid(node, peer, root: CID, client: x402Client, onBlock?): Promise<{ blocks, bytes, settlement, paymentRequired }>`.
- [ ] Step 1: Tests:
  - `verifyCar accepts an untouched CAR and reports every block ok`
  - `verifyCar rejects a CAR with one flipped byte at that block index`
  - `fetchPaid returns blocks whose bytes equal the source file`: two Helia nodes over TCP, mock scheme.
  - `fetch invoice carries the root CIDv0 memo`
- [ ] Step 2: Run `npm test -w ipfs-x402`. Expected: FAIL.
- [ ] Step 3: Implement. Use the `@ipld/car` `CarReader.fromBytes` / `CarWriter`, and `multiformats/hashes/sha2`.
- [ ] Step 4: Run `npm test -w ipfs-x402`. Expected: PASS.
- [ ] Step 5: Commit `feat(ipfs-x402): verified CAR transfer and paid fetch`.

### Task 3: ipfs-x402: paid pin with receipts

**Files:**
- Create: `js/packages/ipfs-x402/src/pin.ts`, `src/receipt.ts`
- Test: `js/packages/ipfs-x402/test/pin.test.ts`

**Interfaces:**
- Produces:
  - `Receipt = { cid: string, payer: string, payee: string, network: string, tx: string, bytes: number, expiresAt: string }`, stored as dag-json; `putReceipt(helia, r): Promise<CID>`.
  - `pinHandler(helia, server, pricing, opts: { maxBytes: number, durationDays: number }, hooks?: { onBlock?, onPinned?(p: { root: CID, receipt: CID, receiptBody: Receipt }) }): StreamHandler`.
    - Uses `settle: 'manual'`. The invoice is built from `{ root, bytes }`; if `bytes > maxBytes` it rejects with `resource_too_large`.
    - Flow: receiveCar(declared bytes) → verifyCar → `ctx.settle()` → blockstore put + `helia.pins.add(root)` → putReceipt → reply `{ pinned, receipt, expiresAt }`.
  - `pinPaid(node, peer, car, root, client): Promise<{ pinned: string, receipt: string, expiresAt: string, settlement }>`.
- [ ] Step 1: Tests:
  - `pin happy path stores blocks, pins root, returns receipt whose tx equals settlement.transaction`
  - `pin with tampered CAR returns resource_invalid and facilitator settle is never called`
  - `pin larger than declared bytes returns resource_too_large, no settle`
  - `pin aborted mid-CAR settles nothing and provider keeps serving`: a second pin afterwards succeeds.
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run `npm test -w ipfs-x402`. Expected: all PASS.
- [ ] Step 5: Commit `feat(ipfs-x402): paid pin with receipts`.

### Task 4: swarm: events, nodes, scenes, devnet payments

**Files:**
- Create in `js/apps/swarm/`:
  - `package.json`, `.gitignore` (`.keys/`, `recordings/`)
  - `src/events.ts`: the event union from the spec, plus `seq` and `at`
  - `src/bus.ts`
  - `src/http.ts`: SSE + control
  - `src/keys.ts`
  - `src/payments.ts`: mock | devnet scheme wiring and the facilitator
  - `src/txwatch.ts`
  - `src/nodes.ts`
  - `src/scenes.ts`
  - `src/kubo.ts`
  - `src/main.ts`
- Test: `js/apps/swarm/test/swarm.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: the event contract for Tasks 5–6.
  - `SwarmEvent` exported from `src/events.ts`. Kinds: `peer`, `connection`, `quote`, `payee-check`, `payment`, `tx`, `block`, `pinned`, `provided`, `error`, plus `scene` `{ n: 1|2|3, state: 'start'|'done'|'failed' }` and `hello` `{ mode: 'mock'|'devnet'|'local'|'replay', explorer: string }`. Field shapes are as in the spec.
  - `GET /events`: SSE, `data: <SwarmEvent JSON>`. On connect it sends `hello` and then the backlog (last 500 events).
  - `POST /scenes/:n`: requires `Authorization: Bearer $SWARM_TOKEN`. Returns 202 when started, 409 when a scene is running, 401 on a bad token.
  - CORS allows `http://localhost:3000`. The server binds `127.0.0.1:4402`.
  - CLI:
    - `node src/main.ts keys`: creates `.keys/{agent,seller,provider,feepayer}.json` when absent (Solana 64-byte array format) and prints **public** addresses and faucet steps.
    - `node src/main.ts --mode mock|devnet [--record file] [--replay file]`.
- Implementation notes the spec pins:
  - The libp2p private key comes from the same 64-byte Solana secret (`privateKeyFromRaw`).
  - Devnet uses `ExactSvmScheme` (client) with the agent key and `registerExactSvmScheme(server, { rpcUrl })`. The facilitator is an in-process `x402Facilitator` with exact-SVM and the fee-payer signer, wrapped as a `FacilitatorClient`.
  - Wrap the facilitator signer's send so the tx signature is emitted as `tx submitted` and `txwatch` subscribes (Kit `signatureNotifications` at processed/confirmed/finalized). `ms` is measured from submit.
  - Kubo: the `kubo` npm binary, a temp repo, swarm listening on 127.0.0.1. Scene 3 connects Kubo to the provider and runs `ipfs dag get`/`block get` on the root, emitting `provided { via: 'kubo-bitswap' }`.
- [ ] Step 1: Tests (mock mode, in-process):
  - `scene 1 emits quote, payee-check ok, payment, tx finalized, blocks all ok, in order`
  - `scene 2 emits a block ok:false and an error resource_invalid and no tx event`
  - `late subscriber receives backlog`
  - `second scene trigger returns 409`
  - `devnet without keys fails with guidance`
- [ ] Step 2: Run `npm test -w swarm`. Expected: FAIL.
- [ ] Step 3: Implement. Mock mode emits `tx` from the mock facilitator with measured ms.
- [ ] Step 4: Run `npm test -w swarm`. Expected: PASS. Then `node src/main.ts --mode mock` and `curl -N localhost:4402/events` print `hello`.
- [ ] Step 5: Commit `feat(swarm): demo engine with scenes and event stream`.
- [ ] Step 6 (needs funded keys, user approves before the first devnet tx): run scene 1 in devnet mode and confirm the signature on the explorer shows the root CID memo. Record it to `recordings/scene1.jsonl`.

### Task 5: web: app shell and landing page

**Files:**
- Create: `js/apps/web/` (Next.js 16 App Router, TS, Tailwind 4)
  - Layout and fonts: `app/layout.tsx`, `app/globals.css`
  - Pages: `app/page.tsx`, `app/not-found.tsx`
  - Components: `components/landing/*`, `components/ui/*`
  - Fixtures: `lib/events-fixture.ts`, a realistic recorded-shape sequence for the bento visuals
- Test: `npm run build` plus a Playwright-free smoke check (`next build` succeeds; `curl localhost:3000` contains the headline)

**Interfaces:**
- Consumes: the `SwarmEvent` type via a tsconfig path alias `@swarm/events` → `../swarm/src/events.ts` (type-only import).
- Produces: `components/ui` primitives (Panel, Eyebrow, Mono, Button, GlassPill) that Task 6 reuses.
- Content (from the spec):
  - Hero copy is fixed:
    - **Headline:** "Agents that get paid / without running a server"
    - **Subheadline:** "x402 payments over libp2p. One Ed25519 key is the peer and the wallet, so every USDC transfer on Solana goes to the peer that served the bytes."
    - **CTA:** "Watch it live" → `/live`
    - **Proof line:** "Settled on Solana devnet · open spec for x402 v2"
  - Sections, in order: hero (dashboard mockup) · problem/solution with "HTTP x402 vs libp2p x402" columns · bento ×4 (PeerId = wallet, CID in memo, verified bytes, works behind NAT), each with a story loop · tagline reveal (word by word) · how it works ×3 · spec + open source · FAQ ×8 · final CTA + footer.
- [ ] Step 1: Scaffold, then `npm run build`. Expected: success.
- [ ] Step 2: Build the sections in the order hero → bento → tagline → how → proof → FAQ → CTA, checking each in the browser pane.
- [ ] Step 3: Check against the landing-page-design checklist: one font, scale-only sizes, no hyphens, reduced motion, focus rings, 404, meta + og tags.
- [ ] Step 4: Commit `feat(web): landing page`.

### Task 6: web: `/live` stage dashboard

**Files:**
- Create in `js/apps/web/`:
  - `app/live/page.tsx`
  - `components/live/{TopPill,PeerGraph,TxFeed,BlockGrid,ReceiptCard,SceneControls,OfflineState}.tsx`
  - `lib/useSwarm.ts`: an EventSource hook reducing `SwarmEvent` → state, with reconnect
  - `lib/reduce.ts`
- Test: `js/apps/web/lib/reduce.test.ts` (node --test)

**Interfaces:**
- Consumes: Task 4's SSE contract and Task 5's primitives.
- Produces:
  - `reduce(state: LiveState, e: SwarmEvent): LiveState`, a pure function.
  - `LiveState = { mode, connected, peers, edges, payments: Payment[] (newest first, max 20), blocks: BlockCell[] (current request), receipt?: Receipt, counters: { peers, usdc, p50FinalizeMs, blocksVerified }, scene? }`.
- Layout (1920×1080, 12 columns, 32px margins, 24px gutters):
  - Top: glass pill with the counters.
  - Middle: PeerGraph (columns 1–8, fixed positions per role, edge pulse on `payment`) | TxFeed (columns 9–12; three-stage timer per payment, explorer link `https://explorer.solana.com/tx/<sig>?cluster=devnet`).
  - Bottom band: BlockGrid (columns 1–8, grey → green, red + one shake on `ok:false`, "No settlement transaction" note) | ReceiptCard (columns 9–12).
  - Controls: scene buttons and keys `1` `2` `3`, which POST with the token from `NEXT_PUBLIC_SWARM_TOKEN`. They are visible only when the page is served from localhost.
  - A `mode` badge is always visible, reading LIVE DEVNET / MOCK / REPLAY.
- [ ] Step 1: Tests: `reduce` folds the recorded scene 1 sequence into one payment with stages [processed, confirmed, finalized], ms ascending, and `counters.blocksVerified === total`; scene 2 leaves the payment list unchanged and marks one red cell.
- [ ] Step 2: Run `node --test lib/reduce.test.ts`. Expected: FAIL, then implement, then PASS.
- [ ] Step 3: Build the components. Verify against the swarm in mock mode (`npm run dev` in both); all three scenes render; killing the swarm shows OfflineState and recovers on restart.
- [ ] Step 4: Commit `feat(web): live stage dashboard`.

### Task 7 (Should): `/sell` browser seller via local relay

Deferred until Tasks 1–6 pass. The relay runs inside the swarm (circuit-relay-v2 server + WebSockets on 127.0.0.1). `/sell` creates a Helia node in the tab with a key generated in browser storage, reserves a slot, and serves the fetch protocol. Scene 1 targets it when it is connected, and falls back to the swarm's Node seller otherwise.
