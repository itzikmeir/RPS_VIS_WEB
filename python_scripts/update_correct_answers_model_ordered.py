"""
Fill correct_answers (Q1, Q2, Q3) in model-ordered participant JSON files.

Input:  questions/scenario_questions.json (from build_scenario_questions.py)
        experiment_model_ordered/participants_json/*.json
Output: Updated participant JSONs with correct_answers per trial

Run build_scenario_questions.py first (with SCN_Questions_catalog.xlsx or
models_SCN_Questions_catalog.xlsx) to ensure scenario_questions.json is up to date.
"""
import json
from pathlib import Path
from typing import Dict

# Scripts live in python_scripts/; project root is parent
ROOT_DIR = Path(__file__).resolve().parent.parent
SCENARIO_QUESTIONS_PATH = ROOT_DIR / "experiment_model_ordered" / "questions" / "scenario_questions.json"
PARTICIPANTS_DIR = ROOT_DIR / "experiment_model_ordered" / "participants_json"
COMBINED_JSON_PATH = ROOT_DIR / "experiment_model_ordered" / "participants_all.json"


def build_correct_answers_map() -> Dict[str, Dict[str, str]]:
    """
    Build a mapping from scenario_id to correct answers.
    Returns: {scenario_id: {"Q1": "answer_text", "Q2": "answer_text", "Q3": "answer_text"}}
    """
    with open(SCENARIO_QUESTIONS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    mapping: Dict[str, Dict[str, str]] = {}

    for entry in data.get("scenario_questions", []):
        scenario_id = entry.get("scenario_id")
        question_id = entry.get("question_id")  # "sa_1", "sa_2", "sa_3"
        options = entry.get("options", [])
        # Support both correct_answer_indices (array) and correct_answer_index (single)
        correct_indices = entry.get("correct_answer_indices")
        if correct_indices is None:
            correct_index = entry.get("correct_answer_index")
            correct_indices = [correct_index] if correct_index is not None and isinstance(correct_index, int) else []

        if not scenario_id or not question_id:
            continue

        if scenario_id not in mapping:
            mapping[scenario_id] = {}

        # Map sa_1 -> Q1, sa_2 -> Q2, sa_3 -> Q3
        q_key = question_id.replace("sa_", "Q")

        # Get answer text: for multiple correct, join with ", "; for single, use that option
        valid_indices = [i for i in correct_indices if isinstance(i, int) and 0 <= i < len(options)]
        if valid_indices:
            answer_texts = [options[i] for i in valid_indices]
            mapping[scenario_id][q_key] = ", ".join(answer_texts)
        else:
            mapping[scenario_id][q_key] = None

    return mapping


def update_participant_file(path: Path, answers_map: Dict[str, Dict[str, str]]) -> dict:
    """Update correct_answers in a single participant JSON file (model-ordered structure)."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    changed = False

    # Update practice trials
    for trial in data.get("practice", []):
        sid = trial.get("scenario_id")
        if not sid or sid not in answers_map:
            continue

        scenario_answers = answers_map[sid]
        correct_answers = trial.get("correct_answers", {})

        for q_key in ["Q1", "Q2", "Q3"]:
            if q_key in scenario_answers:
                new_val = scenario_answers[q_key]
                if correct_answers.get(q_key) != new_val:
                    correct_answers[q_key] = new_val
                    changed = True

        trial["correct_answers"] = correct_answers

    # Update experimental trials (models -> visualizations -> trials)
    for model in data.get("models", []):
        for vis in model.get("visualizations", []):
            for trial in vis.get("trials", []):
                sid = trial.get("scenario_id")
                if not sid or sid not in answers_map:
                    continue

                scenario_answers = answers_map[sid]
                correct_answers = trial.get("correct_answers", {})

                for q_key in ["Q1", "Q2", "Q3"]:
                    if q_key in scenario_answers:
                        new_val = scenario_answers[q_key]
                        if correct_answers.get(q_key) != new_val:
                            correct_answers[q_key] = new_val
                            changed = True

                trial["correct_answers"] = correct_answers

    if changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    return data


def main():
    if not SCENARIO_QUESTIONS_PATH.exists():
        raise SystemExit(
            f"Scenario questions not found: {SCENARIO_QUESTIONS_PATH}\n"
            "Run build_scenario_questions.py first (with SCN_Questions_catalog.xlsx or models_SCN_Questions_catalog.xlsx)"
        )

    answers_map = build_correct_answers_map()
    print(f"Loaded correct answers for {len(answers_map)} scenarios from '{SCENARIO_QUESTIONS_PATH}'")

    if not PARTICIPANTS_DIR.is_dir():
        raise SystemExit(f"Participants directory not found: {PARTICIPANTS_DIR}")

    files = sorted(PARTICIPANTS_DIR.glob("P*.json"))
    combined = []

    for path in files:
        pdata = update_participant_file(path, answers_map)
        combined.append(pdata)
        print(f"Processed {path.name}")

    with open(COMBINED_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)

    print(f"Updated {len(files)} participant files and rewrote '{COMBINED_JSON_PATH}'")


if __name__ == "__main__":
    main()
