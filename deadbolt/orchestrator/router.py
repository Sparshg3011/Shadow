"""Generic intent router.

One entry point, no hardcoded agent list. Given a request and the agents
*currently available* — built-in routes plus everything in your space — an LLM
picks the single best agent to handle it, judged purely on each agent's own
metadata (name / domain / capabilities). Add an agent to your space and it is
instantly a routing candidate; remove it and it's gone. A keyword heuristic is
the offline fallback when no LLM key is configured.

A candidate is a plain dict: {address, name, domain, capabilities, description}.
"""

import json
import logging
import os
from typing import Any, Optional

_log = logging.getLogger(__name__)

ROUTER_MODEL_ANTHROPIC = os.getenv("ROUTER_MODEL", "claude-haiku-4-5-20251001")
ROUTER_MODEL_ASI = "asi1"

_SYSTEM = (
    "You are a router for an agent marketplace. Pick the SINGLE agent best suited "
    "to handle the user's request. Match GENEROUSLY: infer what each agent does "
    "from its name and domain, and choose the closest fit even when the wording "
    "differs. For example a 'Cheapest Route Finder' handles ANY travel / route / "
    "directions / trip / 'plan from A to B' request between places (e.g. 'travel "
    "plan from SFO to NYC'); a food agent handles meals and groceries; a nutrition "
    "agent handles diet and calories. Return index -1 ONLY if no listed agent is "
    "even loosely related to the request's topic. "
    'Respond with ONLY JSON: {"index": <number>, "reason": "<short>"}. No prose.'
)


def _candidates_block(candidates: list[dict[str, Any]]) -> str:
    lines = []
    for i, c in enumerate(candidates):
        caps = ", ".join(c.get("capabilities") or [])
        desc = c.get("description") or caps or "—"
        lines.append(
            f'{i}. {c.get("name") or c["address"][:12]} '
            f'(domain: {c.get("domain") or "?"}) — {desc}'
        )
    return "\n".join(lines)


def _user_prompt(query: str, candidates: list[dict[str, Any]]) -> str:
    return (
        f"Request: {query}\n\nAvailable agents:\n{_candidates_block(candidates)}\n\n"
        'Return ONLY: {"index": <int>, "reason": "<short>"}'
    )


def _parse_index(raw: str) -> tuple[int, str]:
    start, end = raw.find("{"), raw.rfind("}")
    data = json.loads(raw[start : end + 1] if start != -1 else raw)
    return int(data.get("index", -1)), str(data.get("reason", ""))


# --------------------------------------------------------------------------- #
# Providers (best-effort; any may be unavailable depending on configured keys)
# --------------------------------------------------------------------------- #
def _asi_choose(query: str, candidates: list[dict[str, Any]]) -> Optional[tuple[int, str]]:
    key = os.getenv("ASI_ONE_API_KEY")
    if not key or key == "INSERT_YOUR_API_KEY_HERE":
        return None
    from openai import OpenAI

    client = OpenAI(base_url="https://api.asi1.ai/v1", api_key=key)
    resp = client.chat.completions.create(
        model=ROUTER_MODEL_ASI,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": _user_prompt(query, candidates)},
        ],
        temperature=0,
        max_tokens=120,
    )
    return _parse_index(str(resp.choices[0].message.content).strip())


def _anthropic_choose(query: str, candidates: list[dict[str, Any]]) -> Optional[tuple[int, str]]:
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    from anthropic import Anthropic

    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    resp = client.messages.create(
        model=ROUTER_MODEL_ANTHROPIC,
        max_tokens=120,
        system=_SYSTEM,
        messages=[{"role": "user", "content": _user_prompt(query, candidates)}],
    )
    text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    return _parse_index(text.strip())


def _keyword_choose(query: str, candidates: list[dict[str, Any]]) -> Optional[tuple[int, str]]:
    """Offline fallback: overlap between the query and an agent's domain/name."""
    q = (query or "").lower()
    for i, c in enumerate(candidates):
        hay = f"{c.get('domain','')} {c.get('name','')} {' '.join(c.get('capabilities') or [])}"
        for token in hay.lower().replace("-", " ").split():
            if len(token) >= 4 and token in q:
                return i, f"keyword match on '{token}'"
    return None


# --------------------------------------------------------------------------- #
# Public entry
# --------------------------------------------------------------------------- #
def choose_agent(
    query: str, candidates: list[dict[str, Any]]
) -> tuple[Optional[dict[str, Any]], str]:
    """Return (chosen_candidate | None, reason). Tries ASI -> Anthropic -> keyword."""
    if not candidates:
        return None, "no agents available — add one to your space"

    for provider in (_asi_choose, _anthropic_choose):
        try:
            result = provider(query, candidates)
        except Exception as exc:  # noqa: BLE001 — try the next provider
            _log.warning("router provider %s failed: %s", provider.__name__, exc)
            result = None
        if result is not None:
            idx, reason = result
            if 0 <= idx < len(candidates):
                return candidates[idx], reason or "llm match"
            return None, reason or "no suitable agent"

    # offline fallback
    kw = _keyword_choose(query, candidates)
    if kw is not None:
        idx, reason = kw
        return candidates[idx], reason
    return None, "no agent in your space fits this request"
