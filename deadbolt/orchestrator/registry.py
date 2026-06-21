"""In-memory views the dashboard reads: the route registry + a live intent feed.

Agent Place invariant: the orchestrator is the only writer. Agents are untrusted
planners; the dashboard reads *derived* state (what we routed, what we saw) — it
never lets an agent write here.

Everything is process-local and best-effort (a ring buffer + a dict). That's all
the hackathon dashboard needs; swap for Redis later without touching callers.
"""

import threading
from collections import OrderedDict
from typing import Any, Optional

from .routing import ROUTES

# --------------------------------------------------------------------------- #
# Route registry — the agents the orchestrator currently knows how to call.
# --------------------------------------------------------------------------- #
# Human-facing metadata for each intent we route. Keep in sync with intent.py.
INTENT_META: dict[str, dict[str, str]] = {
    "amazon_grocery_order": {
        "name": "Amazon Grocery Search",
        "type": "planner",
        "domain": "groceries",
        "description": "Turns a request into purchasable Amazon product links.",
    },
}


def route_registry() -> list[dict[str, Any]]:
    """The orchestrator's wired routes as dashboard agent-cards. Status here is
    'registered' — liveness enrichment (marketplace lookup) happens in agent.py."""
    cards: list[dict[str, Any]] = []
    for intent, address in ROUTES.items():
        meta = INTENT_META.get(intent, {})
        cards.append(
            {
                "id": intent,
                "intent": intent,
                "name": meta.get("name", intent),
                "type": meta.get("type", "planner"),
                "domain": meta.get("domain", ""),
                "description": meta.get("description", ""),
                "address": address,
                "status": "registered",
            }
        )
    return cards


# --------------------------------------------------------------------------- #
# Intent feed — recent requests and where they are in the pipeline.
# --------------------------------------------------------------------------- #
_MAX_INTENTS = 50
_lock = threading.Lock()
# session_id -> record, newest last. OrderedDict gives us cheap bounded history.
_intents: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
_seq = 0


def record_intent(
    session_id: str,
    query: str,
    *,
    origin: str,
    intent: str = "",
    status: str = "captured",
) -> None:
    """Insert a new intent at the head of the feed."""
    global _seq
    with _lock:
        _seq += 1
        _intents[session_id] = {
            "session_id": session_id,
            "seq": _seq,
            "query": query,
            "origin": origin,  # "rest" | "chat"
            "intent": intent,
            "status": status,  # captured|classifying|routing|awaiting|ok|unknown_intent|timeout|error
            "downstream": "",
            "product_count": 0,
            "message": "",
        }
        while len(_intents) > _MAX_INTENTS:
            _intents.popitem(last=False)


def update_intent(session_id: str, **fields: Any) -> None:
    """Patch fields on an existing intent record (no-op if it aged out)."""
    with _lock:
        rec = _intents.get(session_id)
        if rec is not None:
            rec.update(fields)


def list_intents() -> list[dict[str, Any]]:
    """Newest-first snapshot for the dashboard feed."""
    with _lock:
        return list(reversed(list(_intents.values())))


def clear_intents() -> int:
    """Empty the intent feed. Returns how many were cleared."""
    with _lock:
        n = len(_intents)
        _intents.clear()
        return n


def stats() -> dict[str, int]:
    """Lightweight counters for dashboard headline numbers."""
    with _lock:
        records = list(_intents.values())
    by_status: dict[str, int] = {}
    for r in records:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
    return {
        "total": len(records),
        "ok": by_status.get("ok", 0),
        "awaiting": by_status.get("awaiting", 0),
        "routing": by_status.get("routing", 0)
        + by_status.get("classifying", 0)
        + by_status.get("captured", 0),
        "failed": by_status.get("timeout", 0)
        + by_status.get("error", 0)
        + by_status.get("unknown_intent", 0),
    }
