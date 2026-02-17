"""
Test log viewer HTML files load and have required structure.
"""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG_VIEWER = ROOT / "experiment_model_ordered" / "log_results_viewer.html"
LOGS_OVERVIEW = ROOT / "experiment_model_ordered" / "logs_overview.html"


class TestLogViewers(unittest.TestCase):
    """Log viewer HTML tests."""

    def test_log_results_viewer_exists(self):
        """log_results_viewer.html must exist."""
        self.assertTrue(LOG_VIEWER.exists(), f"log_results_viewer.html not found: {LOG_VIEWER}")

    def test_log_results_viewer_has_required_elements(self):
        """log_results_viewer must have load button and fetch logic."""
        content = LOG_VIEWER.read_text(encoding="utf-8", errors="replace")
        self.assertTrue("loadBtn" in content or "loadLog" in content, "Missing load logic")
        self.assertIn("Participants_log", content, "Must fetch from Participants_log")
        self.assertIn("participants_json", content, "Must fetch schedule from participants_json")
        self.assertIn("createExperimentTrialsView", content, "Must have model-ordered experiment view")
        self.assertIn("vis_index", content, "Must handle vis_index (model-ordered)")
        self.assertIn("model_index", content, "Must handle model_index")

    def test_logs_overview_exists(self):
        """logs_overview.html must exist."""
        self.assertTrue(LOGS_OVERVIEW.exists(), f"logs_overview.html not found: {LOGS_OVERVIEW}")

    def test_logs_overview_has_required_elements(self):
        """logs_overview must have file input and CSV export."""
        content = LOGS_OVERVIEW.read_text(encoding="utf-8", errors="replace")
        self.assertTrue("logFiles" in content or "input" in content, "Missing file input")
        self.assertTrue("buildQuestionnairesCsvForOverview" in content or "buildTrialsCsvForOverview" in content, "Missing CSV export")
        self.assertIn("vis_index", content, "Must handle vis_index (model-ordered)")
