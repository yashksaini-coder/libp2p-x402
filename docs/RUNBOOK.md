# Booth runbook

Devnet only. Visitors scan a QR code, get 0.01 USDC dripped to their Phantom wallet, and pay for content from a phone.

## One time

```
export TRY_HOST=try.example.com SELLER_HOST=seller.example.com
deploy/tunnel-setup.sh     # prints the cloudflared commands; run them yourself
```

Render `deploy/cloudflared/config.yml.template` with `envsubst` as the script says.

## Start order

Run each in its own terminal, from the repo root.

1. Swarm on devnet (fee payer and USDC funded first):
   `cd js/apps/swarm && SELLER_HOST=$SELLER_HOST TRY_ORIGIN=https://$TRY_HOST SWARM_TOKEN=<secret> node src/main.ts --mode devnet`
2. Public build (empty swarm token, no scene controls). `TRY_HOST` must be exported: the build bakes in
   `https://$TRY_HOST` as the swarm URL (the tunnel routes `/events` and `/visitor` there) and
   `https://$TRY_HOST/try` for the wallet deeplinks, and refuses to build without it:
   `cd js/apps/web && npm run build:public && npm run start:public` (port 3000)
   Check: `grep -rl 127.0.0.1:4402 .next-public/static` finds nothing.
3. Presenter build on localhost, with the token:
   `cd js/apps/web && NEXT_PUBLIC_SWARM_TOKEN=<secret> NEXT_DIST_DIR=.next-presenter npx next dev -p 3005`
4. Tunnel: `cloudflared tunnel --protocol http2 run booth`

Check: `curl -N https://$TRY_HOST/events` streams; `curl -i -X POST https://$TRY_HOST/visitor/pause` returns 403.

## QR code

Encode `https://$TRY_HOST/try` (for example `qrencode -t ansiutf8 "https://$TRY_HOST/try"`).

## Pause switch

Stop all drips: `curl -X POST localhost:4402/visitor/pause -H "Authorization: Bearer <secret>" -d '{"paused":true}'` (`false` to resume). Only works on localhost; tunneled requests get 403.

## Budget

- One drip costs about 0.00205 SOL (token account rent) plus 0.01 USDC.
- 20 USDC funds 2,000 drips; the swarm caps at 500 total, 60 per hour, 3 per IP per hour, one per address.
- Drips refuse when the fee payer holds under 0.1 SOL. Top up before the event.

## Fallbacks

- Tunnel or venue network down: visitors use the booth laptop at `http://localhost:3005/try` with the booth demo wallet (a wallet in a browser profile, funded like any visitor). On localhost the page labels it "Booth wallet", so it is never passed off as the visitor's own.
- Devnet down or out of funds: `cd js/apps/swarm && node src/main.ts --replay <recording.jsonl>` (labelled REPLAY on screen, never live); pause drips first.

## Phone rehearsal (pending)

Not yet run; needs the real tunnel and approval to send devnet transactions. From a phone on mobile data with Phantom:

1. Record the instruction count of the signed transaction.
2. Time from invoice to payment frame.
3. `curl -N https://$TRY_HOST/events` shows streaming.

Save results to `captures/2026-1x-xx-try-rehearsal/`.
