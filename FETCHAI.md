# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies (activate venv first)
pip install -r requirements.txt

# Copy and fill in environment variables
cp .env.example .env

# Run the orchestrator (port 8000)
python -m orchestrator.agent

# Run the Amazon search agent (port 8001)
python -m search_agent.agent

# Run the restaurant agent (port 8002)
python -m restaurant_agent.agent
```

All three agents can run simultaneously in separate terminals. There is no test suite.

## Architecture

This is a **Fetch.ai (uAgents) multi-agent system** with three agents that communicate via the **Agent Chat Protocol** (`chat_protocol_spec`). All agents register with Agentverse mailboxes so they can receive messages from ASI:One.

```
ASI:One / Middleware
        │
        ▼
shadow-orchestrator (port 8000)
  ├── REST POST /classify  (synchronous middleware channel)
  └── ChatMessage handler  (async ASI:One channel)
        │
        ├── amazon_grocery_order ──▶ shadow-amazon-search (port 8001)
        └── restaurant_reservation ──▶ shadow-restaurant-search (port 8002)
```

### Orchestrator (`orchestrator/`)

- **`agent.py`** — entry point. Two inbound channels: `POST /classify` (sync REST) and `ChatMessage` from ASI:One (async). Both forward to the same downstream routing logic.
- **`intent.py`** — calls ASI:One LLM (`asi1` model via OpenAI-compatible endpoint) to classify queries into `amazon_grocery_order`, `restaurant_reservation`, or `unknown`. Add new skills by appending to the `INTENTS` dict and wiring a route in `routing.py`.
- **`routing.py`** — maps intent names to downstream agent addresses (`AMAZON_AGENT_ADDRESS`, `RESTAURANT_AGENT_ADDRESS` from env). `forward_to_downstream()` opens a chat session and registers the pending entry.
- **`session.py`** — bridges async chat replies back to sync REST callers. Uses two in-memory structures: `PENDING` (session_id → entry) and `EXPECT` (downstream addr → FIFO queue of session_ids). Replies are correlated FIFO by sender address because the chat protocol does not echo our `msg_id`.
- **`models.py`** — Pydantic models: `OrchestrateRequest`, `OrchestrateResponse`, `Product`, `HealthResponse`.
- **`chat_utils.py`** — helpers for building/parsing `ChatMessage` objects and `parse_products()` which extracts `Product` objects from downstream reply text (supports `<LinkCard>` tags, markdown links, and bare URLs).

### Amazon Search Agent (`search_agent/`)

- **`agent.py`** — uAgents shell on port 8001. Speaks `chat_protocol_spec`, acks messages, calls `search_amazon_products()`, replies with markdown.
- **`search.py`** — switchable LLM web-search backend (set `SEARCH_PROVIDER` env var):
  - `anthropic` (default): Claude Opus 4.8 + `web_search_20260209` tool with `pause_turn` continuation loop
  - `openai`: GPT-4o Responses API + `web_search_preview`
  - `gemini`: `gemini-3-flash-preview` + Google Search grounding
  - All providers return exactly 5 `[title — price](url)` markdown lines. `_extract_links()` post-filters to ensure URLs contain `/dp/` and are not blocked domains (music, video, audible).

### Restaurant Agent (`restaurant_agent/`)

- **`agent.py`** — uAgents shell on port 8002. Speaks `chat_protocol_spec`, calls `find_restaurants()`.
- **`search.py`** — parses location/date/time/covers from query text with regex, queries **Foursquare Places API** sorted by rating, builds **Yelp reservation URLs** with the parsed parameters, returns up to 5 markdown links.

## Extending with a new skill

1. Add intent name + description to `INTENTS` in `orchestrator/intent.py`.
2. Add `NEW_AGENT_ADDRESS = os.getenv("NEW_AGENT_ADDRESS")` in `orchestrator/routing.py` and add the mapping to `ROUTES`.
3. Add the address to `.env`.
4. Update `_agent_name_for()` and `_name_for_addr()` in `orchestrator/agent.py` for logging/response labeling.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `ASI_ONE_API_KEY` | orchestrator | Intent classification via ASI:One LLM |
| `AGENT_SEED` | orchestrator | Fixes orchestrator's Agentverse identity |
| `AMAZON_AGENT_ADDRESS` | orchestrator | Downstream Amazon agent address |
| `RESTAURANT_AGENT_ADDRESS` | orchestrator | Downstream restaurant agent address |
| `PORT` | orchestrator | REST port (default 8000) |
| `DOWNSTREAM_TIMEOUT` | orchestrator | Seconds to wait for downstream reply (default 45) |
| `FALLBACK_API_URL` | orchestrator | Optional external API for unknown intents |
| `ANTHROPIC_API_KEY` | search_agent | Claude web search (when `SEARCH_PROVIDER=anthropic`) |
| `OPENAI_API_KEY` | search_agent | GPT-4o search (when `SEARCH_PROVIDER=openai`) |
| `GEMINI_API_KEY` | search_agent | Gemini search (when `SEARCH_PROVIDER=gemini`) |
| `SEARCH_PROVIDER` | search_agent | `anthropic` \| `openai` \| `gemini` (default: `anthropic`) |
| `SEARCH_AGENT_SEED` | search_agent | Fixes Amazon agent's Agentverse identity |
| `SEARCH_AGENT_PORT` | search_agent | Port (default 8001) |
| `FOURSQUARE_API_KEY` | restaurant_agent | Foursquare Places search |
| `RESTAURANT_AGENT_SEED` | restaurant_agent | Fixes restaurant agent's Agentverse identity |
| `RESTAURANT_AGENT_PORT` | restaurant_agent | Port (default 8002) |
