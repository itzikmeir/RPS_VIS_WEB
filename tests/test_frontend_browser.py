"""
Browser-based frontend tests using Playwright.
Run with: python -m pytest tests/test_frontend_browser.py -v
Requires: pip install playwright && playwright install chromium
Skips gracefully if Playwright not installed.
"""
import socket
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
EXPERIMENT_DIR = ROOT / "experiment_model_ordered"

try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False


def find_free_port():
    """Find a free port for the test server."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def start_http_server(port, cwd):
    """Start a simple HTTP server in a background thread (serves from cwd)."""
    import http.server
    import os
    os.chdir(str(cwd))
    handler = http.server.SimpleHTTPRequestHandler
    server = http.server.HTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


@pytest.mark.skipif(not PLAYWRIGHT_AVAILABLE, reason="Playwright not installed (pip install playwright && playwright install chromium)")
class TestFrontendBrowser:
    """Browser automation tests for the experiment app."""

    def test_app_js_vis_intro_button_fix(self):
        """Regression: vis intro continue must set scenario_intro, not vis_intro."""
        app_js = (EXPERIMENT_DIR / "app.js").read_text(encoding="utf-8")
        assert 'state.pageType = "scenario_intro"' in app_js, (
            "Vis intro continue button bug: must set pageType to scenario_intro"
        )

    def test_app_js_stacked_viz_spelling(self):
        """Regression: must accept עמודות נערמות (not only מוערמות)."""
        app_js = (EXPERIMENT_DIR / "app.js").read_text(encoding="utf-8")
        assert "עמודות נערמות" in app_js, "Must support עמודות נערמות for STACKED.png"

    def test_login_page_loads_via_http(self):
        """Login page must load when served over HTTP."""
        port = find_free_port()
        server, thread = start_http_server(port, ROOT)
        try:
            time.sleep(0.5)
            url = f"http://127.0.0.1:{port}/experiment_model_ordered/index.html"
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=10000)
                page.wait_for_load_state("networkidle", timeout=8000)
                content = page.content()
                assert "app" in content.lower() or "participant" in content.lower() or "התחלה" in content, (
                    "Login page content missing"
                )
                browser.close()
        finally:
            server.shutdown()

    def test_participant_load_p001(self):
        """Loading P001 should display content (no JS errors)."""
        port = find_free_port()
        server, thread = start_http_server(port, ROOT)
        try:
            time.sleep(0.5)
            url = f"http://127.0.0.1:{port}/experiment_model_ordered/index.html"
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()
                errors = []
                page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
                page.goto(url, wait_until="domcontentloaded", timeout=10000)
                page.wait_for_load_state("networkidle", timeout=8000)
                # Find input and button
                inp = page.locator('input[type="text"]').first
                if inp.count() > 0:
                    inp.fill("P001")
                    btn = page.locator("button").first
                    if btn.count() > 0:
                        btn.click()
                        page.wait_for_timeout(3000)
                # Exclude fetch/network errors (expected in test)
                syntax_errors = [e for e in errors if "SyntaxError" in e or "ReferenceError" in e or "TypeError" in e]
                assert len(syntax_errors) == 0, f"JS errors: {syntax_errors}"
                browser.close()
        finally:
            server.shutdown()
