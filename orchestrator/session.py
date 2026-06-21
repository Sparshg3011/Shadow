"""Correlates asynchronous downstream chat replies back to their originating
request.

Agent-to-agent chat is asynchronous: when we forward a query to a downstream
agent, its answer arrives later in a separate ChatMessage handler. We bridge
that back to the original caller (a synchronous REST request, or an ASI:One chat
sender) using a pending-session map.

Downstream chat replies do not echo our msg_id, so replies are matched to
pending sessions FIFO per downstream address.
"""

import asyncio
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class PendingEntry:
    session_id: str
    intent: str
    origin: str  # "rest" | "chat"
    # For origin == "rest": resolved with the downstream reply text.
    future: Optional[asyncio.Future] = None
    # For origin == "chat": the ASI:One sender to reply back to.
    reply_to: Optional[str] = None
    meta: dict[str, Any] = field(default_factory=dict)


# session_id -> PendingEntry
PENDING: dict[str, PendingEntry] = {}
# downstream agent address -> FIFO of session_ids awaiting a reply from it
EXPECT: dict[str, deque[str]] = defaultdict(deque)


def register(entry: PendingEntry, downstream_addr: str) -> None:
    PENDING[entry.session_id] = entry
    EXPECT[downstream_addr].append(entry.session_id)


def pop_for_sender(downstream_addr: str) -> Optional[PendingEntry]:
    """Return (and remove) the oldest pending entry awaiting `downstream_addr`."""
    queue = EXPECT.get(downstream_addr)
    while queue:
        session_id = queue.popleft()
        entry = PENDING.pop(session_id, None)
        if entry is not None:
            return entry
    return None


def discard(session_id: str, downstream_addr: Optional[str] = None) -> None:
    """Remove a pending entry (e.g. on timeout). Best-effort cleanup."""
    PENDING.pop(session_id, None)
    if downstream_addr and session_id in EXPECT.get(downstream_addr, ()):
        try:
            EXPECT[downstream_addr].remove(session_id)
        except ValueError:
            pass
