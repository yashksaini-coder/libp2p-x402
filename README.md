# libp2p-x402

x402 payments over libp2p streams. Agents pay each other in Solana USDC for any libp2p protocol, starting with paid IPFS pinning and retrieval. Neither side needs an HTTP server.

On Solana, a libp2p peer's Ed25519 identity key is also its wallet. A client therefore refuses to sign a payment whose `payTo` is not the key of the peer it is connected to.

| Path | What | Status |
| --- | --- | --- |
| [`spec/libp2p.md`](spec/libp2p.md) | x402 v2 transport spec for libp2p (target: `coinbase/x402` `specs/transports-v2/`) | draft (M0) |
| [`js/packages/x402-libp2p`](js/packages/x402-libp2p) | `paid()` gate for any js-libp2p protocol + `payAndOpen()` paying client | working, offline tests (M1 minus devnet) |
| `js/packages/ipfs-x402` | paid pin / fetch on Helia | M2 |
| `py/` | py-libp2p binding | M3 |
| [`docs/DESIGN.md`](docs/DESIGN.md) | full design: problem, decisions, milestones, risks | |

## Quick look

```ts
import { paid, payAndOpen } from 'x402-libp2p'

// provider: gate a protocol
node.handle('/echo/1.0.0', paid(resourceServer, { accepts, resource }, async ({ lp }) => {
  await lp.write(await lp.read())
}))

// agent: pay and use it
const { lp, settlement } = await payAndOpen(agent, providerAddr, '/echo/1.0.0', x402Client)
```

`resourceServer` and `x402Client` are the stock `@x402/core` objects, so `@x402/svm` and any facilitator plug in unchanged.

## Develop

Node ≥ 23.6 runs the TypeScript directly, so there is no build step.

```bash
cd js/packages/x402-libp2p && npm install && npm test && npm run typecheck
```
