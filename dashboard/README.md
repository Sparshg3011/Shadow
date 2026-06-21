# Agent Place Dashboard

A live **control plane** for the Agent Place agent marketplace. It reads only from
the orchestrator (Python uAgents, `:8000`) and shows three things at once:

- **Fetch.ai Marketplace** — live search of the Agentverse marketplace. Type a
  domain (groceries, payments, travel…) and browse real agents — discoverable
  but untrusted (the Agent Place rule: agents plan, they never execute on their own).
- **Wired Routes** — the agents the orchestrator currently routes to, enriched
  with live marketplace metadata (avatar, interaction count, online status).
- **Intent Feed** — every request flowing through the gate, with its live status
  (`classifying → routing → ok` / `timeout` / `unknown_intent`).

It is a standalone Vite + React app. The browser talks only to `/api`, which
Vite proxies to the orchestrator — so no API keys and no CORS in the browser.
The orchestrator stays the single trusted reader/writer.

```
 Browser ──/api──▶ Vite proxy ──▶ orchestrator :8000 ──▶ Agentverse marketplace
 (dashboard)                       (GET /agents, /intents,    (live agent search)
                                    POST /marketplace/search)
```

## Run

This folder is a standalone Vite + React app:

```bash
cd dashboard
npm install
npm run dev          # http://localhost:5273
```

It expects the Agent Place **orchestrator** (the Python uAgents backend) running on
`http://localhost:8000` — Vite proxies `/api` → that origin (override with the
`ORCHESTRATOR_URL` env var). The dashboard is read-mostly: it browses the live
Agentverse marketplace, lists agents in your space, and posts intents through the
gate. Without the orchestrator up, panels show their loading/empty states.

## Dashboard endpoints (added to the orchestrator)

| Method | Path                   | Returns                                            |
|--------|------------------------|----------------------------------------------------|
| GET    | `/health`              | `{status, agent_address}`                          |
| GET    | `/agents`              | wired routes + live marketplace enrichment         |
| GET    | `/intents`             | recent intent feed + headline stats                |
| POST   | `/marketplace/search`  | `{search_text, limit}` → live Agentverse agents    |
| POST   | `/agents/register`     | add a marketplace agent to your space              |
| POST   | `/agents/remove`       | remove an agent from your space                    |
| GET    | `/space`               | added agents + their deflection policy             |
| POST   | `/agents/resolve`      | resolve an agent's contract (status/protocols/chat)|
| POST   | `/classify`            | run an intent through the gate (existing endpoint) |

## Config

- `ORCHESTRATOR_URL` (env) — proxy target, default `http://localhost:8000`.
- Vite dev port is `5273` (see `vite.config.ts` / `.claude/launch.json`).
