"""Chat-protocol message helpers and downstream-reply parsing."""

import re
from datetime import datetime
from uuid import uuid4

from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
)

from .models import Product


def create_text_chat(text: str, end_session: bool = False) -> ChatMessage:
    """Build a ChatMessage carrying a single text block (template helper)."""
    content = [TextContent(type="text", text=text)]
    if end_session:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(
        timestamp=datetime.utcnow(), msg_id=uuid4(), content=content
    )


def create_session_chat(text: str) -> ChatMessage:
    """Build a ChatMessage that opens a session then sends the query text."""
    content = [
        StartSessionContent(type="start-session"),
        TextContent(type="text", text=text),
    ]
    return ChatMessage(
        timestamp=datetime.utcnow(), msg_id=uuid4(), content=content
    )


def make_ack(msg_id) -> ChatAcknowledgement:
    return ChatAcknowledgement(
        timestamp=datetime.utcnow(), acknowledged_msg_id=msg_id
    )


def extract_text(msg: ChatMessage) -> str:
    """Join all TextContent items of a ChatMessage."""
    parts = [c.text for c in msg.content if isinstance(c, TextContent)]
    return "\n".join(p for p in parts if p).strip()


_URL_RE = re.compile(r"https?://[^\s)\]\"'<>]+")
_PRICE_RE = re.compile(
    r"(?:[$£€]\s?\d[\d,]*(?:\.\d{2})?|\b\d+(?:\.\d{2})?\s?(?:USD|GBP|EUR))"
)
# <LinkCard url="..." title="..." description="...">inner</LinkCard>
_LINKCARD_RE = re.compile(
    r"<LinkCard\b([^>]*)>(.*?)</LinkCard>", re.IGNORECASE | re.DOTALL
)
# [Title](url)
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")


def _attr(attrs: str, name: str) -> str | None:
    m = re.search(name + r'\s*=\s*"([^"]*)"', attrs, re.IGNORECASE)
    return m.group(1) if m else None


def parse_products(text: str) -> list[Product]:
    """Best-effort extraction of purchasable products from a downstream reply.

    The Amazon agent returns links as markdown ([title](url)) and/or custom
    <LinkCard url=... title=... description=...> tags. We emit one Product per
    distinct URL, preferring richer (title/description) sources. If nothing is
    parseable, returns an empty list and the caller keeps the raw text.
    """
    products: list[Product] = []
    seen: set[str] = set()

    def add(url: str, title: str | None, details: str | None, price: str | None):
        url = url.strip().rstrip(".,);\"'")
        if not url or url in seen:
            return
        seen.add(url)
        products.append(
            Product(
                title=(title or "Product").strip()[:200],
                url=url,
                price=price,
                details=(details or None) and details.strip()[:500],
            )
        )

    # 1) Structured LinkCard tags (richest source).
    for attrs, inner in _LINKCARD_RE.findall(text):
        url = _attr(attrs, "url")
        if not url:
            continue
        add(
            url,
            _attr(attrs, "title"),
            _attr(attrs, "description") or inner,
            None,
        )

    # 2) Markdown links, with title + the line they appear on as context.
    for line in text.splitlines():
        for title, url in _MD_LINK_RE.findall(line):
            price = _PRICE_RE.search(line)
            add(url, title, line, price.group(0) if price else None)

    # 3) Any remaining bare URLs not already captured.
    for line in text.splitlines():
        for url in _URL_RE.findall(line):
            price = _PRICE_RE.search(line)
            title = line.replace(url, "").strip(" -*:[]()")
            add(url, title, line, price.group(0) if price else None)

    return products
