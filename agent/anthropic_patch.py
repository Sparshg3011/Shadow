"""Compatibility shim so Agent-S's Anthropic engine works with current Claude models.

Newer Claude models (e.g. claude-opus-4-8) reject the deprecated `temperature`
parameter and any empty text content blocks. Agent-S's stock engine sends both,
so we replace its generate() with a version that omits temperature and drops
empty text blocks before calling the API.
"""
import os

from anthropic import Anthropic
from gui_agents.s3.core import engine as _engine


def _sanitize(messages: list) -> list:
    """Drop empty text blocks; current Claude models reject them."""
    clean = []
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list):
            blocks = [
                b
                for b in content
                if not (isinstance(b, dict) and b.get("type") == "text" and not (b.get("text") or "").strip())
            ]
            if not blocks:
                blocks = [{"type": "text", "text": "(continue)"}]
            clean.append({**msg, "content": blocks})
        else:
            clean.append(msg)
    return clean


def _generate(self, messages, temperature=0.0, max_new_tokens=None, **kwargs):
    api_key = self.api_key or os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY needs to be set")
    client = Anthropic(api_key=api_key)

    system = (messages[0]["content"][0]["text"] or " ") if messages else " "
    convo = _sanitize(messages[1:])
    kwargs.pop("temperature", None)  # deprecated on current models

    resp = client.messages.create(
        system=system,
        model=self.model,
        messages=convo,
        max_tokens=max_new_tokens or 4096,
        **kwargs,
    )
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            return block.text
    return ""


def apply() -> None:
    """Install the patched generate() on Agent-S's Anthropic engine."""
    _engine.LMMEngineAnthropic.generate = _generate
