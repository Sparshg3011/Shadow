"""shadow-restaurant-search: a Fetch.ai (uAgents) agent that finds nearby
restaurants and returns Yelp reservation links.

It speaks the Agent Chat Protocol as a drop-in downstream for shadow-orchestrator.
The orchestrator forwards a query like:
  "Find restaurants in San Francisco for 2026-06-21 at 7pm for 2 people"
and this agent replies with up to 5 Yelp search URLs as markdown links.

Run:  python -m restaurant_agent.agent
"""

import os

from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    chat_protocol_spec,
)

from .chat_utils import create_text_chat, extract_text, make_ack
from .search import find_restaurants

load_dotenv()

PORT = int(os.getenv("RESTAURANT_AGENT_PORT", "8002"))
AGENT_SEED = os.getenv(
    "RESTAURANT_AGENT_SEED", "shadow-restaurant-search-secret-seed-change-me"
)

agent = Agent(
    name="shadow-restaurant-search",
    seed=AGENT_SEED,
    port=PORT,
    mailbox=True,
)

chat_proto = Protocol(spec=chat_protocol_spec)


@chat_proto.on_message(ChatMessage)
async def handle_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, make_ack(msg.msg_id))

    query = extract_text(msg)
    if not query:
        return

    ctx.logger.info("Restaurant search request from %s: %r", sender, query)
    try:
        reply = find_restaurants(query)
    except Exception as exc:
        ctx.logger.error("Restaurant search failed: %s", exc)
        reply = "Sorry, the restaurant search failed. Please try again."

    ctx.logger.info("Reply: %r", reply)
    await ctx.send(sender, create_text_chat(reply))


@chat_proto.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


agent.include(chat_proto, publish_manifest=True)


if __name__ == "__main__":
    print(f"shadow-restaurant-search address: {agent.address}")
    agent.run()
