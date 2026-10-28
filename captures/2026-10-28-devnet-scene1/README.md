# First devnet payment: scene 1, 2026-10-28

An agent bought the demo dataset from a seller peer over libp2p and paid it in Solana devnet USDC with x402 `exact`. Code at the commit that adds this capture; swarm run with `node src/main.ts --mode devnet --no-kubo --record …`.

| | |
|---|---|
| Transaction | [`2xUPxmUc…AhmxL`](https://explorer.solana.com/tx/2xUPxmUc5bRN12oGReCrhnmA6nb3wqBYmFe1CQBh5CsLEwrdKHcjQLm9ZZngq2PDqPYbJarLbmN8Ss766i7AhmxL?cluster=devnet) |
| Slot / status | 516131360, finalized, no error |
| Amount | 0.002124 USDC (2124 atomic), agent `HapBbZ8e…e9o9` → seller `45YPm5S2…TTVM` |
| Fee | 10,001 lamports, paid by the facilitator fee payer `J1kyPS3u…jArx` (the agent holds no SOL) |
| Compute | 18,496 of the 20,000 units x402 sets |
| Memo | `QmcXofqbpDDSmWA9p2kjPzVk67eFrFKDtRyHX2GdLG7AqE`, the dataset root as CIDv0 |
| Data | 221,362 bytes, 15 blocks, every block hash checked against its CID before use |

## Timeline (from `events.jsonl`, ms after the scene started)

| ms | event |
|---|---|
| 0 | TCP connection agent → seller |
| 415 | rate card: 0.01 USDC per MiB |
| 550 | invoice: 2124 atomic, memo = root CID; payee check: `payTo` equals the seller's PeerId key |
| 681 | payment signed by the agent and sent on the stream |
| 1063 | facilitator submits the transaction (timer starts) |
| +495 | processed |
| +866 | confirmed and finalized, seen in the same status poll |
| 1961 | all 15 blocks received and verified; scene done |

## Files

- `events.jsonl`: every swarm event of the run (the dashboard's input; replayable with `--replay`).
- `transaction.json`: `getTransaction` (jsonParsed, finalized) from the public devnet RPC.
- `signature-status.json`: `getSignatureStatuses` after the run.
- `balances-before.txt`, `balances-after.txt`: SOL (lamports) and USDC per role. Agent 20 → 19.997876, seller 0 → 0.002124, fee payer −10,001 lamports.
- `dataset.jsonl`: the bytes that were bought. Re-importing them with 16 KiB chunks gives root `bafybeigs34rvgpu2tieobp2hgh53j4m673maw7ml6ousm5tevdj6lkjioe`, whose CIDv0 is the memo.
- `swarm.log`: swarm stdout (control token redacted).

## The two failed attempts before it

Both are kept beside this folder. Neither submitted a transaction; no funds moved.

1. `…-attempt1-feepayer-missing`: the agent refused to build the payment, `feePayer is required in paymentRequirements.extra`. Cause: `paid()` in `x402-libp2p` sent requirements without running the scheme's `enhancePaymentRequirements`, which is where `@x402/svm` adds the facilitator fee payer and a recent blockhash. Fixed by passing every requirement through `server.buildPaymentRequirements`; spec now requires complete requirements.
2. `…-attempt2-memo-simulation`: facilitator simulation failed at the Memo instruction, `ProgramFailedToComplete`. Measured by simulation: devnet's Memo program costs ~355 CU per byte (1 byte 1,773 CU; 32 bytes 12,775; 46 bytes 18,091) and x402 `exact` fixes the limit at 20,000 CU, so the 64 byte `ipfs:<CIDv1>` memo could never land. Fixed by writing the memo as the root's CIDv0 (46 bytes). Upstream note: x402 allows memos up to 256 bytes but its fixed compute limit only fits about 50.
