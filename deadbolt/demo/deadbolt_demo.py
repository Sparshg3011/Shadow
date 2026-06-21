"""deadbolt_demo.py — the full Deadbolt loop in one process.

A food agent (PLANNER) proposes a cart; it never executes. A client receives the
proposal, runs it through the DEFLECTOR, and any irreversible action is FROZEN at
the bolt until a human approves. This is the runnable shape every "added" agent
follows: typed contract -> plan -> gate -> approve -> execute.

    order -> plan -> GATE (bolt held) -> approved -> executed

Run:  python deadbolt_demo.py   (Ctrl-C to stop; the loop fires once at startup)
"""

from uagents import Agent, Bureau, Context, Model, Protocol


# --- typed contract (the request/response models the orchestrator needs) ------
class OrderRequest(Model):
    item: str
    max_price: float


class OrderProposal(Model):
    item: str
    vendor: str
    total: float
    irreversible: bool


food = Agent(name="food_agent", seed="food agent demo seed phrase")
client = Agent(name="deadbolt_client", seed="deadbolt client demo seed phrase")


# --- food agent = PLANNER: it proposes a cart, never executes -----------------
food_proto = Protocol("FoodOrder", version="1.0")


@food_proto.on_message(model=OrderRequest, replies=OrderProposal)
async def handle_order(ctx: Context, sender: str, msg: OrderRequest):
    proposal = OrderProposal(
        item=msg.item, vendor="Tony's Pizza", total=18.50, irreversible=True
    )
    ctx.logger.info(
        f"[food] built plan: {proposal.item} @ {proposal.vendor} = ${proposal.total}"
    )
    await ctx.send(sender, proposal)


food.include(food_proto, publish_manifest=True)


# --- the deflector ------------------------------------------------------------
def deflect(p: OrderProposal) -> str:
    return "GATE" if (p.irreversible and p.total > 0) else "AUTO"


@client.on_event("startup")
async def kick(ctx: Context):
    ctx.logger.info("[client] ordering: pizza (cap $25)")
    await ctx.send(food.address, OrderRequest(item="pizza", max_price=25.0))


@client.on_message(model=OrderProposal)
async def on_proposal(ctx: Context, sender: str, msg: OrderProposal):
    decision = deflect(msg)
    ctx.logger.info(
        f"[deflector] -> {decision}  (${msg.total} {msg.item} from {msg.vendor})"
    )
    if decision == "GATE":
        ctx.logger.info("[bolt] HELD — pushing approval card to phone... (simulating tap)")
        ctx.logger.info("[bolt] APPROVED -> executor places the order. DONE.")
    else:
        ctx.logger.info("[bolt] AUTO -> executed.")


# Port 8200 so the demo doesn't collide with the orchestrator on :8000.
bureau = Bureau(port=8200, endpoint="http://127.0.0.1:8200/submit")
bureau.add(food)
bureau.add(client)


if __name__ == "__main__":
    bureau.run()
