# libp2p-x402

**Paid IPFS between peers: agents pay for storage and data with Solana USDC over libp2p, with no HTTP server, no API key and no single storage vendor.**

Working name; rename freely. Origin: Yash Saini × Manu Sheel Gupta, goal "bring libp2p into the Solana ecosystem", first concrete task "IPFS over x402 on Solana". Status: design, October 2026.

This is a **new project**. Contributions to the existing toju / `seetadev/IPFS-Solana-SDK` codebase are tracked separately in `HANDOFF.md`; toju becomes this project's first integration, not its home.

> **Implementation notes (2026-10-26)** — where the built code refines this design. The spec in `spec/libp2p.md` is normative.
> - §5.3: the server **always** sends `x402/payment-required` as its first frame (it cannot tell a prepaying client from a waiting one on a libp2p stream). Prepaying still costs one round trip because both frames are in flight at once.
> - §5.3: after `x402/error` the server **closes** the stream rather than resetting it; a reset can drop the error frame in flight.
> - §5.3: `resource` uses the v2 `ResourceInfo.url` field (`libp2p://<peerId><protocol>`); v2 has no `protocol` field.
> - §5.3: settlement failure is an `x402/error` frame, never an `x402/settlement` with `success: false`.

---

## 1. The problem

AI agents increasingly pay for what they use, and x402 has become the standard way to do it: a server answers `402 Payment Required`, the agent signs a stablecoin payment, a facilitator settles it on-chain. Solana is a natural settlement layer for this (sub-second finality, sub-cent fees, native USDC).

But today, three things are still missing:

1. **x402 only works where there is a server.** Its v2 spec defines three transports: HTTP, MCP and A2A. All three assume one side runs a reachable server. Most agents run on laptops, behind NAT, in browsers or in short-lived sandboxes. They can pay, but they cannot be paid.
2. **"Decentralized storage" on these stacks is usually one company's API.** Content is addressed by CID, but the bytes live with a single pinning provider. When that provider changes or disappears, the CID still exists and nothing serves it.
3. **Payments and data are not cryptographically tied together.** Over HTTP, the `payTo` address is whatever the server says it is, and the data you receive is whatever it sends. Nothing proves you paid the party that delivered the bytes, or that the bytes are the ones you paid for.

libp2p already solves reachability, identity and verified content transfer. It is the networking layer under IPFS, Filecoin and Ethereum's consensus clients. Solana's validator network uses its own stack, so at the application layer the two ecosystems barely meet. This project connects them.

---

## 2. What we are building

Four deliverables, in dependency order:

| # | Deliverable | What it is | Upstream target |
| --- | --- | --- | --- |
| 1 | **x402 libp2p transport spec** | `transports-v2/libp2p.md`: how x402 `PaymentRequired`, `PaymentPayload` and `SettlementResponse` travel over a libp2p stream | [coinbase/x402](https://github.com/coinbase/x402) `specs/transports-v2/`, following its `transport_template.md` |
| 2 | **js binding** (`x402-libp2p`) | A js-libp2p service that payment-gates **any** libp2p protocol, plus the client side that pays automatically. The libp2p equivalent of `@x402/express` + `@x402/fetch` | npm |
| 3 | **Paid IPFS** (`ipfs-x402`) | Two protocols on a Helia node: pay a peer to **pin** a DAG, pay a peer to **fetch** one. Solana USDC first. | npm |
| 4 | **py binding** | The same transport in py-libp2p, reusing the x402 Python SDK's `svm` mechanism. Proves the spec is language-neutral. | py-libp2p ecosystem / PyPI |

Plus: an agent CLI demo, a devnet interop test suite (js ↔ py), and toju as the first production provider.

---

## 3. Why build it: the strong reasons

**1. It fills a gap in an official, governed standard, through the front door.**
x402 v2 separates its core from its transports and ships a template for adding new ones (`specs/transport_template.md`). HTTP, MCP and A2A exist; libp2p does not. x402 is now governed by a Technical Steering Committee (Coinbase, Cloudflare, Stripe and others) under a technical charter dated March 31, 2026. A libp2p transport spec is a well-scoped contribution with a defined path to acceptance, not a fork or a competing protocol.

**2. It turns agents from buyers into sellers.**
libp2p peers are dialable without a public server: NAT hole punching, circuit relays, WebRTC and WebTransport for browsers. Over this transport, an agent on a laptop can sell a dataset, a model checkpoint or a cached result to another agent and get paid in USDC. HTTP-based x402 cannot do that. This is the shift from agent-to-API commerce to agent-to-agent commerce.

**3. One key is both the wallet and the network identity.**
Solana keypairs and libp2p peer identities are both Ed25519. A provider's PeerId therefore *contains* the public key its USDC is paid to. The client checks that the `payTo` in the payment request matches the peer on the other end of the authenticated, encrypted connection. A malicious proxy or compromised config can't swap the payee, a class of attack HTTP x402 has to defend against separately. This works only because of the Solana + libp2p pairing.

**4. You pay for verified bytes, not promises.**
IPFS data is content-addressed: every block is checked against its hash. Paying for a CID and receiving hash-verified blocks means a provider cannot deliver corrupted or substituted data and still get paid without being caught. Payment, identity and data integrity are all checked by cryptography, without trusting the server.

**5. Vendor risk is real, and toju already hit it.**
toju itself had to migrate storage backends: its commit `ca04dba` (2026-04-06) reads *"pinata migration due to storacha's foreclosure"*. Every service that stores data through one pinning API carries this risk. With paid pinning between peers, storage becomes a market: an agent asks several providers for a price, pays one, and can move because the CID is identical everywhere.

**6. Solana's economics make per-request payments work.**
Paying $0.0001 for one retrieval is unworkable on L1 Ethereum and routine on Solana. The CDP facilitator supports Solana mainnet and devnet with both the `exact` and `upto` schemes, and `@x402/svm` (TypeScript) and the x402 Python SDK (`mechanisms/svm`) already implement them. The payment side is solved; this project adds the network side.

**7. It is a real bridge, not a logo swap.**
"libp2p in Solana" usually means a slide. Here it is concrete: Solana settles, libp2p moves and verifies, IPFS addresses. Each layer does what it is best at, and the integration point is a published spec that other implementations can follow.

---

## 4. Benefits by stakeholder

| Who | What they get |
| --- | --- |
| Agent developers | Pay or get paid by any peer with one SDK call; no servers, accounts or API keys; works from browsers and behind NAT |
| Storage providers | Sell pinning and retrieval to anyone on the network; paid in USDC per use; no platform cut beyond facilitator fees |
| Solana ecosystem | A native storage and data market settled in Solana USDC; new demand for USDC micro-transactions from agents |
| libp2p ecosystem | A payment primitive any libp2p protocol can use; a reason for Solana-native teams to adopt libp2p |
| x402 ecosystem | Its first peer-to-peer transport; coverage of agents that cannot host HTTP |
| IPFS users | Data that survives any single provider; paid persistence with verifiable receipts |
| toju / seetadev | Becomes a provider on an open network rather than a single service; reference integration for the spec |

---

## 5. Design

### 5.1 Decisions, and why

| Decision | Choice | Reason |
| --- | --- | --- |
| Message schemas | Reuse x402 v2 `PaymentRequired`, `PaymentPayload`, `SettlementResponse` unchanged | Existing wallets, schemes (`@x402/svm`) and facilitators work as-is; the spec only defines transport |
| Framing | Unsigned-varint length prefix + UTF-8 JSON, one object per frame | x402 schemas are JSON; MCP and A2A transports also carry JSON; length-prefixing is the libp2p norm |
| Gating model | Wrap any app protocol (`paid(handler, requirements)`), in-band on its own stream | No separate negotiation protocol; one stream, one round trip when the client already knows the price |
| Price discovery | The in-band `PaymentRequired` frame *is* the quote; client may read it and close | No extra `/quote` protocol to spec and maintain |
| Payee identity | For `solana:*`, `payTo` MUST equal the Ed25519 key in the server's PeerId; other networks use a signed binding record | Authenticated payee for free on Solana (reason 3) |
| Settlement order | Verify → settle → deliver, for anything that cannot be taken back | HTTP x402 settles after the handler runs; on a stream, delivered bytes cannot be recalled |
| Pricing scheme | `upto` for pins (pay actual size), `exact` for fetches | Size is only known after the DAG is received |
| Data format | CAR over the same stream for v1 | Self-verifying against the root CID; no changes to Bitswap |
| First network | Solana devnet, then mainnet; EVM supported by the same code path | Matches the project goal; x402's multi-network design keeps others cheap |

### 5.2 Architecture

```
  ┌──────────────────────┐                 ┌──────────────────────────────────┐
  │  Agent (any peer)    │  libp2p stream  │  Provider peer                   │
  │                      │  Noise + Yamux  │                                  │
  │  x402-libp2p client  │◄───────────────►│  x402-libp2p server (gates any   │
  │  @x402/svm signer    │ TCP/QUIC/WebRTC │  protocol) → ipfs-x402 handlers  │
  │  PeerId = wallet key │  relay, holepunch│ PeerId = payTo key               │
  └──────────────────────┘                 │        │                 │       │
                                           │        ▼                 ▼       │
                                           │   Helia node       Facilitator   │
                                           │   (pin, DHT,       client (HTTPS)│
                                           │    Bitswap)                      │
                                           └────────┼─────────────────┼───────┘
                                                    │                 │
                                     provide CIDs   ▼                 ▼  settle
                                     ┌─────────────────────┐   ┌──────────────┐
                                     │ Public IPFS network │   │ Solana (USDC)│
                                     │ Kubo, gateways, ... │   └──────────────┘
                                     └─────────────────────┘
```

The facilitator and Solana see only the payment. The data never leaves the peer-to-peer connection until it is pinned and announced.

### 5.3 The transport binding (spec draft, mapped to the x402 template)

**Payment required signaling.** When a client opens a gated protocol without a payment, the server's first frame is:

```json
{ "type": "x402/payment-required", "paymentRequired": { "x402Version": 2, "accepts": [ {
  "scheme": "upto", "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "amount": "50000", "asset": "<USDC mint>", "payTo": "<base58 key from server PeerId>",
  "maxTimeoutSeconds": 300 } ], "resource": { "protocol": "/ipfs-x402/pin/1.0.0" } } }
```

The stream stays open; the client either pays on the same stream or closes it.

**Payment payload transmission.** The client sends `{ "type": "x402/payment", "paymentPayload": { … } }`, followed by the app's request frames (for a pin, the CAR). A client that already knows the requirements may send the payment as its first frame and skip a round trip.

**Settlement response delivery.** After settling through its facilitator, the server sends `{ "type": "x402/settlement", "settlementResponse": { … } }` carrying the on-chain transaction. For deliveries (fetch), this frame comes **before** the data. For pins, it comes after the CAR is verified and settled, followed by the app's response (pinned CID, receipt CID).

**Error handling.** `{ "type": "x402/error", "code": "…", "message": "…", "paymentRequired"?: { … } }` then stream reset. Codes mirror the HTTP transport's failure cases (invalid payment, insufficient amount, settlement failed, payee mismatch, resource too large). A payment error may carry a fresh `paymentRequired` so the client can retry.

**Identity rule.** Before signing, the client MUST check `payTo` against the remote peer's Ed25519 public key from the authenticated connection (Solana networks), or verify `extra.payeeBinding`, a libp2p signed envelope `{ peerId, network, payTo, expiry }` (other networks, or operators who keep wallet and node keys separate).

### 5.4 Paid IPFS on top (`ipfs-x402`)

- **`/ipfs-x402/pin/1.0.0`**: request `{ root, maxBytes, durationDays }`, priced `upto`. Server receives the CAR, checks every block hashes to the root, measures the DAG, settles the actual amount, pins it in Helia, provides the root to the DHT, and replies `{ pinned: root, expiresAt, receipt: <CID> }`.
- **`/ipfs-x402/fetch/1.0.0`**: request `{ root }`, priced `exact`. Server settles, then streams the CAR. Public content can stay free over normal Bitswap; this protocol is for private or premium data.
- **Receipts**: a small DAG `{ cid, payer, payee, network, tx, bytes, expiresAt }`, pinned and returned by CID. Anyone can check it against the on-chain transaction.
- **Discovery**: providers advertise the protocols via identify and provide a well-known DHT key per protocol; agents find several, read their `PaymentRequired` frames, and choose.

---

## 6. Repo layout and stack

```
libp2p-x402/
  spec/libp2p.md               # becomes coinbase/x402 specs/transports-v2/libp2p.md
  js/packages/x402-libp2p      # generic gate + paying client
  js/packages/ipfs-x402        # pin/fetch protocols on Helia
  js/examples/agent-cli        # store / fetch / sell from a terminal
  py/x402_libp2p               # py-libp2p binding (mirrors x402 python/mcp layout)
  interop/                     # js ⇄ py tests on Solana devnet
```

- **TypeScript:** js-libp2p, Helia, `@helia/unixfs`, `@ipld/car`, `@x402/core`, `@x402/svm`, `@solana/kit`
- **Python:** py-libp2p, `x402` Python SDK (`mechanisms/svm`)
- **Infra:** Solana devnet + Circle devnet USDC, CDP or a self-hosted facilitator

---

## 7. Relationship to toju and the PRs

| Track | Where | Purpose |
| --- | --- | --- |
| Contributions (`HANDOFF.md`) | `seetadev/IPFS-Solana-SDK` | Fix toju's x402 bugs, add Solana USDC to its HTTP agent endpoint, add Helia as a storage backend |
| This project | new repo | The spec, the bindings and the paid-IPFS protocols |
| Integration | toju server | toju runs `ipfs-x402` as a provider: first real node on the network, reference deployment for the spec |

The toju work comes first, both to build credibility and because its Helia backend is the same code a provider needs.

---

## 8. Milestones

Estimates for part-time work; each gate must pass before the next milestone starts.

| # | Milestone | Gate |
| --- | --- | --- |
| M0 | Spec draft + early feedback from libp2p and x402 maintainers | Draft reviewed by at least one maintainer from each side |
| M1 | `x402-libp2p` js: paid echo protocol on devnet | Two js peers complete a paid exchange; tx visible on Explorer |
| M2 | `ipfs-x402`: paid pin and fetch on Helia | Content pinned through the protocol is fetchable from a stock Kubo node |
| M3 | py binding + interop | A py-libp2p client pins to a js provider on devnet |
| M4 | toju as provider + spec PR upstream + public demo | PR open on `coinbase/x402`; live demo (Devcon 8 India hub is a natural venue) |

Rough total: 8–10 weeks after the toju PRs in `HANDOFF.md` land.

---

## 9. How we know it worked

- A libp2p transport spec is under review in `coinbase/x402`.
- js and py peers interoperate on devnet with real USDC settlement.
- An agent behind NAT sells data to another agent with no server on either side (demo).
- Every pin produces a receipt that resolves and matches an on-chain transfer.
- Stretch: one provider besides toju runs `ipfs-x402`.

---

## 10. Non-goals (v1)

- No new token, no on-chain storage proofs (Filecoin already does this; it can be a backend later).
- No per-block micropayments: price per DAG; consider `batch-settlement` later.
- No changes to Bitswap or the DHT protocols.
- No mainnet launch before the spec has outside review.

---

## 11. Risks and open questions

| Risk | Mitigation |
| --- | --- |
| x402 TSC declines or reshapes the transport | Engage before writing code (M0); ship as an independent spec if needed, since it works either way |
| Facilitator dependency | Configurable facilitator; evaluate self-hosting (e.g. Kora) |
| Reusing one key for wallet and node identity | Domain separation exists (libp2p signs prefixed payloads); allow separate keys via the signed binding record |
| Free `PaymentRequired` frames as a DoS vector | Per-peer rate limits via libp2p's connection manager and resource limits |
| Helia / js-libp2p API churn | Pin versions; interop tests in CI |

Open questions:

- Final name, and where the repo lives (own org, seetadev, or libp2p ecosystem).
- JSON framing vs protobuf: JSON for v1 is the proposal; revisit if maintainers prefer protobuf.
- Should the spec also be proposed to `libp2p/specs`, or only to x402?

---

## 12. References

- x402 v2 spec and transports: https://github.com/coinbase/x402/tree/main/specs
- Transport template: https://github.com/coinbase/x402/blob/main/specs/transport_template.md
- Solana x402 guide: https://solana.com/docs/payments/agentic-payments/x402.md
- CDP network support: https://docs.cdp.coinbase.com/x402/network-support
- libp2p docs: https://docs.libp2p.io/ · peer IDs: https://github.com/libp2p/specs/blob/master/peer-ids/peer-ids.md
- Helia: https://github.com/ipfs/helia · js-libp2p: https://github.com/libp2p/js-libp2p · py-libp2p: https://github.com/libp2p/py-libp2p
- toju (first integration): https://github.com/seetadev/IPFS-Solana-SDK
- Project write-up (toju audit and plan): https://claude.ai/artifact/14pcYxTThaQJpn9KRzdfVM
