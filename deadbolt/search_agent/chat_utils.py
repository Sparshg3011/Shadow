"""Minimal chat-protocol helpers (standalone copy for this agent process)."""

from datetime import datetime
from uuid import uuid4

from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
)


def create_text_chat(text: str) -> ChatMessage:
    """Build a ChatMessage carrying a single text block."""
    return ChatMessage(
        timestamp=datetime.utcnow(),
        msg_id=uuid4(),
        content=[TextContent(type="text", text=text)],
    )


def make_ack(msg_id) -> ChatAcknowledgement:
    return ChatAcknowledgement(
        timestamp=datetime.utcnow(), acknowledged_msg_id=msg_id
    )


def extract_text(msg: ChatMessage) -> str:
    """Join all TextContent items of a ChatMessage."""
    parts = [c.text for c in msg.content if isinstance(c, TextContent)]
    return "\n".join(p for p in parts if p).strip()
