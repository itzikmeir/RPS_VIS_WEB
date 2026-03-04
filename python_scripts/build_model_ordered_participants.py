"""
Build participant JSON files for the Model-Ordered experiment format.

Input:  Model_Ordered_experiment/Models_Experiment_Order_Expanded.xlsx
Output: experiment_model_ordered/participants_json/P001.json, ...
        experiment_model_ordered/participants_all.json

Structure: models[] -> visualizations[] -> trials[]
(Instead of conditions[] -> models[] -> trials[])
"""
import json
import math
from pathlib import Path

import pandas as pd

# -------------------------
# CONFIG: scripts live in python_scripts/; project root is parent
# -------------------------
ROOT_DIR = Path(__file__).resolve().parent.parent
INPUT_PATH = ROOT_DIR / "Model_Ordered_experiment" / "Models_Experiment_Order_Expanded.xlsx"
OUTPUT_DIR = ROOT_DIR / "experiment_model_ordered" / "participants_json"
COMBINED_JSON = ROOT_DIR / "experiment_model_ordered" / "participants_all.json"


def clean(value):
    """Convert NaN to None, leave other values as-is."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def main():
    if not INPUT_PATH.exists():
        # Fallback: try CSV if Excel doesn't exist
        csv_path = INPUT_PATH.with_suffix(".csv")
        if csv_path.exists():
            df = pd.read_csv(csv_path, encoding="utf-8-sig", sep="\t")
        else:
            raise FileNotFoundError(
                f"Input file not found: {INPUT_PATH}\n"
                "Please add Models_Experiment_Order_Expanded.xlsx to Model_Ordered_experiment/"
            )
    else:
        df = pd.read_excel(INPUT_PATH)

    participants = {}

    for _, row in df.iterrows():
        pid_raw = row.get("Participant_ID")
        if pd.isna(pid_raw):
            continue
        pid = str(pid_raw).strip()
        if not pid.startswith("P"):
            pid = "P" + pid

        participant = {
            "participant_id": pid,
            "model_order_text": clean(row.get("סדר_מודלים")),
            "visualization_order_text": clean(row.get("סדר_תנאים")),
            "practice": [],
            "models": [],
        }

        # -------------------------
        # PRACTICE (R1..R6)
        # -------------------------
        for r in range(1, 7):
            scenario_id = row.get(f"תרגול_R{r}_Scenario_ID")
            if pd.isna(scenario_id):
                continue
            trial = {
                "slot": r,
                "scenario_id": clean(scenario_id),
                "difficulty": clean(row.get(f"תרגול_R{r}_קושי")) or "E",
                "correct_route": None,
                "ai_recommended_route": None,
                "correct_answers": {},
            }
            participant["practice"].append(trial)

        # -------------------------
        # MODELS (1, 2)
        # -------------------------
        for model_idx in [1, 2]:
            prefix = f"מודל_{model_idx}_"
            model_type = clean(row.get(prefix + "סוג_מודל"))
            vis_order_text = clean(row.get(prefix + "סדר_ויזואליזציות"))

            model = {
                "index": model_idx,
                "model_type": model_type,
                "visualization_order_text": vis_order_text,
                "visualizations": [],
            }

            # VIS1, VIS2, VIS3
            for vis_idx in [1, 2, 3]:
                vis_prefix = prefix + f"VIS{vis_idx}_"
                viz_name = clean(row.get(vis_prefix + "ויזואליזציה"))

                vis_block = {
                    "index": vis_idx,
                    "visualization": viz_name,
                    "trials": [],
                }

                for r in range(1, 6):
                    scenario_col = vis_prefix + f"R{r}_Scenario_ID"
                    if scenario_col not in df.columns:
                        continue
                    scenario_id = row.get(scenario_col)
                    if pd.isna(scenario_id):
                        continue

                    trial = {
                        "slot": r,
                        "scenario_id": clean(scenario_id),
                        "difficulty": clean(row.get(vis_prefix + f"R{r}_קושי")) or "E",
                        "correct_route": None,
                        "ai_recommended_route": None,
                        "correct_answers": {},
                        "rec_correct": None,
                    }
                    vis_block["trials"].append(trial)

                model["visualizations"].append(vis_block)

            participant["models"].append(model)

        participants[pid] = participant

    # -------------------------
    # WRITE
    # -------------------------
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for pid, pdata in participants.items():
        out_path = OUTPUT_DIR / f"{pid}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(pdata, f, ensure_ascii=False, indent=2)

    with open(COMBINED_JSON, "w", encoding="utf-8") as f:
        json.dump(list(participants.values()), f, ensure_ascii=False, indent=2)

    print(f"Written {len(participants)} participant JSON files to '{OUTPUT_DIR}'")
    print(f"Combined JSON written to '{COMBINED_JSON}'")


if __name__ == "__main__":
    main()
