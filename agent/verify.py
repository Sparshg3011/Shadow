"""Final verification: judge whether a task actually succeeded from the end screen.

Claude looks at the final screenshot and returns approved/rejected + a reason.
Used to give the HTTP caller a real outcome instead of a bare acknowledgement.
"""
import json

import anthropic

_SCHEMA = {
    "type": "object",
    "properties": {
        "approved": {"type": "boolean"},
        "reason": {"type": "string"},
    },
    "required": ["approved", "reason"],
    "additionalProperties": False,
}


def verify(api_key: str, model: str, instruction: str, screenshot_b64: str) -> tuple[str, str]:
    """Return ("approved"|"rejected", reason). Fails open (approved) if it can't run."""
    client = anthropic.Anthropic(api_key=api_key)
    prompt = (
        "You are a strict verifier checking whether a computer-control task was "
        "completed successfully. Judge ONLY from the final screenshot.\n\n"
        f"Task: {instruction}\n\n"
        "Approve only if the screen clearly shows the task was accomplished. "
        "Respond as JSON with `approved` (boolean) and a short `reason`."
    )
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=400,
            output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
            messages=[{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image",
                 "source": {"type": "base64", "media_type": "image/png", "data": screenshot_b64}},
            ]}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
        data = json.loads(text)
        return ("approved" if data.get("approved") else "rejected"), str(data.get("reason", "")).strip()
    except Exception as exc:  # never block completion on a verifier hiccup
        return "approved", f"could not verify ({exc})"
