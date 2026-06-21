"""Agent-S run loop: Claude plans, UI-TARS grounds, pyautogui acts.

Exposes AgentRunner.run(instruction, emit, should_cancel), which streams events
(status / step / screenshot / done / error) through the `emit` callback so the
sidecar can forward them to the UI.
"""
import os
import sys
import time
import traceback
from typing import Callable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pyautogui

from config import Config
from screenshot import (
    CaptureError,
    capture_base64,
    capture_obs,
    looks_blank,
    scaled_dims,
)
from verify import verify

# Moving the mouse to a screen corner aborts execution — a manual kill switch.
pyautogui.FAILSAFE = True

Emit = Callable[[dict], None]

_LABELS = [
    ("doubleclick", "double-click"),
    ("rightclick", "right-click"),
    ("click", "click"),
    ("typewrite", "type"),
    ("press", "key"),
    ("hotkey", "shortcut"),
    ("scroll", "scroll"),
    ("moveto", "move"),
    ("dragto", "drag"),
]


def _action_label(code: str) -> str:
    low = code.lower()
    for needle, label in _LABELS:
        if needle in low:
            return label
    return "action"


def _detail(info: dict) -> str:
    """Short, human-readable note about the current step from Agent-S info."""
    text = (info or {}).get("plan") or (info or {}).get("reflection") or ""
    line = text.strip().splitlines()[0] if text.strip() else ""
    return line[:140]


class AgentRunner:
    """Builds Agent-S once and runs tasks against it."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.screen_w, self.screen_h = pyautogui.size()
        # Grounding dims = the size of the screenshots we actually send.
        self.ground_w, self.ground_h = scaled_dims(self.screen_w, self.screen_h)

        # Make Agent-S's Anthropic engine compatible with current Claude models.
        import anthropic_patch
        anthropic_patch.apply()

        from gui_agents.s3.agents.agent_s import AgentS3
        from gui_agents.s3.agents.grounding import OSWorldACI

        gen_params = cfg.generation_engine_params()
        grounding = OSWorldACI(
            env=None,  # no local code execution — actions are pyautogui only
            platform="darwin",
            engine_params_for_generation=gen_params,
            engine_params_for_grounding=cfg.grounding_engine_params(self.ground_w, self.ground_h),
            width=self.screen_w,
            height=self.screen_h,
        )
        self.agent = AgentS3(
            gen_params,
            grounding,
            platform="darwin",
            max_trajectory_length=cfg.traj_window,
            enable_reflection=cfg.reflection,  # off by default for speed
        )

    def run(self, instruction: str, emit: Emit, should_cancel: Callable[[], bool] = lambda: False,
            mode: str = "hands-on"):  # mode is honored by the native engine; Agent-S runs hands-on
        """Run a task to completion, emitting events. Never raises."""
        try:
            self._run(instruction, emit, should_cancel)
        except CaptureError:
            emit(_permission_error())
        except Exception as exc:  # keep the sidecar alive on any failure
            traceback.print_exc(file=sys.stderr)
            emit({"type": "error", "code": _error_code(exc), "message": str(exc)})

    def _run(self, instruction: str, emit: Emit, should_cancel: Callable[[], bool]):
        missing = self.cfg.missing_keys()
        if missing:
            emit({"type": "error", "code": "api",
                  "message": "Missing key(s): " + ", ".join(missing)})
            return
        if looks_blank():
            emit(_permission_error())
            return

        self.agent.reset()
        emit({"type": "status", "state": "thinking"})

        obs: dict = {}
        for step in range(self.cfg.max_steps):
            if should_cancel():
                emit({"type": "status", "state": "idle"})
                return

            obs_frame, _, _ = capture_obs(self.screen_w, self.screen_h)
            obs["screenshot"] = obs_frame["screenshot"]

            info, code = self.agent.predict(instruction=instruction, observation=obs)
            action = code[0]
            low = action.lower()

            if "fail" in low:
                emit(self._done(info, instruction, ok=False))
                return
            if "done" in low:
                emit(self._done(info, instruction, ok=True))
                return
            if "next" in low:
                continue
            if "wait" in low:
                time.sleep(1.0)
                continue

            emit({"type": "status", "state": "working"})
            emit({"type": "step", "action": _action_label(action),
                  "detail": _detail(info), "n": step + 1})

            if should_cancel():
                emit({"type": "status", "state": "idle"})
                return

            exec(action, {})  # the pyautogui code Agent-S emitted (self-contained)
            time.sleep(self.cfg.action_delay)
            emit({"type": "screenshot", "data": capture_base64(1200), "final": False})

        emit(self._verified_done(instruction,
             "I hit the step limit before finishing — here's where I got to."))

    def _done(self, info: dict, instruction: str, ok: bool) -> dict:
        if ok:
            summary = "Done! " + (_detail(info) or f"Completed: {instruction}")
        else:
            summary = "I couldn't complete that. " + (_detail(info) or "")
        return self._verified_done(instruction, summary)

    def _verified_done(self, instruction: str, summary: str) -> dict:
        final = capture_base64(1280)
        verdict, reason = "approved", ""
        if self.cfg.verify and self.cfg.anthropic_api_key:
            verdict, reason = verify(self.cfg.anthropic_api_key, self.cfg.gen_model, instruction, final)
        return {"type": "done", "screenshot": final, "summary": summary.strip(),
                "verdict": verdict, "reason": reason}


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
    if "api" in text or "auth" in text or "key" in text or "credit" in text:
        return "api"
    return "unknown"


def _cli():
    """Manual milestone-2 check: run one instruction and print events."""
    cfg = Config.load()
    runner = AgentRunner(cfg)
    print(f"screen {runner.screen_w}x{runner.screen_h}, grounding {runner.ground_w}x{runner.ground_h}")
    instruction = " ".join(sys.argv[1:]) or input("Instruction: ")

    def emit(ev: dict):
        if ev["type"] == "screenshot":
            print("  [screenshot frame]")
        else:
            print(" ", ev)

    runner.run(instruction, emit)


if __name__ == "__main__":
    _cli()
