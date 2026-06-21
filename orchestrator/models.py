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
