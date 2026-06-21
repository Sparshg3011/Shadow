"""Local HTTP endpoint so middleware can POST a list of instructions.

POST /instructions
    body:    {"instructions": ["open notes", "type hello"]}
    header:  Authorization: Bearer <token>   (only if SHADOW_HTTP_TOKEN is set)
    returns: 202 {"accepted": ["<id>", ...], "count": N}

Each instruction is enqueued and run sequentially by the agent, emitting the
same status/step/done events the UI already reacts to.

GET /health -> {"status": "ok"}
"""
import logging
import sys
import threading
from typing import Callable

from flask import Flask, jsonify, request

from config import Config


def start_http(enqueue: Callable[[str, str], str], cfg: Config) -> None:
    """Start the Flask server on a daemon thread. `enqueue(instruction, source) -> id`."""
    app = Flask(__name__)
    logging.getLogger("werkzeug").setLevel(logging.WARNING)

    def authorized() -> bool:
        if not cfg.http_token:
            return True
        return request.headers.get("Authorization") == f"Bearer {cfg.http_token}"

    @app.post("/instructions")
    def instructions():
        if not authorized():
            return jsonify({"error": "unauthorized"}), 401
        data = request.get_json(silent=True) or {}
        items = data.get("instructions")
        if not isinstance(items, list) or not all(isinstance(x, str) for x in items):
            return jsonify({"error": "'instructions' must be a list of strings"}), 400
        ids = [enqueue(x.strip(), "api") for x in items if x.strip()]
        return jsonify({"accepted": ids, "count": len(ids)}), 202

    @app.get("/health")
    def health():
        return jsonify({"status": "ok"})

    def run():
        print(
            f"[sidecar] instruction endpoint on http://{cfg.http_host}:{cfg.http_port}/instructions"
            + ("" if cfg.http_token else "  (no token — set SHADOW_HTTP_TOKEN to require auth)"),
            file=sys.stderr,
        )
        app.run(host=cfg.http_host, port=cfg.http_port, threaded=True)

    threading.Thread(target=run, daemon=True).start()
