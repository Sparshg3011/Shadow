"""Conversational turn — the layer that makes Sunny interactive.

Before any computer-use work, every spoken or typed message lands here first.
One fast Claude call (small, no screenshot) decides whether the message is a
request to *do* something on the Mac (a task) or just conversation (a question,
a greeting, thanks), and always returns a short, warm spoken reply.

This is the "acknowledge-then-act" pattern: Sunny replies in well under a second
("Sure — opening Safari for you…") and the renderer speaks that immediately,
then runs the computer-use task in the background if there is one.
"""
import json

import anthropic

# intent="task"  -> Sunny will operate the Mac; `task` is a clean instruction.
# intent="chat"  -> just talk back; `task` is empty (questions, chit-chat, clarifying).
_SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "enum": ["task", "chat"]},
        "say": {"type": "string"},
        "task": {"type": "string"},
    },
    "required": ["intent", "say", "task"],
    "additionalProperties": False,
}

_SYSTEM = """You are Sunny, a warm, upbeat AI companion who lives on the user's Mac and can \
operate it for them. Many users are older adults, so you are patient, plain-spoken, and never use jargon.

You will be given one thing the user just said (typed or spoken). Decide what kind of message it is and \
reply in a natural, friendly, spoken style.

Two intents:
- "task": the user wants you to DO something on the computer (open an app, search the web, write or send a \
message, find something, change a setting, etc.). Set `task` to ONE clear, self-contained instruction the \
computer agent can follow, and set `say` to a short, warm acknowledgement of what you are about to do.
- "chat": a greeting, thanks, small talk, or a question you can answer in words (including "what can you \
do?", "how do I…?", or asking you to clarify). Set `task` to "" and put your full reply in `say`.

Rules for `say`:
- Keep it to ONE or TWO short sentences. Sound like a kind friend, not a manual.
- For a task, briefly restate what you'll do ("Sure — let me open Mail and start a new message.").
- Never invent details the user didn't give. If a task is missing something essential (like who to email), \
make it intent "chat" and ASK one short question instead of guessing.
- Default to intent "task" whenever the user is clearly asking you to operate the computer."""

# How the chosen help mode colours Sunny's acknowledgement.
_MODE_NOTE = {
    "hands-on": "The user wants you to do the task for them. Acknowledge that you're on it.",
    "side-by-side": "The user wants to watch and learn as you do it together. Say you'll walk through it with them.",
    "cheering": "The user wants to do it THEMSELVES while you coach. Encourage them; you'll point the way, not take over.",
}


def converse(api_key: str, model: str, message: str, mode: str = "hands-on") -> dict:
    """Return {"intent": "task"|"chat", "say": str, "task": str}.

    Fails safe: if the call errors, treat the message as a task so behaviour
    degrades to "just run it" rather than going silent.
    """
    text = (message or "").strip()
    if not text:
        return {"intent": "chat", "say": "I'm listening — what would you like to do?", "task": ""}

    try:
        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model=model,
            max_tokens=300,
            system=_SYSTEM + "\n\n" + _MODE_NOTE.get(mode, _MODE_NOTE["hands-on"]),
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": _SCHEMA}},
            messages=[{"role": "user", "content": text}],
        )
        raw = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
        data = json.loads(raw)
        intent = "task" if data.get("intent") == "task" else "chat"
        say = str(data.get("say", "")).strip()
        task = str(data.get("task", "")).strip()
        if intent == "task" and not task:
            task = text  # model forgot the instruction — fall back to the raw words
        if not say:
            say = "On it." if intent == "task" else "I'm here."
        return {"intent": intent, "say": say, "task": task if intent == "task" else ""}
    except Exception as exc:  # never block the user on a chat hiccup
        print(f"[converse] failed, treating as task: {exc}", flush=True)
        return {"intent": "task", "say": "On it.", "task": text}
