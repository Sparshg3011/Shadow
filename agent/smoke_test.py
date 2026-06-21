"""Milestone 1 smoke test — run before any app code.

Validates the riskiest pieces in isolation:
  1. Screen Recording permission (the capture is not black).
  2. UI-TARS grounding via OpenRouter returns coordinates.
  3. Retina scaling — the predicted point maps to the right place on screen.

Non-destructive: it only MOVES the cursor, never clicks.
Run: agent/.venv/bin/python agent/smoke_test.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pyautogui

from config import Config
from screenshot import capture_obs, looks_blank


def main() -> int:
    cfg = Config.load()
    if not cfg.openrouter_api_key:
        print("FAIL: OPENROUTER_API_KEY is missing in .env")
        return 1

    print("1) Permission check ...")
    if looks_blank():
        print("FAIL: the screen capture is black.")
        print("      Grant Screen Recording to your terminal under")
        print("      System Settings > Privacy & Security > Screen Recording, then retry.")
        return 1
    print("   OK — screen captured.")

    sw, sh = pyautogui.size()
    obs, gw, gh = capture_obs(sw, sh)  # sent-image dims drive the grounding space
    print(f"2) Logical screen {sw}x{sh}, sent image {gw}x{gh}")

    # Import here so a missing dependency surfaces after the permission check.
    from gui_agents.s3.agents.grounding import OSWorldACI

    grounding = OSWorldACI(
        env=None,
        platform="darwin",
        engine_params_for_generation=cfg.generation_engine_params(),
        engine_params_for_grounding=cfg.grounding_engine_params(gw, gh),
        width=sw,
        height=sh,
    )

    target = (
        "the Apple menu icon, the small Apple logo at the very top-left corner "
        "of the macOS menu bar"
    )
    print(f"3) Grounding target: {target}")
    grounding.assign_screenshot(obs)
    try:
        raw = grounding.generate_coords(target, obs)
    except Exception as exc:  # surface OpenRouter/model failures clearly
        print(f"FAIL: grounding call failed: {exc}")
        return 1

    screen_xy = grounding.resize_coordinates(raw)
    print(f"   UI-TARS raw coords: {raw}  ->  screen: {screen_xy}")

    pyautogui.moveTo(screen_xy[0], screen_xy[1], duration=0.6)
    print("   Cursor moved to the predicted point (no click).")

    ok = screen_xy[0] < sw * 0.15 and screen_xy[1] < 60
    print(
        "RESULT: PASS — point is in the expected top-left region."
        if ok
        else "RESULT: REVIEW — point is outside the expected region; check the cursor."
    )
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
