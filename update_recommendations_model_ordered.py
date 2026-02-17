"""
Update rec_correct, correct_route, ai_recommended_route in model-ordered participant JSONs.

Input:  Model_Ordered_experiment/models_rec_long.xlsx (or rec_long.xlsx)
        experiment_model_ordered/participants_json/*.json
Output: Updated participant JSONs
"""
import json
import math
from pathlib import Path
from typing import Dict, Tuple

import pandas as pd

ROOT_DIR = Path(__file__).resolve().parent
INPUT_EXCEL = ROOT_DIR / "Model_Ordered_experiment" / "models_rec_long.xlsx"
FALLBACK_EXCEL = ROOT_DIR / "rec_long.xlsx"
PARTICIPANTS_DIR = ROOT_DIR / "experiment_model_ordered" / "participants_json"
COMBINED_JSON_PATH = ROOT_DIR / "experiment_model_ordered" / "participants_all.json"


def is_nan(value) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return True
    try:
        return pd.isna(value)
    except Exception:
        return False


def normalize_participant_id(pid: str) -> str:
    pid = str(pid).strip().upper()
    if not pid.startswith("P"):
        pid = "P" + pid
    return pid


def build_recommendation_map() -> Dict[Tuple[str, str], Dict[str, str]]:
    path = INPUT_EXCEL if INPUT_EXCEL.exists() else FALLBACK_EXCEL
    if not path.exists():
        print(f"[WARN] No Excel found at {INPUT_EXCEL} or {FALLBACK_EXCEL} – no recommendations applied.")
        return {}

    try:
        df = pd.read_excel(path, sheet_name="Schedule_Long")
    except Exception:
        df = pd.read_excel(path)

    required_cols = ["Participant_ID", "Scenario_ID", "Rec_Correct", "Correct_Answer", "System_Recommendation"]
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        print(f"[WARN] Missing columns {missing} – no recommendations applied.")
        return {}

    mapping: Dict[Tuple[str, str], Dict[str, str]] = {}

    for _, row in df.iterrows():
        pid_raw = row.get("Participant_ID")
        scenario_raw = row.get("Scenario_ID")
        if is_nan(pid_raw) or is_nan(scenario_raw):
            continue

        pid = normalize_participant_id(pid_raw)
        scenario_id = str(scenario_raw).strip()
        if not scenario_id:
            continue

        rec_correct = None if is_nan(row.get("Rec_Correct")) else str(row.get("Rec_Correct")).strip()
        correct_answer = None if is_nan(row.get("Correct_Answer")) else str(row.get("Correct_Answer")).strip()
        system_rec = None if is_nan(row.get("System_Recommendation")) else str(row.get("System_Recommendation")).strip()

        mapping[(pid, scenario_id)] = {
            "rec_correct": rec_correct,
            "correct_answer": correct_answer,
            "system_recommendation": system_rec,
        }

    return mapping


def apply_update(trial: dict, pid: str, rec_map: Dict[Tuple[str, str], Dict[str, str]]) -> bool:
    sid = trial.get("scenario_id")
    if not sid:
        return False

    key = (pid, sid)
    if key not in rec_map:
        return False

    rec_info = rec_map[key]
    changed = False

    if rec_info.get("rec_correct") is not None and trial.get("rec_correct") != rec_info["rec_correct"]:
        trial["rec_correct"] = rec_info["rec_correct"]
        changed = True

    if rec_info.get("correct_answer") and trial.get("correct_route") != rec_info["correct_answer"]:
        trial["correct_route"] = rec_info["correct_answer"]
        changed = True

    if rec_info.get("system_recommendation") and trial.get("ai_recommended_route") != rec_info["system_recommendation"]:
        trial["ai_recommended_route"] = rec_info["system_recommendation"]
        changed = True

    return changed


def update_participant_file(path: Path, rec_map: Dict[Tuple[str, str], Dict[str, str]]) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    pid = data.get("participant_id")
    if not pid:
        return data

    changed = False

    for trial in data.get("practice", []):
        if apply_update(trial, pid, rec_map):
            changed = True

    for model in data.get("models", []):
        for vis in model.get("visualizations", []):
            for trial in vis.get("trials", []):
                if apply_update(trial, pid, rec_map):
                    changed = True

    if changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    return data


def main():
    rec_map = build_recommendation_map()
    print(f"Loaded {len(rec_map)} participant-scenario recommendation entries")

    if not PARTICIPANTS_DIR.is_dir():
        raise SystemExit(f"Participants directory not found: {PARTICIPANTS_DIR}")

    files = sorted(PARTICIPANTS_DIR.glob("P*.json"))
    combined = []

    for path in files:
        pdata = update_participant_file(path, rec_map)
        combined.append(pdata)
        print(f"Processed {path.name}")

    with open(COMBINED_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)

    print(f"Updated {len(files)} participant files and rewrote '{COMBINED_JSON_PATH}'")


if __name__ == "__main__":
    main()
