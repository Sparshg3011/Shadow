"""'Your space' — marketplace agents the user has added to Agent Place.

Adding an agent makes it a known planner the orchestrator can route to, but the
deflector still gates its irreversible actions (discovery without trust). State
persists to a JSON file beside the package (no Redis here); the orchestrator is
the only writer.
"""

import json
import os
import threading
from datetime import datetime
from typing import Any, Optional

SPACE_FILE = os.getenv(
    "SPACE_FILE",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "space.json"),
)

_lock = threading.Lock()
_space: "dict[str, dict[str, Any]]" = {}  # address -> record


def _load() -> None:
    if not os.path.exists(SPACE_FILE):
        return
    try:
        with open(SPACE_FILE) as f:
            for rec in json.load(f):
                _space[rec["address"]] = rec
    except Exception:  # noqa: BLE001 — corrupt/empty file shouldn't crash boot
        pass


def _persist() -> None:
    try:
        with open(SPACE_FILE, "w") as f:
            json.dump(list(_space.values()), f, indent=2)
    except Exception:  # noqa: BLE001 — best-effort; in-memory stays authoritative
        pass


_load()


def now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def add_agent(rec: "dict[str, Any]") -> "dict[str, Any]":
    """Insert/replace an agent in the space and persist."""
    with _lock:
        existing = _space.get(rec["address"])
        if existing:
            # Preserve original added_at on re-add.
            rec.setdefault("added_at", existing.get("added_at", now_iso()))
        _space[rec["address"]] = rec
        _persist()
        return rec


def remove_agent(address: str) -> bool:
    with _lock:
        existed = _space.pop(address, None) is not None
        if existed:
            _persist()
        return existed


def get_agent(address: str) -> Optional["dict[str, Any]"]:
    with _lock:
        return _space.get(address)


def list_space() -> "list[dict[str, Any]]":
    with _lock:
        # newest first
        return sorted(
            _space.values(), key=lambda r: r.get("added_at", ""), reverse=True
        )


def pick_for(query: str) -> Optional["dict[str, Any]"]:
    """Choose a space agent to handle a deflected intent. Prefer one whose
    domain/category/name overlaps the query; otherwise the newest agent."""
    agents = list_space()
    if not agents:
        return None
    q = (query or "").lower()
    for a in agents:
        hay = f"{a.get('domain','')} {a.get('category','')} {a.get('name','')}".lower()
        for token in hay.replace("-", " ").split():
            if len(token) >= 4 and token in q:
                return a
    return agents[0]
