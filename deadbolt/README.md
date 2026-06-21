# Deadbolt

> A marketplace of agents that can finally do things for you — fronted by one
> trust layer. **The agents plan. The gate decides.**

Self-contained stack (decoupled from the Shadow Electron app). Discover agents on
the Fetch.ai/Agentverse marketplace, add the ones you want to your space, and let
the **deflector** gate every irreversible action for human approval.

```
deadbolt/
  orchestrator/     Fetch.ai uAgents orchestrator — REST on :8000 (the only trusted writer)
  search_agent/     downstream Amazon-links agent (:8001), Claude web search
  dashboard/        Vite + React control plane (:5273), proxies /api -> :8000
  demo/             deadbolt_demo.py — the full gate loop in one process
  requirements.txt  Python deps   ·   .env(.example)  ·  space.json (runtime, gitignored)
```

## Run

```bash
cd deadbolt

# 1. one-time Python setup
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. keys: copy .env.example -> .env and fill in.
#      ASI_ONE_API_KEY   real intent classification   (https://asi1.ai/developer)
#      ANTHROPIC_API_KEY downstream search agent
#      AGENTVERSE_API_KEY  resolve/manifest + higher search limits (search itself is public)

# 3. orchestrator (dashboard backend). AGENT_MAILBOX=false skips the Agentverse handshake for local dev.
.venv/bin/python -m orchestrator.agent

# 4. dashboard
npm --prefix dashboard install
npm --prefix dashboard run dev          # http://localhost:5273

# 5. (optional) the downstream Amazon search agent
.venv/bin/python -m search_agent.agent

# the full gate loop, standalone:
.venv/bin/python demo/deadbolt_demo.py  # order -> plan -> GATE -> approve -> execute
```

## One generic entry point — no hardcoded agents

`POST /classify {query}` is the single entry point. A **dynamic router**
([`router.py`](orchestrator/router.py)) ranks the agents *currently available*
(built-in routes + everything in your space) by their own name/domain/
capabilities, picks the best fit, forwards the intent, and returns the reply.
There is **no agent list in code** — add an agent to your space and it's instantly
a routing candidate; remove it and the same query routes elsewhere or returns
`unknown`. An LLM does the ranking (ASI → Anthropic → keyword fallback).

```
/classify "order me a pizza"
  with local-food-agent in space  -> routed to local-food-agent -> reply
  after removing it                -> unknown ("no agent handles food")
```

## Call it from another system

**Entry point:** `POST /classify` — submit an intent, block until the chosen
agent replies, get the result back in one response (call-and-wait).

```
POST http://<host>:8000/classify
Content-Type: application/json

{ "query": "order me a pizza for delivery", "user_id": "optional", "context": {} }
```

Response (synchronous; waits up to `DOWNSTREAM_TIMEOUT`, default 45s):

```json
{
  "session_id": "uuid",
  "intent": "space:local-food-agent",   // which agent it routed to
  "status": "ok",                          // ok | unknown_intent | timeout
  "message": "Proposed order … Total $24.50 (needs approval at the bolt).",
  "products": [ { "title": "...", "url": "...", "price": "..." } ]  // or null
}
```

Chat a specific agent instead of auto-routing: `POST /space/chat {address, message}`.

**Expose it publicly** (so other systems can call it):

```bash
cd deadbolt
.venv/bin/python -m orchestrator.agent      # orchestrator on :8000
./scripts/tunnel.sh                          # ngrok  (or: ./scripts/tunnel.sh cloudflare)
# -> prints https://<id>.ngrok-free.app ; then from anywhere:
curl -X POST https://<id>.ngrok-free.app/classify \
  -H 'content-type: application/json' -H 'ngrok-skip-browser-warning: 1' \
  -d '{"query":"order me a pizza for delivery"}'
```

> ⚠️ The orchestrator has **no auth** — anyone with the tunnel URL can submit
> intents. Keep the tunnel ephemeral and shut it down when done.
> For the full round-trip to remote space agents over the tunnel, also set
> `AGENT_ENDPOINT=https://<id>.ngrok-free.app/submit` so their replies route back.

## The product flow

1. **Discover** — search the live Agentverse marketplace from the dashboard.
2. **Add to space** — `+ Add` registers an agent as a known planner. It is
   *discoverable but untrusted*: usable immediately, never granted execution.
3. **Deflect** — each added agent gets a policy. High-stakes domains
   (payments, transfers, trading) **gate every action**; everything else
   **gates irreversible actions**. Read-only flows would pass (AUTO).
4. **Resolve** — `⌕` resolves an agent's contract from Agentverse: status,
   endpoint, protocols, and whether it **speaks the chat protocol** (so we can
   talk to it with zero per-agent models — the universal fallback).
5. **Run / chat** — the orchestrator actually talks to an added agent over the
   chat protocol and returns its reply:
   - `POST /space/chat {address, message}` — chat a specific space agent (the 💬
     box on each Your Space card).
   - **Deflect-to-space**: when `/classify` finds no built-in route, it hands the
     intent to a matching space agent, awaits the reply, and returns it — so an
     upstream orchestrator can fall back to your space and get a real answer.

## How agent comms work (and the one requirement)

Forwarding is the same proven mechanism as the built-in Amazon route:
`ctx.send(address, chat)` → the agent replies asynchronously → we correlate it
(FIFO per address) back to the waiting request. It works for **any** agent that
speaks the chat protocol.

The one real-world requirement is **reachability for the reply**: the
orchestrator must be addressable so the agent's response can route back. Two ways:
- **Endpoint mode** — `AGENT_ENDPOINT=http://127.0.0.1:8000/submit` (or a tunnel
  URL). Registers a real endpoint; no mailbox needed. Used by the local demo.
- **Mailbox mode** — `mailbox=True` + a claimed mailbox on Agentverse (set
  `AGENTVERSE_API_KEY`; one-time claim via the agent inspector). Needed for
  remote hosted agents.

Prove the full round-trip locally (no mailbox claim):

```bash
# terminal 1 — orchestrator reachable on localhost
AGENT_ENDPOINT=http://127.0.0.1:8000/submit .venv/bin/python -m orchestrator.agent
# terminal 2 — a local agent that actually answers
.venv/bin/python -m demo.local_food_agent          # prints LOCAL_FOOD_ADDRESS
# add it to the space + chat it
curl -X POST localhost:8000/agents/register -d '{"address":"<LOCAL_FOOD_ADDRESS>","name":"local-food-agent","domain":"food"}' -H 'content-type: application/json'
curl -X POST localhost:8000/space/chat -d '{"address":"<LOCAL_FOOD_ADDRESS>","message":"order a pizza"}' -H 'content-type: application/json'
# -> {"ok": true, "reply": "Proposed order … Total $24.50 (needs approval at the bolt)"}
```

`demo/probe_space_agent.py <address> "<msg>"` is a one-off probe for trying any
marketplace agent (shows whether its reply routes back).

## Orchestrator endpoints (`:8000`)

| Method | Path                  | Purpose |
|--------|-----------------------|---------|
| GET    | `/health`             | liveness + agent address |
| POST   | `/classify`           | **one generic entry point** — router picks the best agent in your space + built-in routes, forwards, returns the reply |
| GET    | `/agents`             | built-in wired routes (live marketplace-enriched) |
| GET    | `/intents`            | live intent feed + stats |
| POST   | `/marketplace/search` | proxy live Agentverse search `{search_text, limit}` |
| POST   | `/agents/register`    | add a marketplace agent to your space |
| POST   | `/agents/remove`      | remove an agent from your space |
| GET    | `/space`              | added agents + their deflection policy |
| POST   | `/space/chat`         | chat a space agent `{address, message}` → its reply |
| POST   | `/agents/resolve`     | resolve an agent's contract `{address}` |

## Notes

- **Marketplace search is public** (no key). Resolve uses the authenticated
  Agentverse API at `/v1/almanac/agents/:address` (bare `/almanac/...` routes to
  the website — use `/v1/`). Protocol manifests by digest 404 on the public API,
  so typed-model reconstruction falls back to chat protocol / README.
- **Gateway-only writer**: agents never touch the store; the orchestrator writes
  `space.json` and the intent feed. Swap for Redis later without touching callers.
- `AGENTVERSE_API_KEY` is a secret — keep it in `deadbolt/.env` (gitignored) only.
