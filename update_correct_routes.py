import json
import math
import os
from typing import Dict

import pandas as pd


ROOT_DIR = os.path.dirname(__file__)
INPUT_EXCEL = os.path.join(ROOT_DIR, "SCN_Questions_catalog.xlsx")
PARTICIPANTS_DIR = os.path.join(ROOT_DIR, "participants_json")
COMBINED_JSON_PATH = os.path.join(ROOT_DIR, "participants_all.json")


def is_nan(value) -> bool:
    """Return True if value is a NaN (float) or pandas NA."""
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return True
    try:
        return pd.isna(value)
    except Exception:
        return False


def build_correct_route_map() -> Dict[str, str]:
    """
    Build a mapping from scenario_id (e.g. SCN_001_H) to the correct route
    using the CORRECT_ROUTE column in SCN_Questions_catalog.xlsx.
    """
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

        # Map each non-empty scenario variant to this correct_route
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


def update_participant_file(path: str, correct_map: Dict[str, str]) -> dict:
    """Update correct_route in a single participant JSON file."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    changed = False

    # Update practice trials
    for trial in data.get("practice", []):
        sid = trial.get("scenario_id")
        if not sid:
            continue
        if sid in correct_map:
            new_val = correct_map[sid]
            if trial.get("correct_route") != new_val:
                trial["correct_route"] = new_val
                changed = True

    # Update experimental trials
    for cond in data.get("conditions", []):
        for model in cond.get("models", []):
            for trial in model.get("trials", []):
                sid = trial.get("scenario_id")
                if not sid:
                    continue
                if sid in correct_map:
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

    if not os.path.isdir(PARTICIPANTS_DIR):
        raise SystemExit(f"Participants directory not found: {PARTICIPANTS_DIR}")

    combined = []
    files = sorted(
        f for f in os.listdir(PARTICIPANTS_DIR)
        if f.lower().endswith(".json")
    )

    for fname in files:
        path = os.path.join(PARTICIPANTS_DIR, fname)
        pdata = update_participant_file(path, correct_map)
        combined.append(pdata)
        print(f"Processed {fname}")

    # Rebuild combined JSON so it stays in sync
    with open(COMBINED_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)

    print(f"Updated {len(files)} participant files and rewrote '{COMBINED_JSON_PATH}'")


if __name__ == "__main__":
    main()

