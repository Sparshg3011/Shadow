#!/usr/bin/env bash
# Expose the Deadbolt orchestrator (:8000) publicly so other systems can call
# POST /classify. Defaults to ngrok; pass "cloudflare" to use cloudflared.
#
# SECURITY: the orchestrator has NO auth — anyone with the URL can submit intents
# (which can drive agents and spend LLM credits). Use an ephemeral tunnel and
# Ctrl-C it the moment you're done. Do not post the URL publicly.
#
# Usage:
#   ./scripts/tunnel.sh             # ngrok  http 8000
#   ./scripts/tunnel.sh cloudflare  # cloudflared --url http://localhost:8000
set -euo pipefail

PORT="${PORT:-8000}"
PROVIDER="${1:-ngrok}"

if ! curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "Orchestrator not reachable on :${PORT}. Start it first:" >&2
  echo "  cd deadbolt && .venv/bin/python -m orchestrator.agent" >&2
  exit 1
fi

echo "Exposing http://localhost:${PORT} via ${PROVIDER}…"
echo "When the https URL appears, call it like:"
cat <<'EOF'

  curl -X POST https://<your-url>/classify \
    -H 'content-type: application/json' \
    -H 'ngrok-skip-browser-warning: 1' \
    -d '{"query":"order me a pizza for delivery"}'

EOF

case "$PROVIDER" in
  ngrok)
    command -v ngrok >/dev/null || { echo "ngrok not found: brew install ngrok" >&2; exit 1; }
    exec ngrok http "${PORT}"
    ;;
  cloudflare|cloudflared)
    command -v cloudflared >/dev/null || { echo "cloudflared not found: brew install cloudflared" >&2; exit 1; }
    exec cloudflared tunnel --url "http://localhost:${PORT}"
    ;;
  *)
    echo "Unknown provider '${PROVIDER}'. Use 'ngrok' or 'cloudflare'." >&2
    exit 1
    ;;
esac
