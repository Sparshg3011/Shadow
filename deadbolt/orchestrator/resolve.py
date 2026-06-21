"""Resolve a marketplace agent's *contract* so the orchestrator knows how to
talk to it.

uAgents route by schema digest, so to send a typed request we'd need the target's
exact models. Three ways to get them (from the build log):
  1. Chat Protocol — the universal fallback. If the agent speaks it, we can talk
     to it with ZERO per-agent models. We detect this by comparing the agent's
     registered protocol digests against the chat protocol digest computed here.
  2. Protocol manifest — typed models by digest (not exposed on the public API
     today; 404s — fall back to chat / README).
  3. README — hand-documented models.

Resolution itself uses the AUTHENTICATED Agentverse endpoint. Note the routing
gotcha: bare `/almanac/...` hits the website; the API lives under `/v1/`. We use
`/v1/almanac/agents/:address`, the path confirmed to return 200.
"""

import os
from typing import Any

import httpx
from uagents import Protocol
from uagents_core.contrib.protocols.chat import chat_protocol_spec

AGENTVERSE_API_BASE = os.getenv("AGENTVERSE_API_BASE", "https://agentverse.ai/v1")
AGENTVERSE_API_KEY = os.getenv("AGENTVERSE_API_KEY", "")
_TIMEOUT = float(os.getenv("MARKETPLACE_TIMEOUT", "12"))

# Compute the chat protocol digest once; agents that registered it speak chat.
_CHAT_DIGEST = (
    Protocol(spec=chat_protocol_spec)
    .manifest()["metadata"]["digest"]
    .replace("proto:", "")
)


def _headers() -> dict[str, str]:
    h = {"content-type": "application/json"}
    if AGENTVERSE_API_KEY:
        h["authorization"] = f"Bearer {AGENTVERSE_API_KEY}"
    return h


async def resolve_agent(address: str) -> dict[str, Any]:
    """Return the resolved contract for an agent. Never raises; returns an
    `error` string the dashboard can show instead of blanking."""
    out: dict[str, Any] = {
        "address": address,
        "found": False,
        "status": "",
        "type": "",
        "endpoint": "",
        "protocols": [],
        "speaks_chat": False,
        "error": None,
    }
    if not address:
        out["error"] = "address required"
        return out
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{AGENTVERSE_API_BASE}/almanac/agents/{address}", headers=_headers()
            )
            if resp.status_code == 404:
                out["error"] = "not in almanac — agent may be inactive/unregistered"
                return out
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001 — degrade gracefully for the UI
        out["error"] = str(exc)
        return out

    out["found"] = True
    out["status"] = data.get("status", "")
    out["type"] = data.get("type", "")
    eps = data.get("endpoints") or []
    if eps and isinstance(eps[0], dict):
        out["endpoint"] = eps[0].get("url", "")
    protocols = data.get("protocols") or []
    out["protocols"] = protocols
    out["speaks_chat"] = _CHAT_DIGEST in protocols
    return out
