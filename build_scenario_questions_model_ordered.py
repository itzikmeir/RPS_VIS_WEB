"""
Build scenario_questions.json for the model-ordered experiment.

Input:  Model_Ordered_experiment/models_SCN_Questions_catalog.xlsx
Output: experiment_model_ordered/questions/scenario_questions.json

Same logic as build_scenario_questions.py but uses the model-ordered catalog
and outputs to the model-ordered questions folder.
"""
import json
import math
from pathlib import Path
from typing import List, Optional

import pandas as pd

ROOT_DIR = Path(__file__).resolve().parent
INPUT_PATH = ROOT_DIR / "Model_Ordered_experiment" / "models_SCN_Questions_catalog.xlsx"
OUTPUT_PATH = ROOT_DIR / "experiment_model_ordered" / "questions" / "scenario_questions.json"


def is_nan(value) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return True
    try:
        return pd.isna(value)
    except Exception:
        return False


def parse_options(raw) -> List[str]:
    """Parse the options cell (O1/O2/O3) - multi-line text to list."""
    if is_nan(raw):
        return []
    text = str(raw).replace("\r\n", "\n").replace("\r", "\n")
    parts = [p.strip() for p in text.split("\n")]
    return [p for p in parts if p]


def _match_single_answer_to_index(ans: str, options: List[str]) -> Optional[int]:
    """Match a single answer string to an option index. Returns 0-based index or None."""
    ans = ans.strip()
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
    return None


def find_correct_indices(answer_raw, options: List[str]) -> List[int]:
    """
    Infer 0-based correct option indices from A1/A2/A3 and options.
    Supports comma-separated answers (e.g. "מסלול א, מסלול ב") for multiple correct answers.
    Returns a list of indices (may be empty, or have 1+ elements).
    """
    if is_nan(answer_raw) or not options:
        return []
    raw = str(answer_raw).strip()
    # Split by comma for multiple correct answers
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    indices = []
    seen = set()
    for ans in parts:
        idx = _match_single_answer_to_index(ans, options)
        if idx is not None and idx not in seen:
            indices.append(idx)
            seen.add(idx)
        elif idx is None and ans:
            pass  # Unmatched part in comma-separated answer; skip silently
    return indices


def build_scenario_questions():
    if not INPUT_PATH.exists():
        raise SystemExit(f"Input not found: {INPUT_PATH}")

    # Sheet index 1 = "קטלוג תרחישים" (scenario catalog) with Q1/O1/A1 etc.
    try:
        df = pd.read_excel(INPUT_PATH, sheet_name=1)
    except Exception:
        df = pd.read_excel(INPUT_PATH)

    # SCN_ID or Scenario_ID for base scenario
    id_col = "SCN_ID" if "SCN_ID" in df.columns else "Scenario_ID"
    required_cols = [
        id_col, "Scenario_ID_H", "Scenario_ID_R", "Scenario_ID_S",
        "Q1", "O1", "A1", "Q2", "O2", "A2", "Q3", "O3", "A3",
    ]
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns in {INPUT_PATH}: {missing}")

    scenario_questions = []

    for _, row in df.iterrows():
        base_scn_raw = row.get(id_col)
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
            correct_indices = find_correct_indices(a_raw, options)
            # Store correct_answer_indices (array); keep correct_answer_index for backward compat (first element)
            per_scenario_questions.append({
                "question_id": f"sa_{i}",
                "question_text": str(q_text_raw).strip(),
                "options": options,
                "correct_answer_indices": correct_indices,
                "correct_answer_index": correct_indices[0] if len(correct_indices) == 1 else (correct_indices[0] if correct_indices else None),
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
                    "correct_answer_indices": q["correct_answer_indices"],
                    "correct_answer_index": q["correct_answer_index"],
                })

    out_obj = {"scenario_questions": scenario_questions}
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(scenario_questions)} scenario-question entries for {len(df)} rows to '{OUTPUT_PATH}'")


if __name__ == "__main__":
    build_scenario_questions()
