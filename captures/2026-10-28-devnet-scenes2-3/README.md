# Devnet scenes 2 and 3, 2026-10-28

One swarm session (`node src/main.ts --mode devnet --record …`, stock Kubo on), scene 2 then scene 3. Code at `e4d0324`.

## Scene 2: a tampered upload is rejected before payment

| ms | event |
|---|---|
| 0 | TCP connection agent → provider |
| 320 | rate card |
| 410 | invoice: 4029 atomic, memo `QmdZjUMbz3ZMwtQMrHuqh7p4wkYcZgNc1YA3GcqjY1ALP2`; payee check ok (`7zpeH2MK…2LVJ`) |
| 507 | payment `pay-1` signed and sent |
| 611 | provider rejects: `resource_invalid`, block 13 does not match its hash. Nothing settled. |

`pay-1` has no `tx` event, and the agent's USDC did not change for it: the signed payment was never submitted.

## Scene 3: pay a peer to keep it, then a stock IPFS node fetches it

| ms | event |
|---|---|
| 0 | TCP connection agent → provider |
| 185 | invoice: 4029 atomic (0.004029 USDC), same memo; payee check ok |
| 187 | payment `pay-2` |
| 481 | transaction submitted |
| +441 | processed |
| +785 | confirmed and finalized (same poll) |
| 1598 | pinned; receipt `baguqeerauvulea3vsnpk4kzhua5fjt7j2axhm434hr2vfa5vmmvi6jagh24a`, expires 2026-11-27 |
| 2169 | stock Kubo node fetched all 27 blocks from the provider over Bitswap in 562 ms |

Transaction [`38GfwMFJ…C1qceY`](https://explorer.solana.com/tx/38GfwMFJChSUJTZxfyPpaYdJHoU3KCnbxSGFHMpVD6DzbQ4hWUSRWaP1oPkVUXt9iTYYpysgZkbjYp5U7EC1qceY?cluster=devnet): slot 516132056, finalized, no error, fee 10,001 lamports (fee payer), 18,496 CU, memo `QmdZjUMb…ALP2`.

Receipt (dag-json, stored in the provider's Helia): cid `bafybeihche6wpslyiom6tsurp5x37xxa32ztd4ozcrewzffw7rdrb7mp6e`, payer agent `HapBbZ8e…e9o9`, payee provider `7zpeH2MK…2LVJ`, tx as above, 422,416 bytes, expires 2026-11-27T17:36:16.536Z.

## Balances (`balances-before.txt` → `balances-after.txt`)

- Agent USDC 19.997876 → 19.993847 (−0.004029: scene 3 only)
- Provider USDC 0 → 0.004029
- Fee payer 2,997,003,119 → 2,996,993,118 lamports (−10,001: one transaction)

## Files

`events.jsonl` (all events, replayable), `transaction-scene3.json`, `signature-status-scene3.json`, `balances-*.txt`, `swarm.log` (control token redacted).
