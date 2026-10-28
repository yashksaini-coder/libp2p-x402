# Transport: libp2p

> Status: **draft** (M0), not yet submitted. Target: `coinbase/x402` `specs/transports-v2/libp2p.md`.
> Structure follows `specs/transport_template.md` at x402 commit `0e6e8c5`.
> Reference implementation: [`js/packages/x402-libp2p`](../js/packages/x402-libp2p).

## Summary

The libp2p transport carries x402 payments in-band on a libp2p stream. Any libp2p protocol can be payment-gated. The client pays on the same stream it uses for the application protocol, and the server settles before it delivers anything.

Unlike HTTP, MCP and A2A, neither side needs a publicly reachable server. libp2p peers are dialable behind NAT (hole punching, circuit relay) and from browsers (WebRTC, WebTransport), so an agent can **sell** as well as buy.

Every libp2p connection is authenticated by the peers' identity keys. On Solana networks the payee's PeerId key and its wallet are the same Ed25519 key. The client can therefore check that `payTo` belongs to the peer it is connected to (see [Payee Identity](#payee-identity)).

This transport defines only how existing x402 v2 objects (`PaymentRequired`, `PaymentPayload`, `SettlementResponse`) travel. Schemes, networks and facilitators are unchanged.

## Stream and Framing

- The x402 exchange runs on the stream of the **gated application protocol** (e.g. `/ipfs-x402/pin/1.0.0`), after multistream-select has negotiated it. There is no separate x402 protocol ID.
- Each x402 message is one **frame**: an unsigned-varint length prefix followed by a UTF-8 JSON object. One JSON object per frame.
- Every frame has a `type` string starting with `x402/`.
- Implementations MUST reject an x402 frame larger than 64 KiB. Frames sent by the application after settlement are not x402 frames and are not covered by this limit.

| `type` | Direction | Body field |
| --- | --- | --- |
| `x402/payment-required` | server → client | `paymentRequired`: `PaymentRequired` |
| `x402/request` | client → server | `request`: application object that determines the price (optional step) |
| `x402/payment` | client → server | `paymentPayload`: `PaymentPayload` |
| `x402/settlement` | server → client | `settlementResponse`: `SettlementResponse` |
| `x402/error` | server → client | `code`, optional `message`, optional `paymentRequired` |

## Payment Flow Overview

```
client                                   server
  │── open stream, negotiate /app/1.0.0 ──►│
  │◄──────────── x402/payment-required ────│  (always the server's first frame)
  │  check payTo against remote PeerId     │
  │── x402/payment ───────────────────────►│
  │                                        │  verify → settle (facilitator)
  │◄──────────────────── x402/settlement ──│
  │◄═════════ application protocol ═══════►│
```

## Payment Required Signaling

**Mechanism.** As soon as the gated stream opens, the server writes an `x402/payment-required` frame as its first frame. It does not wait for the client.

Why the server speaks first: a libp2p stream has no request line or headers before application data. If the client spoke first, a server could not tell a client that is about to prepay from one that is waiting for a price. Because the server always speaks first:

- **Price discovery is free.** Open the stream, read one frame, close it. No separate quote protocol is needed.
- **Prepaying still takes one round trip.** A client that already knows the requirements (from an earlier exchange or out of band) MAY write its `x402/payment` frame immediately, without waiting for the server's frame. Both frames are then in flight at the same time. The server MUST still send `x402/payment-required` first, and the client SHOULD read it and check it matches what it paid for.

**Data format.** `paymentRequired` is a v2 `PaymentRequired` object, unchanged. `resource.url` SHOULD be `libp2p://<server PeerId><protocol ID>` (open question: see [Open Questions](#open-questions)).

**Complete requirements.** Each `accepts` entry (in the rate card and in any invoice) MUST already carry every field its scheme adds from the facilitator, exactly as the HTTP transport's resource server produces them. For `exact` on Solana that is `extra.feePayer` and, when the server has an RPC endpoint, a recent blockhash; without `feePayer` an SVM client cannot build the payment. Implementations that build requirements by hand MUST pass them through the scheme's requirement enhancement step before sending them.

**Example** (Solana devnet USDC, `exact`):

```json
{
  "type": "x402/payment-required",
  "paymentRequired": {
    "x402Version": 2,
    "resource": {
      "url": "libp2p://<server PeerId>/ipfs-x402/fetch/1.0.0",
      "description": "Fetch a private DAG as CAR",
      "mimeType": "application/vnd.ipld.car"
    },
    "accepts": [
      {
        "scheme": "exact",
        "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        "amount": "1000",
        "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        "payTo": "<base58 of the server PeerId's Ed25519 public key>",
        "maxTimeoutSeconds": 60,
        "extra": { "feePayer": "<facilitator sponsor address>" }
      }
    ]
  }
}
```

### Invoices: pricing a specific request

The first `x402/payment-required` is a **rate card**: it is sent before the server knows what the client wants. Some protocols can only price a request once they see it. For example, a fetch is priced on the size of the requested DAG, and its memo names the root CID. For these:

1. After reading the rate card, the client MAY send one `x402/request` frame carrying the application's request object, without paying.
2. The server answers with a further `x402/payment-required` frame, the **invoice**, or with `x402/error` if it refuses the request.
3. **A later `x402/payment-required` supersedes every earlier one on the stream.** The client pays the latest one, and the server matches the payment against it.
4. The client MUST apply the [payee identity](#payee-identity) check to the invoice it pays, not only to the rate card.

A server that does not support invoices answers `x402/request` with `x402/error` `invalid_frame`.

## Payment Payload Transmission

**Mechanism.** The client writes one `x402/payment` frame on the same stream. Application request frames, if any, follow it.

**Data format.** `paymentPayload` is a v2 `PaymentPayload`, unchanged. Its `accepted` field MUST be one of the `accepts` entries the server sent.

**Example** (SVM `exact`: a transaction partially signed by the client; the sponsor adds the `feePayer` signature at settlement):

```json
{
  "type": "x402/payment",
  "paymentPayload": {
    "x402Version": 2,
    "accepted": {
      "scheme": "exact",
      "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      "amount": "1000",
      "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      "payTo": "<server key, base58>",
      "maxTimeoutSeconds": 60,
      "extra": { "feePayer": "<facilitator sponsor address>" }
    },
    "payload": { "transaction": "<base64 partially-signed transaction>" }
  }
}
```

## Settlement Response Delivery

**Mechanism.** After verifying and settling through its facilitator, the server writes one `x402/settlement` frame. Application data follows it on the same stream.

**Ordering.** A stream cannot recall bytes it has already delivered, so the server MUST settle **before** it sends any paid content. This differs from the HTTP transport, where the handler may run before settlement. Concretely:

- **Delivery protocols** (e.g. fetch): verify → settle → `x402/settlement` → content.
- **Protocols where the price depends on the request body** (e.g. pin with `upto`): verify → receive the body → settle the actual amount → `x402/settlement` → application response. The server MUST NOT do the paid work in a way the client can observe before settlement succeeds.

**Example** (success):

```json
{
  "type": "x402/settlement",
  "settlementResponse": {
    "success": true,
    "transaction": "<base58 transaction signature>",
    "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    "payer": "<client wallet address>"
  }
}
```

A failed settlement is reported as an `x402/error` frame (below), not as an `x402/settlement` frame with `success: false`, so the client never mistakes a failure for a delivery.

## Payee Identity

Before creating a payment, the client MUST check every requirement it might pay against the **remote peer of the authenticated connection**:

- **`solana:*` networks.** If the remote PeerId has an Ed25519 key, the payee address is the base58 (bitcoin alphabet, no multibase prefix) encoding of the raw 32-byte public key. The client MUST discard any requirement whose `payTo` differs. If the remote PeerId has a non-Ed25519 key, all `solana:*` requirements are discarded.
- **Other networks, or operators who keep the node key and wallet separate.** The requirement MUST carry `extra.payeeBinding`, a libp2p [signed envelope](https://github.com/libp2p/specs/blob/master/RFC/0002-signed-envelopes.md) from the server's PeerId over `{ peerId, network, payTo, expiry }`. The client discards the requirement if the envelope is missing, expired, or signed by a key other than the remote peer's. *(Envelope domain and payload type: TBD.)*
- If no requirement survives, the client MUST NOT sign anything. It closes the stream and reports `payee_mismatch` locally.

Because `payTo` is the owner of the receiving token account, the payee's key never signs on-chain to get paid. An operator can keep the node key online and sweep funds from it to cold storage.

## Error Handling

**Mechanism.** The server writes one `x402/error` frame and then **closes** its side of the stream. It does not reset the stream: a reset can throw away the error frame before it reaches the client. `code` uses the x402 v2 error reason strings where one exists. For payment errors, the frame SHOULD carry a fresh `paymentRequired` so the client can retry on a new stream.

| Condition | `code` | `paymentRequired` |
| --- | --- | --- |
| Valid x402 frame, but the wrong type for this step | `invalid_frame` | no |
| `accepted` matches none of the offered requirements | `no_matching_requirements` | yes |
| Facilitator verification failed | the facilitator's `invalidReason` (e.g. `invalid_signature`) | yes |
| Settlement failed | the facilitator's `errorReason`, else `settlement_failed` | yes |
| Request exceeds the paid bound (e.g. DAG larger than `maxBytes`) | `resource_too_large` | yes |
| (client-local) no requirement passes [Payee Identity](#payee-identity) | `payee_mismatch` | n/a |

**Example:**

```json
{
  "type": "x402/error",
  "code": "invalid_signature",
  "message": "Payment verification failed",
  "paymentRequired": { "x402Version": 2, "resource": { "url": "…" }, "accepts": [ … ] }
}
```

Unrecoverable stream problems (malformed varint, frame over 64 KiB, frame that is not UTF-8 JSON or has no `x402/` type, timeout) are handled by resetting the stream. No x402 frame is sent.

## Security Considerations

- **Free `PaymentRequired` frames.** The first frame costs the server nothing to send, and it is sent to anyone who opens the stream. Servers SHOULD rate-limit per peer, using libp2p's connection manager and resource manager.
- **Waiting for payment.** Servers MUST bound how long they wait for `x402/payment` (the reference implementation waits 30 s), so idle streams cannot pin resources.
- **Key reuse.** On Solana the node identity key also receives funds. libp2p signs with domain-separated prefixes, so a libp2p signature cannot be replayed as a Solana transaction signature. Operators who want separate keys use `extra.payeeBinding`.

## Open Questions

1. `resource.url` form: `libp2p://<peerId><protocol>`, or a multiaddr such as `/p2p/<peerId>/x402/<protocol>`?
2. JSON vs protobuf framing. JSON is proposed because the x402 schemas are JSON and the MCP and A2A transports also carry JSON.
3. Whether to also propose this to `libp2p/specs`.

## References

- [Core x402 Specification v2](../x402-specification-v2.md)
- [SVM `exact` scheme](../schemes/exact/scheme_exact_svm.md), [SVM `upto` scheme](../schemes/upto/scheme_upto_svm.md)
- [libp2p peer IDs](https://github.com/libp2p/specs/blob/master/peer-ids/peer-ids.md)
- [libp2p signed envelopes (RFC 0002)](https://github.com/libp2p/specs/blob/master/RFC/0002-signed-envelopes.md)
- [multistream-select](https://github.com/multiformats/multistream-select)
