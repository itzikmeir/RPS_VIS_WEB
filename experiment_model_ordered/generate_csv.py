#!/usr/bin/env python3
"""
Generate a comprehensive flat CSV from all participant log files.

Each row = one trial (scenario). Joined columns per row:
  - Trial info: participant, stage, model, vis, scenario, routes, timing
  - Post-scenario questionnaire: confidence, workload, SA questions
  - NASA-TLX: repeated from the vis-block questionnaire (vis-block level)
  - Model trust: repeated from the model summary questionnaire (model level)
  - Model preference: final model choice (study level)
  - Visualization global ranking (study level)
  - Demographics (study level)

Column note convention:
  model_index   0 = first model seen, 1 = second model seen
  model_type    OPT = optimal AI model, SUB = suboptimal AI model
  vis_index     0/1/2 = order within a model block
  visualization stacked_bars | radar | heatmap (English)
  scenario_vis_type  stacked_bars|radar|heatmap derived from scenario_id suffix (S/R/H)
  difficulty    easy | hard
  routes        Route_A | Route_B | Route_C
  nasa_*        from NasaTLX after each vis block (repeated for all trials in that block)
  model_trust*  1-7 Likert trust scale after each model (repeated for all trials in model)
  model_preference  model_A_M0 = first model, model_B_M1 = second model
  vis_rank_*    1-3 ranking (1=most preferred) from post-experiment global vis question
  demo_*        demographic fields (age, gender, etc.)
"""

import json
import csv
from pathlib import Path

LOGS_DIR = Path(__file__).parent / "participants_log"
OUTPUT_FILE = Path(__file__).parent.parent / "all_participants_data.csv"

ROUTE_MAP = {
    "א׳": "Route_A",
    "ב׳": "Route_B",
    "ג׳": "Route_C",
    "מסלול א": "Route_A",
    "מסלול ב": "Route_B",
    "מסלול ג": "Route_C",
    "לא יודע/ת": "dont_know",
}

VIS_MAP = {
    "עמודות נערמות": "stacked_bars",
    "עמודות מוערמות": "stacked_bars",
    "רדאר": "radar",
    "מפת חום": "heatmap",
}

GENDER_MAP = {
    "נקבה": "female",
    "זכר": "male",
    "אחר": "other",
    "אחר/ת": "other",
    "לא מעוניין/ת לציין": "prefer_not_to_say",
}

LANGUAGE_MAP = {
    "עברית": "Hebrew",
    "ערבית": "Arabic",
    "אנגלית": "English",
    "רוסית": "Russian",
    "אמהרית": "Amharic",
    "צרפתית": "French",
    "ספרדית": "Spanish",
}

EDUCATION_MAP = {
    "תואר ראשון": "bachelor",
    "תואר שני": "master",
    "תואר שלישי": "doctorate",
    "תיכון": "high_school",
    "תעודת הנדסאי/טכנאי": "technician_diploma",
    "דיפלומה": "diploma",
    "אחר": "other",
}

SCENARIO_TYPE_MAP = {"S": "stacked_bars", "R": "radar", "H": "heatmap"}


def route(heb):
    return ROUTE_MAP.get(heb) if heb else None


def translate_correct_answer(text):
    """Translate comma-separated Hebrew route text like 'מסלול א, מסלול ב'."""
    if not text:
        return None
    parts = [ROUTE_MAP.get(p.strip(), p.strip()) for p in text.split(",")]
    return " | ".join(parts)


def duration_sec(start, end):
    if start is None or end is None:
        return None
    return round((end - start) / 1000, 2)


def process_log(log_data):
    pages = log_data.get("pages", [])
    trials = log_data.get("trials", [])
    questionnaires = log_data.get("questionnaires", [])

    # --- Build lookup tables from pages ---
    vis_name_map = {}     # (model_index, vis_index) -> English vis name
    model_type_map = {}   # model_index -> "OPT" or "SUB"
    for p in pages:
        pt = p.get("page_type", "")
        m = p.get("metadata", {})
        if pt == "vis_intro" and "model_index" in m:
            vis_name_map[(m["model_index"], m["vis_index"])] = VIS_MAP.get(
                m.get("visualization", ""), m.get("visualization", "")
            )
        elif pt == "model_intro" and "model_index" in m:
            model_type_map[m["model_index"]] = m.get("model_type")

    # --- Build questionnaire lookup tables ---
    post_scenario_q = {}   # trial_id -> questionnaire record
    nasa_tlx_q = {}        # (model_index, vis_index) -> answers dict
    model_summary_q = {}   # model_index -> answers dict
    model_selection_ans = None
    vis_global_ans = None
    demographics_ans = None

    for q in questionnaires:
        qt = q.get("questionnaire_type", "")
        if qt == "post_scenario":
            tid = q.get("trial_id")
            if tid:
                post_scenario_q[tid] = q
        elif qt == "nasa_tlx":
            key = (q.get("model_index"), q.get("vis_index"))
            nasa_tlx_q[key] = q.get("answers", {})
        elif qt == "model_summary":
            model_summary_q[q.get("model_index")] = q.get("answers", {})
        elif qt == "model_selection":
            model_selection_ans = q.get("answers", {})
        elif qt == "visualization_global":
            vis_global_ans = q.get("answers", {})
        elif qt == "demographics":
            demographics_ans = q.get("answers", {})

    # --- Parse model preference ---
    pref_raw = (model_selection_ans or {}).get("model_preference", "") or ""
    if "A" in pref_raw:
        model_pref = "model_A_M0"
    elif "B" in pref_raw:
        model_pref = "model_B_M1"
    else:
        model_pref = pref_raw or None

    # --- Parse visualization global rankings ---
    vg = vis_global_ans or {}
    vis_rank_stacked = vg.get("עמודות מוערמות") or vg.get("עמודות נערמות")
    vis_rank_radar = vg.get("רדאר")
    vis_rank_heatmap = vg.get("מפת חום")
    vis_help_raw = vg.get("help_element", "") or ""
    # Extract the letter option (e.g., "ג." from "ג. אזור הוויזואליזציות...")
    vis_help_option = vis_help_raw[0] if vis_help_raw else None

    # --- Parse demographics ---
    demo = demographics_ans or {}
    demo_age = demo.get("age")
    demo_gender = GENDER_MAP.get(demo.get("gender", ""), demo.get("gender"))
    demo_lang_raw = demo.get("native_language", "")
    demo_lang = LANGUAGE_MAP.get(demo_lang_raw, demo_lang_raw)
    demo_edu_raw = demo.get("education", "")
    demo_edu = EDUCATION_MAP.get(demo_edu_raw, demo_edu_raw)
    demo_field = demo.get("field")
    demo_nav = demo.get("navigation_use")
    demo_tech = demo.get("tech_skill")
    demo_viz_lit = demo.get("viz_literacy")

    # --- Build one row per trial ---
    rows = []
    for trial in trials:
        pid = trial["participant_id"]
        trial_id = trial["trial_id"]
        stage = trial["stage"]
        model_idx = trial["model_index"]
        vis_idx = trial["vis_index"]
        trial_idx = trial["trial_index"]
        scenario_id = trial["scenario_id"]

        scenario_type_code = scenario_id.rsplit("_", 1)[-1] if scenario_id else None
        scenario_vis_type = SCENARIO_TYPE_MAP.get(scenario_type_code)

        difficulty_code = trial.get("difficulty", "")
        difficulty = "easy" if difficulty_code == "E" else "hard" if difficulty_code == "H" else difficulty_code

        true_rt = route(trial.get("true_route"))
        ai_rt = route(trial.get("ai_route"))
        user_rt = route(trial.get("user_route"))
        ai_was_correct = (ai_rt == true_rt) if (ai_rt and true_rt) else None

        model_type = trial.get("model_type") or model_type_map.get(model_idx)
        vis_name = vis_name_map.get((model_idx, vis_idx))
        trial_dur = duration_sec(trial.get("start_ts"), trial.get("end_ts"))

        # Post-scenario questionnaire
        pq = post_scenario_q.get(trial_id, {})
        pq_ans = pq.get("answers", {})
        pq_correct = pq.get("correct", {})
        pq_dur = duration_sec(pq.get("enter_ts"), pq.get("exit_ts"))
        sq = pq_ans.get("scenario_questions", {})
        sa1 = sq.get("sa_1", {})
        sa2 = sq.get("sa_2", {})

        sa1_answer = ROUTE_MAP.get(sa1.get("answer_text", ""), sa1.get("answer_text"))
        sa2_answer = ROUTE_MAP.get(sa2.get("answer_text", ""), sa2.get("answer_text"))

        # NASA-TLX (vis-block level; repeated for all trials in the same vis block)
        nasa = nasa_tlx_q.get((model_idx, vis_idx), {})

        # Model trust (model level; repeated for all trials in same model)
        trust = model_summary_q.get(model_idx, {}).get("trust", {})

        row = {
            # --- Identity ---
            "participant_id": pid,
            "stage": stage,                         # practice | experiment
            "model_index": model_idx,               # 0 = first model seen, 1 = second
            "model_type": model_type,               # OPT | SUB (null for practice)
            "vis_index": vis_idx,                   # 0/1/2 within model block (null for practice)
            "visualization": vis_name,              # stacked_bars | radar | heatmap
            "trial_index": trial_idx,               # trial order within vis block
            "scenario_id": scenario_id,

            # --- Scenario characteristics ---
            "scenario_vis_type": scenario_vis_type, # stacked_bars|radar|heatmap from scenario ID
            "difficulty": difficulty,               # easy | hard

            # --- Routes ---
            "true_route": true_rt,                  # correct optimal route
            "ai_route": ai_rt,                      # AI recommended route
            "ai_was_correct": ai_was_correct,       # whether AI recommendation matched true optimal
            "user_route": user_rt,                  # participant's chosen route
            "followed_ai": trial.get("followed_ai"),
            "chose_true_optimal": trial.get("chose_true_optimal"),

            # --- Timing ---
            "trial_duration_sec": trial_dur,
            "questionnaire_duration_sec": pq_dur,

            # --- Post-scenario questionnaire ---
            "q_confidence": pq_ans.get("confidence"),       # -10 to 10
            "q_mental_workload": pq_ans.get("mental_workload"),  # -10 to 10
            "q_sa1_answer": sa1_answer,
            "q_sa1_correct_answer": translate_correct_answer(pq_correct.get("Q1")),
            "q_sa1_is_correct": sa1.get("is_correct"),
            "q_sa2_answer": sa2_answer,
            "q_sa2_correct_answer": translate_correct_answer(pq_correct.get("Q2")),
            "q_sa2_is_correct": sa2.get("is_correct"),

            # --- NASA-TLX (vis-block level, -10 to 10) ---
            "nasa_mental_demand": nasa.get("mental_demand"),
            "nasa_time_demand": nasa.get("time_demand"),
            "nasa_performance": nasa.get("performance"),
            "nasa_effort": nasa.get("effort"),
            "nasa_frustration": nasa.get("frustration"),

            # --- Model trust questionnaire (model level, 1-7 Likert) ---
            "model_trust1": trust.get("trust1"),
            "model_trust2": trust.get("trust2"),
            "model_trust3": trust.get("trust3"),
            "model_trust4": trust.get("trust4"),
            "model_trust5": trust.get("trust5"),
            "model_trust6": trust.get("trust6"),
            "model_trust7": trust.get("trust7"),
            "model_trust8": trust.get("trust8"),
            "model_trust9": trust.get("trust9"),
            "model_trust10": trust.get("trust10"),
            "model_trust11": trust.get("trust11"),
            "model_trust12": trust.get("trust12"),

            # --- Post-experiment model preference (study level) ---
            "model_preference": model_pref,         # model_A_M0 | model_B_M1

            # --- Visualization global ranking (study level) ---
            # 1=most preferred, 3=least preferred
            "vis_rank_stacked_bars": vis_rank_stacked,
            "vis_rank_radar": vis_rank_radar,
            "vis_rank_heatmap": vis_rank_heatmap,
            "vis_help_element_option": vis_help_option,  # letter of most helpful UI element

            # --- Demographics ---
            "demo_age": demo_age,
            "demo_gender": demo_gender,             # female | male | other
            "demo_native_language": demo_lang,
            "demo_education": demo_edu,
            "demo_field": demo_field,
            "demo_navigation_use": demo_nav,        # 1-7 self-rated navigation app use
            "demo_tech_skill": demo_tech,           # 1-7 self-rated tech skill
            "demo_viz_literacy": demo_viz_lit,      # 1-7 self-rated visualization literacy
        }
        rows.append(row)

    return rows


def main():
    log_files = sorted(LOGS_DIR.glob("P*_log.json"),
                       key=lambda f: int(f.stem.replace("P", "").replace("_log", "")))
    print(f"Found {len(log_files)} participant log files.")

    all_rows = []
    for log_file in log_files:
        with open(log_file, "r", encoding="utf-8") as f:
            log_data = json.load(f)
        rows = process_log(log_data)
        all_rows.extend(rows)
        pid = log_file.stem.replace("_log", "")
        print(f"  {pid}: {len(rows)} trial rows")

    if not all_rows:
        print("No data found.")
        return

    fieldnames = list(all_rows[0].keys())
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    n_exp = sum(1 for r in all_rows if r["stage"] == "experiment")
    n_prac = sum(1 for r in all_rows if r["stage"] == "practice")
    print(f"\nDone. Written to: {OUTPUT_FILE}")
    print(f"Total rows: {len(all_rows)}  (practice: {n_prac}, experiment: {n_exp})")


if __name__ == "__main__":
    main()
