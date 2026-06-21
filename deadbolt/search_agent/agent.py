"""shadow-amazon-search: a Fetch.ai (uAgents) agent that returns Amazon product
links for a free-form request.

It speaks the Agent Chat Protocol, so it is a drop-in downstream for the
shadow-orchestrator: the orchestrator forwards a query (e.g. "I want milk") over
chat, this agent searches the web via Claude and replies with 5 purchasable
Amazon links as markdown, which the orchestrator parses into product details.

Run:  python -m search_agent.agent
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
from .search import search_amazon_products

load_dotenv()

PORT = int(os.getenv("SEARCH_AGENT_PORT", "8001"))
AGENT_SEED = os.getenv("SEARCH_AGENT_SEED", "shadow-amazon-search-secret-seed-change-me")

SEARCH_PROVIDER = os.getenv("SEARCH_PROVIDER", "anthropic").lower()

agent = Agent(
    name="shadow-amazon-search",
    seed=AGENT_SEED,
    port=PORT,
    mailbox=True,
)

chat_proto = Protocol(spec=chat_protocol_spec)


@chat_proto.on_message(ChatMessage)
async def handle_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, make_ack(msg.msg_id))

    query = extract_text(msg)
    ctx.logger.info("Query: %r", query)
    if not query:
        # Session-open / empty messages carry no request; nothing to answer.
        return

    ctx.logger.info("Search request from %s via %s: %r", sender, SEARCH_PROVIDER, query)
    try:
        reply = search_amazon_products(query)
    except Exception as exc:  # noqa: BLE001 - surface a usable message downstream
        ctx.logger.error("Search failed: %s", exc)
        reply = "Sorry, the product search failed. Please try again."

    ctx.logger.info("LLM response: %r", reply)
    await ctx.send(sender, create_text_chat(reply))


@chat_proto.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


agent.include(chat_proto, publish_manifest=True)


if __name__ == "__main__":
    print(f"shadow-amazon-search address: {agent.address}")
    print(f"Search provider: {SEARCH_PROVIDER}")
    agent.run()
