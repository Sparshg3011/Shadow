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

## Customizing the avatar

The default avatar is bundled, so it works offline. To use your own, create one at
[readyplayer.me](https://readyplayer.me) and set the GLB URL (include `?morphTargets=ARKit` for
blink/lip movement):

```bash
# .env
VITE_SHADOW_AVATAR_URL=https://models.readyplayer.me/<your-id>.glb?morphTargets=ARKit
```

## Credits

Default avatar from the [TalkingHead](https://github.com/met4citizen/TalkingHead) project, created
with [Ready Player Me](https://readyplayer.me) (CC BY-NC-SA — non-commercial). Desktop automation by
[Simular Agent-S](https://github.com/simular-ai/Agent-S). Visual grounding by
[UI-TARS](https://huggingface.co/ByteDance-Seed/UI-TARS-1.5-7B).
