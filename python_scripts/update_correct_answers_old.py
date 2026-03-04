"""
Update correct_answers in OLD experiment participant JSON files.
Uses old_experiment_order_files_by_vis_type/ folder.
"""
import json
from pathlib import Path
from typing import Dict

# Scripts live in python_scripts/; project root is parent; old experiment in subfolder
ROOT_DIR = Path(__file__).resolve().parent.parent
OLD_EXP_DIR = ROOT_DIR / "old_experiment_order_files_by_vis_type"
SCENARIO_QUESTIONS_PATH = OLD_EXP_DIR / "questions" / "scenario_questions.json"
PARTICIPANTS_DIR = OLD_EXP_DIR / "participants_json"
COMBINED_JSON_PATH = OLD_EXP_DIR / "participants_all.json"


def build_correct_answers_map() -> Dict[str, Dict[str, str]]:
    with open(SCENARIO_QUESTIONS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    mapping: Dict[str, Dict[str, str]] = {}
    for entry in data.get("scenario_questions", []):
        scenario_id = entry.get("scenario_id")
        question_id = entry.get("question_id")
        options = entry.get("options", [])
        correct_index = entry.get("correct_answer_index")
        if not scenario_id or not question_id:
            continue
        if scenario_id not in mapping:
            mapping[scenario_id] = {}
        q_key = question_id.replace("sa_", "Q")
        if correct_index is not None and isinstance(correct_index, int) and 0 <= correct_index < len(options):
            mapping[scenario_id][q_key] = options[correct_index]
        else:
            mapping[scenario_id][q_key] = None
    return mapping


def update_participant_file(path: Path, answers_map: Dict[str, Dict[str, str]]) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    changed = False
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
    for cond in data.get("conditions", []):
        for model in cond.get("models", []):
            for trial in model.get("trials", []):
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
    answers_map = build_correct_answers_map()
    print(f"Loaded correct answers for {len(answers_map)} scenarios from '{SCENARIO_QUESTIONS_PATH}'")
    if not PARTICIPANTS_DIR.is_dir():
        raise SystemExit(f"Participants directory not found: {PARTICIPANTS_DIR}")
    files = sorted(PARTICIPANTS_DIR.glob("*.json"))
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
