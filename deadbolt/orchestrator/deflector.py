"""The deflector — Deadbolt's bolt.

Core rule: irreversible-by-default caution. A proposed action passes freely
(AUTO) only if it is reversible and within an auto limit; anything that spends
money or commits is FROZEN at the gate (GATE) for explicit human approval. We
never trust the agent — we trust the gate — so the deflector runs on every
proposal regardless of which agent produced it.
"""

from dataclasses import dataclass

# Domains where we gate everything, no matter how small.
HIGH_STAKES = {
    "payments", "payment", "finance", "banking", "defi", "crypto",
    "trading", "wallet", "transfer", "money",
}


@dataclass
class Proposal:
    """A normalized action a (planner) agent proposes. The deflector only ever
    sees this canonical shape — foreign agent models stay quarantined upstream."""

    irreversible: bool
    amount: float = 0.0
    domain: str = ""


@dataclass
class DeflectPolicy:
    """Per-agent gate policy. `always_gate` overrides everything (high-stakes
    agents); otherwise reversible actions under `auto_max_amount` pass."""

    auto_max_amount: float = 0.0
    always_gate: bool = False


def default_policy(*texts: str) -> DeflectPolicy:
    """Pick a sensible default policy when an agent is added to the space.

    Pass any descriptive text (domain, category, name) — if any of it smells
    high-stakes (payments, transfers, trading), we gate everything."""
    blob = " ".join(t for t in texts if t).lower()
    if any(k in blob for k in HIGH_STAKES):
        return DeflectPolicy(auto_max_amount=0.0, always_gate=True)
    return DeflectPolicy(auto_max_amount=0.0, always_gate=False)


def deflect(p: Proposal, policy: DeflectPolicy) -> tuple[str, str]:
    """Return ("GATE"|"AUTO", reason). This is the single chokepoint every
    irreversible action passes through before anything executes."""
    if policy.always_gate:
        return "GATE", "high-stakes agent — every action requires approval"
    if p.irreversible:
        return "GATE", "irreversible action — held at the bolt"
    if p.amount > policy.auto_max_amount:
        return (
            "GATE",
            f"${p.amount:.2f} exceeds auto limit ${policy.auto_max_amount:.2f}",
        )
    return "AUTO", "reversible and within auto limit"


def policy_summary(policy: DeflectPolicy) -> str:
    """Human-readable one-liner for the dashboard badge."""
    if policy.always_gate:
        return "Gates every action"
    if policy.auto_max_amount > 0:
        return f"Gates irreversible · auto ≤ ${policy.auto_max_amount:.0f}"
    return "Gates irreversible actions"
