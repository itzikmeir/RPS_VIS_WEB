"""
Update correct_route in OLD experiment participant JSON files.
Uses old_experiment_order_files_by_vis_type/ folder.
"""
import json
import math
from pathlib import Path
from typing import Dict

import pandas as pd

# Scripts live in python_scripts/; project root is parent; old experiment in subfolder
ROOT_DIR = Path(__file__).resolve().parent.parent
OLD_EXP_DIR = ROOT_DIR / "old_experiment_order_files_by_vis_type"
INPUT_EXCEL = OLD_EXP_DIR / "SCN_Questions_catalog.xlsx"
PARTICIPANTS_DIR = OLD_EXP_DIR / "participants_json"
COMBINED_JSON_PATH = OLD_EXP_DIR / "participants_all.json"


def is_nan(value) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return True
    try:
        return pd.isna(value)
    except Exception:
        return False


def build_correct_route_map() -> Dict[str, str]:
    df = pd.read_excel(INPUT_EXCEL)
    required_cols = ["Scenario_ID", "Scenario_ID_H", "Scenario_ID_R", "Scenario_ID_S", "CORRECT_ROUTE"]
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Missing expected columns in {INPUT_EXCEL}: {missing}")

    mapping: Dict[str, str] = {}
    for _, row in df.iterrows():
        correct_raw = row.get("CORRECT_ROUTE")
        if is_nan(correct_raw):
            continue
        correct_route = str(correct_raw).strip()
        if not correct_route:
            continue
        base_id = row.get("Scenario_ID")
        if not is_nan(base_id) and str(base_id).strip():
            mapping[str(base_id).strip()] = correct_route
        for col in ["Scenario_ID_H", "Scenario_ID_R", "Scenario_ID_S"]:
            sid_raw = row.get(col)
            if is_nan(sid_raw):
                continue
            sid = str(sid_raw).strip()
            if sid:
                mapping[sid] = correct_route
    return mapping


def update_participant_file(path: Path, correct_map: Dict[str, str]) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    changed = False
    for trial in data.get("practice", []):
        sid = trial.get("scenario_id")
        if not sid or sid not in correct_map:
            continue
        new_val = correct_map[sid]
        if trial.get("correct_route") != new_val:
            trial["correct_route"] = new_val
            changed = True
    for cond in data.get("conditions", []):
        for model in cond.get("models", []):
            for trial in model.get("trials", []):
                sid = trial.get("scenario_id")
                if not sid or sid not in correct_map:
                    continue
                new_val = correct_map[sid]
                if trial.get("correct_route") != new_val:
                    trial["correct_route"] = new_val
                    changed = True
    if changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    return data


def main():
    correct_map = build_correct_route_map()
    print(f"Loaded {len(correct_map)} scenario -> correct_route mappings from '{INPUT_EXCEL}'")
    if not PARTICIPANTS_DIR.is_dir():
        raise SystemExit(f"Participants directory not found: {PARTICIPANTS_DIR}")
    files = sorted(PARTICIPANTS_DIR.glob("*.json"))
    combined = []
    for path in files:
        pdata = update_participant_file(path, correct_map)
        combined.append(pdata)
        print(f"Processed {path.name}")
    with open(COMBINED_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)
    print(f"Updated {len(files)} participant files and rewrote '{COMBINED_JSON_PATH}'")


if __name__ == "__main__":
    main()
