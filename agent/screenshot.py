"""Screen capture helpers for the result frame and permission checks."""
import base64
import io

import pyautogui
from PIL import Image


class CaptureError(Exception):
    """Raised when the screen cannot be captured (usually missing permission)."""


def scaled_dims(w: int, h: int, max_dim: int = 2400) -> tuple[int, int]:
    """Cap the long edge so the screenshot fits the grounding model's limits."""
    f = min(max_dim / w, max_dim / h, 1)
    return int(w * f), int(h * f)


def capture_obs(screen_w: int, screen_h: int) -> tuple[dict, int, int]:
    """Capture the screen for Agent-S; return (obs, sent_w, sent_h).

    UI-TARS reports coordinates in the sent image's pixel space, so the caller
    uses (sent_w, sent_h) as the grounding dimensions.
    """
    sw, sh = scaled_dims(screen_w, screen_h)
    img = capture_image().resize((sw, sh), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return {"screenshot": buf.getvalue()}, sw, sh


def capture_image():
    """Grab the current screen as a PIL image.

    On macOS a denied Screen Recording permission makes `screencapture` fail;
    we surface that as CaptureError so callers can show clear guidance.
    """
    try:
        return pyautogui.screenshot()
    except Exception as exc:  # screencapture non-zero exit, etc.
        raise CaptureError(str(exc)) from exc


def capture_base64(max_width: int | None = 1600) -> str:
    """Capture the screen as a base64 PNG, optionally downscaled for transport."""
    img = capture_image()
    if max_width and img.width > max_width:
        ratio = max_width / img.width
        img = img.resize((max_width, round(img.height * ratio)))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.standard_b64encode(buf.getvalue()).decode()


def looks_blank(threshold: int = 8) -> bool:
    """True if the screen cannot be captured or is essentially black.

    On macOS this almost always means Screen Recording permission is missing.
    """
    try:
        small = capture_image().convert("L").resize((32, 32))
    except CaptureError:
        return True
    _, brightest = small.getextrema()
    return brightest <= threshold
