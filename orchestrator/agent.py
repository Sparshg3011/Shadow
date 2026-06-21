"""shadow-orchestrator: intent-routing Fetch.ai agent.

Accepts queries from two channels:
  1. Middleware  -> synchronous REST  POST /classify
  2. ASI:One     -> Agent Chat Protocol (ChatMessage)

Classifies intent with the ASI:One LLM and, for `amazon_grocery_order`, forwards
the request to the downstream Amazon agent over the chat protocol, then returns
the purchasable links + product details to the originating caller.

Run:  python -m orchestrator.agent
"""

import asyncio
import json
import os
from uuid import uuid4

import httpx

from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    chat_protocol_spec,
)

from .chat_utils import create_text_chat, extract_text, make_ack, parse_products
from .intent import classify_intent
from .models import (
    HealthResponse,
    OrchestrateRequest,
    OrchestrateResponse,
    Product,
)
from .routing import AMAZON_AGENT_ADDRESS, RESTAURANT_AGENT_ADDRESS, ROUTES, downstream_for, forward_to_downstream
from .session import PendingEntry, discard, pop_for_sender

load_dotenv()

PORT = int(os.getenv("PORT", "8000"))
AGENT_SEED = os.getenv("AGENT_SEED", "shadow-orchestrator-secret-seed-change-me")
DOWNSTREAM_TIMEOUT = float(os.getenv("DOWNSTREAM_TIMEOUT", "45"))
FALLBACK_API_URL = os.getenv("FALLBACK_API_URL", "")

agent = Agent(
    name="shadow-orchestrator",
    seed=AGENT_SEED,
    port=PORT,
    mailbox=True,
)

chat_proto = Protocol(spec=chat_protocol_spec)


# --------------------------------------------------------------------------- #
# Shared result shaping
# --------------------------------------------------------------------------- #
def _agent_name_for(intent: str) -> str | None:
    addr = ROUTES.get(intent)
    if not addr:
        return None
    for name, a in [("amazon_search_agent", AMAZON_AGENT_ADDRESS), ("restaurant_agent", RESTAURANT_AGENT_ADDRESS)]:
        if a and addr == a:
            return name
    return addr


def _name_for_addr(addr: str) -> str:
    for name, a in [("amazon", AMAZON_AGENT_ADDRESS), ("restaurant", RESTAURANT_AGENT_ADDRESS)]:
        if a and addr == a:
            return name
    return addr


def build_response(
    session_id: str, intent: str, reply_text: str, args: dict | None = None
) -> OrchestrateResponse:
    products = parse_products(reply_text)
    return OrchestrateResponse(
        session_id=session_id,
        intent=intent,
        status="ok",
        message=reply_text,
        products=products or None,
        args=args or None,
        agent=_agent_name_for(intent),
    )


# --------------------------------------------------------------------------- #
# Chat protocol (ASI:One inbound + downstream replies)
# --------------------------------------------------------------------------- #
@chat_proto.on_message(ChatMessage)
async def handle_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, make_ack(msg.msg_id))

    # Case 1: a reply from any downstream agent -> correlate it back.
    _downstream_addresses = {a for a in (AMAZON_AGENT_ADDRESS, RESTAURANT_AGENT_ADDRESS) if a}
    if sender in _downstream_addresses:
        reply_text = extract_text(msg)
        ctx.logger.info(
            "Downstream msg from %s: types=%s text_len=%d",
            _name_for_addr(sender),
            [type(c).__name__ for c in msg.content],
            len(reply_text),
        )
        # Session-open / empty messages carry no answer; wait for the text one
        # so we don't consume the pending session prematurely.
        if not reply_text:
            return

        entry = pop_for_sender(sender)
        if entry is None:
            ctx.logger.warning(
                "Downstream reply from %s with no pending session; dropping.",
                _name_for_addr(sender),
            )
            return

        if entry.origin == "rest" and entry.future and not entry.future.done():
            entry.future.set_result(reply_text)
        elif entry.origin == "chat" and entry.reply_to:
            resp = build_response(entry.session_id, entry.intent, reply_text)
            await ctx.send(entry.reply_to, create_text_chat(_format_chat(resp)))
        return

    # Case 2: an inbound user query from ASI:One.
    text = extract_text(msg)
    if not text:
        return

    intent, args = classify_intent(text)
    query = args.get("query", text)
    session_id = str(uuid4())
    ctx.logger.info(
        "Inbound chat from %s | intent=%s | text=%r", sender, intent, text
    )

    if downstream_for(intent):
        ctx.logger.info("Forwarding to %s | query=%r", _agent_name_for(intent) or intent, query)
        entry = PendingEntry(
            session_id=session_id,
            intent=intent,
            origin="chat",
            reply_to=sender,
        )
        await forward_to_downstream(ctx, entry, query)
        # Reply is delivered asynchronously when the downstream agent answers.
    else:
        await ctx.send(
            sender,
            create_text_chat(
                "I can currently help with Amazon grocery orders and restaurant reservations. "
                "Try asking me to find grocery products, or to find restaurants in a location "
                "with a date, time, and number of people."
            ),
        )


@chat_proto.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


def _format_chat(resp: OrchestrateResponse) -> str:
    """Render an OrchestrateResponse as readable chat text for ASI:One."""
    if not resp.products:
        return resp.message
    sep = "─" * 48
    if resp.intent == "restaurant_reservation":
        lines = [f"🍽️ Found {len(resp.products)} restaurant(s):\n{sep}"]
        for i, p in enumerate(resp.products, 1):
            lines.append(
                f"{i}. {p.title}\n"
                f"   🔗 Reserve: {p.url}"
            )
            lines.append(sep)
    else:
        lines = [f"🛒 Found {len(resp.products)} product(s):\n{sep}"]
        for i, p in enumerate(resp.products, 1):
            lines.append(
                f"{i}. {p.title}\n"
                f"   🔗 Link  : {p.url}"
            )
            lines.append(sep)
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Fallback API (unknown intents)
# --------------------------------------------------------------------------- #
async def _call_fallback(query: str) -> str | None:
    """POST query to FALLBACK_API_URL; returns the response text or None on failure."""
    if not FALLBACK_API_URL:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                FALLBACK_API_URL,
                json={"query": query},
                headers={"ngrok-skip-browser-warning": "1"},
            )
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict):
                return data.get("message") or data.get("response") or data.get("answer") or json.dumps(data)
            return str(data)
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# REST channel (middleware inbound)
# --------------------------------------------------------------------------- #
@agent.on_rest_post("/classify", OrchestrateRequest, OrchestrateResponse)
async def handle_classify(
    ctx: Context, req: OrchestrateRequest
) -> OrchestrateResponse:
    intent, args = classify_intent(req.query)
    query = args.get("query", req.query)
    session_id = str(uuid4())

    if not downstream_for(intent):
        fallback_text = await _call_fallback(req.query)
        return OrchestrateResponse(
            session_id=session_id,
            intent=intent,
            status="ok" if fallback_text else "unknown_intent",
            message=fallback_text or "No downstream skill matched this request.",
            products=None,
            args=args or None,
            agent="fallback" if fallback_text else None,
        )

    ctx.logger.info("REST classify | intent=%s | query=%r", intent, query)
    loop = asyncio.get_event_loop()
    future: asyncio.Future = loop.create_future()
    entry = PendingEntry(
        session_id=session_id, intent=intent, origin="rest", future=future
    )
    await forward_to_downstream(ctx, entry, query)

    try:
        reply_text = await asyncio.wait_for(future, timeout=DOWNSTREAM_TIMEOUT)
    except asyncio.TimeoutError:
        discard(session_id, downstream_for(intent))
        return OrchestrateResponse(
            session_id=session_id,
            intent=intent,
            status="timeout",
            message="The downstream agent did not respond in time.",
            products=None,
            args=args or None,
            agent=_agent_name_for(intent),
        )

    return build_response(session_id, intent, reply_text, args)


@agent.on_rest_get("/health", HealthResponse)
async def handle_health(ctx: Context) -> HealthResponse:
    return HealthResponse(status="ok", agent_address=agent.address)


agent.include(chat_proto, publish_manifest=True)


if __name__ == "__main__":
    print(f"shadow-orchestrator address: {agent.address}")
    agent.run()
