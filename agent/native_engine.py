"""Native Anthropic computer-use engine.

One Claude call per step: Claude looks at a screenshot, reasons, and issues an
action — it grounds itself, so there is no separate grounding model or extra
planner/reflection round-trips.

A focused system prompt keeps it self-aware (read the screen, check results,
don't invent URLs), and harness-level loop detection stops it from repeating a
failed action and burning credits.

Exposes NativeRunner.run(instruction, emit, should_cancel) — same contract as
AgentRunner — so the sidecar can use either engine interchangeably.
"""
import os
import sys
import time
import traceback
from typing import Callable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import anthropic
import pyautogui

import actions as A
from config import Config
from screenshot import CaptureError, capture_resized_b64, looks_blank, scaled_dims
from verify import verify

COMPUTER_TOOL = "computer_20251124"
COMPUTER_BETA = "computer-use-2025-11-24"

Emit = Callable[[dict], None]

SYSTEM_PROMPT = """You are Shadow, controlling a macOS computer to complete the user's task. \
You see the screen only through screenshots and act with the mouse and keyboard.

STAY AWARE OF WHAT YOU ARE DOING:
- Look at the latest screenshot before every action and act on what you actually SEE, not on assumptions.
- After acting, check the next screenshot to confirm it worked. If the screen did not change or the action \
failed, do NOT repeat the same action — work out why and try something different.
- Never do the same thing twice expecting a different result. If an action already failed once, change \
your approach. If you are about to repeat it a third time, stop and reconsider, or report that you are stuck.

CLICKING AND SCROLLING:
- To scroll to an off-screen element, scroll a SMALL amount (scroll_amount 1-3), then look at the new \
screenshot before scrolling again. Do not scroll in large jumps or several times in a row — you will fly \
past your target.
- Once the element you want is visible, STOP scrolling and click it. Aim for the centre of a button or \
control, and only click it when it is fully visible and not under another window.

URLS AND NAVIGATION:
- Do NOT invent, guess, or recall URLs from memory — that produces invalid URLs. Only type a URL if the \
user gave you the exact address or you can read it on the current screen.
- To open a site: open the browser, focus the address bar (Cmd+L), select all (Cmd+A), type the exact URL \
or a search query, then press Return.
- To reach a page, prefer clicking a visible link or searching over typing a URL you are unsure about.

MACOS:
- Open or switch to any app via Spotlight: press Cmd+Space, type the app name, press Return — even if it \
looks already open.
- Cmd+A then type replaces a field's contents; Return submits.

BE EFFICIENT AND FINISH:
- Use the fewest actions possible. A fresh screenshot is provided after every action, so do not waste steps \
taking extra screenshots.
- When the task is done, stop and state briefly what you accomplished.
- If the task cannot be completed (a login wall, a missing element, an ambiguous request), stop and explain \
— do not loop."""

_NUDGE = (
    "You appear to be repeating the same action without making progress. Stop. "
    "Look carefully at the current screenshot, determine why your last attempt did not work, and either "
    "take a clearly different action or, if the task cannot be done, stop and explain."
)


def _sig(inp: dict) -> str:
    """A signature identifying an action, for loop detection."""
    return "|".join(str(inp.get(k, "")) for k in ("action", "coordinate", "text", "scroll_direction"))


class NativeRunner:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.client = anthropic.Anthropic(api_key=cfg.anthropic_api_key)
        self.screen = tuple(pyautogui.size())
        self.scaled = scaled_dims(*self.screen, cfg.display_max)

    def run(self, instruction: str, emit: Emit, should_cancel: Callable[[], bool] = lambda: False):
        try:
            self._run(instruction, emit, should_cancel)
        except CaptureError:
            emit(_permission_error())
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            emit({"type": "error", "code": _error_code(exc), "message": str(exc)})

    def _run(self, instruction: str, emit: Emit, should_cancel: Callable[[], bool]):
        if not self.cfg.anthropic_api_key:
            emit({"type": "error", "code": "api", "message": "ANTHROPIC_API_KEY is not set"})
            return
        if looks_blank():
            emit(_permission_error())
            return

        tools = [{
            "type": COMPUTER_TOOL,
            "name": "computer",
            "display_width_px": self.scaled[0],
            "display_height_px": self.scaled[1],
        }]
        system = [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}]
        # Seed the first screenshot so the agent can act immediately (saves a step).
        messages = [{"role": "user", "content": [
            {"type": "text", "text": instruction},
            {"type": "image",
             "source": {"type": "base64", "media_type": "image/png",
                        "data": capture_resized_b64(*self.scaled)}},
        ]}]
        emit({"type": "status", "state": "thinking"})

        last_text = ""
        sigs: list[str] = []
        nudged = False

        for step in range(self.cfg.max_steps):
            if should_cancel():
                emit({"type": "cancelled"})
                return

            resp = self._generate(messages, system, tools, should_cancel)
            if resp is None:  # stop pressed mid-generation
                emit({"type": "cancelled"})
                return

            text = " ".join(b.text for b in resp.content if b.type == "text").strip()
            if text:
                last_text = text
            tool_uses = [b for b in resp.content if b.type == "tool_use"]
            messages.append({"role": "assistant", "content": resp.content})

            if not tool_uses:  # stop_reason: end_turn — task finished
                self._done(emit, instruction, last_text or "Done.")
                return

            tool_results = []
            for tu in tool_uses:
                inp = tu.input
                action = inp.get("action", "")
                emit({"type": "status", "state": "working"})
                emit({"type": "step", "action": A.ACTION_LABELS.get(action, action),
                      "detail": text[:160], "n": step + 1})

                if should_cancel():
                    emit({"type": "cancelled"})
                    return
                if action not in ("screenshot", "cursor_position"):
                    A.execute_action(inp, self.screen, self.scaled, self.cfg.scroll_scale)
                    time.sleep(self.cfg.action_delay)
                sigs.append(_sig(inp))

                shot = capture_resized_b64(*self.scaled)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu.id,
                    "content": [{"type": "image",
                                 "source": {"type": "base64", "media_type": "image/png", "data": shot}}],
                })
                emit({"type": "screenshot", "data": shot, "final": False})

            # Loop detection over the recent action window.
            repeats = sigs[-6:].count(sigs[-1])
            if repeats >= 4:
                messages.append({"role": "user", "content": tool_results})
                self._done(emit, instruction,
                           "I kept repeating the same action without progress, so I stopped.")
                return
            if repeats >= 3 and not nudged:
                tool_results.append({"type": "text", "text": _NUDGE})
                nudged = True
            elif repeats < 3:
                nudged = False

            messages.append({"role": "user", "content": tool_results})
            _prune_old_images(messages, self.cfg.keep_images)
            emit({"type": "status", "state": "thinking"})

        self._done(emit, instruction, (last_text + " (reached the step limit)").strip())

    def _generate(self, messages, system, tools, should_cancel):
        """Stream one response so a stop can abort it mid-generation (instead of
        blocking on a 10-30s call). Returns the final message, or None if cancelled."""
        with self.client.beta.messages.stream(
            model=self.cfg.gen_model,
            max_tokens=4096,
            system=system,
            thinking={"type": "adaptive"},
            output_config={"effort": self.cfg.effort},
            tools=tools,
            betas=[COMPUTER_BETA],
            messages=messages,
        ) as stream:
            for _ in stream:
                if should_cancel():
                    return None
            return stream.get_final_message()

    def _done(self, emit: Emit, instruction: str, summary: str):
        final = self._final()
        verdict, reason = "approved", ""
        if self.cfg.verify and self.cfg.anthropic_api_key:
            verdict, reason = verify(self.cfg.anthropic_api_key, self.cfg.gen_model, instruction, final)
        emit({"type": "done", "screenshot": final, "summary": summary,
              "verdict": verdict, "reason": reason})

    def _final(self) -> str:
        return capture_resized_b64(*self.scaled)


def _prune_old_images(messages: list, keep: int):
    """Replace all but the most recent `keep` screenshots with a placeholder,
    so each step's request stays small as the task grows."""
    if keep <= 0:
        return
    slots = []  # (containing list, index) of every image block
    for msg in messages:
        content = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(content, list):
            continue
        for i, block in enumerate(content):
            if not isinstance(block, dict):
                continue
            if block.get("type") == "image":
                slots.append((content, i))
            elif block.get("type") == "tool_result" and isinstance(block.get("content"), list):
                for j, b in enumerate(block["content"]):
                    if isinstance(b, dict) and b.get("type") == "image":
                        slots.append((block["content"], j))
    for lst, idx in slots[:-keep]:
        lst[idx] = {"type": "text", "text": "(screenshot from an earlier step omitted)"}


def _permission_error() -> dict:
    return {
        "type": "error",
        "code": "permissions",
        "message": (
            "Can't capture the screen. Grant Screen Recording and Accessibility to "
            "Shadow under System Settings > Privacy & Security, then try again."
        ),
    }


def _error_code(exc: Exception) -> str:
    text = str(exc).lower()
    if any(k in text for k in ("api", "auth", "key", "credit", "beta")):
        return "api"
    return "unknown"


def _cli():
    """Manual check: run one instruction with the native engine and print events."""
    cfg = Config.load()
    runner = NativeRunner(cfg)
    print(f"native engine | model {cfg.gen_model} | effort {cfg.effort} | display {runner.scaled}")
    instruction = " ".join(sys.argv[1:]) or input("Instruction: ")

    def emit(ev: dict):
        print("  [screenshot]" if ev["type"] == "screenshot" else f"  {ev}")

    runner.run(instruction, emit)


if __name__ == "__main__":
    _cli()
