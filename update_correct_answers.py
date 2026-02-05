import json
import os
from typing import Dict, Optional

ROOT_DIR = os.path.dirname(__file__)
SCENARIO_QUESTIONS_PATH = os.path.join(ROOT_DIR, "questions", "scenario_questions.json")
PARTICIPANTS_DIR = os.path.join(ROOT_DIR, "participants_json")
COMBINED_JSON_PATH = os.path.join(ROOT_DIR, "participants_all.json")


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
        correct_index = entry.get("correct_answer_index")

        if not scenario_id or not question_id:
            continue

        if scenario_id not in mapping:
            mapping[scenario_id] = {}

        # Map sa_1 -> Q1, sa_2 -> Q2, sa_3 -> Q3
        q_key = question_id.replace("sa_", "Q")

        # Get the actual answer text from options using correct_answer_index
        if (
            correct_index is not None
            and isinstance(correct_index, int)
            and 0 <= correct_index < len(options)
        ):
            answer_text = options[correct_index]
            mapping[scenario_id][q_key] = answer_text
        else:
            # If no valid correct index, leave as None (or empty string)
            mapping[scenario_id][q_key] = None

    return mapping


def update_participant_file(path: str, answers_map: Dict[str, Dict[str, str]]) -> dict:
    """Update correct_answers in a single participant JSON file."""
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

    # Update experimental trials
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
    print(
        f"Loaded correct answers for {len(answers_map)} scenarios from '{SCENARIO_QUESTIONS_PATH}'"
    )

    if not os.path.isdir(PARTICIPANTS_DIR):
        raise SystemExit(f"Participants directory not found: {PARTICIPANTS_DIR}")

    combined = []
    files = sorted(
        f for f in os.listdir(PARTICIPANTS_DIR) if f.lower().endswith(".json")
    )

    for fname in files:
        path = os.path.join(PARTICIPANTS_DIR, fname)
        pdata = update_participant_file(path, answers_map)
        combined.append(pdata)
        print(f"Processed {fname}")

    # Rebuild combined JSON so it stays in sync
    with open(COMBINED_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)

    print(f"Updated {len(files)} participant files and rewrote '{COMBINED_JSON_PATH}'")


if __name__ == "__main__":
    main()
