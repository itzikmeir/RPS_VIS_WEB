#!/usr/bin/env python3
"""
Local live-test dashboard for the RPS_VIS experiment.

Serves test_dashboard.html plus a small JSON API that:
  - lists all participants + the scheduled scenarios for one of them, in run
    order, with the ground-truth "was the AI recommendation correct?" flag
    from the schedule (GET /api/participants, GET /api/schedule?pid=P001)
  - runs a batch of participants sequentially as background subprocesses of
    visual_sanity_check.py, one at a time, auto-advancing to the next once
    each finishes (POST /api/start with {"pids": [...]})
  - pauses/resumes the currently-running subprocess without killing it, and
    stops it (and the whole queued batch) completely
    (POST /api/pause, POST /api/resume, POST /api/stop)
  - exposes live progress + batch queue status for the dashboard to poll
    (GET /api/status)

Usage:
  python dashboard_server.py               # http://127.0.0.1:8765
  python dashboard_server.py --port 8800 --no-browser
"""
import argparse
import json
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from visual_sanity_check import load_schedule, build_steps  # noqa: E402

DASHBOARD_HTML = ROOT / "test_dashboard.html"
RUNNER_SCRIPT = ROOT / "visual_sanity_check.py"
PARTICIPANTS_DIR = ROOT / "experiment_model_ordered" / "participants_json"

# Set by main() from --port before the server starts. Scoped per-port so that
# running more than one dashboard_server.py instance at once (e.g. a real
# session plus a separate test/dev instance on another port) never collides
# on the same status/control files.
STATUS_FILE = None
CONTROL_FILE = None

_lock = threading.Lock()
_proc = None
_proc_pid = None
_stop_requested = False  # set by /api/stop; tells the queue watcher not to auto-advance
_batch = {"pids": [], "index": -1, "results": {}, "delay": 1.0}  # results[pid] = "done"|"error"|"stopped"


def _idle_status():
    return {"running": False, "done": False, "stopped": False, "paused": False, "error": None,
             "pid": None, "total": 0, "index": -1, "label": None, "kind": None,
             "updated_at": time.time()}


def _read_status():
    if not STATUS_FILE.exists():
        return _idle_status()
    try:
        return json.loads(STATUS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return _idle_status()


def _write_status(data):
    STATUS_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _write_control(data):
    CONTROL_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _build_schedule_rows(pid: str) -> list:
    """One row per scenario in run order, with the step-index span it occupies
    (scenario_intro..trial_questions) so the frontend can tell pending / current
    / done just by comparing against the live status index."""
    schedule = load_schedule(pid)
    steps = build_steps(schedule)

    groups = {}
    order_keys = []
    for idx, step in enumerate(steps):
        if step["kind"] not in ("scenario_intro", "trial", "trial_questions"):
            continue
        stage = step.get("stage")
        key = ("practice", step["pi"]) if stage == "practice" else \
              ("experiment", step["mi"], step["vi"], step["ti"])
        if key not in groups:
            order_keys.append(key)
            groups[key] = {
                "step_index_start": idx,
                "step_index_end": idx,
                "stage": stage,
                "group_label": "Practice" if stage == "practice" else step.get("model_type"),
                "model_type": step.get("model_type"),
                "visualization": step.get("visualization"),
                "scenario_id": step.get("scenario_id"),
                "difficulty": step.get("difficulty"),
                "correct_route": step.get("correct_route"),
                "ai_recommended_route": step.get("ai_recommended_route"),
                "rec_is_correct": step.get("rec_is_correct"),
            }
        else:
            groups[key]["step_index_end"] = idx

    rows = []
    for order, key in enumerate(order_keys, start=1):
        row = dict(groups[key])
        row["order"] = order
        rows.append(row)
    return rows


def _list_participants() -> list:
    if not PARTICIPANTS_DIR.is_dir():
        return []
    return sorted(p.stem for p in PARTICIPANTS_DIR.glob("P*.json"))


def _launch(pid: str, delay: float):
    """Spawn visual_sanity_check.py for one participant. Caller holds _lock."""
    global _proc, _proc_pid
    _write_status({"running": True, "done": False, "stopped": False, "paused": False, "error": None,
                    "pid": pid, "total": 0, "index": -1, "label": "מפעיל...",
                    "kind": None, "updated_at": time.time()})
    _write_control({"paused": False})
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0
    _proc = subprocess.Popen(
        [sys.executable, str(RUNNER_SCRIPT), "--pid", pid, "--delay", str(delay),
         "--status-file", str(STATUS_FILE), "--control-file", str(CONTROL_FILE)],
        cwd=str(ROOT), creationflags=creationflags,
    )
    _proc_pid = _proc.pid


def _kill_current():
    """Force-kill the current subprocess (and its whole tree, e.g. the browser). Caller holds _lock."""
    global _proc, _proc_pid
    killed = False
    if _proc is not None and _proc.poll() is None:
        try:
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/PID", str(_proc_pid), "/T", "/F"], capture_output=True)
            else:
                _proc.terminate()
            killed = True
        except Exception:
            pass
    _proc = None
    return killed


def _queue_watcher():
    """Background thread: when the current subprocess exits on its own (not via
    an explicit Stop), records its result and auto-launches the next queued pid."""
    global _proc
    while True:
        time.sleep(0.5)
        with _lock:
            if _proc is None or _proc.poll() is None:
                continue  # nothing running, or still running
            rc = _proc.returncode
            _proc = None
            idx = _batch["index"]
            if 0 <= idx < len(_batch["pids"]):
                finished_pid = _batch["pids"][idx]
                _batch["results"][finished_pid] = "done" if rc == 0 else "error"
            if _stop_requested:
                continue  # user asked for a full stop - don't advance the queue
            next_idx = idx + 1
            if next_idx < len(_batch["pids"]):
                _batch["index"] = next_idx
                _launch(_batch["pids"][next_idx], _batch.get("delay", 1.0))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # quiet - avoid noisy polling logs

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str):
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            self._send_file(DASHBOARD_HTML, "text/html; charset=utf-8")
        elif parsed.path == "/api/participants":
            try:
                participants = _list_participants()
                self._send_json({"ok": True, "participants": participants,
                                  "dir": str(PARTICIPANTS_DIR), "dir_exists": PARTICIPANTS_DIR.is_dir()})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e), "participants": []}, status=500)
        elif parsed.path == "/api/schedule":
            qs = parse_qs(parsed.query)
            pid = (qs.get("pid") or ["P001"])[0].strip()
            try:
                rows = _build_schedule_rows(pid)
                self._send_json({"ok": True, "pid": pid, "rows": rows})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, status=400)
        elif parsed.path == "/api/status":
            data = _read_status()
            with _lock:
                data["batch"] = {"pids": list(_batch["pids"]), "index": _batch["index"],
                                  "results": dict(_batch["results"])}
            self._send_json(data)
        else:
            self._send_json({"error": "not found"}, status=404)

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except Exception:
            body = {}

        if parsed.path == "/api/start":
            self._start(body)
        elif parsed.path == "/api/pause":
            self._pause()
        elif parsed.path == "/api/resume":
            self._resume()
        elif parsed.path == "/api/stop":
            self._stop()
        elif parsed.path == "/api/clear":
            self._clear()
        else:
            self._send_json({"error": "not found"}, status=404)

    def _start(self, body):
        global _stop_requested
        pids = body.get("pids")
        if not pids:
            single = body.get("pid")
            pids = [single] if single else []
        pids = [str(p).strip() for p in pids if str(p).strip()]
        if not pids:
            self._send_json({"ok": False, "error": "no participants selected"}, status=400)
            return
        try:
            delay = float(body.get("delay") or 1.0)
        except (TypeError, ValueError):
            delay = 1.0

        with _lock:
            if _proc is not None and _proc.poll() is None:
                self._send_json({"ok": False, "error": "run already in progress"}, status=409)
                return
            missing = [p for p in pids if not (PARTICIPANTS_DIR / f"{p}.json").exists()]
            if missing:
                self._send_json({"ok": False, "error": f"no schedule for participant(s): {', '.join(missing)}"},
                                 status=400)
                return

            _stop_requested = False
            _batch["pids"] = pids
            _batch["index"] = 0
            _batch["results"] = {}
            _batch["delay"] = delay
            _launch(pids[0], delay)
        self._send_json({"ok": True, "pids": pids})

    def _pause(self):
        _write_control({"paused": True})
        self._send_json({"ok": True})

    def _resume(self):
        _write_control({"paused": False})
        self._send_json({"ok": True})

    def _stop(self):
        global _stop_requested
        with _lock:
            _stop_requested = True
            was_running = _proc is not None and _proc.poll() is None
            idx = _batch["index"]
            if was_running and 0 <= idx < len(_batch["pids"]):
                # Only relabel the in-flight participant - don't clobber a result
                # the queue watcher already recorded (e.g. it finished naturally
                # moments before this request landed).
                _batch["results"][_batch["pids"][idx]] = "stopped"
            killed = _kill_current()
            status = _read_status()
            status.update({"running": False, "stopped": True, "paused": False, "updated_at": time.time()})
            _write_status(status)
        self._send_json({"ok": True, "killed": killed})

    def _clear(self):
        """Reset the batch/results shown on the dashboard. Doesn't touch any files on disk."""
        global _stop_requested
        with _lock:
            if _proc is not None and _proc.poll() is None:
                self._send_json({"ok": False, "error": "יש הרצה פעילה - יש לעצור אותה קודם"}, status=409)
                return
            _batch["pids"] = []
            _batch["index"] = -1
            _batch["results"] = {}
            _stop_requested = False
            _write_status(_idle_status())
        self._send_json({"ok": True})


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true", help="Don't auto-open the dashboard tab")
    args = ap.parse_args()

    global STATUS_FILE, CONTROL_FILE
    STATUS_FILE = ROOT / f".dashboard_status_{args.port}.json"
    CONTROL_FILE = ROOT / f".dashboard_control_{args.port}.json"

    _write_status(_idle_status())
    _write_control({"paused": False})
    threading.Thread(target=_queue_watcher, daemon=True).start()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"\nLive test dashboard running at {url}")
    print(f"Participants dir: {PARTICIPANTS_DIR} (exists: {PARTICIPANTS_DIR.is_dir()})")
    print("Press Ctrl+C to stop.\n")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        with _lock:
            global _stop_requested
            _stop_requested = True
            _kill_current()


if __name__ == "__main__":
    main()
