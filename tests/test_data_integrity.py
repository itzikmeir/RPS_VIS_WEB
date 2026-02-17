"""
Test data integrity: participant JSONs, scenario questions, required files.
"""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARTICIPANTS_DIR = ROOT / "experiment_model_ordered" / "participants_json"
SCENARIO_QUESTIONS = ROOT / "experiment_model_ordered" / "questions" / "scenario_questions.json"
QUESTIONS_JSON = ROOT / "experiment_model_ordered" / "questions" / "questions.json"
APP_JS = ROOT / "experiment_model_ordered" / "app.js"
INDEX_HTML = ROOT / "experiment_model_ordered" / "index.html"


def load_json(path: Path):
    """Load JSON file, return None on error."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


class TestDataIntegrity(unittest.TestCase):
    """Data integrity tests."""

    def test_participants_dir_exists(self):
        """Participants directory must exist."""
        self.assertTrue(PARTICIPANTS_DIR.is_dir(), f"Participants dir not found: {PARTICIPANTS_DIR}")

    def test_at_least_one_participant(self):
        """At least one participant JSON must exist."""
        files = list(PARTICIPANTS_DIR.glob("P*.json"))
        self.assertGreaterEqual(len(files), 1, f"No participant JSONs in {PARTICIPANTS_DIR}")

    def test_participant_structure(self):
        """Each participant JSON must have required structure."""
        for path in PARTICIPANTS_DIR.glob("P*.json"):
            data = load_json(path)
            self.assertIsNotNone(data, f"Failed to load {path}")
            self.assertIn("participant_id", data, f"{path}: missing participant_id")
            self.assertIn("practice", data, f"{path}: missing practice")
            self.assertIn("models", data, f"{path}: missing models")
            self.assertIsInstance(data["practice"], list, f"{path}: practice must be list")
            self.assertIsInstance(data["models"], list, f"{path}: models must be list")
            self.assertGreaterEqual(len(data["models"]), 1, f"{path}: must have at least 1 model")
            for model in data["models"]:
                self.assertIn("model_type", model, f"{path}: model missing model_type")
                self.assertIn("visualizations", model, f"{path}: model missing visualizations")
                self.assertIn(model["model_type"], ("OPT", "SUB"), f"{path}: invalid model_type")
                for vis in model["visualizations"]:
                    self.assertIn("visualization", vis, f"{path}: vis missing visualization")
                    self.assertIn("trials", vis, f"{path}: vis missing trials")
                    for trial in vis["trials"]:
                        self.assertIn("scenario_id", trial, f"{path}: trial missing scenario_id")
                        self.assertIn("correct_route", trial, f"{path}: trial missing correct_route")
                        self.assertIn("correct_answers", trial, f"{path}: trial missing correct_answers")

    def test_participant_trial_has_correct_answers(self):
        """Trials should have correct_answers populated (non-empty for most)."""
        for path in list(PARTICIPANTS_DIR.glob("P*.json"))[:3]:
            data = load_json(path)
            if not data:
                continue
            trials_with_answers = 0
            total_trials = 0
            for trial in data.get("practice", []):
                total_trials += 1
                if trial.get("correct_answers") and len(trial["correct_answers"]) > 0:
                    trials_with_answers += 1
            for model in data.get("models", []):
                for vis in model.get("visualizations", []):
                    for trial in vis.get("trials", []):
                        total_trials += 1
                        if trial.get("correct_answers") and len(trial["correct_answers"]) > 0:
                            trials_with_answers += 1
            self.assertTrue(total_trials == 0 or trials_with_answers > 0, f"{path}: no trials have correct_answers")

    def test_scenario_questions_exists(self):
        """Scenario questions JSON must exist."""
        self.assertTrue(SCENARIO_QUESTIONS.exists(), f"Scenario questions not found: {SCENARIO_QUESTIONS}")

    def test_scenario_questions_structure(self):
        """Scenario questions must have scenario_questions array."""
        data = load_json(SCENARIO_QUESTIONS)
        self.assertIsNotNone(data, f"Failed to load {SCENARIO_QUESTIONS}")
        self.assertIn("scenario_questions", data, "Missing scenario_questions key")
        self.assertIsInstance(data["scenario_questions"], list, "scenario_questions must be list")
        self.assertGreater(len(data["scenario_questions"]), 0, "scenario_questions must not be empty")
        for q in data["scenario_questions"][:5]:
            self.assertIn("scenario_id", q, "Entry missing scenario_id")
            self.assertIn("question_id", q, "Entry missing question_id")
            self.assertIn("options", q, "Entry missing options")

    def test_questions_json_exists(self):
        """questions.json must exist."""
        self.assertTrue(QUESTIONS_JSON.exists(), f"questions.json not found: {QUESTIONS_JSON}")

    def test_app_js_exists(self):
        """app.js must exist."""
        self.assertTrue(APP_JS.exists(), f"app.js not found: {APP_JS}")

    def test_app_js_has_required_symbols(self):
        """app.js must contain key functions and state."""
        content = APP_JS.read_text(encoding="utf-8", errors="replace")
        required = ["state", "render", "assetPath", "getCurrentTrial", "logPageEntry", "downloadLogs"]
        for symbol in required:
            self.assertIn(symbol, content, f"app.js missing required symbol: {symbol}")

    def test_index_html_exists(self):
        """index.html must exist."""
        self.assertTrue(INDEX_HTML.exists(), f"index.html not found: {INDEX_HTML}")

    def test_index_html_loads_app(self):
        """index.html must reference app.js."""
        content = INDEX_HTML.read_text(encoding="utf-8", errors="replace")
        self.assertIn("app.js", content, "index.html must load app.js")

    def test_participants_all_json(self):
        """participants_all.json must exist and be valid."""
        all_path = ROOT / "experiment_model_ordered" / "participants_all.json"
        self.assertTrue(all_path.exists(), f"participants_all.json not found: {all_path}")
        data = load_json(all_path)
        self.assertIsNotNone(data, "participants_all.json is invalid JSON")
        self.assertIsInstance(data, list, "participants_all.json must be array")
