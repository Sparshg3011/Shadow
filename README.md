# Shadow

An animated 3D avatar desktop assistant. Type a task; Shadow controls your Mac to do it,
then shows you a screenshot of the result and talks you through what it did.

- **Avatar** — an expressive 3D companion (Ready Player Me + React Three Fiber) that idles,
  blinks, and "talks" while it works.
- **Brain** — by default, Claude's native **computer-use** loop: one model call per step where
  Claude looks at the screen, reasons, and acts (it grounds itself). [Simular Agent-S](https://github.com/simular-ai/Agent-S)
  (Claude planner + UI-TARS grounding) is available as an alternate engine.
- **Body** — an Electron app whose Python sidecar drives the mouse and keyboard.

## Engines

Set `SHADOW_ENGINE` in `.env`:

| `SHADOW_ENGINE` | How it works | Notes |
|---|---|---|
| `native` *(default)* | Anthropic computer-use — **one** Claude call per step; Claude grounds itself | Fastest and most coherent. Needs only `ANTHROPIC_API_KEY`. Tune `SHADOW_EFFORT` (low/medium/high/max) and `SHADOW_GEN_MODEL` (e.g. `claude-sonnet-4-6` for more speed). |
| `agent-s` | Simular Agent-S — Claude plans, UI-TARS grounds, with optional reflection | More moving parts and slower (≈4 model calls/step). Needs `OPENROUTER_API_KEY`; set `SHADOW_REFLECTION=1` to re-enable per-step reflection. |

## Architecture

```
Electron (React + R3F avatar)  <— stdio JSON —>  Python sidecar (Agent-S3)
                                                   ├── Claude  (planner, Anthropic)
                                                   └── UI-TARS (grounding, OpenRouter)
```

## Prerequisites

- macOS, Node 20+, Python 3.10+
- `brew install tesseract` (Agent-S OCR dependency)
- An **Anthropic** API key and an **OpenRouter** API key (with a few dollars of credit —
  UI-TARS is a paid model, ~$0.05–0.30 per task).

## Setup

```bash
# 1. Secrets
cp .env.example .env        # then fill in ANTHROPIC_API_KEY and OPENROUTER_API_KEY

# 2. Python sidecar
python3 -m venv agent/.venv
agent/.venv/bin/pip install -r agent/requirements.txt

# 3. App
npm install
```

### macOS permissions

The first run needs **Screen Recording** and **Accessibility** granted to the app (or to your
terminal/IDE in dev) under System Settings → Privacy & Security. Without them, screenshots come
back black and clicks are ignored.

## Run

```bash
npm run dev
```

Type an instruction (or tap a suggestion chip). Shadow plans the task with Claude, grounds each
action with UI-TARS, performs it, and shows you a screenshot of the result while the avatar speaks
a summary. Use **Stop** or flick the mouse to a screen corner to abort at any time.

## Sending instructions from middleware

The sidecar exposes a local HTTP endpoint so external middleware can submit a **list of
instructions**. They run sequentially through the same agent (the avatar/UI react as for typed
tasks). By default the call **blocks until each task finishes, verifies the result from the final
screen, and returns an approval verdict** — so middleware gets a real outcome, not just an ack.

```bash
curl -X POST http://127.0.0.1:8765/instructions \
  -H "Content-Type: application/json" \
  -d '{"instructions": ["open Notes and type hello"]}'
# -> 200 {
#   "status": "approved",                       // "rejected" if any task failed verification
#   "results": [
#     { "instruction": "open Notes and type hello",
#       "verdict": "approved",                  // per-task verdict
#       "reason": "Notes is open with 'hello' typed",
#       "summary": "...", "id": "..." }
#   ]
# }
```

The verdict comes from a final check: Claude looks at the end screen and judges whether the goal was
met (set `SHADOW_VERIFY=0` to skip it). For long batches, give your HTTP client a generous timeout.
Add `"wait": false` to fire-and-forget instead (returns `202 {"accepted": [...]}` immediately).

Configure host/port and an optional auth token in `.env` (`SHADOW_HTTP_HOST`, `SHADOW_HTTP_PORT`,
`SHADOW_HTTP_TOKEN`). It binds to `127.0.0.1` by default. **This endpoint controls your computer** —
set `SHADOW_HTTP_TOKEN` (sent as `Authorization: Bearer <token>`) before exposing it beyond
localhost. `GET /health` returns `{"status":"ok"}`.

### Remote access from another computer (Cloudflare Tunnel)

To reach the endpoint from another machine, expose it with a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
— it dials out to Cloudflare's edge and hands you a public `https://<name>.trycloudflare.com` URL,
so you never open a firewall port.

```bash
brew install cloudflared      # one-time
npm run dev                   # app + endpoint must be running
npm run tunnel                # prints the public URL + a ready-to-use curl
```

> ⚠️ **A public URL to a computer-control endpoint is dangerous.** The tunnel script **refuses to
> run unless `SHADOW_HTTP_TOKEN` is set**, and every request must send `Authorization: Bearer
> <token>`. The `trycloudflare.com` URL is ephemeral — `Ctrl-C` the tunnel as soon as you're done,
> and rotate the token if it leaks. For anything beyond a quick demo, use a
> [named tunnel with Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
> in front of it.

## Customizing the avatar

The avatar is **model-agnostic**: drop in any rigged GLB and it auto-scales, frames, and animates.
A model with animation clips (like the default fox) loops its idle clip; a face-rigged Ready Player
Me human uses ARKit morphs to blink and lip-sync. Point at your own model with:

```bash
# .env  — e.g. a cat GLB you have the rights to, or your own Ready Player Me avatar
VITE_SHADOW_AVATAR_URL=https://example.com/your-cat.glb
```

or replace `src/renderer/src/assets/avatar.glb`.

## Credits

Default avatar is the public-domain (CC0) low-poly fox from the
[glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) (PixelMannen / tomkranis).
Desktop automation by [Simular Agent-S](https://github.com/simular-ai/Agent-S). Visual grounding by
[UI-TARS](https://huggingface.co/ByteDance-Seed/UI-TARS-1.5-7B).
