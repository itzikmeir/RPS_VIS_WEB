import json
import os
from typing import List, Optional

import math
import pandas as pd


INPUT_PATH = "SCN_Questions_catalog.xlsx"
OUTPUT_PATH = os.path.join("questions", "scenario_questions.json")


def is_nan(value) -> bool:
    """Return True if value is a NaN (float) or pandas NA."""
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return True
    # pandas NA / NaT etc.
    try:
        return pd.isna(value)
    except Exception:
        return False


def parse_options(raw) -> List[str]:
    """
    Parse the options cell (O1/O2/O3).

    The Excel file stores options as multiple lines in a single cell, e.g.:
        "א
        ב
        ג
        לא יודע/ת"
    This function splits on newlines, trims whitespace and removes empty lines.
    """
    if is_nan(raw):
        return []

    text = str(raw).replace("\r\n", "\n").replace("\r", "\n")
    parts = [p.strip() for p in text.split("\n")]
    return [p for p in parts if p]


def find_correct_index(answer_raw, options: List[str]) -> Optional[int]:
    """
    Given the raw answer cell (A1/A2/A3) and the parsed options,
    return a 0-based index of the correct option if we can infer it.

    Strategy:
    1. Try exact text match against the options.
    2. If the answer looks numeric, treat it as 1-based index.
    3. Handle Hebrew letters (א, ב, ג, ד, ה, ...) as A, B, C, ...
    """
    if is_nan(answer_raw) or not options:
        return None

    ans = str(answer_raw).strip()

    # 1) Direct text match
    for idx, opt in enumerate(options):
        if opt.strip() == ans:
            return idx

    # 2) Numeric (1-based) index
    try:
        num = int(ans)
        idx = num - 1
        if 0 <= idx < len(options):
            return idx
    except ValueError:
        pass

    # 3) Hebrew letters mapping (א, ב, ג, ד, ה, ו, ז, ח, ט, י, ...)
    heb_letters = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י",
                   "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ", "ק", "ר", "ש", "ת"]
    if ans in heb_letters:
        idx = heb_letters.index(ans)
        if 0 <= idx < len(options):
            return idx

    # Fallback: we could not match – leave as None but log for debugging
    print(f"[WARN] Could not match answer '{ans}' to options {options}")
    return None


def build_scenario_questions():
    # Read the Excel catalog
    df = pd.read_excel(INPUT_PATH)

    # Basic sanity check for required columns
    required_cols = [
        "Scenario_ID",
        "Scenario_ID_H",
        "Scenario_ID_R",
        "Scenario_ID_S",
        "Q1",
        "O1",
        "A1",
        "Q2",
        "O2",
        "A2",
        "Q3",
        "O3",
        "A3",
    ]
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Missing expected columns in {INPUT_PATH}: {missing}")

    scenario_questions = []

    for _, row in df.iterrows():
        base_scn_raw = row.get("Scenario_ID")
        if is_nan(base_scn_raw):
            # Skip completely empty rows
            continue

        base_scn = str(base_scn_raw).strip()

        # Each scenario can have up to three visualization variants (H/R/S),
        # and all of them share the same question set.
        scenario_ids: List[str] = []
        for variant_col in ["Scenario_ID_H", "Scenario_ID_R", "Scenario_ID_S"]:
            val = row.get(variant_col)
            if not is_nan(val):
                sid = str(val).strip()
                if sid:
                    scenario_ids.append(sid)

        if not scenario_ids:
            # If no variant IDs are given, we still attach questions to the base Scenario_ID
            scenario_ids.append(base_scn)

        # Prepare the three scenario questions (Q1–Q3)
        per_scenario_questions = []
        for i in (1, 2, 3):
            q_text_raw = row.get(f"Q{i}")
            o_raw = row.get(f"O{i}")
            a_raw = row.get(f"A{i}")

            if is_nan(q_text_raw):
                # No question in this slot
                continue

            options = parse_options(o_raw)
            correct_index = find_correct_index(a_raw, options)

            per_scenario_questions.append(
                {
                    "question_id": f"sa_{i}",  # keeps compatibility with app.js
                    "question_text": str(q_text_raw).strip(),
                    "options": options,
                    "correct_answer_index": correct_index,
                }
            )

        if not per_scenario_questions:
            continue

        # Duplicate this question set for each scenario_id variant
        for sid in scenario_ids:
            for q in per_scenario_questions:
                entry = {
                    "scenario_id": sid,
                    "question_id": q["question_id"],
                    "question_text": q["question_text"],
                    "options": q["options"],
                    "correct_answer_index": q["correct_answer_index"],
                }
                scenario_questions.append(entry)

    # Wrap in the structure expected by app.js: { "scenario_questions": [...] }
    out_obj = {"scenario_questions": scenario_questions}

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, indent=2)

    print(
        f"Wrote {len(scenario_questions)} scenario-question entries "
        f"for {len(df)} rows to '{OUTPUT_PATH}'"
    )


if __name__ == "__main__":
    build_scenario_questions()

