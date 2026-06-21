# shadow-amazon-search

A Fetch.ai (uAgents) **downstream agent** that turns a free-form request
("I want milk") into **5 purchasable Amazon product links**.

It is the reliable replacement for the previous third-party Agentverse Amazon
agent: the [shadow-orchestrator](../README.md) forwards a query over the Agent
Chat Protocol, this agent searches the web using **Claude (Opus 4.8) + the
native web-search tool**, and replies with markdown links the orchestrator
parses into product details.

```
shadow-orchestrator ──chat query──▶ shadow-amazon-search
                    ◀──5 markdown links──┘ (Claude web_search under the hood)
```

## Setup

```bash
pip install -r ../requirements.txt
# In ../.env set:
#   ANTHROPIC_API_KEY=...        (https://console.anthropic.com)
#   SEARCH_AGENT_SEED=...        (keep stable to keep the same address)
```

## Run

```bash
python -m search_agent.agent
```

On start it prints the agent address. That address is already wired into
`AMAZON_AGENT_ADDRESS` in `../.env` (it is deterministic from
`SEARCH_AGENT_SEED`), so the orchestrator routes to it automatically.

## How it works

- `agent.py` — the uAgents shell. Speaks `chat_protocol_spec`, acks inbound
  messages, and replies with the link list. Runs on port `8001` by default.
- `search.py` — one `client.messages.create` call to `claude-opus-4-8` with the
  `web_search_20260209` tool, system-prompted to return exactly 5 Amazon links
  as `[title — price](url)` lines and nothing else. Handles the server-side
  tool loop (`pause_turn`) and strips any stray prose before returning.

## Contract with the orchestrator

The orchestrator's `parse_products()` extracts `[title](url)` markdown links (and
prices found on the same line) into `Product` objects, and correlates this
agent's reply FIFO by sender address. So the only requirement here is: reply
with one chat message whose text is clean markdown links.
