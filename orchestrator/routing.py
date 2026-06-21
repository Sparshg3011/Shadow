"""Maps classified intents to downstream agents and forwards chat requests."""

import os

from uagents import Context

from .chat_utils import create_session_chat
from .session import PendingEntry, register

AMAZON_AGENT_ADDRESS = os.getenv(
    "AMAZON_AGENT_ADDRESS"
)

RESTAURANT_AGENT_ADDRESS = os.getenv(
    "RESTAURANT_AGENT_ADDRESS"
)

# intent name -> downstream agent address
ROUTES: dict[str, str] = {
    "amazon_grocery_order": AMAZON_AGENT_ADDRESS,
    "restaurant_reservation": RESTAURANT_AGENT_ADDRESS,
}


def downstream_for(intent: str) -> str | None:
    return ROUTES.get(intent)


async def forward_to_downstream(
    ctx: Context, entry: PendingEntry, query: str
) -> bool:
    """Send `query` to the downstream agent for entry.intent and record the
    pending session so its async reply can be correlated back. Returns False if
    the intent has no route."""
    addr = downstream_for(entry.intent)
    if not addr:
        return False
    register(entry, addr)
    await ctx.send(addr, create_session_chat(query))
    ctx.logger.info(
        f"Forwarded session {entry.session_id} ({entry.intent}) -> {addr}"
    )
    return True
