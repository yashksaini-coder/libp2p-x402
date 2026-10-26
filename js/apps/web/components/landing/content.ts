export const COMPARE: Array<[string, string, string]> = [
  ['Who can sell', 'A web server at a public URL', 'Any peer, addressed by its PeerId'],
  ['Who speaks first', 'The client requests, the server answers 402 Payment Required', 'The server sends its price the moment the stream opens'],
  ['Who gets paid', 'Whatever payTo the server config says', 'payTo must equal the remote PeerId key, checked before signing'],
  ['Behind NAT', 'Needs a public IP, a domain and TLS', 'Circuit relay first, then a direct WebRTC upgrade'],
  ['Where the payment travels', 'A header on a retried HTTP request', 'Frames on the same encrypted libp2p stream'],
]

export const STEPS = [
  {
    title: 'Quote',
    body: 'The provider speaks first with a rate card. The agent names a root CID and gets an invoice with the exact amount and the memo ipfs: plus that CID.',
  },
  {
    title: 'Pay',
    body: 'The agent checks payTo against the remote PeerId key, signs a USDC transfer on Solana and sends it on the same stream. No HTTP round trip.',
  },
  {
    title: 'Settle and deliver',
    body: 'Fetch settles, then streams blocks. Pin streams every block, verifies each hash, then settles, pins and returns a receipt CID that names the transaction.',
  },
]

export const FAQ: Array<[string, string]> = [
  [
    'What is x402?',
    'An open payment protocol that revives HTTP 402 Payment Required. A server states a price, the client answers with a signed stablecoin transfer, and a facilitator verifies and settles it. Version 2 keeps the payment format separate from the transport, which is what lets the same payloads run over libp2p.',
  ],
  [
    'Why libp2p instead of HTTP?',
    'Agents rarely have a domain, a certificate or an open port. libp2p gives every node an identity key, encrypted streams, relays for peers behind NAT and direct WebRTC upgrades, so a laptop or a browser tab can sell data without hosting anything.',
  ],
  [
    'Why Solana?',
    'A transfer costs a fraction of a cent and is confirmed in under a second, so paying per file is practical. Solana wallets also use Ed25519, the same key type as libp2p peers, which is what lets one key be both the PeerId and the wallet.',
  ],
  [
    'How can a PeerId be a wallet?',
    'An Ed25519 PeerId embeds the raw 32 byte public key. Encode that key in base58 and you have a Solana address. The agent decodes the remote PeerId, compares it with payTo and refuses to sign if they differ. Operators who want separate keys can send a signed payee binding instead.',
  ],
  [
    'What if a provider takes the money and sends bad bytes?',
    'Pin is safe today: the provider verifies every block before it settles, so a bad upload never costs anyone. Fetch is not yet: the agent pays first and verifies after, so a cheating provider is caught but the money is gone. Payment channels that pay per verified chunk are next.',
  ],
  [
    'Does it need a server?',
    'No HTTP server and no public IP for buyers or sellers. A peer behind NAT needs a relay to be reached the first time, and settlement needs a Solana RPC node. In the demo the facilitator that submits transactions runs inside the swarm process on the same laptop.',
  ],
  [
    'Is it on mainnet?',
    'No. Everything settles on Solana devnet with devnet USDC. The dashboard labels every run as live devnet, mock or replay, and never shows a replay as live.',
  ],
  [
    'How is this different from Betar?',
    'Betar is an agent marketplace that runs x402 over libp2p streams and pays in USDC on an EVM chain. This project settles on Solana, adds paid IPFS pin and fetch with per block verification and receipts, and writes the libp2p transport spec for x402 v2.',
  ],
]
