"""Pydantic models for the orchestrator's REST interface (middleware channel)."""

from typing import Optional

from uagents import Model


class Product(Model):
    """A single purchasable product returned by a downstream agent."""

    title: str
    url: str
    price: Optional[str] = None
    image: Optional[str] = None
    details: Optional[str] = None


class OrchestrateRequest(Model):
    """Incoming request from the middleware."""

    query: str
    user_id: Optional[str] = None
    # Free-form extra context the middleware may pass through (session, locale...).
    context: Optional[dict] = None


class OrchestrateResponse(Model):
    """Synchronous response returned to the middleware."""

    session_id: str
    intent: str
    status: str  # "ok" | "unknown_intent" | "timeout" | "error"
    message: str
    products: Optional[list[Product]] = None


class HealthResponse(Model):
    status: str
    agent_address: str


# --------------------------------------------------------------------------- #
# Dashboard models (read-only views the control plane renders)
# --------------------------------------------------------------------------- #
class RegisteredAgent(Model):
    """An agent the orchestrator currently routes to (a wired-in skill)."""

    id: str
    intent: str
    name: str
    type: str  # "planner" | "executor"
    domain: str = ""
    description: str = ""
    address: str = ""
    status: str = "registered"
    # Live marketplace enrichment (best-effort; empty if lookup failed).
    avatar: str = ""
    interactions: int = 0
    marketplace_url: str = ""


class AgentsResponse(Model):
    agents: list[RegisteredAgent]
    count: int


class MarketplaceAgent(Model):
    """A normalized agent from the live Fetch.ai Agentverse marketplace."""

    address: str
    name: str
    description: str = ""
    category: str = ""
    domain: Optional[str] = None
    tags: list[str] = []
    avatar: str = ""
    rating: Optional[float] = None
    interactions: int = 0
    recent_interactions: int = 0
    status: str = ""
    unresponsive: bool = False
    type: str = ""
    featured: bool = False
    handle: str = ""
    success_rate: Optional[float] = None
    marketplace_url: str = ""


class MarketplaceSearchRequest(Model):
    search_text: str = ""
    limit: int = 12
    offset: int = 0
    semantic: bool = False


class MarketplaceResponse(Model):
    query: str
    agents: list[MarketplaceAgent]
    total: int = 0
    num_hits: int = 0
    error: Optional[str] = None


class IntentRecord(Model):
    session_id: str
    seq: int
    query: str
    origin: str  # "rest" | "chat"
    intent: str = ""
    status: str = "captured"
    downstream: str = ""
    product_count: int = 0
    message: str = ""


class IntentStats(Model):
    total: int = 0
    ok: int = 0
    awaiting: int = 0
    routing: int = 0
    failed: int = 0


class IntentsResponse(Model):
    intents: list[IntentRecord]
    stats: IntentStats


class ClearRequest(Model):
    confirm: bool = True


class ClearResponse(Model):
    ok: bool
    cleared: int


# --------------------------------------------------------------------------- #
# "Your space" — agents added from the marketplace + their deflection policy
# --------------------------------------------------------------------------- #
class DeflectionPolicy(Model):
    always_gate: bool = False
    auto_max_amount: float = 0.0
    summary: str = ""


class SpaceAgent(Model):
    address: str
    name: str
    domain: str = ""
    category: str = ""
    avatar: str = ""
    capabilities: list[str] = []
    added_at: str = ""
    policy: DeflectionPolicy
    # What the bolt would do for a sample irreversible action (dashboard badge).
    sample_decision: str = "GATE"
    sample_reason: str = ""


class RegisterRequest(Model):
    address: str
    name: str = ""
    domain: str = ""
    category: str = ""
    avatar: str = ""
    capabilities: list[str] = []


class RemoveRequest(Model):
    address: str


class SpaceResponse(Model):
    agents: list[SpaceAgent]
    count: int


class RegisterResponse(Model):
    ok: bool
    message: str = ""
    agent: Optional[SpaceAgent] = None


class SpaceChatRequest(Model):
    address: str
    message: str


class SpaceChatResponse(Model):
    ok: bool
    address: str = ""
    agent_name: str = ""
    reply: str = ""
    message: str = ""  # status/error detail
    deflected: bool = False


class ResolveRequest(Model):
    address: str


class ResolveResponse(Model):
    address: str
    found: bool = False
    status: str = ""
    type: str = ""
    endpoint: str = ""
    protocols: list[str] = []
    protocol_count: int = 0
    speaks_chat: bool = False
    error: Optional[str] = None
