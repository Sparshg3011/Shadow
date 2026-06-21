"""Maps classified intents to downstream agents and forwards chat requests."""

import os

from uagents import Context

from .chat_utils import create_session_chat
from .session import PendingEntry, register

AMAZON_AGENT_ADDRESS = os.getenv(
    "AMAZON_AGENT_ADDRESS",
    "agent1qg3gqlzxxcdvtmkx5fr4grlnuct4f43cvp9xgm2z2kg48g2rrn4aq98y6uz",
)

# intent name -> downstream agent address
ROUTES: dict[str, str] = {
    "amazon_grocery_order": AMAZON_AGENT_ADDRESS,
}


def downstream_for(intent: str) -> str | None:
    return ROUTES.get(intent)


async def forward_to_address(
    ctx: Context, entry: PendingEntry, address: str, query: str
) -> bool:
    """Send `query` to an arbitrary agent address over the chat protocol and
    record the pending session so its async reply correlates back. This is the
    one mechanism used for both built-in routes and space agents."""
    if not address:
        return False
    register(entry, address)
    await ctx.send(address, create_session_chat(query))
    ctx.logger.info(
        f"Forwarded session {entry.session_id} ({entry.intent}) -> {address}"
    )
    return True


async def forward_to_downstream(
    ctx: Context, entry: PendingEntry, query: str
) -> bool:
    """Forward to the built-in route for entry.intent. False if no route."""
    addr = downstream_for(entry.intent)
    if not addr:
        return False
    return await forward_to_address(ctx, entry, addr, query)
