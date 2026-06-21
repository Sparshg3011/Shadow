"""A local 'space agent' that actually answers, for proving the round-trip.

It speaks the chat protocol and replies to any message with a concrete food
proposal. Runs with a local HTTP endpoint (no mailbox needed) so the orchestrator
can reach it directly on localhost — exactly how a registered/tunnelled agent is
reachable in production.

Run:  python -m demo.local_food_agent      (prints its address)
"""

import os

from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    chat_protocol_spec,
)

from orchestrator.chat_utils import create_text_chat, extract_text, make_ack

load_dotenv()

PORT = int(os.getenv("LOCAL_FOOD_PORT", "8400"))
food = Agent(
    name="local-food-agent",
    seed="deadbolt-local-food-agent-seed-001",
    port=PORT,
    endpoint=[f"http://127.0.0.1:{PORT}/submit"],
)
chat = Protocol(spec=chat_protocol_spec)


@chat.on_message(ChatMessage)
async def on_msg(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, make_ack(msg.msg_id))
    text = extract_text(msg)
    if not text:
        return  # session-open / empty
    ctx.logger.info("local-food got: %r", text)
    reply = (
        f"Proposed order for “{text}”:\n"
        f"- Margherita Pizza — Tony's Pizza — $18.50\n"
        f"- Garlic Knots — Tony's Pizza — $6.00\n"
        f"Total $24.50 (irreversible — needs approval at the bolt)."
    )
    await ctx.send(sender, create_text_chat(reply))


@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


food.include(chat, publish_manifest=True)


if __name__ == "__main__":
    print(f"LOCAL_FOOD_ADDRESS={food.address}")
    food.run()
