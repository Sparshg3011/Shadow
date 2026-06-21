"""Live Fetch.ai Agentverse marketplace search.

The dashboard wants to *browse* the real marketplace (discover agents that could
become downstream skills) without trusting them — exactly the Agent Place model:
agents are discoverable as planners, never granted execution.

We proxy the public Agentverse search API server-side so the browser needs no
keys and hits no CORS. Search is unauthenticated; if AGENTVERSE_API_KEY is set
we forward it as a bearer token (raises rate limits / unlocks private agents).
"""

import logging
import os
from typing import Any, Optional

import httpx

_log = logging.getLogger(__name__)

AGENTVERSE_SEARCH_URL = os.getenv(
    "AGENTVERSE_SEARCH_URL", "https://agentverse.ai/v1/search/agents"
)
AGENTVERSE_API_KEY = os.getenv("AGENTVERSE_API_KEY", "")
_TIMEOUT = float(os.getenv("MARKETPLACE_TIMEOUT", "12"))


def _headers() -> dict[str, str]:
    h = {"content-type": "application/json"}
    if AGENTVERSE_API_KEY:
        h["authorization"] = f"Bearer {AGENTVERSE_API_KEY}"
    return h


def _summarize_readme(readme: str, limit: int = 220) -> str:
    """Pull a short human blurb out of the (often long, markdown) readme."""
    if not readme:
        return ""
    for raw in readme.splitlines():
        line = raw.strip().lstrip("#").strip()
        # skip headings / badges / empty lines, take the first real sentence-ish line
        if line and not line.startswith(("![", "[", "<", "-", "*", "|", "=")):
            return line[:limit]
    return readme.strip()[:limit]


def _normalize(agent: dict[str, Any]) -> dict[str, Any]:
    """Reduce a raw Agentverse agent object to the fields the dashboard renders."""
    address = agent.get("address", "")
    name = agent.get("name") or "Untitled agent"
    description = agent.get("description") or _summarize_readme(agent.get("readme", ""))
    domain = agent.get("domain")
    tags = agent.get("system_wide_tags") or []
    return {
        "address": address,
        "name": name,
        "description": description,
        "category": agent.get("category") or "",
        "domain": domain,
        "tags": tags[:6] if isinstance(tags, list) else [],
        "avatar": agent.get("avatar_href") or "",
        "rating": agent.get("rating"),
        "interactions": agent.get("total_interactions") or 0,
        "recent_interactions": agent.get("recent_interactions") or 0,
        "status": agent.get("status") or "",
        "unresponsive": bool(agent.get("unresponsive")),
        "type": agent.get("type") or "",
        "featured": bool(agent.get("featured")),
        "handle": agent.get("handle") or "",
        "success_rate": agent.get("recent_success_rate"),
        # Deep-link to the agent's marketplace page so the user can inspect it.
        "marketplace_url": f"https://agentverse.ai/agents/details/{address}/profile"
        if address
        else "",
    }


async def search_marketplace(
    search_text: str,
    *,
    limit: int = 12,
    offset: int = 0,
    sort: str = "relevancy",
    semantic: bool = False,
) -> dict[str, Any]:
    """Query the Agentverse marketplace. Returns {agents, total, num_hits, error}.

    Never raises: on any failure it returns an empty result set with an `error`
    string so the dashboard degrades gracefully instead of blanking out.
    """
    payload: dict[str, Any] = {
        "search_text": search_text or "",
        "sort": sort,
        "direction": "desc",
        "offset": offset,
        "limit": limit,
        "semantic_search": semantic,
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                AGENTVERSE_SEARCH_URL, json=payload, headers=_headers()
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001 — degrade gracefully for the UI
        _log.warning("Agentverse search failed: %s", exc)
        return {"agents": [], "total": 0, "num_hits": 0, "error": str(exc)}

    raw_agents = data.get("agents") or []
    return {
        "agents": [_normalize(a) for a in raw_agents],
        "total": data.get("total", len(raw_agents)),
        "num_hits": data.get("num_hits", len(raw_agents)),
        "error": None,
    }


# address -> normalized agent (or None if not found). Cached for the process
# lifetime so the dashboard's /agents polling doesn't re-hit Agentverse each time.
_LOOKUP_CACHE: dict[str, Optional[dict[str, Any]]] = {}


async def lookup_agent(address: str) -> Optional[dict[str, Any]]:
    """Best-effort marketplace metadata for a single agent address (for enriching
    the orchestrator's registered routes with live marketplace info)."""
    if not address:
        return None
    if address in _LOOKUP_CACHE:
        return _LOOKUP_CACHE[address]
    result = await search_marketplace(address, limit=5)
    found: Optional[dict[str, Any]] = None
    for a in result["agents"]:
        if a["address"] == address:
            found = a
            break
    # Only cache positive hits / clean misses — not transient network errors.
    if found is not None or result.get("error") is None:
        _LOOKUP_CACHE[address] = found
    return found
