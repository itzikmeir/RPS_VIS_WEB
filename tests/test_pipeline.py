"""
Test Python pipeline scripts for the model-ordered experiment.
Runs each script and validates exit code and basic output.
"""
import subprocess
import sys
import unittest
from pathlib import Path

# Project root
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def run_script(script_name: str, cwd: Path = ROOT):
    """Run a Python script and return (success, output)."""
    script_path = ROOT / "python_scripts" / script_name
    if not script_path.exists():
        return False, f"Script not found: {script_path}"
    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        output = (result.stdout or "") + (result.stderr or "")
        return result.returncode == 0, output
    except subprocess.TimeoutExpired:
        return False, "Script timed out after 60 seconds"
    except Exception as e:
        return False, str(e)


class TestPipeline(unittest.TestCase):
    """Pipeline script tests."""

    def test_build_model_ordered_participants(self):
        """Test build_model_ordered_participants.py runs successfully."""
        ok, out = run_script("build_model_ordered_participants.py")
        self.assertTrue(ok, f"build_model_ordered_participants.py failed:\n{out}")
        self.assertTrue("participant" in out.lower() or "P0" in out or "json" in out.lower(), f"Unexpected output: {out}")

    def test_build_scenario_questions_model_ordered(self):
        """Test build_scenario_questions_model_ordered.py runs successfully."""
        ok, out = run_script("build_scenario_questions_model_ordered.py")
        self.assertTrue(ok, f"build_scenario_questions_model_ordered.py failed:\n{out}")
        self.assertTrue("scenario" in out.lower() or "Wrote" in out or "wrote" in out, f"Unexpected output: {out}")

    def test_update_correct_answers_model_ordered(self):
        """Test update_correct_answers_model_ordered.py runs successfully."""
        ok, out = run_script("update_correct_answers_model_ordered.py")
        self.assertTrue(ok, f"update_correct_answers_model_ordered.py failed:\n{out}")
        self.assertTrue("participant" in out.lower() or "Loaded" in out or "Processed" in out, f"Unexpected output: {out}")

    def test_update_correct_routes_model_ordered(self):
        """Test update_correct_routes_model_ordered.py runs successfully."""
        ok, out = run_script("update_correct_routes_model_ordered.py")
        self.assertTrue(ok, f"update_correct_routes_model_ordered.py failed:\n{out}")
        self.assertTrue("scenario" in out.lower() or "Loaded" in out or "Processed" in out, f"Unexpected output: {out}")

    def test_update_recommendations_model_ordered(self):
        """Test update_recommendations_model_ordered.py runs successfully."""
        ok, out = run_script("update_recommendations_model_ordered.py")
        self.assertTrue(ok, f"update_recommendations_model_ordered.py failed:\n{out}")
        self.assertTrue("participant" in out.lower() or "Loaded" in out or "Processed" in out or "WARN" in out, f"Unexpected output: {out}")
