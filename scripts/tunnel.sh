#!/usr/bin/env bash
# Expose Shadow's instruction endpoint over a Cloudflare Tunnel for remote access.
#
# SECURITY: this lets a remote caller drive THIS computer. A token is required,
# the tunnel is ephemeral, and you should Ctrl-C it the moment you're done.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

read_env() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' \r'; }

PORT="$(read_env SHADOW_HTTP_PORT)"; PORT="${PORT:-8765}"
TOKEN="$(read_env SHADOW_HTTP_TOKEN)"

if [ -z "$TOKEN" ]; then
  echo "Refusing to expose the endpoint: SHADOW_HTTP_TOKEN is not set in .env." >&2
  echo "Anyone with the public URL could control this computer. Set a token first:" >&2
  echo "  echo \"SHADOW_HTTP_TOKEN=\$(openssl rand -hex 24)\" >> .env" >&2
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install it with: brew install cloudflared" >&2
  exit 1
fi

if ! curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "Warning: http://127.0.0.1:${PORT}/health is not reachable." >&2
  echo "Start the app first (npm run dev), then re-run this." >&2
fi

cat <<EOF

Starting a Cloudflare Tunnel to http://127.0.0.1:${PORT}
When the https://<name>.trycloudflare.com URL appears below, call it like:

  curl -X POST https://<name>.trycloudflare.com/instructions \\
    -H "Authorization: Bearer ${TOKEN}" \\
    -H "Content-Type: application/json" \\
    -d '{"instructions": ["open Notes", "type hello"]}'

Press Ctrl-C to stop exposing this computer.

EOF

exec cloudflared tunnel --url "http://127.0.0.1:${PORT}"
