# Visitor dashboard: pay with your own wallet and watch it happen

Date: 2026-10-28. Status: draft for approval. Verified at commit `fddb4cb`.
Builds on `2026-10-26-demo-app-design.md` (landing page, `/live`, swarm) and Task 7 (`/sell`).

## Intent

At the Devcon 8 booth (Mumbai, Nov 3 to 6), a stranger scans a QR code with their own phone or laptop, connects their own Solana wallet, gets a little test USDC from the booth, and buys the demo dataset themselves. They watch every step happen for real: their browser dials the seller peer over libp2p, the price arrives, the payee check passes, their wallet signs, the transaction finalizes on devnet, and every IPFS block is hashed and checked as it arrives. At the end they hold the data and an Explorer link to a transaction from their own address.

The point is ownership: it is their transaction, signed by their key, not a recording and not the presenter pressing a button. Nobody should need the presenter standing next to them to get through it.

## Goals

1. A new public page, `/try`, usable on a phone (first) and on a laptop, by someone who has never heard of libp2p or x402.
2. Solana wallet connection through the wallet standard: Phantom, Solflare, Backpack on desktop; Phantom/Solflare/Backpack in-app browsers on iOS via deeplink; Mobile Wallet Adapter on Android Chrome.
3. One tap test money: the booth sends 0.01 devnet USDC to the visitor (enough for four purchases) and creates their USDC account. The visitor needs no SOL: the booth's facilitator pays every fee.
4. A real purchase: the visitor's browser runs a Helia/libp2p node, dials the Node seller over WebSockets through the tunnel, and pays with x402 `exact` on devnet, signed by their wallet.
5. Process visuals that show the actual protocol as it happens, driven only by real events, with a plain language caption per step and an optional "under the hood" detail.
6. Visitor purchases also appear on the shared `/live` stage dashboard, so the booth screen shows strangers paying in real time.
7. A fallback that still works if the venue network fails: the same page on the booth laptop, with a booth owned demo wallet, labelled as such.

## Non goals

- Mainnet, real money, or any asset other than devnet USDC.
- Visitors selling or pinning (`/sell` and scene 3 stay presenter features). A "pay to pin your own note" flow is a later idea, not this build.
- Replacing `/live`. It stays the 1920×1080 stage view the presenter drives.
- Accounts, logins, or storing anything about visitors beyond the drip ledger (address, time, hashed IP).
- WebRTC for visitors. Phones on cellular networks need TURN for WebRTC; visitors dial the seller over WebSockets through the tunnel instead.

## Anti goals (failure even if it technically works)

- Anything that looks like a payment but is not one. In mock mode the page says MOCK on every payment, exactly like `/live`; it never shows an Explorer link for a mock signature.
- An animation that runs ahead of reality. Every visual state is caused by an event that already happened (a frame received, a hook fired, a status observed). Idle states are composed, not looped fakes.
- Leaking presenter powers: the public page must not carry the swarm control token, and the public tunnel must not reach `/scenes`, `/sell/register` or `/facilitator/*`.
- A flow that dead ends on a phone: every error says what happened and offers the next step (switch to devnet, open in wallet browser, retry with a fresh invoice).

## Constraints

- Deadline: usable for a rehearsal by Nov 1, booth Nov 3. Scope must fit.
- Stack: Next.js 16 app in `js/apps/web` (Turbopack root is `js/`, deps resolve from `js/node_modules`), React 19.3, Tailwind 4, `motion`, Phosphor icons, Geist + Geist Mono. Swarm engine in `js/apps/swarm` (Node 26 runs `.ts` directly).
- Visual system: the existing site tokens (`app/globals.css`): surfaces `#000`, `#181818`, `#1F1F1F`, `#272727`; hairline borders white 8%; `#14F195` means finalized or verified only; `#9B9B9B` processing; white confirmed; `#FF4757` rejected. No background gradients, no italics, Tailwind type scale, the landing page spacing table, custom cubic beziers. The ui-ux-pro-max suggestion of Inter with gold and purple is rejected because it conflicts with this system.
- Devnet wallets are currently unfunded (all four at 0 SOL, checked 2026-10-28). Real payments cannot be tested until the user funds them.

## Decisions already made

### Where it runs

Visitors use their own devices. The swarm and the web app keep running on the presenter laptop; a tunnel makes the public parts reachable over HTTPS. The user accepted that this breaks the earlier "everything stays on one laptop" rule for the visitor endpoints only.

### Tunnel (decided by the user, 2026-10-28)

A named Cloudflare Tunnel on the user's own domain (DNS on Cloudflare). Hostnames are configuration, not code: `TRY_HOST` (page, `/events`, `/visitor/*`) and `SELLER_HOST` (the seller's WebSockets port), for example `try.<domain>` and `seller.<domain>`. The user runs the one time `cloudflared tunnel login / create / route dns` commands; the repo ships the ingress config template and a script that prints the commands. Use `--protocol http2` (conference Wi-Fi often blocks UDP/QUIC). Fallback if the domain is unavailable: Tailscale Funnel.

### Priorities (decided by the user, 2026-10-28)

1. Must have: own wallet paying on a phone, the drip, the payee check, honest step states, the security fixes (public build without token, token endpoints refuse tunnel traffic, version trap test).
2. Next: the live sequence diagram, and visitor purchases on `/live` (seller side hooks).
3. Cut first: Android Mobile Wallet Adapter, purchase history, explain mode toggle, booth feed, desktop diagram polish.

### Topology (from recon, 2026-10-28)

- **Node seller gets a WebSockets listener** on a loopback port (for example `/ip4/127.0.0.1/tcp/4404/ws`) in addition to TCP, and announces its public address `/dns4/<seller-host>/tcp/443/tls/ws`. A browser cannot dial TCP, and the stock `@libp2p/websockets` cannot route by URL path, so the seller gets its own tunnel hostname.
- **Visitors never buy over the circuit relay.** The relay's default limits (2 minutes, 128 KiB) would cut the CAR off, and phones cannot rely on WebRTC without TURN. The relay stays for presenter `/sell` tabs.
- **Every node behind the tunnel** allows loopback in its connection manager (`connectionManager.allow: ['/ip4/127.0.0.1/ipcidr/32']`), because all tunnel traffic arrives from 127.0.0.1 and would otherwise hit the per host inbound limits after 5 visitors per second. Rate limiting moves to the HTTP layer and the tunnel.
- **Same origin for page and API:** one hostname routes `/events` and `/visitor/*` to the swarm HTTP server and everything else to the public Next.js build. A second hostname routes to the seller's WebSockets port. No CORS change is needed for the public origin.
- **Production build at the booth** (`next build` then `next start`), not `next dev`.

### Presenter and public builds are separate

- The public build is built with `NEXT_PUBLIC_SWARM_TOKEN` empty and serves `/`, `/try`, and a read only `/live` (no scene buttons when there is no token).
- The presenter runs a second build on localhost only, with the token, in its own `distDir` (the `NEXT_DIST_DIR` knob exists). The tunnel never routes to it.
- The swarm's control token becomes long and random (it already generates one when `SWARM_TOKEN` is unset); the 8 character token in `.env.local` is retired.
- Defense in depth: the swarm refuses token endpoints for any request carrying `CF-Connecting-IP` (that header only exists on tunnel traffic), in addition to the ingress rules not routing them.

### Wallet and payment

- `@solana/react` 8.5.0 (exact pin) for wallet discovery and `useWalletAccountTransactionSigner(account, 'solana:devnet')`. Not `@solana/wallet-adapter-react` (web3.js v1 stack). The wallet chain id is `solana:devnet`; the x402 network stays `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`.
- Only offer "Pay" for accounts whose features include `solana:signTransaction` and whose chains include `solana:devnet`. A send only signer silently produces an unsigned payload (verified in recon).
- The browser x402 client is `new x402Client().register(DEVNET, new ExactSvmScheme(walletSigner, { rpcUrl }))`, used by `fetchPaid` from `ipfs-x402`, so the identity rule (payTo equals the PeerId key of the connected peer) is checked in the visitor's browser.
- **Version trap (must not regress):** `@x402/svm` 2.28.0's facilitator rejects every client signed payload when it resolves `@solana/kit`/`@solana/keys` 8.5.0 (non extractable key import plus a new extractable check in keys 8.5.0; reproduced in recon). Today the swarm works because `@x402/svm` resolves kit 5.5.1. Adding `@solana/react` must not change that: install it in `js/apps/web` only, check `npm ls @solana/kit` afterwards, add an npm override pinning `@x402/svm`'s kit if needed, and add a swarm test that the in process facilitator verifies a payload partially signed by a wallet style (modifying) signer. Report the bug upstream to x402 (draft only; the user files it).
- The seller's x402 payment wait (`paymentTimeoutMs`, default 30 s in `paid()`) is too short for a first time phone user approving in a wallet. Make it configurable through `fetchHandler` and use 120 s for the visitor facing seller. The page requests the invoice only after the wallet is connected and ready, shows a countdown while the wallet prompt is open, and on timeout retries with a fresh invoice and blockhash.

### Test money (the drip)

- Public `POST /visitor/drip { address }` on the swarm. One transaction: idempotent create of the visitor's USDC associated token account (paid by the fee payer), then `transferChecked` 10,000 atomic USDC (0.01) from the agent's USDC account, signed by fee payer and agent. One send at a time through a single worker.
- Limits: one drip per address ever (persisted ledger, claimed before sending); 3 per IP per hour via `CF-Connecting-IP` (loose, because conference Wi-Fi shares IPs); 60 per hour globally; a hard budget of 500 drips; refuse when fee payer SOL drops below 0.1 SOL so purchases can still settle; a presenter stop switch. No captcha.
- The swarm ensures, at devnet startup, that the seller's and provider's USDC accounts exist (fee payer pays), because neither the x402 client nor the drip creates the payee's account.
- In mock mode the drip is a no op that says so.

### Mock mode (settled in review)

Mock mode still runs the wallet step: the visitor connects a wallet and the drip is a no op that says so. The payment uses the mock scheme, so no signature is requested; the step reads "MOCK: no signature requested" and the receipt carries the MOCK label, with no Explorer link. The headless test injects a fake wallet standard wallet (registered through the wallet standard registry, as in the recon proof) so the same connect path is exercised.

### Shared events

- The visitor's page builds its own view from its own client side hooks (`PayHooks`, `onBlock`), so it works even if the event stream drops.
- The seller side gains hooks (invoice issued, payment verified, settled, bytes sent) and emits bus events tagged with a per request id (not the global `currentPayment`, which would mix up two visitors buying at once). `/live` and the booth feed on `/try` render these. Visitor addresses are shown shortened.

## The page: `/try`

Mobile first single column; from `lg` a two column layout (controls and steps left, live process visual right). It keeps the site's top navigation pattern and links to `/` and `/live`.

### Top bar

Brand, a DEVNET badge (MOCK or REPLAY when relevant, same rules as `/live`), the wallet button (Connect wallet, then address shortened plus USDC balance, with a menu: copy address, view on Explorer, disconnect).

### The four steps

Each is a card with a state (waiting, active, done, error), one plain sentence, and a collapsible "under the hood" line with the protocol detail.

1. **Connect a wallet.** Lists detected wallets. On a phone with no injected wallet: buttons "Open in Phantom", "Open in Solflare", "Open in Backpack" (deeplinks to the wallet's in app browser), and on Android Chrome the Mobile Wallet Adapter option. If the wallet is not on devnet: a short how to (Phantom: Settings, Developer settings, Testnet mode).
2. **Get test USDC.** One button. Shows the drip transaction's stages and the new balance. Done automatically if the wallet already holds at least one purchase worth.
3. **Buy the dataset.** Shows the seller (name, PeerId shortened, its payee address) and the price after the invoice arrives. The primary button reads "Pay 0.002124 USDC" with the real amount. While the wallet prompt is open: "Approve in your wallet" with the countdown.
4. **Verified and yours.** Receipt: amount, payer (you), payee (the seller's key), memo (the root CID), transaction with Explorer link (devnet only), blocks verified N of N, total time. "Preview the data" shows the first rows of the dataset they bought; "Download" saves it. "Buy again" starts a fresh purchase.

### The process visual (the main act)

A sequence diagram with four lanes: **You** (this browser's libp2p node), **Seller peer**, **Facilitator**, **Solana devnet**. Messages travel between lanes as they actually happen, each labelled:

dial over WSS, Noise handshake (shows the seller's PeerId), rate card, `x402/request`, invoice (amount, memo), payee check (payTo equals the PeerId key, a check mark), wallet signature (on the You lane), `x402/payment`, verify, settle, transaction submitted, then the stage timer processed → confirmed → finalized with measured milliseconds, then the CAR streaming as a block grid where each cell turns green as its hash is checked.

Motion follows the design-to-motion website rules: a pulse travels along a connector only when its event fires; the step being worked on is highlighted; nothing loops while idle; `prefers-reduced-motion` shows the same states without travel. On phones the diagram collapses to a vertical timeline with the same events.

### Booth feed

A compact list of recent purchases from all visitors (from the swarm event stream): shortened address, amount, time to finalized, Explorer link. Social proof that this is live.

### Options

- **Seller:** visitors always buy from the Node seller. A presenter `/sell` tab is reachable only through the circuit relay and WebRTC, which visitors do not use, so it is not offered on `/try` (builder's call, settled in review). Tabs stay a `/live` stage feature.
- **Explain mode** toggle (captions on by default on first visit, remembered in local storage).
- **Your history:** this browser's past purchases (local storage), each with its receipt.

### States

Every interactive element has hover, active, focus, loading (skeletons shaped like the content), empty, and inline error states. Error copy states cause and next step, for example "Your wallet is on mainnet. Switch it to devnet, then try again."

## Booth fallback

If the venue network or tunnel fails: the presenter opens `/try` on the booth laptop with a booth demo wallet (a wallet standard wallet in a browser profile, funded like any visitor). The page shows "Booth wallet" so it is never passed off as the visitor's own. If devnet itself is down, `/live` replay remains the last resort, labelled REPLAY.

## Left to the builder

- Component structure, file names, and how the visitor state machine is modelled (a reducer like `lib/reduce.ts` fits the codebase).
- Exact copy, within the voice and copy rules above.
- Whether `/visitor/config` (seller multiaddr, price, network, mode) is a swarm endpoint or baked into the page at build time (the tunnel hostname is stable either way).
- How the drip ledger is persisted (a JSON file next to `.keys` is enough).
- The exact tunnel configuration file, written from the topology above.
- Test structure, provided it covers: the facilitator accepting a wallet style signer (version trap), drip limits, the public build containing no token, token endpoints refusing tunnel traffic, and a headless browser run of `/try` in mock mode through a buy.

## Contingency: wallets that add too many instructions (settled in review)

The facilitator's 3 to 7 instruction rule is a payment safety check from x402; it is not loosened in the swarm. If a wallet appends more Lighthouse instructions than the rule allows, that wallet is listed as unsupported on `/try` and the finding is reported upstream.

## Verification

- Automated: the tests above, plus all existing suites (x402-libp2p, ipfs-x402, swarm, web) and `next build`.
- Manual rehearsal (needs funded wallets and the tunnel, both user actions): a phone on mobile data with Phantom, Solflare and Backpack each completing a purchase through the tunnel; record the signed transaction's instruction count (Lighthouse instructions must stay within the 3 to 7 rule), the time from invoice to payment frame, and confirm `/events` streams through the tunnel.
