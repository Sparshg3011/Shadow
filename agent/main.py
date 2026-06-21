"""Shadow Python sidecar — bridges Electron (stdio) and middleware (HTTP) to Agent-S.

Commands arrive two ways and feed one sequential task queue:
  - stdin JSON: {"type":"run_task","id":"...","instruction":"..."} / {"type":"cancel"}
  - HTTP POST /instructions: {"instructions": [...]}  (see http_server.py)

Events stream on stdout, one JSON object per line:
  ready / queued / status / step / screenshot / done / error  (each carries the task id)

stdout is reserved for JSON only — Agent-S and its deps print to stdout, so we
redirect their output to stderr up front.
"""
import json
import os
import queue
import sys
import threading
import uuid

# Reserve real stdout for JSON; send everything else (library prints, logs) to stderr.
_OUT = sys.stdout
sys.stdout = sys.stderr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import Config  # noqa: E402
from http_server import start_http  # noqa: E402


def build_runner(cfg: Config):
    """Pick the automation engine: native computer-use (default) or Agent-S."""
    if cfg.engine == "agent-s":
        from agent_runner import AgentRunner
        return AgentRunner(cfg)
    from native_engine import NativeRunner
    return NativeRunner(cfg)


class Sidecar:
    def __init__(self):
        self._queue: queue.Queue = queue.Queue()
        self._cancel = threading.Event()
        self._runner = None  # built lazily on first task
        self._current_id = None
        self._results: dict = {}   # task_id -> terminal event (sync callers only)
        self._events: dict = {}    # task_id -> threading.Event (sync callers only)

    def send(self, event: dict):
        _OUT.write(json.dumps(event) + "\n")
        _OUT.flush()

    def enqueue(self, instruction: str, source: str) -> str:
        task_id = str(uuid.uuid4())
        self._queue.put((task_id, instruction))
        self.send({"type": "queued", "id": task_id, "instruction": instruction, "source": source})
        return task_id

    def run_sync(self, instruction: str, timeout: float = 300.0) -> dict:
        """Enqueue and block until the task finishes; return its verdict."""
        task_id = str(uuid.uuid4())
        done = threading.Event()
        self._events[task_id] = done
        self._queue.put((task_id, instruction))
        self.send({"type": "queued", "id": task_id, "instruction": instruction, "source": "api"})

        finished = done.wait(timeout)
        self._events.pop(task_id, None)
        result = self._results.pop(task_id, None)

        if not finished or result is None:
            return {"id": task_id, "instruction": instruction,
                    "verdict": "rejected", "reason": "timed out", "summary": ""}
        if result.get("type") == "error":
            return {"id": task_id, "instruction": instruction,
                    "verdict": "rejected", "reason": result.get("message", ""), "summary": ""}
        if result.get("type") == "cancelled":
            return {"id": task_id, "instruction": instruction,
                    "verdict": "rejected", "reason": "cancelled", "summary": ""}
        return {"id": task_id, "instruction": instruction,
                "verdict": result.get("verdict", "approved"),
                "reason": result.get("reason", ""),
                "summary": result.get("summary", "")}

    def handle_stdin(self, cmd: dict):
        ctype = cmd.get("type")
        if ctype == "run_task":
            task_id = cmd.get("id") or str(uuid.uuid4())
            self._queue.put((task_id, cmd.get("instruction", "")))
            self.send({"type": "queued", "id": task_id,
                       "instruction": cmd.get("instruction", ""), "source": "ui"})
        elif ctype == "cancel":
            self._drain()
            self._cancel.set()

    def _drain(self):
        """Discard pending tasks (used on cancel)."""
        try:
            while True:
                self._queue.get_nowait()
                self._queue.task_done()
        except queue.Empty:
            pass

    def _worker(self):
        while True:
            task_id, instruction = self._queue.get()
            self._current_id = task_id
            self._cancel.clear()

            def emit(ev: dict):
                self.send({**ev, "id": task_id})
                # Hand the terminal result to any sync caller waiting on this task.
                if ev.get("type") in ("done", "error", "cancelled"):
                    waiter = self._events.get(task_id)
                    if waiter:
                        self._results[task_id] = ev
                        waiter.set()

            try:
                if self._runner is None:
                    self._runner = build_runner(Config.load())
                self._runner.run(instruction, emit, should_cancel=self._cancel.is_set)
            except Exception as exc:
                emit({"type": "error", "code": "unknown", "message": str(exc)})
            finally:
                self._current_id = None
                self._queue.task_done()

    def loop(self):
        cfg = Config.load()
        threading.Thread(target=self._worker, daemon=True).start()
        start_http(self.enqueue, self.run_sync, cfg)
        self.send({"type": "ready"})

        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except json.JSONDecodeError:
                self.send({"type": "error", "code": "unknown", "message": "invalid JSON command"})
                continue
            self.handle_stdin(cmd)


if __name__ == "__main__":
    Sidecar().loop()
