"""Shadow Python sidecar — a stdio JSON bridge between Electron and Agent-S.

Reads newline-delimited JSON commands on stdin:
  {"type": "run_task", "id": "...", "instruction": "..."}
  {"type": "cancel",   "id": "..."}

Emits newline-delimited JSON events on stdout (each carries the task id):
  ready / status / step / screenshot / done / error

stdout is reserved for JSON only — Agent-S and its dependencies print to stdout,
so we redirect their output to stderr up front.
"""
import json
import os
import sys
import threading

# Reserve real stdout for JSON; send everything else (library prints, logs) to stderr.
_OUT = sys.stdout
sys.stdout = sys.stderr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_runner import AgentRunner  # noqa: E402
from config import Config  # noqa: E402


class Sidecar:
    def __init__(self):
        self._lock = threading.Lock()
        self._current_id = None
        self._cancel = threading.Event()
        self._runner = None  # built lazily on first task

    def send(self, event: dict):
        _OUT.write(json.dumps(event) + "\n")
        _OUT.flush()

    def handle(self, cmd: dict):
        ctype = cmd.get("type")
        if ctype == "run_task":
            self._start(cmd.get("id"), cmd.get("instruction", ""))
        elif ctype == "cancel":
            self._cancel.set()

    def _start(self, task_id, instruction: str):
        with self._lock:
            if self._current_id is not None:
                self.send({"type": "error", "id": task_id, "code": "busy",
                           "message": "A task is already running."})
                return
            self._current_id = task_id
            self._cancel.clear()
        threading.Thread(target=self._worker, args=(task_id, instruction), daemon=True).start()

    def _worker(self, task_id, instruction: str):
        def emit(ev: dict):
            self.send({**ev, "id": task_id})

        try:
            if self._runner is None:
                self._runner = AgentRunner(Config.load())
            self._runner.run(instruction, emit, should_cancel=self._cancel.is_set)
        except Exception as exc:  # building or running blew up
            emit({"type": "error", "code": "unknown", "message": str(exc)})
        finally:
            with self._lock:
                self._current_id = None

    def loop(self):
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
            self.handle(cmd)


if __name__ == "__main__":
    Sidecar().loop()
