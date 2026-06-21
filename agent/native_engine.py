"""Native Anthropic computer-use engine.

One Claude call per step: Claude looks at a screenshot, reasons, and issues an
action — it grounds itself, so there is no separate grounding model or extra
planner/reflection round-trips. Much faster and more coherent than Agent-S, and
Claude's own reasoning text becomes the activity-log detail.

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

COMPUTER_TOOL = "computer_20251124"
COMPUTER_BETA = "computer-use-2025-11-24"

Emit = Callable[[dict], None]


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
        # Seed the first screenshot so the agent can act immediately (saves a step).
        messages = [{"role": "user", "content": [
            {"type": "text", "text": instruction},
            {"type": "image",
             "source": {"type": "base64", "media_type": "image/png",
                        "data": capture_resized_b64(*self.scaled)}},
        ]}]
        emit({"type": "status", "state": "thinking"})

        last_text = ""
        for step in range(self.cfg.max_steps):
            if should_cancel():
                emit({"type": "status", "state": "idle"})
                return

            resp = self.client.beta.messages.create(
                model=self.cfg.gen_model,
                max_tokens=4096,
                thinking={"type": "adaptive"},
                output_config={"effort": self.cfg.effort},
                tools=tools,
                betas=[COMPUTER_BETA],
                messages=messages,
            )

            text = " ".join(b.text for b in resp.content if b.type == "text").strip()
            if text:
                last_text = text
            tool_uses = [b for b in resp.content if b.type == "tool_use"]
            messages.append({"role": "assistant", "content": resp.content})

            if not tool_uses:  # stop_reason: end_turn — task finished
                emit({"type": "done", "screenshot": self._final(), "summary": last_text or "Done."})
                return

            tool_results = []
            for tu in tool_uses:
                inp = tu.input
                action = inp.get("action", "")
                emit({"type": "status", "state": "working"})
                emit({"type": "step", "action": A.ACTION_LABELS.get(action, action),
                      "detail": text[:160], "n": step + 1})

                if should_cancel():
                    emit({"type": "status", "state": "idle"})
                    return
                if action not in ("screenshot", "cursor_position"):
                    A.execute_action(inp, self.screen, self.scaled)
                    time.sleep(self.cfg.action_delay)

                shot = capture_resized_b64(*self.scaled)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu.id,
                    "content": [{"type": "image",
                                 "source": {"type": "base64", "media_type": "image/png", "data": shot}}],
                })
                emit({"type": "screenshot", "data": shot, "final": False})

            messages.append({"role": "user", "content": tool_results})
            _prune_old_images(messages, self.cfg.keep_images)  # keep context (and calls) small
            emit({"type": "status", "state": "thinking"})

        emit({"type": "done", "screenshot": self._final(),
              "summary": (last_text + " (reached the step limit)").strip()})

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
