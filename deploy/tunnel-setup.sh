#!/usr/bin/env bash
# Prints the one-time Cloudflare tunnel commands. Does not run them.
set -euo pipefail
: "${TRY_HOST:?set TRY_HOST, e.g. try.example.com}"
: "${SELLER_HOST:?set SELLER_HOST, e.g. seller.example.com}"
cat <<CMDS
cloudflared tunnel login
cloudflared tunnel create booth
cloudflared tunnel route dns booth $TRY_HOST
cloudflared tunnel route dns booth $SELLER_HOST

# then render the config (TUNNEL_ID is printed by "create") and run:
TUNNEL_ID=<id> envsubst < deploy/cloudflared/config.yml.template > ~/.cloudflared/config.yml
cloudflared tunnel --protocol http2 run booth
CMDS
