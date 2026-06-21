"""Intent classification via the ASI:One LLM (OpenAI-compatible endpoint)."""

import json
import os

from openai import OpenAI

# --- Intent registry ------------------------------------------------------
# Add a new skill by registering its intent name + description here, then wire
# a downstream address in routing.ROUTES. classify_intent() is constrained to
# these names so the router stays predictable.
INTENTS: dict[str, str] = {
    "amazon_grocery_order": (
        "User wants to buy/find a product on Amazon, or asks for purchasable "
        "product links/prices. Includes plainly-phrased wants like 'I want "
        "milk', 'find me a water bottle', or 'order eggs' — anything that "
        "should return shoppable Amazon product links."
    ),
    "restaurant_reservation": (
        "User wants to find nearby restaurants, make a restaurant reservation, "
        "or search for places to eat. Includes requests like 'find restaurants "
        "in Paris', 'book a table for 4 on Friday at 7pm', or 'where can I eat "
        "in New York for 2 people tonight' — anything that needs restaurant "
        "search and Yelp reservation links."
    ),
    "unknown": "Anything that does not match another intent.",
}

ASI_MODEL = "asi1"

client = OpenAI(
    base_url="https://api.asi1.ai/v1",
    api_key=os.getenv("ASI_ONE_API_KEY", "INSERT_YOUR_API_KEY_HERE"),
)


def _system_prompt() -> str:
    catalog = "\n".join(f"- {name}: {desc}" for name, desc in INTENTS.items())
    return (
        "You are an intent classifier for an orchestrator agent. "
        "Classify the user's message into exactly one of the intents below.\n\n"
        f"{catalog}\n\n"
        'Respond with ONLY a JSON object: {"intent": "<intent_name>", '
        '"args": {"query": "<the actionable request to forward, cleaned up>"}}. '
        "Use 'unknown' if nothing fits. Do not add prose outside the JSON."
    )


def classify_intent(query: str) -> tuple[str, dict]:
    """Return (intent_name, args). Falls back to ('unknown', {}) on any error."""
    try:
        resp = client.chat.completions.create(
            model=ASI_MODEL,
            messages=[
                {"role": "system", "content": _system_prompt()},
                {"role": "user", "content": query},
            ],
            temperature=0,
            max_tokens=512,
        )
        raw = str(resp.choices[0].message.content).strip()
        data = _extract_json(raw)
        intent = data.get("intent", "unknown")
        if intent not in INTENTS:
            intent = "unknown"
        args = data.get("args") or {}
        if not isinstance(args, dict):
            args = {}
        args.setdefault("query", query)
        return intent, args
    except Exception:
        return "unknown", {"query": query}


def _extract_json(raw: str) -> dict:
    """Tolerant JSON extraction (handles ```json fences / surrounding text)."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(raw[start : end + 1])
        raise
