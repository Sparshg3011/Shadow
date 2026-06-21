"""Reply-quality guard for heterogeneous marketplace agents.

Some hosted agents are broken at runtime: instead of executing their tools and
answering, their model leaks raw tool-call markup
(`<tool_call><function=…><parameter=…>`) or loops emitting closing tags. We can't
fix a broken downstream agent, but we can detect the garbage and surface a clean
status ("this agent looks broken — try another") instead of dumping it to the
user. Clean natural-language replies (the good agents) pass straight through.
"""

import re

# Leaked tool-call / function-call / parameter markup.
_LEAK_RE = re.compile(r"<\s*/?\s*(tool_call|function|parameter)\b|<\s*function\s*=", re.I)


def is_unusable_reply(text: str) -> bool:
    """True if the reply is malformed agent output rather than a real answer."""
    if not text or not text.strip():
        return True
    if _LEAK_RE.search(text):
        return True
    # Degenerate repetition: many lines, almost all identical (a stuck loop).
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) >= 8 and len(set(lines)) <= 2:
        return True
    return False


def unusable_message(agent_name: str) -> str:
    return (
        f"{agent_name or 'The agent'} returned a malformed response — it leaked "
        "internal tool-call markup instead of an answer, so it looks broken on its "
        "end. Reachability is fine; try a different agent for this request."
    )
