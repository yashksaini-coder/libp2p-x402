# Demo app design: landing page + live stage dashboard

Status: draft for approval, 2026-10-26. **Everything runs on one laptop; only payments touch Solana devnet** (user decision 2026-10-26: start simple, no VPS). Target: Devcon 8, Mumbai, Nov 3–6 2026 (assumed; 8 days out).
Research basis: [`docs/RESEARCH-2026-10-26.md`](../../RESEARCH-2026-10-26.md).

## Intent

The room is Devcon attendees and Solana developers. They must **see** real Solana transactions and real IPFS requests happen live, and leave believing three things:

1. An agent can be paid **peer to peer**, with no HTTP server, and the payment is bound to the peer's identity (PeerId = wallet).
2. The chain and IPFS point at each other: the payment memo carries the content CID, and the receipt carries the transaction signature.
3. Bytes are verified, not trusted. A tampered block is rejected before any money moves.

**Anti-goals:**
- A pretty dashboard animating fake data.
- Anything that breaks on venue wifi with no fallback.
- Claiming "first x402 over libp2p" (Betar exists).
- Generic crypto-neon styling.

## What we build

| Part | Path | What |
| --- | --- | --- |
| Web app | `js/apps/web` | Next.js 16 (App Router), Tailwind 4, Geist, Phosphor icons, Motion. Routes: `/` landing, `/live` stage dashboard, `/sell` browser seller tab |
| Swarm | `js/apps/swarm` | Long-running Node process: provider and agent libp2p nodes, `x402-libp2p` + `ipfs-x402`, Solana status watcher. Serves an event stream (SSE) the dashboard renders |
| Paid IPFS | `js/packages/ipfs-x402` | `/ipfs-x402/fetch/1.0.0` and `/ipfs-x402/pin/1.0.0` on Helia, per-block hash verification, receipts |

**Why a separate swarm process, not Next.js route handlers:** libp2p nodes and Solana websocket subscriptions are long-lived. Next.js dev reloads and serverless handlers would kill them. The dashboard only renders events. It never holds keys.

### Event stream (the contract between swarm and dashboard)

There is one SSE endpoint, `GET /events`. Each event is JSON, with a monotonically increasing `seq` and an `at` timestamp (ms):

- `peer` `{ id, role: agent|provider|seller|relay, addrs, payee }`
- `connection` `{ from, to, transport: tcp|webrtc|circuit, open|closed }`
- `quote` `{ from, to, protocol, accepts }`: the `x402/payment-required` frame
- `payee-check` `{ from, to, payTo, remoteKey, ok }`: the identity rule, shown explicitly
- `payment` `{ id, from, to, amount, asset, network, memo }`
- `tx` `{ paymentId, signature, status: submitted|processed|confirmed|finalized, ms }`: measured from submit, via Kit `signatureNotifications`
- `block` `{ requestId, cid, index, total, ok }`: one per CAR block hash check
- `pinned` `{ root, provider, receiptCid, expiresAt }`
- `provided` `{ root, via: kubo-fast-provide, lookupUrl }`
- `error` `{ code, message, scene }`

The dashboard is a pure function of this stream. Replaying a recorded stream drives the same UI. That replay is the last-resort fallback, and it is labelled "replay" on screen. It is never passed off as live.

### Network modes (swarm flag)

| Mode | Payments | Use |
| --- | --- | --- |
| `mock` | mock x402 scheme (as in the tests) | development, CI |
| `devnet` | `@x402/svm` `exact`, self-hosted facilitator in the swarm, devnet USDC, public devnet RPC (a few tx per scene is far below its rate limit) | **the stage default** |
| `local` | Surfpool or solana-test-validator, self-hosted `@x402/svm` facilitator | venue internet down |

## The three scenes on `/live`

1. **Sell from a browser tab.**
   1. `/sell` on a second device reserves a slot on our relay.
   2. The agent dials it (`circuit` → `webrtc`), reads the quote, and shows the payee check (payTo vs. the PeerId key, ✓).
   3. The agent pays. The ticker runs processed → confirmed → finalized with measured ms. The explorer link shows the CID in the memo.
   4. Blocks tick green as they arrive.
   - *Fallback:* the seller runs as a Node peer inside the swarm. The scene is the same, without the transport upgrade.
2. **Tamper.**
   1. A misbehaving agent uploads a CAR with one flipped byte for pinning.
   2. The provider checks blocks in order and hits a red block.
   3. It sends `x402/error resource_invalid`. **No settlement transaction exists**, and the panel says so.
   - This is why pin settles after verification.
3. **Pay to keep it.**
   1. The agent pays the provider to pin. The provider verifies, settles, pins in Helia and replies with a receipt CID.
   2. A **stock Kubo node** running on the same laptop is given only the root CID and fetches it from our provider over Bitswap. This is the M2 gate: "fetchable from a stock Kubo node". The dashboard shows Kubo's peer and the blocks arriving.
   3. The receipt CID opens to `{ cid, payer, payee, tx, bytes, expiresAt }`.
   - **Public-network proof is deferred:** the `delegated-ipfs.dev` lookup, which needs a public host. The UI states "local network" plainly; it never implies the public DHT.

**Honest limitation slide:** in fetch, the provider is paid before it delivers, so a cheating provider is caught but the money is already gone. The fix is payment channels (`upto` over the Solana Foundation program): pay per verified chunk. It is shown as "next".

## Protocol changes the scenes need

- **Quote, then invoice (builder check Q1, my call).** The server still speaks first. Its opening `x402/payment-required` is a **rate card**: a generic price, for example per MiB, with no memo. The client then sends its application request (`{ root }`, or `{ root, bytes, maxBytes }`) *without* paying. The server answers with a second `x402/payment-required`, the **invoice**, which carries the exact amount and `extra.memo = "ipfs:<root>"`. The client pays the latest requirements it has received.
  - Spec change: *"A server MAY send a further `x402/payment-required` in response to an application frame. It supersedes earlier ones."*
  - Free price discovery and server-speaks-first both survive, at the cost of one extra round trip for priced-per-request protocols.
- **Self-hosted facilitator in the swarm (builder check Q3, my call).** The swarm runs the `@x402/svm` exact facilitator with its own devnet fee-payer key (hot, devnet only), instead of x402.org. We submit the transaction ourselves, so the ticker starts at real submit time and subscribes before submission. Processed, confirmed and finalized are measured, not inferred. This also gives `local` mode for free (same code, local RPC). The facilitator moves from Should to **Must**.

- **`paid()` gains manual settlement:** `paid(server, { ..., settle: 'before' | 'manual' }, handler)`. In `manual` mode the handler gets `ctx.settle()` and must call it before delivering anything paid. Pin uses `manual` (verify payment → receive CAR → verify blocks → settle → pin). Fetch uses `before`.
- **Pin is priced `exact` on the declared size.** The client declares `bytes` and `maxBytes` in the request, and the server rejects with `resource_too_large` if the CAR exceeds the declaration. `upto` waits until a devnet facilitator supports it (x402.org and PayAI don't today).
- **Memo:** the provider sets `extra.memo = "ipfs:<root CID>"`, within the 256-byte cap of exact-SVM.
- **Dependencies:** switch `@chainsafe/libp2p-noise`/`-yamux` to `@libp2p/noise`/`@libp2p/yamux`, as Helia uses.

## Landing page (`/`)

Layout **A** (classic hero + sections): the product is easiest to understand from the live dashboard itself.

The one primary action is **"Watch it live"** → `/live`. The secondary action is GitHub, kept out of the hero.

| # | Section | Motion (design-to-motion, website context) |
| --- | --- | --- |
| 1 | Hero: headline, subheadline, CTA, proof line, product visual = dashboard mockup | Loading intro on scroll for the mockup, no stories unless approved |
| 2 | Problem → solution (x402 needs a server, agents don't have one) | normal scroll reveal |
| 3 | Bento, 4 cards with visuals: PeerId = wallet, CID in memo, verified bytes, works behind NAT | card intro + one story loop per visual |
| 4 | Tagline reveal (word-by-word, mandatory) | per-word opacity on scroll |
| 5 | How it works, 3 steps (quote → pay → settle and deliver) | scroll reveal |
| 6 | Spec + open source (link to `spec/libp2p.md`, the npm packages) | scroll reveal |
| 7 | FAQ (8 Qs) | none |
| 8 | Final CTA (same as hero) + footer | none |

Draft hero copy (no hyphens, sentence case):
- **Headline:** "Agents that get paid / without running a server"
- **Subheadline:** "x402 payments over libp2p. One Ed25519 key is the peer and the wallet, so every USDC transfer on Solana goes to the peer that served the bytes."
- **CTA:** "Watch it live" · **Proof line:** "Settled on Solana devnet · open spec for x402 v2"

## Visual direction

### Sources

- **Read as page text:** Vercel Observability and Geist, Linear, Helius Orb, Arkham Visualizer, x402.org, libp2p universal-connectivity, Emil Kowalski's animation tips, rauno.me/craft. Third-party token extractions for solana.com, Phantom and Raycast.
- **Seen in a browser:** Dribbble searches for network-graph and dashboard work, and x402scan.
- **No access:** Behance (403), and no specific posts on X. Designer work came from their own portfolio sites instead.

**What the looking showed:**
- Dribbble's "network visualization" results are dense, light business dashboards. Copying them would make us look like everyone else.
- x402scan's main view is a table where every row is an **HTTP server**. Ours is a graph where every node is a **peer**, and that contrast is the story.

### Direction: calm, flat, one colour that means "settled"

**Colour**
- **Surfaces:** flat steps only. `#000` stage, `#181818` panels, `#1F1F1F` raised, `#272727` hover. Panels get 1px hairline borders at white 8% all round; no shadows, no gradients.
- **Status:** **`#14F195`** (Solana green) is reserved for *finalized / verified*, so green always means settled. Processing is `#9B9B9B`, confirmed is white, and tampered or rejected is `#FF4757`.
- **Solana purple** is not used for text, because it is too dark on black for a projector.

**Type**
- **Geist** everywhere. Geist Mono with tabular numbers for CIDs, signatures, amounts and ms.
- **Panel labels:** mono uppercase eyebrows, 12px, wide tracking.
- **Projector minimums:** 20px text, 30px (`text-3xl`) live numbers.

**`/live` grid** (1920×1080, 12 columns, 32px margins, 24px gutters):
- **Top:** floating glass pill with the live counters: peers, USDC settled, p50 time to finalize, blocks verified.
- **Main left (columns 1–8):** peer graph on `#000`.
- **Main right (columns 9–12):** transaction feed on `#181818`.
- **Bottom band, left (columns 1–8):** IPFS block grid.
- **Bottom band, right (columns 9–12):** latest receipt card, CID ↔ tx signature.

**Patterns we borrow**
1. **Three-stage timer per payment:** processed → confirmed → finalized. Each stage is a dot that fills and freezes its measured ms (Vercel log rows, Rauno's countdown).
2. **Edge pulse:** a single dot travels payer → payee when a payment lands, in about 600 ms with the custom ease. The edge settles slightly thicker as USDC accumulates.
3. **Graph ↔ feed sync:** hovering a feed row lights its edge; clicking a peer filters the feed (Arkham).
4. **Block grid as a heatmap:** grey cells turn green as hashes verify. A tampered cell flips red with one small shake, then the panel states "no settlement transaction" (Helius Orb heatmap).
5. **Receipt card:** CID → short signature, staggered text reveal, deep link to the explorer `/tx/<sig>`.
6. **Landing figure captions:** editorial labels like "Fig 0.1 Payment over a libp2p stream" (Linear).
7. **"HTTP x402 vs libp2p x402" two-column comparison** on the landing page (x402.org's old-vs-new layout).

**Motion rules**
- **The graph is fixed, not drifting.** Peer positions are fixed, with no live force simulation. Things move only when an event happens (Geist: motion explains a state change).
- **Landing:** follows the `design-to-motion` website context. The bento cards rise in on scroll, and each visual acts out its story: the payee check ticks, the memo types the CID, blocks verify, the NAT badge flips circuit → webrtc.
- **Dashboard:** the dashboard is UI, not a showcase. Transitions stay short and physical; no looping showcase cycle.
- **Reduced motion:** honoured everywhere.

**Avoid**
- **Neon gradients, glows, particle or grid backgrounds.** They wash out on projectors and read as generic crypto.
- **A drifting force graph.**
- **Price tickers or candlesticks.** Our story is latency and verification, not price.

## Scope for Devcon (8 days)

- **Must:**
  - `ipfs-x402` fetch + pin with manual settle, quote→invoice, memo
  - self-hosted `@x402/svm` facilitator in the swarm (devnet fee payer)
  - swarm on devnet, event stream, and a recorded replay
  - `/live` with the peer graph, tx ticker, block grid and receipt panel
  - landing page
  - the three scenes rehearsed
  - pre-funded devnet wallets: start the faucet now, 20 USDC / 2 h
- **Should:**
  - `/sell` browser seller via a relay running on the same laptop. A second browser tab works; a phone on the same hotspot works if the LAN allows peer-to-peer
  - `local` mode on Surfpool (same facilitator code)
- **Won't (yet):** VPS / public relay / AutoTLS / public DHT proof, `upto` / payment channels, Solana Pay QR, SAS, cNFT receipts, Anchor registry, py binding.

## Stage control and receipts (builder check Q4, Q5, my calls)

- **Starting scenes:** the presenter triggers scenes from `/live`, with buttons plus keys `1` `2` `3`. They call a control endpoint on the swarm (`POST /scenes/:n`) bound to localhost and guarded by a token in `.env`. The stage `/live` runs from the presenter laptop; a public deployment of the landing page has no control surface.
- **Receipts:** the dashboard decodes and shows the receipt itself, from the swarm. A public gateway link is shown as a secondary proof when the provider is publicly reachable.

## Left to the builder

Component structure, exact animation timings within the skill tokens, peer-graph layout algorithm (force layout vs. fixed positions; fixed is safer on stage), and SSE reconnect handling.
