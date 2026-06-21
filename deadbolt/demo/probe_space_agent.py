"""Probe: can we actually talk to an agent in our space and get a reply?

Sends one chat message to a target Agentverse address over the chat protocol and
prints whatever comes back. mailbox=True so the hosted agent can route its reply
to us. This is the empirical test behind "added agents spin up and we chat".

Usage:  python demo/probe_space_agent.py <agent_address> "your message"
"""

import os
import sys

from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    chat_protocol_spec,
)

# reuse the orchestrator's chat helpers
from orchestrator.chat_utils import create_session_chat, extract_text, make_ack

load_dotenv()

TARGET = sys.argv[1] if len(sys.argv) > 1 else ""
MESSAGE = sys.argv[2] if len(sys.argv) > 2 else "I want to order a pizza"
AV_KEY = os.getenv("AGENTVERSE_API_KEY", "")

# Pass the Agentverse API key so the agent registers its own mailbox and is
# reachable for replies (without it, mailbox=True prints "mailbox not found").
probe = Agent(
    name="deadbolt-probe",
    seed="deadbolt-probe-stable-seed-001",
    port=8300,
    mailbox=True,
    agentverse=AV_KEY or None,
)
chat = Protocol(spec=chat_protocol_spec)


@probe.on_event("startup")
async def kick(ctx: Context):
    ctx.logger.info(f"PROBE address: {probe.address}")
    ctx.logger.info(f"PROBE -> sending to {TARGET}: {MESSAGE!r}")
    await ctx.send(TARGET, create_session_chat(MESSAGE))


@chat.on_message(ChatMessage)
async def on_msg(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, make_ack(msg.msg_id))
    text = extract_text(msg)
    if text:
        ctx.logger.info(f"PROBE_REPLY from {sender[:20]}: {text[:600]}")
    else:
        ctx.logger.info(f"PROBE_SESSION_EVENT from {sender[:20]} (no text)")


@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.info(f"PROBE_ACK from {sender[:20]}")


probe.include(chat, publish_manifest=True)


if __name__ == "__main__":
    probe.run()
