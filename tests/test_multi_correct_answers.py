"""
Tests for multi-correct answer support in scenario questions.

Covers:
- build_scenario_questions_model_ordered: find_correct_indices parsing
- scenario_questions.json: correct_answer_indices structure
- update_correct_answers_model_ordered: correct_answers with multi-value
- Participant JSON: correct_answers populated for multi-correct questions
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Import build module to test find_correct_indices
from build_scenario_questions_model_ordered import (
    find_correct_indices,
    parse_options,
    _match_single_answer_to_index,
)

SCENARIO_QUESTIONS = ROOT / "experiment_model_ordered" / "questions" / "scenario_questions.json"
PARTICIPANTS_DIR = ROOT / "experiment_model_ordered" / "participants_json"


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class TestFindCorrectIndices(unittest.TestCase):
    """Unit tests for find_correct_indices."""

    def setUp(self):
        self.options = ["מסלול א", "מסלול ב", "מסלול ג", "לא יודע/ת"]

    def test_single_answer_exact_match(self):
        """Single answer matching option text."""
        result = find_correct_indices("מסלול א", self.options)
        self.assertEqual(result, [0])

    def test_single_answer_second_option(self):
        """Single answer - second option."""
        result = find_correct_indices("מסלול ב", self.options)
        self.assertEqual(result, [1])

    def test_multi_answer_comma_separated(self):
        """Multiple correct answers: מסלול א, מסלול ב."""
        result = find_correct_indices("מסלול א, מסלול ב", self.options)
        self.assertEqual(result, [0, 1])

    def test_multi_answer_order_preserved(self):
        """Multiple answers - order should be preserved."""
        result = find_correct_indices("מסלול ב, מסלול א", self.options)
        self.assertEqual(result, [1, 0])

    def test_multi_answer_three_options(self):
        """Three correct answers."""
        result = find_correct_indices("מסלול א, מסלול ב, מסלול ג", self.options)
        self.assertEqual(result, [0, 1, 2])

    def test_duplicate_in_input_deduplicated(self):
        """Duplicate in comma-separated input should be deduplicated."""
        result = find_correct_indices("מסלול א, מסלול א", self.options)
        self.assertEqual(result, [0])

    def test_numeric_answer(self):
        """Numeric answer (1-based)."""
        result = find_correct_indices("1", self.options)
        self.assertEqual(result, [0])

    def test_hebrew_letter_answer(self):
        """Hebrew letter א = first option."""
        result = find_correct_indices("א", self.options)
        self.assertEqual(result, [0])

    def test_empty_options_returns_empty(self):
        """Empty options returns empty list."""
        result = find_correct_indices("מסלול א", [])
        self.assertEqual(result, [])

    def test_none_answer_returns_empty(self):
        """None/NaN answer returns empty."""
        result = find_correct_indices(float("nan"), self.options)
        self.assertEqual(result, [])

    def test_partial_match_multi(self):
        """One valid, one invalid in comma-separated - returns only valid."""
        result = find_correct_indices("מסלול א, invalid_option", self.options)
        self.assertEqual(result, [0])

    def test_parse_options_multiline(self):
        """parse_options splits by newline."""
        raw = "מסלול א\nמסלול ב\nמסלול ג"
        result = parse_options(raw)
        self.assertEqual(result, ["מסלול א", "מסלול ב", "מסלול ג"])

    def test_whitespace_around_comma(self):
        """Whitespace around comma should be trimmed."""
        result = find_correct_indices("  מסלול א ,  מסלול ב  ", self.options)
        self.assertEqual(result, [0, 1])

    def test_empty_string_returns_empty(self):
        """Empty string returns empty list."""
        result = find_correct_indices("", self.options)
        self.assertEqual(result, [])

    def test_all_invalid_returns_empty(self):
        """All invalid parts return empty."""
        result = find_correct_indices("xyz, invalid, 999", self.options)
        self.assertEqual(result, [])


class TestScenarioQuestionsJSON(unittest.TestCase):
    """Tests for scenario_questions.json structure."""

    def test_has_correct_answer_indices(self):
        """All entries should have correct_answer_indices."""
        data = load_json(SCENARIO_QUESTIONS)
        for entry in data.get("scenario_questions", []):
            self.assertIn("correct_answer_indices", entry, f"Missing correct_answer_indices: {entry.get('scenario_id')} {entry.get('question_id')}")
            self.assertIsInstance(entry["correct_answer_indices"], list)

    def test_indices_within_options_bounds(self):
        """All correct_answer_indices must be valid option indices."""
        data = load_json(SCENARIO_QUESTIONS)
        for entry in data.get("scenario_questions", []):
            options = entry.get("options", [])
            indices = entry.get("correct_answer_indices", [])
            for idx in indices:
                self.assertIsInstance(idx, int, f"Index must be int: {idx}")
                self.assertGreaterEqual(idx, 0, f"Index must be >= 0: {idx}")
                self.assertLess(idx, len(options), f"Index {idx} out of bounds for {len(options)} options")

    def test_multi_correct_entries_exist(self):
        """At least some entries should have multiple correct indices."""
        data = load_json(SCENARIO_QUESTIONS)
        multi = [e for e in data.get("scenario_questions", []) if len(e.get("correct_answer_indices", [])) > 1]
        self.assertGreater(len(multi), 0, "Expected at least one question with multiple correct answers")

    def test_backward_compat_correct_answer_index(self):
        """correct_answer_index should equal first of correct_answer_indices when single."""
        data = load_json(SCENARIO_QUESTIONS)
        for entry in data.get("scenario_questions", []):
            indices = entry.get("correct_answer_indices", [])
            single = entry.get("correct_answer_index")
            if len(indices) == 1:
                self.assertEqual(single, indices[0], f"Mismatch for {entry.get('scenario_id')} {entry.get('question_id')}")
            elif len(indices) > 1:
                self.assertEqual(single, indices[0], "correct_answer_index should be first when multi")


class TestParticipantCorrectAnswers(unittest.TestCase):
    """Tests for participant JSON correct_answers with multi-correct."""

    def test_multi_correct_stored_as_comma_separated(self):
        """Participant correct_answers for multi-correct should contain comma."""
        found = False
        for path in list(PARTICIPANTS_DIR.glob("P*.json"))[:5]:
            data = load_json(path)
            for trial in data.get("practice", []) + self._all_experiment_trials(data):
                ca = trial.get("correct_answers", {})
                for q, val in ca.items():
                    if val and "," in str(val):
                        found = True
                        break
                if found:
                    break
            if found:
                break
        self.assertTrue(found, "Expected at least one correct_answers value with comma (multi-correct)")

    def _all_experiment_trials(self, data):
        trials = []
        for model in data.get("models", []):
            for vis in model.get("visualizations", []):
                trials.extend(vis.get("trials", []))
        return trials

    def test_correct_answers_match_scenario_questions(self):
        """Participant correct_answers should match scenario_questions for each scenario."""
        sq_data = load_json(SCENARIO_QUESTIONS)
        sq_map = {}
        for e in sq_data.get("scenario_questions", []):
            sid = e["scenario_id"]
            qid = e["question_id"]
            qkey = qid.replace("sa_", "Q")
            if sid not in sq_map:
                sq_map[sid] = {}
            opts = e.get("options", [])
            indices = e.get("correct_answer_indices", [])
            sq_map[sid][qkey] = ", ".join(opts[i] for i in indices if 0 <= i < len(opts))

        for path in list(PARTICIPANTS_DIR.glob("P*.json"))[:2]:
            data = load_json(path)
            for trial in data.get("practice", []) + self._all_experiment_trials(data):
                sid = trial.get("scenario_id")
                if sid not in sq_map:
                    continue
                ca = trial.get("correct_answers", {})
                for qkey, expected in sq_map[sid].items():
                    if not expected:
                        continue
                    actual = ca.get(qkey)
                    self.assertEqual(actual, expected, f"{path.name} {sid} {qkey}: expected {expected!r}, got {actual!r}")


class TestAppJSCorrectnessLogic(unittest.TestCase):
    """Test that app.js has correct logic for multi-correct."""

    def test_app_uses_correct_answer_indices(self):
        """app.js should reference correct_answer_indices for is_correct."""
        app_path = ROOT / "experiment_model_ordered" / "app.js"
        content = app_path.read_text(encoding="utf-8", errors="replace")
        self.assertIn("correct_answer_indices", content)
        self.assertIn("correctIndices.includes(selectedIndex)", content)


if __name__ == "__main__":
    unittest.main()
