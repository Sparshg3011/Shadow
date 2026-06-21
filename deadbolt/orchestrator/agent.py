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
import os
from uuid import uuid4

from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    chat_protocol_spec,
)

from . import space
from .chat_utils import extract_text, make_ack, parse_products
from .deflector import DeflectPolicy, Proposal, default_policy, deflect, policy_summary
from .marketplace import lookup_agent, search_marketplace
from .models import (
    AgentsResponse,
    ClearRequest,
    ClearResponse,
    DeflectionPolicy,
    HealthResponse,
    IntentRecord,
    IntentsResponse,
    IntentStats,
    MarketplaceAgent,
    MarketplaceResponse,
    MarketplaceSearchRequest,
    OrchestrateRequest,
    OrchestrateResponse,
    Product,
    RegisteredAgent,
    RegisterRequest,
    RegisterResponse,
    RemoveRequest,
    ResolveRequest,
    ResolveResponse,
    SpaceAgent,
    SpaceChatRequest,
    SpaceChatResponse,
    SpaceResponse,
)
from .adapter import is_unusable_reply, unusable_message
from .resolve import resolve_agent
from .router import choose_agent
from .registry import (
    clear_intents,
    list_intents,
    record_intent,
    route_registry,
    stats as intent_stats,
    update_intent,
)
from .routing import forward_to_address
from .session import PendingEntry, discard, has_pending, pop_for_sender

load_dotenv()

PORT = int(os.getenv("PORT", "8000"))
AGENT_SEED = os.getenv("AGENT_SEED", "shadow-orchestrator-secret-seed-change-me")
DOWNSTREAM_TIMEOUT = float(os.getenv("DOWNSTREAM_TIMEOUT", "45"))
# Mailbox connects to Agentverse so ASI:One can reach the agent. Disable for
# local dashboard dev (AGENT_MAILBOX=false) to skip the cloud handshake.
MAILBOX = os.getenv("AGENT_MAILBOX", "true").lower() not in ("false", "0", "no")
# If AGENT_ENDPOINT is set (e.g. http://127.0.0.1:8000/submit), register that
# endpoint instead of a mailbox — lets agents reach the orchestrator directly
# (local round-trips, or a tunnel URL in prod) without claiming a mailbox.
AGENT_ENDPOINT = os.getenv("AGENT_ENDPOINT", "")
AGENTVERSE_API_KEY = os.getenv("AGENTVERSE_API_KEY", "")

_agent_kwargs: dict = {"name": "shadow-orchestrator", "seed": AGENT_SEED, "port": PORT}
if AGENT_ENDPOINT:
    # Public endpoint mode: register THIS url (e.g. an ngrok tunnel) so agents
    # POST their replies straight to us. Explicitly disable the mailbox — without
    # this uagents still registers the (unclaimed) mailbox endpoint and replies
    # are routed there and lost.
    _agent_kwargs["endpoint"] = [AGENT_ENDPOINT]
    _agent_kwargs["mailbox"] = False
else:
    _agent_kwargs["mailbox"] = MAILBOX
    if MAILBOX and AGENTVERSE_API_KEY:
        _agent_kwargs["agentverse"] = AGENTVERSE_API_KEY

agent = Agent(**_agent_kwargs)

chat_proto = Protocol(spec=chat_protocol_spec)


# --------------------------------------------------------------------------- #
# Shared result shaping
# --------------------------------------------------------------------------- #
def build_response(
    session_id: str, intent: str, reply_text: str
) -> OrchestrateResponse:
    products = parse_products(reply_text)
    return OrchestrateResponse(
        session_id=session_id,
        intent=intent,
        status="ok",
        message=reply_text,
        products=products or None,
    )


# --------------------------------------------------------------------------- #
# Chat protocol — RECEIVE-ONLY.
# The orchestrator is a POST-driven gateway: every request enters via REST
# (/classify, /space/chat) and is answered in that POST's response. This handler
# exists solely to catch the asynchronous reply an agent sends back and hand it
# to the REST call that's blocking on it. There is NO inbound query handling — any
# non-correlated chat (ASI:One users, stray/late agent replies) is acked and
# dropped. We never classify, record, or act on unsolicited inbound.
# --------------------------------------------------------------------------- #
@chat_proto.on_message(ChatMessage)
async def handle_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, make_ack(msg.msg_id))

    # Only accept a message if a REST call is currently waiting on this sender.
    if not has_pending(sender):
        ctx.logger.info("Dropped non-correlated chat from %s (receive-only gateway).", sender[:16])
        return

    reply_text = extract_text(msg)
    if not reply_text:
        return  # session-open / empty frame — wait for the text message

    entry = pop_for_sender(sender)
    if entry is None or entry.future is None or entry.future.done():
        return
    entry.future.set_result(reply_text)  # wakes the blocked REST handler


@chat_proto.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


# --------------------------------------------------------------------------- #
# REST channel (middleware inbound)
# --------------------------------------------------------------------------- #
async def _forward_and_wait(
    ctx: Context, session_id: str, intent: str, address: str, query: str
) -> str | None:
    """Forward `query` to `address` over chat and block for its reply. Returns
    the reply text, or None on timeout (the reachability/offline case). Shared by
    built-in routing, deflect-to-space, and direct space chat."""
    update_intent(session_id, intent=intent, status="routing", downstream=address)
    loop = asyncio.get_event_loop()
    future: asyncio.Future = loop.create_future()
    entry = PendingEntry(
        session_id=session_id, intent=intent, origin="rest", future=future
    )
    await forward_to_address(ctx, entry, address, query)
    try:
        return await asyncio.wait_for(future, timeout=DOWNSTREAM_TIMEOUT)
    except asyncio.TimeoutError:
        discard(session_id, address)
        update_intent(session_id, status="timeout")
        return None


def _route_candidates() -> list[dict]:
    """Everything the router may pick from RIGHT NOW: built-in wired routes plus
    every agent currently in the space. No hardcoded agent list — add to the
    space and it's instantly a candidate; remove it and it's gone."""
    cands: list[dict] = []
    for c in route_registry():
        cands.append(
            {
                "address": c["address"],
                "name": c["name"],
                "domain": c["domain"],
                "capabilities": [],
                "description": c["description"],
                "intent": c["intent"],
            }
        )
    for s in space.list_space():
        cands.append(
            {
                "address": s["address"],
                "name": s.get("name") or s["address"][:12],
                "domain": s.get("domain", ""),
                "capabilities": s.get("capabilities", []),
                "description": "",
                "intent": f"space:{s.get('name') or s['address'][:10]}",
            }
        )
    return cands


@agent.on_rest_post("/classify", OrchestrateRequest, OrchestrateResponse)
async def handle_classify(
    ctx: Context, req: OrchestrateRequest
) -> OrchestrateResponse:
    """One generic entry point: route the intent to the best-fit agent currently
    available (built-in routes + your space), forward it, return the reply."""
    session_id = str(uuid4())
    record_intent(session_id, req.query, origin="rest", status="classifying")

    candidates = _route_candidates()
    chosen, reason = choose_agent(req.query, candidates)
    if not chosen:
        update_intent(session_id, intent="unknown", status="unknown_intent")
        return OrchestrateResponse(
            session_id=session_id,
            intent="unknown",
            status="unknown_intent",
            message=f"No agent available can handle this. ({reason})",
            products=None,
        )

    intent = chosen.get("intent") or f"space:{chosen.get('name')}"
    ctx.logger.info("Routed %r -> %s (%s)", req.query, chosen.get("name"), reason)

    reply_text = await _forward_and_wait(
        ctx, session_id, intent, chosen["address"], req.query
    )
    if reply_text is None:
        return OrchestrateResponse(
            session_id=session_id,
            intent=intent,
            status="timeout",
            message=(
                f"Routed to {chosen.get('name')} but it did not respond "
                "(offline or not reachable — needs a mailbox/endpoint)."
            ),
            products=None,
        )

    if is_unusable_reply(reply_text):
        update_intent(session_id, status="error", message="malformed agent reply")
        return OrchestrateResponse(
            session_id=session_id,
            intent=intent,
            status="error",
            message=unusable_message(chosen.get("name") or intent),
            products=None,
        )

    resp = build_response(session_id, intent, reply_text)
    update_intent(
        session_id,
        status="ok",
        product_count=len(resp.products or []),
        message=reply_text[:280],
    )
    return resp


@agent.on_rest_get("/health", HealthResponse)
async def handle_health(ctx: Context) -> HealthResponse:
    return HealthResponse(status="ok", agent_address=agent.address)


# --------------------------------------------------------------------------- #
# Dashboard channel (read-only control plane)
# --------------------------------------------------------------------------- #
@agent.on_rest_get("/agents", AgentsResponse)
async def handle_agents(ctx: Context) -> AgentsResponse:
    """The orchestrator's wired routes, enriched with live marketplace metadata."""
    cards: list[RegisteredAgent] = []
    for c in route_registry():
        live = await lookup_agent(c["address"])
        cards.append(
            RegisteredAgent(
                id=c["id"],
                intent=c["intent"],
                name=(live or {}).get("name") or c["name"],
                type=c["type"],
                domain=c["domain"],
                description=(live or {}).get("description") or c["description"],
                address=c["address"],
                status="online" if live and not live.get("unresponsive") else c["status"],
                avatar=(live or {}).get("avatar", ""),
                interactions=(live or {}).get("interactions", 0),
                marketplace_url=(live or {}).get("marketplace_url", ""),
            )
        )
    return AgentsResponse(agents=cards, count=len(cards))


@agent.on_rest_get("/intents", IntentsResponse)
async def handle_intents(ctx: Context) -> IntentsResponse:
    """Live feed of recent intents and where each sits in the pipeline."""
    records = [IntentRecord(**r) for r in list_intents()]
    return IntentsResponse(intents=records, stats=IntentStats(**intent_stats()))


@agent.on_rest_post("/intents/clear", ClearRequest, ClearResponse)
async def handle_clear_intents(ctx: Context, req: ClearRequest) -> ClearResponse:
    """Empty the intent feed (in-memory ring buffer)."""
    n = clear_intents()
    ctx.logger.info("Cleared %d intents from the feed", n)
    return ClearResponse(ok=True, cleared=n)


@agent.on_rest_post("/marketplace/search", MarketplaceSearchRequest, MarketplaceResponse)
async def handle_marketplace_search(
    ctx: Context, req: MarketplaceSearchRequest
) -> MarketplaceResponse:
    """Live-browse the Fetch.ai Agentverse marketplace (proxied, no key in browser)."""
    result = await search_marketplace(
        req.search_text, limit=req.limit, offset=req.offset, semantic=req.semantic
    )
    return MarketplaceResponse(
        query=req.search_text,
        agents=[MarketplaceAgent(**a) for a in result["agents"]],
        total=result["total"],
        num_hits=result["num_hits"],
        error=result["error"],
    )


# --------------------------------------------------------------------------- #
# "Your space" — add marketplace agents; the deflector gates their actions
# --------------------------------------------------------------------------- #
def _space_model(rec: dict) -> SpaceAgent:
    """Render a stored space record + its live deflection preview."""
    p = rec.get("policy", {})
    policy = DeflectPolicy(
        always_gate=bool(p.get("always_gate")),
        auto_max_amount=float(p.get("auto_max_amount", 0.0)),
    )
    # Show what the bolt would do for a sample irreversible action.
    decision, reason = deflect(
        Proposal(irreversible=True, amount=0.0, domain=rec.get("domain", "")), policy
    )
    return SpaceAgent(
        address=rec["address"],
        name=rec.get("name") or rec["address"][:14],
        domain=rec.get("domain", ""),
        category=rec.get("category", ""),
        avatar=rec.get("avatar", ""),
        capabilities=rec.get("capabilities", []),
        added_at=rec.get("added_at", ""),
        policy=DeflectionPolicy(
            always_gate=policy.always_gate,
            auto_max_amount=policy.auto_max_amount,
            summary=policy_summary(policy),
        ),
        sample_decision=decision,
        sample_reason=reason,
    )


@agent.on_rest_post("/agents/register", RegisterRequest, RegisterResponse)
async def handle_register(ctx: Context, req: RegisterRequest) -> RegisterResponse:
    """Add a marketplace agent to the space. It becomes a known planner, but the
    deflector still gates its irreversible actions (discovery without trust)."""
    if not req.address:
        return RegisterResponse(ok=False, message="address required")
    pol = default_policy(req.domain, req.category, req.name)
    rec = {
        "address": req.address,
        "name": req.name,
        "domain": req.domain,
        "category": req.category,
        "avatar": req.avatar,
        "capabilities": req.capabilities,
        "added_at": space.now_iso(),
        "policy": {"always_gate": pol.always_gate, "auto_max_amount": pol.auto_max_amount},
    }
    space.add_agent(rec)
    ctx.logger.info("Added to space: %s (%s)", req.name or req.address[:14], req.domain)
    return RegisterResponse(ok=True, message="added to space", agent=_space_model(rec))


@agent.on_rest_post("/agents/remove", RemoveRequest, RegisterResponse)
async def handle_remove(ctx: Context, req: RemoveRequest) -> RegisterResponse:
    ok = space.remove_agent(req.address)
    return RegisterResponse(ok=ok, message="removed" if ok else "not in space")


@agent.on_rest_get("/space", SpaceResponse)
async def handle_space(ctx: Context) -> SpaceResponse:
    """Agents the user added, each with its deflection policy + sample decision."""
    agents = [_space_model(r) for r in space.list_space()]
    return SpaceResponse(agents=agents, count=len(agents))


@agent.on_rest_post("/space/chat", SpaceChatRequest, SpaceChatResponse)
async def handle_space_chat(ctx: Context, req: SpaceChatRequest) -> SpaceChatResponse:
    """Post an intent to a specific agent in the space over the chat protocol and
    return its reply — the 'communicate with the agent we added' path."""
    rec = space.get_agent(req.address)
    if rec is None:
        return SpaceChatResponse(ok=False, address=req.address, message="agent not in space")
    name = rec.get("name") or req.address[:12]
    session_id = str(uuid4())
    record_intent(
        session_id, req.message, origin="space", intent=f"space:{name}", status="routing"
    )
    reply = await _forward_and_wait(ctx, session_id, f"space:{name}", req.address, req.message)
    if reply is None:
        return SpaceChatResponse(
            ok=False,
            address=req.address,
            agent_name=name,
            deflected=True,
            message="no reply — agent offline or not reachable (needs a mailbox/endpoint)",
        )
    if is_unusable_reply(reply):
        update_intent(session_id, status="error", message="malformed agent reply")
        return SpaceChatResponse(
            ok=False,
            address=req.address,
            agent_name=name,
            deflected=True,
            message=unusable_message(name),
        )
    update_intent(session_id, status="ok", message=reply[:280])
    return SpaceChatResponse(
        ok=True, address=req.address, agent_name=name, reply=reply, deflected=True
    )


@agent.on_rest_post("/agents/resolve", ResolveRequest, ResolveResponse)
async def handle_resolve(ctx: Context, req: ResolveRequest) -> ResolveResponse:
    """Resolve an agent's contract from Agentverse: status, endpoint, protocols,
    and whether it speaks the chat protocol (talk to it with zero per-agent models)."""
    r = await resolve_agent(req.address)
    return ResolveResponse(
        address=r["address"],
        found=r["found"],
        status=r["status"],
        type=r["type"],
        endpoint=r["endpoint"],
        protocols=r["protocols"],
        protocol_count=len(r["protocols"]),
        speaks_chat=r["speaks_chat"],
        error=r["error"],
    )


agent.include(chat_proto, publish_manifest=True)


if __name__ == "__main__":
    print(f"shadow-orchestrator address: {agent.address}")
    agent.run()
