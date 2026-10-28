# Visitor Dashboard (/try) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public `/try` page where a booth visitor connects their own Solana wallet, gets a devnet USDC drip, and buys the demo dataset from the Node seller over libp2p, watching every real step, with their purchase also shown on `/live`.

**Architecture:** The swarm (Node, `js/apps/swarm`) gains a WebSockets listener on the seller, public `/visitor/*` endpoints (config, drip), seller-side payment hooks with per-payment attribution, and tunnel-aware security. A browser-safe buyer module (`apps/swarm/src/buyer.ts`, like `tab.ts`) runs a Helia node in the visitor's tab and pays with an x402 `exact` client signed by the visitor's wallet. The Next.js app (`js/apps/web`) adds `/try` (wallet layer, a flow reducer, step cards, a sequence visual) and a token-free public build.

**Tech Stack:** Node 26 (runs `.ts` directly), js-libp2p 3 / Helia 7, `@x402/core` + `@x402/svm` 2.28.0, `@solana/kit` 8.5.0 (swarm, web), `@solana-program/token` 0.9.0, `@solana/react` 8.5.0 + `@wallet-standard/react` (web), Next.js 16.4.3, React 19.3, Tailwind 4, `motion`, Phosphor icons, Geist.

**Spec:** `docs/superpowers/specs/2026-10-28-visitor-dashboard-design.md`

## Global Constraints

- Branch: `feat/try-visitor-dashboard`. Commits carry no `Co-Authored-By` trailer (user rule).
- Devnet only. x402 network id `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`; wallet chain id `solana:devnet`. USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals.
- Version trap: `@x402/svm` must keep resolving `@solana/keys` < 8.5.0 (today 5.5.1 via kit 5.5.1). Web wallet packages install in `js/apps/web` only; run `npm ls @solana/keys` from `js/` after any install.
- Memo is the root as CIDv0 (`memoFor`); never longer than 46 bytes (x402 exact caps compute at 20,000 CU).
- Visitor seller payment wait: `paymentTimeoutMs: 120_000`.
- Drip: 10,000 atomic USDC (0.01) per address, once ever; 3 per IP per hour (`CF-Connecting-IP`); 60 per hour global; 500 total; refuse when fee payer < 0.1 SOL (100,000,000 lamports); presenter pause switch.
- Token endpoints (`POST /scenes/*`, `POST /sell/register`, `/facilitator/*`, `POST /visitor/pause`) answer 403 to any request carrying `CF-Connecting-IP`.
- Public build has an empty `NEXT_PUBLIC_SWARM_TOKEN`; scene controls render only when the token is non-empty and the host is local.
- UI system (existing `app/globals.css` tokens): surfaces `#000` `#181818` `#1F1F1F` `#272727`; borders white 8%; `#14F195` only for finalized/verified; `#9B9B9B` processing; white confirmed; `#FF4757` rejected. Geist + Geist Mono, Tailwind type scale, no italics, no background gradients, Phosphor icons, custom cubic beziers, `prefers-reduced-motion` honoured, touch targets ≥ 44px, mobile first (375px).
- Copy: sentence case, no hyphens inside sentences, errors state cause plus next step, MOCK on every mock payment and no Explorer link for mock signatures.
- Every visual state is caused by an event that already happened; nothing loops while idle.

## Review Focus

1. Visitor's wallet is on mainnet or lacks `solana:signTransaction`: Pay must not be offered; the step says how to switch. (Task 6 test `accountUsable`.)
2. Visitor takes longer than 120 s to approve: the stream times out; the page shows "took too long" and retry starts a fresh invoice. (Task 7 test `timeout then retry`.)
3. Two visitors buy at the same time: each `tx` event carries its own payment id. (Task 2 test `concurrent visitor payments are attributed separately`.)
4. Same wallet asks for a second drip, or a burst from one IP: refused with a reason, no transaction. (Task 4 tests.)
5. A tunnel request reaches a token endpoint even with a valid token: 403. (Task 5 test.)

---

### Task 1: Seller-side payment hooks and a configurable payment wait

**Files:**
- Modify: `js/packages/x402-libp2p/src/server.ts` (`PaidOptions`, `paid()`)
- Modify: `js/packages/ipfs-x402/src/fetch.ts` (`FetchHooks`, `fetchHandler` opts)
- Test: `js/packages/x402-libp2p/test/x402-libp2p.test.ts`, `js/packages/ipfs-x402/test/ipfs-x402.test.ts`

**Interfaces:**
- Produces: `PaidOptions.hooks?: GateHooks` where `GateHooks = { onInvoice?: (r: { accepts: PaymentRequirements[], peer: PeerId }) => void, onVerified?: (r: { payment: PaymentPayload, requirements: PaymentRequirements, peer: PeerId }) => void }` (exported from `x402-libp2p`).
- Produces: `FetchHooks` gains `onInvoice` and `onVerified` with the same shapes (passed through to `paid`), and `onSettled` gains `payment: PaymentPayload`. `fetchHandler(..., opts: { maxBytes: number, paymentTimeoutMs?: number }, hooks)`.

- [ ] **Step 1: Failing test** `gate hooks: invoice and verified fire with the remote peer` in x402-libp2p: setup with an invoice; after a paid exchange assert `onInvoice` got `accepts[0].amount === '2500'` and `peer.equals(agent.peerId)`, and `onVerified` got the payment whose `accepted.amount === '2500'`; a payment that fails verify (`payer('bad')`) fires no `onVerified`.
- [ ] **Step 2:** Run `cd js/packages/x402-libp2p && node --test test/x402-libp2p.test.ts`; expect the new test to FAIL.
- [ ] **Step 3:** Add `hooks` to `PaidOptions`; call `onInvoice` after the invoice frame is written and `onVerified` right after `verifyPayment` returns valid. Hooks must never throw into the gate: wrap each call in try/catch.
- [ ] **Step 4: Failing test** `fetch: paymentTimeoutMs and seller hooks reach the gate` in ipfs-x402: `fetchHandler(..., { maxBytes, paymentTimeoutMs: 120_000 }, { onInvoice, onVerified, onSettled })`; after `fetchPaid` assert all three fired once and `onSettled` received `payment`.
- [ ] **Step 5:** Implement in `fetch.ts`; run both package suites: all pass (x402-libp2p 11, ipfs-x402 14).
- [ ] **Step 6:** Commit `feat(x402-libp2p): seller-side gate hooks; fetch passes hooks and payment wait`.

### Task 2: Visitor seller over WebSockets, visitor config, per-payment attribution

**Files:**
- Modify: `js/apps/swarm/src/nodes.ts` (`heliaNode` opts), `js/apps/swarm/src/swarm.ts`, `js/apps/swarm/src/payments.ts`, `js/apps/swarm/src/events.ts`, `js/apps/swarm/src/http.ts`, `js/apps/swarm/src/main.ts`
- Modify: `js/apps/swarm/src/shared.ts` (add `VisitorConfig`)
- Test: `js/apps/swarm/test/swarm.test.ts`

**Interfaces:**
- Produces: `heliaNode(key, opts: { dialsTabs?: boolean, wsPort?: number, announce?: string[] })`. With `wsPort`: adds `webSockets()`, listens on `/ip4/127.0.0.1/tcp/${wsPort}/ws`, sets `addresses.announce` when given, and `connectionManager: { allow: ['/ip4/127.0.0.1/ipcidr/32'] }`.
- Produces: `SwarmOptions.sellerWsPort?: number` (default 0 = any; `main.ts` default 4404, flag `--seller-ws-port`), `SwarmOptions.sellerPublicAddr?: string` (`main.ts` reads env `SELLER_HOST` → `/dns4/${SELLER_HOST}/tcp/443/tls/ws`).
- Produces: `interface VisitorConfig { mode: 'mock' | 'devnet', network: Network, asset: string, rpcUrl?: string, root: string, seller: { peerId: string, payee: string, addrs: string[] }, drip: { amount: string, enabled: boolean } }` in `shared.ts`; `Swarm.visitorConfig(): VisitorConfig`. `seller.addrs` = the public announce address with `/p2p/<id>` when set, else the loopback ws address with `/p2p/<id>`.
- Produces: `GET /visitor/config` (public, JSON).
- Produces: `Role` gains `'visitor'`. Visitor events (all emitted by the seller hooks): `peer { role: 'visitor', label: 'Visitor ' + first 4 and last 4 chars of payer, id: <visitor PeerId>, payee: <payer address> }` once per visitor PeerId; `quote { from: seller, to: visitor, invoice: true }`; `payment { id: 'visit-<n>', from: visitor, to: seller }`; `tx` events with `paymentId: 'visit-<n>'`.
- Produces in `payments.ts`: `tagPayment(payload: PaymentPayload, paymentId: string): void` and the `OnSubmit` signature becomes `(signature: string, submittedAt: number, paymentId?: string) => void`. Attribution: key = `JSON.stringify(payload.payload)`; the facilitator wrapper's `settle` runs the inner settle inside an `AsyncLocalStorage<string | undefined>` holding the tagged id, and the watched `sendTransaction` reads it. Mock settle passes the id directly. `swarm.ts` falls back to `currentPayment` when the id is undefined. Agent `onPayment` calls `tagPayment(p, currentPayment)`.

- [ ] **Step 1: Failing test** `visitor config advertises the seller over ws` : `startSwarm({ mode: 'mock' })`, `serve`, GET `/visitor/config`; assert `seller.addrs[0]` matches `/\/ws\/p2p\/12D3KooW/`, `seller.payee === payeeFromPeerId(sellerId)`, `root` equals the dataset root, `drip.amount === '10000'`.
- [ ] **Step 2: Failing test** `concurrent visitor payments are attributed separately`: two Node libp2p buyers (webSockets only, from Task 3's `startBuyer` once it exists; until then a plain `createLibp2p` with `webSockets()` and `fetchPaid` with the mock client) buy at the same time; assert two `payment` events with distinct `visit-*` ids, each with a `tx` `submitted` event of the same id, and two `peer` events with `role: 'visitor'`.
- [ ] **Step 3:** Run `cd js/apps/swarm && node --test test/swarm.test.ts`; both FAIL.
- [ ] **Step 4:** Implement per the Interfaces block. The seller's `fetchHandler` gets `paymentTimeoutMs: 120_000` and the hooks; `/visitor/config` goes in `http.ts` beside `/sell/config` (`Control.visitorConfig?`).
- [ ] **Step 5:** Run the swarm suite and `npx tsc --noEmit -p .`: all pass.
- [ ] **Step 6:** Commit `feat(swarm): visitor seller over WebSockets, visitor config, per-payment attribution`.

### Task 3: Browser-safe buyer module

**Files:**
- Create: `js/apps/swarm/src/buyer.ts`
- Modify: `js/apps/swarm/src/shared.ts` (add `mockSchemeClient`)
- Test: `js/apps/swarm/test/swarm.test.ts`

**Interfaces:**
- Consumes: `VisitorConfig` (Task 2), `fetchPaid`, `PayHooks`, `BlockCheck` (ipfs-x402 / x402-libp2p).
- Produces: `startBuyer(): Promise<Buyer>` where `Buyer = { libp2p: Libp2p, stop(): Promise<void> }` (Helia with `webSockets()`, `noise`, `yamux`, `identify`, no discovery, no listen addresses; no connection gater override).
- Produces: `buy(buyer: Buyer, config: VisitorConfig, payer: { kind: 'wallet', signer: TransactionSigner } | { kind: 'mock' }, hooks: { pay?: PayHooks, onBlock?: (b: BlockCheck) => void, onDial?: (ms: number) => void }, signal?: AbortSignal): Promise<{ bytes: number, blocks: number, data: Uint8Array, settlement: SettleResponse, paymentRequired: PaymentRequired }>`. Wallet path: `new x402Client().register(config.network, new ExactSvmScheme(signer, { rpcUrl: config.rpcUrl }))`; mock path: `mockSchemeClient` with spend controls off. `data` is the UnixFS file bytes reassembled from the verified blocks (so the page can preview and download).
- Produces: `mockSchemeClient: SchemeNetworkClient` (scheme `mock`, payload `{ sig: 'mock' }`) in `shared.ts`; `payments.ts` mock path uses it.

- [ ] **Step 1: Failing test** `a buyer pays the seller over ws and gets the dataset (mock)`: start swarm mock + serve; `startBuyer()`; `buy(buyer, config, { kind: 'mock' }, hooks)`; assert `data` deep-equals `dataset()`, every `onBlock` call has `ok: true`, `onPayeeCheck` fired with `ok: true`, and the swarm emitted a `visit-1` payment.
- [ ] **Step 2:** Run; FAIL (module missing).
- [ ] **Step 3:** Implement `buyer.ts` (browser-safe: no Node imports) and `mockSchemeClient`.
- [ ] **Step 4:** Run swarm suite and tsc; pass. If Task 2's Step 2 used an inline buyer, switch it to `startBuyer`.
- [ ] **Step 5:** Commit `feat(swarm): browser-safe visitor buyer`.

### Task 4: Test USDC drip with limits, payee accounts at startup

**Files:**
- Create: `js/apps/swarm/src/drip.ts`
- Modify: `js/apps/swarm/src/swarm.ts`, `js/apps/swarm/src/http.ts`, `js/apps/swarm/src/payments.ts` (export a devnet RPC client factory if needed), `js/apps/swarm/package.json` (declare `@solana-program/token@^0.9.0`)
- Test: `js/apps/swarm/test/drip.test.ts`

**Interfaces:**
- Produces: `createDrip(opts: { send: (address: string) => Promise<string>, ledgerFile?: string, now?: () => number, feePayerLamports: () => Promise<bigint>, limits?: Partial<DripLimits> }): Drip`, with `DripLimits = { perIpPerHour: 3, globalPerHour: 60, total: 500, minFeePayerLamports: 100_000_000n }` as defaults, and `Drip = { request(address: string, ip?: string): Promise<DripResult>, pause(on: boolean): void, status(): { paused: boolean, sent: number, remaining: number } }`; `DripResult = { ok: true, signature: string } | { ok: false, code: 'invalid_address' | 'already_dripped' | 'rate_limited' | 'paused' | 'budget_spent' | 'low_sol' | 'send_failed', message: string }`. The address slot is claimed before `send` (concurrent duplicates get `already_dripped`); a failed send releases it. Sends run one at a time. The ledger (address → ISO time) is a JSON file next to the keys (`.keys/drip-ledger.json`) in devnet, memory in mock.
- Produces: devnet `send`: one transaction, fee payer `keys.feepayer`, `getCreateAssociatedTokenIdempotentInstructionAsync({ payer: feePayer, owner: address, mint })` then `getTransferCheckedInstruction({ source: agentAta, mint, destination: visitorAta, authority: agent, amount: 10_000n, decimals: 6 })`, signed by fee payer and agent, sent and confirmed. The submit goes through `onSubmit` so the dashboard sees a `tx` with `paymentId: 'drip-<n>'`.
- Produces: `ensurePayeeAccounts(addresses: string[])` at devnet startup: idempotent ATA create for seller and provider in one transaction, skipped when both exist.
- Produces: `POST /visitor/drip { address }` (public; IP from `CF-Connecting-IP`, else socket address): 200 `{ signature }`, 400 `invalid_address`, 409 `already_dripped`, 429 `rate_limited`, 503 for `paused`/`budget_spent`/`low_sol`, 502 `send_failed`. Mock mode: 200 `{ signature: null, mock: true }` with no send. `POST /visitor/pause { paused: boolean }` (token). `GET /visitor/config` `drip.enabled` reflects pause/budget/low SOL.

- [ ] **Step 1: Failing tests** in `drip.test.ts` with a fake `send` and fake clock: `second request for the same address is refused`; `fourth request from one IP within an hour is rate limited, allowed after the hour`; `61st request in an hour is rate limited`; `501st request fails with budget_spent`; `low fee payer SOL refuses`; `two concurrent requests for one address send once`; `a failed send releases the address`; `invalid base58 address is refused without sending`.
- [ ] **Step 2:** Run `node --test test/drip.test.ts`; FAIL.
- [ ] **Step 3:** Implement `createDrip` (pure logic, injectable `send`, clock, balance).
- [ ] **Step 4:** Implement the devnet `send` and `ensurePayeeAccounts` with `@solana/kit` 8.5 + `@solana-program/token`; add a test `drip transaction has exactly create-idempotent then transferChecked of 10000` that builds the message with generated keys and decodes it (no network).
- [ ] **Step 5:** Wire `/visitor/drip` and `/visitor/pause` in `http.ts`; test `POST /visitor/drip in mock mode answers mock` and `pause requires the token`.
- [ ] **Step 6:** Run swarm suite and tsc; pass. Commit `feat(swarm): booth USDC drip with limits; payee token accounts at startup`.

### Task 5: Tunnel-aware security and the version-trap guard

**Files:**
- Modify: `js/apps/swarm/src/http.ts`
- Test: `js/apps/swarm/test/swarm.test.ts`

**Interfaces:**
- Produces: one helper in `http.ts`, `fromTunnel(req): boolean` (true when `cf-connecting-ip` is present); every token endpoint returns 403 `tunnel` before checking the token when it is true. CORS keeps local origins and adds the origin in env `TRY_ORIGIN` (for example `https://try.<domain>`) when set.

- [ ] **Step 1: Failing test** `token endpoints refuse tunnel traffic even with the token`: POST `/scenes/1`, `/sell/register`, `/facilitator/verify`, `/visitor/pause` with the right token and `CF-Connecting-IP: 203.0.113.9`; all 403. Without the header, `/scenes/1` still 202.
- [ ] **Step 2: Failing test** `x402 svm resolves @solana/keys below 8.5.0`: `createRequire` from `@x402/svm`'s resolved path, read `@solana/keys/package.json` version, assert major.minor < 8.5 (message names the upstream issue draft).
- [ ] **Step 3:** Implement; run the suite; pass. Commit `fix(swarm): token endpoints refuse tunnel traffic; guard the x402 keys version`.

### Task 6: Web wallet layer, public and presenter builds

**Files:**
- Modify: `js/apps/web/package.json` (add exact `@solana/react@8.5.0`, `@solana/kit@8.5.0`, `@wallet-standard/react@1.0.3`, and the peers `@solana/react` requires; scripts `build:public`, `start:public`, `build:presenter`)
- Create: `js/apps/web/lib/try/wallet.ts`, `js/apps/web/lib/try/deeplinks.ts`, `js/apps/web/lib/try/wallet.test.ts`
- Modify: `js/apps/web/components/live/SceneControls.tsx` (render only with a non-empty `SWARM_TOKEN`), `js/apps/web/lib/config.ts` (`TRY_URL` from `NEXT_PUBLIC_TRY_URL`)

**Interfaces:**
- Produces (`wallet.ts`, pure, node-testable): `accountUsable(account: { chains: readonly string[], features: readonly string[] }): { ok: true } | { ok: false, reason: 'not_devnet' | 'no_sign_transaction' }`; `WALLET_CHAIN = 'solana:devnet'`.
- Produces (`deeplinks.ts`): `walletBrowseLinks(url: string): Array<{ name: 'Phantom' | 'Solflare' | 'Backpack', href: string }>` with `https://phantom.com/ul/browse/<enc url>?ref=<enc origin>`, `https://solflare.com/ul/v1/browse/<enc url>?ref=<enc origin>`, `https://backpack.app/ul/v1/browse/<enc url>?ref=<enc origin>`.
- Produces (React, in Task 8): discovery and connect with `useWallets` / `useConnect` from `@wallet-standard/react`; the payment signer from `useWalletAccountTransactionSigner(account, WALLET_CHAIN)` (`@solana/react`), a modifying signer backed by `solana:signTransaction`.
- Produces: `npm run build:public` = `NEXT_DIST_DIR=.next-public NEXT_PUBLIC_SWARM_TOKEN= next build`; `build:presenter` uses `.next-presenter` and the token from `.env.local`.

- [ ] **Step 1: Failing tests** in `wallet.test.ts`: `accountUsable` refuses `['solana:mainnet']` with `not_devnet`, refuses a devnet account without `solana:signTransaction` with `no_sign_transaction`, accepts `['solana:devnet']` + `['solana:signTransaction']`; `walletBrowseLinks('https://try.example.org/try')` returns the three exact hrefs.
- [ ] **Step 2:** Add the test file to the web `test` script; run `npm test` in `js/apps/web`; FAIL.
- [ ] **Step 3:** Implement both modules; install the packages in `js/apps/web`; then from `js/` run `npm ls @solana/keys` and confirm the `@x402/svm` path still resolves 5.5.1 (paste the output into the commit message body).
- [ ] **Step 4:** SceneControls renders nothing when `SWARM_TOKEN === ''`.
- [ ] **Step 5:** Run `npm run build:public`, then grep `.next-public/static` for the `NEXT_PUBLIC_SWARM_TOKEN` value from `.env.local`: no match. If `.env.local` overrides the empty value, make `build:public` set `NEXT_PUBLIC_SWARM_TOKEN=__none__` and treat `__none__` as empty in `config.ts`.
- [ ] **Step 6:** Web tests pass; commit `feat(web): wallet helpers, deeplinks, token-free public build`.

### Task 7: The visitor flow reducer

**Files:**
- Create: `js/apps/web/lib/try/flow.ts`, `js/apps/web/lib/try/flow.test.ts`

**Interfaces:**
- Produces: `type Step = 'connect' | 'fund' | 'buy' | 'done'`; `type FlowState = { step: Step, mode: 'mock' | 'devnet' | null, wallet?: { address: string, usdc: number }, drip?: { status: 'idle' | 'sending' | 'sent' | 'error', signature?: string, error?: string }, purchase?: Purchase, error?: { code: string, message: string } }`; `Purchase = { seller: { peerId: string, payee: string }, dialMs?: number, quote?: { amount: number, memo?: string }, payeeOk?: boolean, signing?: { since: number }, paid?: { id?: string }, tx?: { signature?: string, stages: Array<{ status: 'processed' | 'confirmed' | 'finalized', ms: number }> }, blocks: Array<{ index: number, ok: boolean }>, total?: number, bytes?: number, data?: Uint8Array }`.
- Produces: `type FlowEvent` (one per real signal): `config`, `wallet-connected { address, usdc }`, `wallet-disconnected`, `balance { usdc }`, `drip-sending`, `drip-sent { signature }`, `drip-failed { code, message }`, `dialed { ms }`, `quote { amount, memo, invoice }`, `payee-check { ok }`, `signing { at }`, `paid`, `tx { signature?, status, ms }` (from the shared event stream, matched by memo and payer), `block { index, total, ok }`, `received { bytes, data }`, `failed { code, message }`, `retry`. `reduceFlow(s: FlowState, e: FlowEvent): FlowState`; `initialFlow: FlowState`.
- Rules: `fund` is skipped when `usdc ≥ 0.002124 × 1` (one purchase); `step` becomes `done` only after `received` and every block `ok`; `failed` with code `timeout` keeps the step at `buy` and `retry` clears `purchase`; in mock mode `signing` is never entered (the UI says "MOCK: no signature requested").

- [ ] **Step 1: Failing tests** in `flow.test.ts`: `happy path walks connect → fund → buy → done with ascending tx stages`; `wallet with enough USDC skips fund`; `timeout then retry starts a fresh purchase`; `a bad block ends in failed, never done`; `mock mode never enters signing`.
- [ ] **Step 2:** Add to the web `test` script; run; FAIL.
- [ ] **Step 3:** Implement `reduceFlow` (erasable TypeScript only, like `lib/reduce.ts`).
- [ ] **Step 4:** Run; pass. Commit `feat(web): visitor flow reducer`.

### Task 8: The /try page

**Files:**
- Create: `js/apps/web/app/try/page.tsx` (metadata; renders the client page), `js/apps/web/components/try/index.tsx` (`next/dynamic`, `ssr: false`), `js/apps/web/components/try/TryPage.tsx`, `js/apps/web/components/try/WalletProvider.tsx`, `js/apps/web/components/try/TopBar.tsx`, `js/apps/web/components/try/StepCard.tsx`, `js/apps/web/components/try/Receipt.tsx`, `js/apps/web/lib/try/useVisitor.ts`
- Modify: `js/apps/web/tsconfig.json` (path `@swarm/buyer` → `../swarm/src/buyer.ts`)

**Interfaces:**
- Consumes: `startBuyer`, `buy` (Task 3), `VisitorConfig` (Task 2), `accountUsable`, `walletBrowseLinks`, `WALLET_CHAIN` (Task 6), `reduceFlow` (Task 7), `useSwarm`-style SSE for `tx` stages (reuse the `EventSource` pattern in `lib/useSwarm.ts`).
- Produces: `useVisitor(): { state: FlowState, connect(wallet), disconnect(), drip(), buy(), retry() }` holding the buyer node for the page's life, fetching `/visitor/config` from `SWARM_URL`, reading the USDC balance through `rpcUrl` (`getTokenAccountsByOwner` for the mint), and folding buyer hooks and matching `tx` events into `reduceFlow`.
- Page structure per spec: top bar (brand, DEVNET/MOCK badge, wallet button with copy, Explorer, disconnect); four `StepCard`s (connect, fund, buy, done) each with state, one plain sentence, and a collapsible "under the hood" line; the buy card's primary button reads `Pay <amount> USDC` with the real invoice amount; while signing, "Approve in your wallet" with a 120 s countdown; receipt with amount, payer, payee, memo, tx (Explorer link only in devnet), blocks N of N, total time, "Preview the data" (first 10 lines), "Download", "Buy again".
- Wallet step with no injected wallet on a phone: the three `walletBrowseLinks` buttons; with a wallet on the wrong network: the `not_devnet` how-to text ("Phantom: Settings, Developer settings, Testnet mode").

- [ ] **Step 1:** Build the page against the mock swarm (`node src/main.ts --mode mock` and `npm run dev`); check by hand at 375px and 1440px in the browser pane that each step renders its waiting, active, done and error states (use the reducer states from Task 7's tests as fixtures via a `?state=` dev-only switch, removed before commit).
- [ ] **Step 2:** `npx tsc --noEmit -p .` and `npm run build:public` pass.
- [ ] **Step 3:** Commit `feat(web): /try page`.

### Task 9: The process visual

**Files:**
- Create: `js/apps/web/components/try/Sequence.tsx`, `js/apps/web/components/try/BlockStrip.tsx`
- Modify: `js/apps/web/components/try/TryPage.tsx`

**Interfaces:**
- Consumes: `Purchase` (Task 7).
- Produces: `<Sequence purchase={Purchase} mode={'mock' | 'devnet'} />`: from `lg`, four lanes (You, Seller peer, Facilitator, Solana devnet) with a message row per real event (dial over WSS with Noise and the seller PeerId, rate card, `x402/request`, invoice amount and memo, payee check mark, wallet signature on the You lane, `x402/payment`, verify, settle, submitted, processed/confirmed/finalized with ms); below `lg`, the same rows as a vertical timeline. A pulse travels a connector only when its row's event arrives (motion `transition` with `cubic-bezier(0.32, 0.72, 0, 1)`); reduced motion shows the row without travel. `<BlockStrip blocks total />`: one cell per block, grey until checked, `#14F195` when `ok`, `#FF4757` when not.

- [ ] **Step 1:** Implement both; drive them from the mock swarm through a real buy; record a screenshot at 375px and 1440px into `captures/try-ui/`.
- [ ] **Step 2:** tsc and `build:public` pass. Commit `feat(web): /try sequence visual and block strip`.

### Task 10: Visitor purchases on /live

**Files:**
- Modify: `js/apps/web/components/live/PeerGraph.tsx` (slots for `visitor`), `js/apps/web/lib/reduce.ts` (only if a `visitor` role needs handling), `js/apps/web/lib/reduce.test.ts`

**Interfaces:**
- Consumes: Task 2 visitor events.
- Produces: visitors get slots `[[160, 470], [330, 470], [500, 470]]` (the newest three; older visitors drop from the graph but stay in the feed); their payments appear in `TxFeed` like any payment.

- [ ] **Step 1: Failing test** `visitor payment folds into the feed with its own tx stages` in `reduce.test.ts` (peer `role: 'visitor'`, payment `visit-1`, `tx` submitted/processed/confirmed/finalized `visit-1`).
- [ ] **Step 2:** Implement; web tests pass; commit `feat(web): visitor purchases on /live`.

### Task 11: End to end in a real browser (mock)

**Files:**
- Create: `js/apps/web/scripts/try-e2e.ts`, `js/apps/web/lib/try/e2eWallet.ts`
- Modify: `js/apps/web/package.json` (`e2e:try`), `js/apps/web/components/try/WalletProvider.tsx`

**Interfaces:**
- Produces: `e2eWallet.ts` registers a fake wallet-standard wallet (chains `['solana:devnet']`, features `standard:connect`, `solana:signTransaction` that signs with a generated key) only when `process.env.NEXT_PUBLIC_E2E_WALLET === '1'` at build time, so public builds never contain it; the page auto-connects it when `?e2e=1`.
- Produces: `try-e2e.ts` like `sell-e2e.ts`: swarm mock in-process, `next dev` with `NEXT_DIST_DIR=.next-e2e-try` and `NEXT_PUBLIC_E2E_WALLET=1`, headless Chromium on `/try?e2e=1&autobuy=1`; asserts on the swarm bus: a `peer` with `role: 'visitor'`, a `payment` `visit-1`, and a `tx` `submitted` for `visit-1`, within 90 s.

- [ ] **Step 1:** Write the script; run `npm run e2e:try`; it FAILS until `autobuy` exists.
- [ ] **Step 2:** Implement `?autobuy=1` (connect → drip (mock) → buy, only with `?e2e=1`); run; PASS.
- [ ] **Step 3:** Commit `test(web): /try end to end in headless Chromium`.

### Task 12: Tunnel config, runbook, devnet rehearsal

**Files:**
- Create: `deploy/cloudflared/config.yml.template`, `deploy/tunnel-setup.sh`, `docs/RUNBOOK.md` (or extend it if the offline-rehearsal session created one)

**Interfaces:**
- Produces: ingress: `${TRY_HOST}` path `^/(events|visitor)` → `http://localhost:4402`; `${TRY_HOST}` → `http://localhost:3000` (public build, `npm run start:public`); `${SELLER_HOST}` → `http://localhost:4404`; catch all `http_status:404`. `tunnel-setup.sh` prints (does not run) `cloudflared tunnel login`, `cloudflared tunnel create booth`, `cloudflared tunnel route dns booth $TRY_HOST`, `… $SELLER_HOST`, and `cloudflared tunnel --protocol http2 run booth`.
- Runbook: start order (swarm devnet with `SELLER_HOST`, `TRY_ORIGIN`; public build; presenter build on localhost; tunnel), QR code for `https://${TRY_HOST}/try`, pause switch, budget numbers (≈0.00205 SOL per drip; 20 USDC = 2,000 drips), fallback to booth laptop and to `--replay`.

- [ ] **Step 1:** Write the three files; `bash -n deploy/tunnel-setup.sh` passes.
- [ ] **Step 2 (needs the user's tunnel and approval for real transactions):** rehearsal on devnet from a phone on mobile data with Phantom: record instruction count of the signed transaction, time from invoice to payment frame, `curl -N https://$TRY_HOST/events` streaming. Save to `captures/2026-1x-xx-try-rehearsal/`.
- [ ] **Step 3:** Commit `docs: booth tunnel config and runbook`.

### Cut first (only if time remains, in this order)

Android Mobile Wallet Adapter (`registerMwa({ chains: ['solana:devnet'] })`), purchase history in local storage, explain mode toggle, booth feed on `/try`, desktop diagram polish.

## Verification at the end

From `js/`: `npm test --workspaces --if-present` (x402-libp2p, ipfs-x402, swarm all pass); from `js/apps/web`: `npm test`, `npx tsc --noEmit -p .`, `npm run build:public`, `npm run e2e:sell`, `npm run e2e:try`; `npm ls @solana/keys` shows `@x402/svm` on 5.5.1.
