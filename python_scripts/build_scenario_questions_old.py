"""
Build scenario_questions.json for the OLD experiment (order by vis type).
Uses old_experiment_order_files_by_vis_type/ folder.
"""
import json
from pathlib import Path
from typing import List, Optional

import math
import pandas as pd

# Scripts live in python_scripts/; project root is parent; old experiment in subfolder
ROOT_DIR = Path(__file__).resolve().parent.parent
OLD_EXP_DIR = ROOT_DIR / "old_experiment_order_files_by_vis_type"
INPUT_PATH = OLD_EXP_DIR / "SCN_Questions_catalog.xlsx"
OUTPUT_PATH = OLD_EXP_DIR / "questions" / "scenario_questions.json"


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


def parse_options(raw) -> List[str]:
    if is_nan(raw):
        return []
    text = str(raw).replace("\r\n", "\n").replace("\r", "\n")
    parts = [p.strip() for p in text.split("\n")]
    return [p for p in parts if p]


def find_correct_index(answer_raw, options: List[str]) -> Optional[int]:
    if is_nan(answer_raw) or not options:
        return None
    ans = str(answer_raw).strip()
    for idx, opt in enumerate(options):
        if opt.strip() == ans:
            return idx
    try:
        num = int(ans)
        idx = num - 1
        if 0 <= idx < len(options):
            return idx
    except ValueError:
        pass
    heb_letters = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י",
                   "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ", "ק", "ר", "ש", "ת"]
    if ans in heb_letters:
        idx = heb_letters.index(ans)
        if 0 <= idx < len(options):
            return idx
    print(f"[WARN] Could not match answer '{ans}' to options {options}")
    return None


def build_scenario_questions():
    df = pd.read_excel(INPUT_PATH)
    required_cols = [
        "Scenario_ID", "Scenario_ID_H", "Scenario_ID_R", "Scenario_ID_S",
        "Q1", "O1", "A1", "Q2", "O2", "A2", "Q3", "O3", "A3",
    ]
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Missing expected columns in {INPUT_PATH}: {missing}")

    scenario_questions = []

    for _, row in df.iterrows():
        base_scn_raw = row.get("Scenario_ID")
        if is_nan(base_scn_raw):
            continue
        base_scn = str(base_scn_raw).strip()
        scenario_ids: List[str] = []
        for variant_col in ["Scenario_ID_H", "Scenario_ID_R", "Scenario_ID_S"]:
            val = row.get(variant_col)
            if not is_nan(val):
                sid = str(val).strip()
                if sid:
                    scenario_ids.append(sid)
        if not scenario_ids:
            scenario_ids.append(base_scn)

        per_scenario_questions = []
        for i in (1, 2, 3):
            q_text_raw = row.get(f"Q{i}")
            o_raw = row.get(f"O{i}")
            a_raw = row.get(f"A{i}")
            if is_nan(q_text_raw):
                continue
            options = parse_options(o_raw)
            correct_index = find_correct_index(a_raw, options)
            per_scenario_questions.append({
                "question_id": f"sa_{i}",
                "question_text": str(q_text_raw).strip(),
                "options": options,
                "correct_answer_index": correct_index,
            })

        if not per_scenario_questions:
            continue

        for sid in scenario_ids:
            for q in per_scenario_questions:
                scenario_questions.append({
                    "scenario_id": sid,
                    "question_id": q["question_id"],
                    "question_text": q["question_text"],
                    "options": q["options"],
                    "correct_answer_index": q["correct_answer_index"],
                })

    out_obj = {"scenario_questions": scenario_questions}
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(scenario_questions)} scenario-question entries for {len(df)} rows to '{OUTPUT_PATH}'")


if __name__ == "__main__":
    build_scenario_questions()
