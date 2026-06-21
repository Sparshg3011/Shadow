# Shadow

An animated 3D avatar desktop assistant. Type a task; Shadow controls your Mac to do it,
then shows you a screenshot of the result and talks you through what it did.

- **Avatar** — an expressive 3D companion (Ready Player Me + React Three Fiber) that idles,
  blinks, and "talks" while it works.
- **Brain** — Claude (Anthropic) plans the task; UI-TARS-1.5-7B (via OpenRouter) grounds each
  action to on-screen coordinates, orchestrated by [Simular Agent-S](https://github.com/simular-ai/Agent-S).
- **Body** — an Electron app whose Python sidecar drives the mouse and keyboard.

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
instructions**. They're queued and run sequentially through the same agent, and the avatar/UI react
just as they do for typed tasks.

```bash
curl -X POST http://127.0.0.1:8765/instructions \
  -H "Content-Type: application/json" \
  -d '{"instructions": ["open Notes", "type hello", "take a screenshot"]}'
# -> 202 {"accepted": ["<id>", ...], "count": 3}
```

Configure host/port and an optional auth token in `.env` (`SHADOW_HTTP_HOST`, `SHADOW_HTTP_PORT`,
`SHADOW_HTTP_TOKEN`). It binds to `127.0.0.1` by default. **This endpoint controls your computer** —
set `SHADOW_HTTP_TOKEN` (sent as `Authorization: Bearer <token>`) before exposing it beyond
localhost. `GET /health` returns `{"status":"ok"}`.

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
