"""Grounding-only check — validates UI-TARS via OpenRouter without screen permission.

Builds a synthetic screen image with a known button, asks UI-TARS to locate it,
and verifies the returned coordinate lands on the button. Proves auth + image input
+ coordinate parsing + the grounding->screen coordinate rescaling end to end.

Run: agent/.venv/bin/python agent/grounding_check.py
"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw, ImageFont

from config import Config

try:
    import pyautogui

    SCREEN_W, SCREEN_H = pyautogui.size()
except Exception:
    SCREEN_W, SCREEN_H = 1512, 982


def load_font(size: int):
    for path in (
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNS.ttf",
        "/Library/Fonts/Arial.ttf",
    ):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


def build_image(w: int, h: int):
    """A plausible app screen with a clear green 'Continue' button as the target."""
    img = Image.new("RGB", (w, h), (236, 238, 242))
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, w, 32], fill=(250, 250, 252))
    d.text((16, 8), "Demo App", fill=(40, 40, 40), font=load_font(16))

    cx, cy, cw, ch = int(w * 0.32), int(h * 0.30), int(w * 0.36), int(h * 0.40)
    d.rounded_rectangle(
        [cx, cy, cx + cw, cy + ch], radius=16, fill=(255, 255, 255),
        outline=(210, 214, 220), width=2,
    )
    d.text((cx + 24, cy + 24), "Sign in", fill=(20, 20, 20), font=load_font(26))

    fx, fy, fw, fh = cx + 24, cy + 80, cw - 48, 44
    d.rounded_rectangle(
        [fx, fy, fx + fw, fy + fh], radius=8, fill=(245, 246, 248),
        outline=(205, 209, 215), width=1,
    )
    d.text((fx + 12, fy + 12), "you@example.com", fill=(150, 150, 150), font=load_font(16))

    bx, by, bw, bh = cx + 24, cy + ch - 72, 180, 48
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=10, fill=(34, 160, 90))
    label, f = "Continue", load_font(20)
    tb = d.textbbox((0, 0), label, font=f)
    d.text(
        (bx + (bw - (tb[2] - tb[0])) // 2, by + (bh - (tb[3] - tb[1])) // 2 - tb[1]),
        label, fill=(255, 255, 255), font=f,
    )
    return img, (bx, by, bx + bw, by + bh)


def main() -> int:
    cfg = Config.load()
    if not cfg.openrouter_api_key:
        print("FAIL: OPENROUTER_API_KEY is missing in .env")
        return 1

    img, (bx0, by0, bx1, by1) = build_image(SCREEN_W, SCREEN_H)
    img.save("/tmp/shadow_grounding_test.png")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    obs = {"screenshot": buf.getvalue()}

    from gui_agents.s3.agents.grounding import OSWorldACI

    # The synthetic image is sent at full screen size, so grounding dims match it.
    grounding = OSWorldACI(
        env=None,
        platform="darwin",
        engine_params_for_generation=cfg.generation_engine_params(),
        engine_params_for_grounding=cfg.grounding_engine_params(SCREEN_W, SCREEN_H),
        width=SCREEN_W,
        height=SCREEN_H,
    )
    grounding.assign_screenshot(obs)

    target = "the green Continue button"
    print(f"image {SCREEN_W}x{SCREEN_H} | target '{target}' | button ({bx0},{by0})-({bx1},{by1})")
    try:
        raw = grounding.generate_coords(target, obs)
    except Exception as exc:
        print(f"FAIL: grounding call failed: {exc}")
        return 1

    x, y = grounding.resize_coordinates(raw)
    print(f"raw {raw} -> screen ({x},{y})")

    inside = bx0 <= x <= bx1 and by0 <= y <= by1
    margin = 25
    near = (bx0 - margin) <= x <= (bx1 + margin) and (by0 - margin) <= y <= (by1 + margin)
    if inside:
        print("RESULT: PASS — landed inside the button.")
    elif near:
        print("RESULT: PASS (within margin) — within 25px of the button.")
    else:
        print("RESULT: FAIL — outside the button. See /tmp/shadow_grounding_test.png; "
              "check the grounding coordinate space.")
    return 0 if near else 2


if __name__ == "__main__":
    sys.exit(main())
