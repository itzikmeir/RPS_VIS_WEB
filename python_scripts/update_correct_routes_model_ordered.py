"""
Update correct_route in model-ordered participant JSON files.

Input:  SCN_Questions_catalog.xlsx or Model_Ordered_experiment/models_SCN_Questions_catalog.xlsx
        experiment_model_ordered/participants_json/*.json
Output: Updated participant JSONs with correct_route per trial
"""
import json
import math
from pathlib import Path
from typing import Dict

import pandas as pd

# Scripts live in python_scripts/; project root is parent
ROOT_DIR = Path(__file__).resolve().parent.parent
INPUT_EXCEL = ROOT_DIR / "SCN_Questions_catalog.xlsx"
MODEL_ORDERED_EXCEL = ROOT_DIR / "Model_Ordered_experiment" / "models_SCN_Questions_catalog.xlsx"
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


def build_correct_route_map() -> Dict[str, str]:
    mapping: Dict[str, str] = {}

    # Prefer model-ordered catalog (sheet 1 = scenario catalog) for model-ordered participants
    if MODEL_ORDERED_EXCEL.exists():
        try:
            df = pd.read_excel(MODEL_ORDERED_EXCEL, sheet_name=1)
        except Exception:
            df = pd.read_excel(MODEL_ORDERED_EXCEL)
        id_col = "SCN_ID" if "SCN_ID" in df.columns else "Scenario_ID"
        if id_col in df.columns and "CORRECT_ROUTE" in df.columns:
            _fill_map(df, mapping, id_col)
            if mapping:
                return mapping

    # Fallback: main catalog
    if INPUT_EXCEL.exists():
        df = pd.read_excel(INPUT_EXCEL)
        if "Scenario_ID" in df.columns and "CORRECT_ROUTE" in df.columns:
            _fill_map(df, mapping, "Scenario_ID")
            if mapping:
                return mapping

    raise ValueError(f"No suitable catalog found. Tried {MODEL_ORDERED_EXCEL}, {INPUT_EXCEL}")


def _fill_map(df, mapping: Dict[str, str], id_col: str) -> None:
    for _, row in df.iterrows():
        correct_raw = row.get("CORRECT_ROUTE")
        if is_nan(correct_raw):
            continue

        correct_route = str(correct_raw).strip()
        if not correct_route:
            continue

        base_id = row.get(id_col)
        if not is_nan(base_id) and str(base_id).strip():
            mapping[str(base_id).strip()] = correct_route

        for col in ["Scenario_ID_H", "Scenario_ID_R", "Scenario_ID_S"]:
            sid_raw = row.get(col)
            if is_nan(sid_raw):
                continue
            sid = str(sid_raw).strip()
            if sid:
                mapping[sid] = correct_route


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

    for model in data.get("models", []):
        for vis in model.get("visualizations", []):
            for trial in vis.get("trials", []):
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
    print(f"Loaded {len(correct_map)} scenario -> correct_route mappings")

    if not PARTICIPANTS_DIR.is_dir():
        raise SystemExit(f"Participants directory not found: {PARTICIPANTS_DIR}")

    files = sorted(PARTICIPANTS_DIR.glob("P*.json"))
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
