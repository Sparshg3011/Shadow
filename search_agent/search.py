"""Find purchasable Amazon product links via a switchable LLM web-search backend.

Set SEARCH_PROVIDER in .env to one of:  anthropic | openai | gemini  (default: anthropic)

Each provider uses its own native web-search tool so no third-party scraper is needed.
The contract is always the same: return up to 5 `[title — price](url)` markdown lines.
"""

import os
import re

NUM_PRODUCTS = 5

_SYSTEM_PROMPT = (
    "You are a shopping assistant that finds purchasable products on Amazon. "
    f"For the user's request, search the web and return exactly {NUM_PRODUCTS} "
    "currently-available Amazon product listings that best match it.\n\n"
    "Respond with ONLY a markdown list, one product per line, in this exact format:\n"
    "[<concise product title> — <price if known, else omit>](<amazon product url>)\n\n"
    "Rules:\n"
    "- Every URL must be a real amazon.com (or regional Amazon) product/listing URL "
    "you found via search — never invent one.\n"
    "- No preamble, no numbering, no commentary, no trailing text. Just the links.\n"
    f"- Exactly {NUM_PRODUCTS} lines if possible; fewer only if you genuinely can't "
    "find more."
)

_MD_LINK_RE = re.compile(r"\[[^\]]+\]\(https?://[^\s)]+\)")


def _extract_links(text: str) -> str:
    links = _MD_LINK_RE.findall(text)
    if links:
        return "\n".join(links[:NUM_PRODUCTS])
    return text or "Sorry, I couldn't find matching Amazon products right now."


# ---------------------------------------------------------------------------
# Provider: Anthropic (Claude Opus 4.8 + web_search_20260209)
# ---------------------------------------------------------------------------

def _search_anthropic(query: str) -> str:
    from anthropic import Anthropic  # lazy import so unused providers don't error

    MAX_CONTINUATIONS = 4
    WEB_SEARCH_TOOL = {
        "type": "web_search_20260209",
        "name": "web_search",
        "max_uses": 5,
    }

    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    messages = [{"role": "user", "content": query}]

    response = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=2048,
        system=_SYSTEM_PROMPT,
        tools=[WEB_SEARCH_TOOL],
        messages=messages,
    )

    continuations = 0
    while response.stop_reason == "pause_turn" and continuations < MAX_CONTINUATIONS:
        messages.append({"role": "assistant", "content": response.content})
        response = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=2048,
            system=_SYSTEM_PROMPT,
            tools=[WEB_SEARCH_TOOL],
            messages=messages,
        )
        continuations += 1

    text = "\n".join(
        b.text for b in response.content if getattr(b, "type", None) == "text"
    ).strip()
    return _extract_links(text)


# ---------------------------------------------------------------------------
# Provider: OpenAI (GPT-4o Responses API + web_search_preview)
# ---------------------------------------------------------------------------

def _search_openai(query: str) -> str:
    from openai import OpenAI  # lazy import

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    response = client.responses.create(
        model="gpt-4o",
        instructions=_SYSTEM_PROMPT,
        tools=[{"type": "web_search_preview"}],
        input=query,
    )

    # response.output is a list; collect text from message items.
    text = ""
    for item in response.output:
        if getattr(item, "type", None) == "message":
            for block in item.content:
                if getattr(block, "type", None) == "output_text":
                    text += block.text
    return _extract_links(text.strip())


# ---------------------------------------------------------------------------
# Provider: Gemini (gemini-2.0-flash + Google Search grounding)
# ---------------------------------------------------------------------------

def _search_gemini(query: str) -> str:
    from google import genai  # lazy import
    from google.genai import types

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=query,
        config=types.GenerateContentConfig(
            system_instruction=_SYSTEM_PROMPT,
            tools=[types.Tool(google_search=types.GoogleSearch())],
        ),
    )
    return _extract_links(response.text.strip())


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

_PROVIDERS = {
    "anthropic": _search_anthropic,
    "openai": _search_openai,
    "gemini": _search_gemini,
}


def search_amazon_products(query: str) -> str:
    """Return up to NUM_PRODUCTS Amazon links as markdown text for `query`."""
    provider = os.getenv("SEARCH_PROVIDER", "anthropic").lower()
    fn = _PROVIDERS.get(provider)
    if fn is None:
        raise ValueError(
            f"Unknown SEARCH_PROVIDER={provider!r}. Choose: {', '.join(_PROVIDERS)}"
        )
    return fn(query)
