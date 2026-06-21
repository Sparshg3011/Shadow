# shadow-orchestrator

A Fetch.ai (uAgents) **orchestrator agent** that classifies user intent and
routes requests to specialized downstream agents. v1 supports one downstream
skill: **Amazon grocery ordering** (an existing Agentverse agent).

It accepts queries from two channels:

| Channel    | Transport                         | Used by    |
|------------|-----------------------------------|------------|
| Middleware | REST `POST /classify` (sync JSON) | your backend |
| ASI:One    | Agent Chat Protocol (`ChatMessage`) | ASI:One / Agentverse chat |

Intent is classified with the **ASI:One LLM** (`asi1`). For
`amazon_grocery_order`, the query is forwarded to the Amazon agent over the chat
protocol; the purchasable links + product details are returned to whichever
caller originated the request.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env      # then fill in ASI_ONE_API_KEY and AGENT_SEED
```

Get an ASI:One API key at https://asi1.ai/developer. To keep the same address
as your marketplace agent (`@shadow-orches`), set `AGENT_SEED` to that agent's
seed.

## Run

```bash
python -m orchestrator.agent
```

On start it prints the agent address and registers via Mailbox so ASI:One /
Agentverse can reach it. The chat protocol manifest is published so the agent is
discoverable on ASI:One.

## Endpoints

**Middleware classify (sync):**

```bash
curl -X POST localhost:8000/classify \
  -H 'content-type: application/json' \
  -d '{"query":"order 2 dozen eggs and milk from amazon"}'
```

Response:

```json
{
  "session_id": "…",
  "intent": "amazon_grocery_order",
  "status": "ok",
  "message": "…raw downstream reply…",
  "products": [{"title": "…", "url": "https://…", "price": "$4.99"}]
}
```

`status` is one of `ok | unknown_intent | timeout | error`.

**Health:** `GET localhost:8000/health`

## Architecture notes

- REST is synchronous but agent-to-agent chat replies are async. We bridge with
  an in-memory pending-session map (`session.py`): the REST handler awaits an
  `asyncio.Future` resolved when the downstream reply arrives. ASI:One chat
  requests are answered asynchronously with a follow-up `ChatMessage`.
- Replies are correlated FIFO per downstream address (chat replies don't echo
  our `msg_id`). If the downstream agent later echoes a reference id, switch to
  exact-id matching.

## Extending with new skills

1. Add an intent name + description to `INTENTS` in `intent.py`.
2. Map it to a downstream agent address in `ROUTES` in `routing.py`.

That's it — classification and routing pick it up automatically.

## Out of scope (v1)

- `AgentPaymentProtocol` auto-pay flow (RequestPayment is not yet handled).
- Persistent session store (current map is in-memory, single-process).
