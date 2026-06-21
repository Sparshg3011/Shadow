"""Execute Anthropic computer-use actions with pyautogui.

Coordinates from the model are in the reported display space; we map them back
to logical screen points (Retina-correct) before acting.
"""
import time

import pyautogui

pyautogui.FAILSAFE = True  # flick the mouse to a corner to abort

# Friendly labels for the activity log.
ACTION_LABELS = {
    "left_click": "click",
    "right_click": "right-click",
    "middle_click": "click",
    "double_click": "double-click",
    "triple_click": "triple-click",
    "mouse_move": "move",
    "left_click_drag": "drag",
    "type": "type",
    "key": "key",
    "scroll": "scroll",
    "wait": "wait",
    "screenshot": "look",
    "cursor_position": "look",
}

# xdotool-style keysyms -> pyautogui key names.
_KEY_ALIASES = {
    "return": "enter", "enter": "enter", "escape": "esc", "esc": "esc",
    "control": "ctrl", "ctrl": "ctrl", "alt": "alt", "option": "option",
    "shift": "shift", "cmd": "command", "command": "command", "super": "command",
    "win": "command", "meta": "command", "tab": "tab", "space": "space",
    "backspace": "backspace", "delete": "delete", "up": "up", "down": "down",
    "left": "left", "right": "right", "page_up": "pageup", "page_down": "pagedown",
    "home": "home", "end": "end",
}


def _key(token: str) -> str:
    return _KEY_ALIASES.get(token.lower(), token.lower())


def _map(coord, screen, scaled):
    """Display-space coordinate -> logical screen point."""
    x, y = coord
    return x * screen[0] / scaled[0], y * screen[1] / scaled[1]


def execute_action(inp: dict, screen: tuple[int, int], scaled: tuple[int, int],
                   scroll_scale: int = 5):
    """Run one computer-use action. Screenshot/cursor_position are no-ops here
    (the caller captures the resulting screen for the tool result)."""
    action = inp.get("action")
    coord = inp.get("coordinate")

    if action in ("left_click", "right_click", "middle_click", "double_click", "triple_click"):
        x, y = _map(coord, screen, scaled)
        if action == "left_click":
            pyautogui.click(x, y)
        elif action == "right_click":
            pyautogui.click(x, y, button="right")
        elif action == "middle_click":
            pyautogui.click(x, y, button="middle")
        elif action == "double_click":
            pyautogui.doubleClick(x, y)
        elif action == "triple_click":
            pyautogui.click(x, y, clicks=3)
    elif action == "mouse_move":
        x, y = _map(coord, screen, scaled)
        pyautogui.moveTo(x, y)
    elif action == "left_click_drag":
        x, y = _map(coord, screen, scaled)
        pyautogui.dragTo(x, y, duration=0.3)
    elif action == "type":
        pyautogui.typewrite(inp.get("text", ""), interval=0.02)
    elif action == "key":
        keys = [_key(k) for k in inp.get("text", "").split("+") if k]
        if keys:
            pyautogui.hotkey(*keys)
    elif action == "scroll":
        if coord:
            x, y = _map(coord, screen, scaled)
            pyautogui.moveTo(x, y)
        # The model's scroll_amount is a few wheel "clicks"; clamp it and scale
        # gently so we nudge instead of flinging past the target.
        amount = max(1, min(int(inp.get("scroll_amount", 3)), 10)) * scroll_scale
        direction = inp.get("scroll_direction", "down")
        if direction in ("down", "up"):
            pyautogui.scroll(amount if direction == "up" else -amount)
        elif direction in ("left", "right"):
            pyautogui.hscroll(amount if direction == "right" else -amount)
    elif action == "wait":
        time.sleep(min(float(inp.get("duration", 1)), 3))
    # screenshot / cursor_position: nothing to do here.
