"""Local HTTP endpoint so middleware can POST a list of instructions.

POST /instructions
    body:    {"instructions": ["open notes", "type hello"], "wait": true}
    header:  Authorization: Bearer <token>   (only if SHADOW_HTTP_TOKEN is set)

    Default (wait=true): runs each instruction to completion, verifies the
    result, and returns an approval verdict:
        200 {"status": "approved"|"rejected",
             "results": [{"instruction", "verdict", "reason", "summary", "id"}, ...]}
    Fire-and-forget (wait=false): queues and returns immediately:
        202 {"accepted": ["<id>", ...], "count": N}

GET /health -> {"status": "ok"}
"""
import logging
import sys
import threading
from typing import Callable

from flask import Flask, jsonify, request

from config import Config


def start_http(enqueue: Callable[[str, str], str],
               run_sync: Callable[[str], dict],
               cfg: Config) -> None:
    """Start the Flask server on a daemon thread.

    enqueue(instruction, source) -> id   (fire-and-forget)
    run_sync(instruction) -> verdict dict (blocks until done + verified)
    """
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

        cleaned = [x.strip() for x in items if x.strip()]
        if data.get("wait", True) is False:
            ids = [enqueue(x, "api") for x in cleaned]
            return jsonify({"accepted": ids, "count": len(ids)}), 202

        # Synchronous: run each, verify, and return an approval verdict.
        results = [run_sync(x) for x in cleaned]
        approved = bool(results) and all(r["verdict"] == "approved" for r in results)
        return jsonify({"status": "approved" if approved else "rejected", "results": results}), 200

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
