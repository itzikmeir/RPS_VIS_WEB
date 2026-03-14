#!/usr/bin/env python3
"""
Visual sanity check for the RPS_VIS experiment.

Walks through every screen for a given participant in headed browser mode at a
configurable pace (default 2 s per screen).  A floating overlay (top-right
corner) shows the current position in the experiment schedule and an overall
progress bar — similar to the models_rec_long view.

Usage:
    python visual_sanity_check.py                  # P001, 2 s/screen
    python visual_sanity_check.py --pid P002
    python visual_sanity_check.py --delay 1.0      # faster
    python visual_sanity_check.py --delay 3.0      # slower
"""

import argparse
import http.server
import json
import os
import socket
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXPERIMENT_DIR = ROOT / "experiment_model_ordered"

# ──────────────────────────────────────────────────────────────────────────────
# HTTP server helpers
# ──────────────────────────────────────────────────────────────────────────────

def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def _start_server(port: int):
    os.chdir(str(ROOT))
    handler = http.server.SimpleHTTPRequestHandler
    handler.log_message = lambda *_: None
    server = http.server.HTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# ──────────────────────────────────────────────────────────────────────────────
# Schedule helpers
# ──────────────────────────────────────────────────────────────────────────────

def load_schedule(pid: str) -> dict:
    path = EXPERIMENT_DIR / "participants_json" / f"{pid}.json"
    if not path.exists():
        raise FileNotFoundError(f"Participant schedule not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def build_steps(schedule: dict) -> list:
    """Return a flat ordered list of step-dicts that mirrors the app state machine."""
    steps = []
    n_practice = len(schedule["practice"])

    steps.append({"label": "Login", "kind": "login"})

    for pg in ["ishihara_test", "invitation_letter", "consent_form",
               "experiment_video", "system_layout", "experiment_flow"]:
        steps.append({"label": f"Pre › {pg}", "kind": "pre", "page_id": pg})

    steps.append({"label": "Practice › Intro", "kind": "practice_info"})

    for i, t in enumerate(schedule["practice"]):
        sid = t["scenario_id"]
        base = f"Practice {i+1}/{n_practice} · {sid}"
        steps.append({"label": f"{base} › Scenario Intro", "kind": "scenario_intro",
                       "stage": "practice", "pi": i})
        steps.append({"label": f"{base} › Trial",           "kind": "trial",
                       "stage": "practice", "pi": i})
        steps.append({"label": f"{base} › Questions",       "kind": "trial_questions",
                       "stage": "practice", "pi": i})

    steps.append({"label": "Experiment Transition", "kind": "experiment_transition"})

    for mi, model in enumerate(schedule["models"]):
        mname = f"Model {mi+1} ({model['model_type']})"
        steps.append({"label": f"{mname} › Model Intro", "kind": "model_intro",
                       "mi": mi})
        for vi, vis in enumerate(model["visualizations"]):
            vname = vis["visualization"]
            n_trials = len(vis["trials"])
            steps.append({"label": f"{mname} · {vname} › Vis Intro", "kind": "vis_intro",
                           "mi": mi, "vi": vi})
            for ti, t in enumerate(vis["trials"]):
                sid = t["scenario_id"]
                base = f"{mname} · {vname} · T{ti+1}/{n_trials} · {sid}"
                steps.append({"label": f"{base} › Scenario Intro", "kind": "scenario_intro",
                               "stage": "experiment", "mi": mi, "vi": vi, "ti": ti})
                steps.append({"label": f"{base} › Trial",           "kind": "trial",
                               "stage": "experiment", "mi": mi, "vi": vi, "ti": ti})
                steps.append({"label": f"{base} › Questions",       "kind": "trial_questions",
                               "stage": "experiment", "mi": mi, "vi": vi, "ti": ti})
            steps.append({"label": f"{mname} · {vname} › NASA TLX", "kind": "nasa_tlx",
                           "mi": mi, "vi": vi})
        steps.append({"label": f"{mname} › Model Completion",   "kind": "model_completion", "mi": mi})
        steps.append({"label": f"{mname} › Model Trust Survey", "kind": "model_summary_trust", "mi": mi})

    steps.append({"label": "Model Selection",          "kind": "model_selection"})
    steps.append({"label": "Post › Viz Global Ranking","kind": "visualization_global"})
    steps.append({"label": "Post › Demographics",      "kind": "demographics"})
    steps.append({"label": "End",                      "kind": "end"})
    return steps


# ──────────────────────────────────────────────────────────────────────────────
# Overlay injection
# ──────────────────────────────────────────────────────────────────────────────

def _overlay_text(step: dict, idx: int, total: int, schedule: dict, steps: list) -> str:
    # Build per-trial step ranges: (mi, vi, ti) → [first_idx, last_idx]
    scenario_range: dict = {}
    for i, s in enumerate(steps):
        if s.get("kind") in ("scenario_intro", "trial", "trial_questions") and "mi" in s:
            key = (s["mi"], s["vi"], s["ti"])
            if key not in scenario_range:
                scenario_range[key] = [i, i]
            else:
                scenario_range[key][1] = i

    filled = round(20 * idx / total)
    bar = "█" * filled + "░" * (20 - filled)
    lines = [
        f"🔬 SANITY CHECK  ·  {schedule['participant_id']}",
        f"Step {idx+1}/{total}  [{bar}]",
        f"▶  {step['label']}",
        "─" * 46,
    ]
    for mi, model in enumerate(schedule["models"]):
        lines.append(f"  Model {mi+1} ({model['model_type']})")
        for vi, vis in enumerate(model["visualizations"]):
            lines.append(f"    {vis['visualization']}")
            for ti, t in enumerate(vis["trials"]):
                key = (mi, vi, ti)
                rng = scenario_range.get(key)
                sid = t["scenario_id"]
                if rng and idx > rng[1]:
                    mark = "✓"
                elif rng and rng[0] <= idx <= rng[1]:
                    mark = "→"
                else:
                    mark = "·"
                lines.append(f"      {mark} {sid}")
    return "\n".join(lines)


def inject_overlay(page, step: dict, idx: int, total: int, schedule: dict, steps: list):
    text = _overlay_text(step, idx, total, schedule, steps)
    js_text = json.dumps(text)
    page.evaluate(f"""
    (() => {{
        let el = document.getElementById('__sanity_overlay');
        if (!el) {{
            el = document.createElement('div');
            el.id = '__sanity_overlay';
            el.style.cssText = `
                position: fixed; top: 0; right: 0;
                background: rgba(8,12,22,0.93);
                color: #7fff9f;
                padding: 10px 14px;
                border-bottom-left-radius: 10px;
                font-family: 'Courier New', Consolas, monospace;
                font-size: 11.5px;
                z-index: 9999999;
                max-width: 300px;
                max-height: 92vh;
                overflow-y: auto;
                overflow-x: hidden;
                white-space: pre;
                pointer-events: none;
                line-height: 1.55;
                border: 1px solid rgba(127,255,159,0.2);
                box-shadow: -2px 2px 10px rgba(0,0,0,0.4);
            `;
            document.body.appendChild(el);
        }}
        el.textContent = {js_text};
        // Auto-scroll to keep the current scenario (→) centred in view
        const lines = el.textContent.split('\\n');
        const arrowIdx = lines.findIndex(l => l.includes('→'));
        if (arrowIdx >= 0) {{
            const lineH = el.scrollHeight / Math.max(lines.length, 1);
            el.scrollTop = Math.max(0, arrowIdx * lineH - el.clientHeight / 2);
        }}
    }})()
    """)


# ──────────────────────────────────────────────────────────────────────────────
# Generic form-filling helpers
# ──────────────────────────────────────────────────────────────────────────────

_FILL_GENERIC_JS = """
() => {
    // ── Scale -10..10 sliders: set hidden value input ──────────────────────
    document.querySelectorAll('input[type="hidden"][id$="_value"]').forEach(inp => {
        if (!inp.value) inp.value = '3';
    });

    // ── Checkboxes ─────────────────────────────────────────────────────────
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (!cb.checked) {
            cb.checked = true;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });

    // ── Radio groups: select first option in each unselected group ─────────
    const groups = new Set(
        Array.from(document.querySelectorAll('input[type="radio"]')).map(r => r.name)
    );
    groups.forEach(name => {
        if (!name) return;
        if (!document.querySelector(`input[name="${CSS.escape(name)}"]:checked`)) {
            const first = document.querySelector(`input[name="${CSS.escape(name)}"]`);
            if (first) {
                first.checked = true;
                first.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });

    // ── Selects: pick first non-empty option ───────────────────────────────
    document.querySelectorAll('select').forEach(sel => {
        if (!sel.value) {
            const opt = Array.from(sel.options).find(o => o.value);
            if (opt) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });

    // ── Number inputs ──────────────────────────────────────────────────────
    document.querySelectorAll('input[type="number"]').forEach(inp => {
        if (!inp.value) {
            inp.value = '25';
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });

    // ── Text inputs ────────────────────────────────────────────────────────
    document.querySelectorAll('input[type="text"]').forEach(inp => {
        if (inp.id === 'participantId') return;
        if (!inp.value) {
            if (inp.id === 'consent_id')    inp.value = '123456789';
            else if (inp.id === 'consent_email') inp.value = 'test@test.com';
            else if (inp.id === 'input_ishihara_test') inp.value = '74';
            else inp.value = 'Test';
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });

    // ── Force-enable all disabled buttons ─────────────────────────────────
    document.querySelectorAll('button[disabled], button[aria-disabled="true"]').forEach(btn => {
        btn.disabled = false;
        btn.removeAttribute('aria-disabled');
    });
}
"""

_VIZ_GLOBAL_JS = """
() => {
    // Assign ranks 1, 2, 3 to the three dropdowns in order
    [0, 1, 2].forEach((idx, rank) => {
        const sel = document.getElementById(`viz_global_rank_${idx}`);
        if (!sel) return;
        sel.value = String(rank + 1);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // Force-enable buttons
    document.querySelectorAll('button[disabled]').forEach(b => {
        b.disabled = false; b.removeAttribute('aria-disabled');
    });
}
"""


def fill_page(page, kind: str):
    """Fill inputs appropriate for each page kind."""
    if kind == "visualization_global":
        page.evaluate(_VIZ_GLOBAL_JS)
    else:
        page.evaluate(_FILL_GENERIC_JS)


def click_continue(page):
    """Click the primary continue / start button."""
    candidates = ["המשך לתרגול", "המשך לניסוי", "המשך", "התחלה"]
    for text in candidates:
        try:
            btn = page.locator(f'button:has-text("{text}")').last
            if btn.count() > 0 and btn.is_visible():
                btn.click()
                return
        except Exception:
            pass
    # Fallback: last visible non-חזור button
    try:
        for btn in reversed(page.locator("button").all()):
            try:
                if btn.is_visible() and "חזור" not in (btn.inner_text() or ""):
                    btn.click()
                    return
            except Exception:
                pass
    except Exception:
        pass


def simulate_route_selection(page):
    """Fire the postMessage that the scenario iframe normally sends."""
    page.evaluate("""
    () => window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'scenario_route_selected', route: 'A', scenarioName: 'sanity_check' }
    }))
    """)


# ──────────────────────────────────────────────────────────────────────────────
# Main runner
# ──────────────────────────────────────────────────────────────────────────────

def run(pid: str = "P001", delay: float = 2.0):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: Playwright not installed.\n"
              "Run:  pip install playwright && playwright install chromium")
        return

    schedule = load_schedule(pid)
    steps    = build_steps(schedule)
    total    = len(steps)

    port   = _find_free_port()
    server = _start_server(port)
    time.sleep(0.4)

    url = f"http://127.0.0.1:{port}/experiment_model_ordered/index.html"
    STORAGE_KEY = f"experiment_model_ordered_log_{pid}"

    print(f"\n{'='*60}")
    print(f"  SANITY CHECK  ·  {pid}  ·  {total} steps  ·  {delay}s/screen")
    print(f"{'='*60}\n")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, slow_mo=50,
                                     args=["--start-maximized"])
        ctx  = browser.new_context(no_viewport=True)
        page = ctx.new_page()

        # Capture console errors for the final report
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        page.goto(url, wait_until="domcontentloaded", timeout=15_000)
        page.wait_for_load_state("networkidle", timeout=8_000)

        # Clear any previous session for this participant
        page.evaluate(f"localStorage.removeItem('{STORAGE_KEY}')")

        for idx, step in enumerate(steps):
            kind  = step["kind"]
            label = step["label"]
            print(f"  [{idx+1:3d}/{total}] {label}")

            # Short settle pause
            page.wait_for_timeout(300)

            # ── Inject/update progress overlay ────────────────────────────
            try:
                inject_overlay(page, step, idx, total, schedule, steps)
            except Exception:
                pass  # overlay is cosmetic – don't fail the run

            # ── Page-specific actions ─────────────────────────────────────

            if kind == "login":
                page.locator('#participantId').fill(pid)
                page.wait_for_timeout(200)
                click_continue(page)

            elif kind == "pre":
                fill_page(page, kind)
                page.wait_for_timeout(400)
                click_continue(page)

            elif kind == "practice_info":
                click_continue(page)

            elif kind == "scenario_intro":
                click_continue(page)

            elif kind == "trial":
                # Wait for scenario iframe container to appear, then simulate selection
                try:
                    page.wait_for_selector('div[id^="scenario-iframe-container"]',
                                           timeout=8_000)
                except Exception:
                    pass
                page.wait_for_timeout(int(delay * 1000))
                simulate_route_selection(page)
                # Skip normal end-of-step delay (already waited above)
                try:
                    inject_overlay(page, step, idx, total, schedule, steps)
                except Exception:
                    pass
                page.wait_for_timeout(400)
                continue  # skip the delay at end

            elif kind == "trial_questions":
                fill_page(page, kind)
                page.wait_for_timeout(400)
                click_continue(page)

            elif kind == "experiment_transition":
                click_continue(page)

            elif kind == "model_intro":
                click_continue(page)

            elif kind == "vis_intro":
                click_continue(page)

            elif kind == "nasa_tlx":
                fill_page(page, kind)
                page.wait_for_timeout(400)
                click_continue(page)

            elif kind == "model_completion":
                click_continue(page)

            elif kind == "model_summary_trust":
                fill_page(page, kind)
                page.wait_for_timeout(400)
                click_continue(page)

            elif kind == "model_selection":
                fill_page(page, kind)
                page.wait_for_timeout(200)
                click_continue(page)

            elif kind == "visualization_global":
                fill_page(page, kind)
                page.wait_for_timeout(400)
                click_continue(page)

            elif kind == "demographics":
                # Fill with specific fictitious demographic values
                page.evaluate("""
                () => {
                    const set = (id, val) => {
                        const el = document.getElementById(id);
                        if (!el) return;
                        if (el.tagName === 'SELECT') {
                            el.value = val;
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        } else {
                            el.value = val;
                            el.dispatchEvent(new Event('input',  { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    };
                    const radio = (name, val) => {
                        const r = document.querySelector(
                            `input[type="radio"][name="${CSS.escape(name)}"][value="${val}"]`);
                        if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
                    };
                    set('demo_age', '28');
                    radio('gender',           'זכר');
                    set('demo_native_language', 'עברית');
                    radio('education',        'תואר ראשון');
                    radio('field',            'מדעי המחשב / הנדסה / דאטה');
                    radio('navigation_use',   '5');
                    radio('tech_skill',       '5');
                    radio('viz_literacy',     '4');
                    // Suppress downloadLogs() so Playwright won't navigate to a
                    // blob URL (which kills the onclick mid-execution).
                    // We save the JSON from localStorage in Python instead.
                    window.downloadLogs = () => {};
                    // force-enable continue button
                    document.querySelectorAll('button[disabled]').forEach(b => {
                        b.disabled = false; b.removeAttribute('aria-disabled');
                    });
                }
                """)
                page.wait_for_timeout(400)
                click_continue(page)

            elif kind == "end":
                pass  # nothing to click – just show it

            # ── Visual pause ──────────────────────────────────────────────
            page.wait_for_timeout(int(delay * 1000))

        # ── Final report ──────────────────────────────────────────────────
        print(f"\n{'='*60}")
        print("  RUN COMPLETE")
        print(f"  {total} steps executed for {pid}")

        # Check for logged data in localStorage and save to file
        try:
            raw = page.evaluate(f"localStorage.getItem('{STORAGE_KEY}')")
            if raw:
                data = json.loads(raw)
                logs = data.get("logs", {})
                print(f"  Trials logged      : {len(logs.get('trials', []))}")
                print(f"  Questionnaires     : {len(logs.get('questionnaires', []))}")
                print(f"  Pages logged       : {len(logs.get('pages', []))}")
                # Save from localStorage — two copies
                log_path = EXPERIMENT_DIR / "participants_log" / f"{pid}_log.json"
                log_path.write_text(raw, encoding="utf-8")
                print(f"  ✓ JSON saved       : {log_path}")
                dl_path = Path.home() / "Downloads" / f"{pid}_log.json"
                dl_path.write_text(raw, encoding="utf-8")
                print(f"  ✓ JSON (Downloads) : {dl_path}")
            else:
                print("  WARNING: No log data found in localStorage")
        except Exception as e:
            print(f"  WARNING: Could not read log: {e}")

        fatal = [e for e in errors if any(t in e for t in
                 ("SyntaxError", "ReferenceError", "TypeError"))]
        if fatal:
            print(f"\n  ⚠  JS ERRORS DETECTED ({len(fatal)}):")
            for e in fatal[:5]:
                print(f"     {e}")
        else:
            print("  ✓  No fatal JS errors")

        print(f"{'='*60}\n")
        print("  ✅ הניסוי הסתיים. הדפדפן נשאר פתוח.")
        print("  כעת תוכל לשמור את ה-JSON מהמסך האחרון.")
        print("  סגור את הדפדפן ידנית כשתסיים.\n")

        # Wait until the browser window is closed by the user
        try:
            while True:
                if not browser.contexts:
                    break
                try:
                    page.title()  # raises if page/browser closed
                    time.sleep(1)
                except Exception:
                    break
        except KeyboardInterrupt:
            pass

        try:
            browser.close()
        except Exception:
            pass
    server.shutdown()


# ──────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Visual sanity check – walk through all experiment screens")
    parser.add_argument("--pid",   default="P001",
                        help="Participant ID (default: P001)")
    parser.add_argument("--delay", type=float, default=1.0,
                        help="Seconds to display each screen (default: 1.0)")
    args = parser.parse_args()
    run(pid=args.pid, delay=args.delay)


if __name__ == "__main__":
    main()
