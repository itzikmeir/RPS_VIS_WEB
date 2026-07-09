"""
Correct Experiment_Raw_Data's "Trials" sheet using Model_Ordered_experiment's
Schedule_Long sheet as the answer key.

Background: the raw trial data currently has AI_REC / TRUE_ROUTE values that
were computed from an earlier, buggy version of the schedule. That produced
per-participant OPT/SUB "AI recommendation accuracy" far from the intended
design (OPT should be ~80% correct = 4/5, SUB should be ~50% correct = 2/4).
This script re-derives AI_REC and TRUE_ROUTE for every trial from the
corrected Schedule_Long sheet (matched on Participant_ID + Scenario_ID), then
recomputes every column that logically depends on them.

Columns overwritten (recomputed from Schedule_Long + the existing USER_CHOICE,
which is the participant's real recorded response and is never touched):
  AI_REC, TRUE_ROUTE, Wrong, FOLLOWED_AI, CHOOSE_OPTIMAL, AI_Correct,
  SDT_Outcome, Appropriate_Reliance, CA, CR, FA, FR, Block_Accuracy

Columns deliberately left untouched (meaning isn't reliably derivable, or they
are independent recorded measures, not connected to the corrected answer key):
  True_ORG, ERROR_REC, RT_SEC, CONFIDENCE, MENTAL_WL, SA1_*, SA2_*, SA_MEAN,
  USER_CHOICE, Trial_No, Phase, SCN_ID, VIS, MODEL, DIFFICULTY

A "Rec_Correct_Schedule" column is added (not overwriting anything) so the
schedule's own Rec_Correct label is visible next to the recomputed AI_Correct
for cross-checking.

Usage:
  python python_scripts/fix_raw_data_from_schedule.py
  python python_scripts/fix_raw_data_from_schedule.py --raw "C:\\path\\to\\Experiment_Raw_Data_updated.xlsx" --out "C:\\path\\to\\Experiment_Raw_Data_corrected.xlsx"
"""
import argparse
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from route_utils import normalize_route_letter  # noqa: E402

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SCHEDULE = ROOT_DIR / "Model_Ordered_experiment" / "Models_Experiment_Order_Expanded_corrected.xlsx"
DEFAULT_RAW = Path.home() / "Downloads" / "Experiment_Raw_Data_updated.xlsx"
DEFAULT_OUT = Path.home() / "Downloads" / "Experiment_Raw_Data_corrected.xlsx"
DEFAULT_CHART = ROOT_DIR / "Model_Ordered_experiment" / "opt_sub_accuracy_validation.png"

SDT_MATRIX = {
    (1, 1): "Correct Acceptance",
    (1, 0): "False Rejection",
    (0, 0): "Correct Rejection",
    (0, 1): "False Acceptance",
}
APPROPRIATE = {"Correct Acceptance", "Correct Rejection"}


def load_schedule_map(schedule_path: Path) -> dict:
    df = pd.read_excel(schedule_path, sheet_name="Schedule_Long")
    df = df.dropna(subset=["Participant_ID", "Scenario_ID"])
    df = df[df["Participant_ID"].astype(str).str.strip().str.upper().str.startswith("P")]

    mapping = {}
    for _, row in df.iterrows():
        pid = str(row["Participant_ID"]).strip().upper()
        sid = str(row["Scenario_ID"]).strip()
        correct = normalize_route_letter(row.get("Correct_Answer"))
        rec = normalize_route_letter(row.get("System_Recommendation"))
        rec_correct = None if pd.isna(row.get("Rec_Correct")) else str(row.get("Rec_Correct")).strip()
        if correct is None or rec is None:
            print(f"[WARN] Schedule_Long row {pid}/{sid}: could not normalize route "
                  f"(Correct_Answer={row.get('Correct_Answer')!r}, System_Recommendation={row.get('System_Recommendation')!r}) - skipped.")
            continue
        mapping[(pid, sid)] = {
            "true_route": correct,
            "ai_rec": rec,
            "rec_correct": rec_correct,
        }
    return mapping


def correct_trials(trials: pd.DataFrame, sched_map: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    trials = trials.copy()
    trials["Participant_ID"] = trials["Participant_ID"].astype(str).str.strip()
    trials = trials[trials["Participant_ID"].str.upper().str.startswith("P")].copy()

    log_rows = []
    unmatched = []

    for idx, row in trials.iterrows():
        pid = row["Participant_ID"].strip().upper()
        sid = str(row["Scenario_ID"]).strip()
        key = (pid, sid)
        if key not in sched_map:
            unmatched.append((pid, sid))
            continue

        info = sched_map[key]
        old_ai_rec = row.get("AI_REC")
        old_true_route = row.get("TRUE_ROUTE")

        new_ai_rec = info["ai_rec"]
        new_true_route = info["true_route"]
        user_choice = row.get("USER_CHOICE")
        user_choice = str(user_choice).strip() if pd.notna(user_choice) else None

        choose_optimal = 1 if (user_choice is not None and user_choice == new_true_route) else 0
        wrong = 1 - choose_optimal
        followed_ai = 1 if (user_choice is not None and user_choice == new_ai_rec) else 0
        ai_correct = 1 if new_ai_rec == new_true_route else 0
        sdt = SDT_MATRIX[(ai_correct, followed_ai)]
        appropriate = 1 if sdt in APPROPRIATE else 0

        trials.at[idx, "AI_REC"] = new_ai_rec
        trials.at[idx, "TRUE_ROUTE"] = new_true_route
        trials.at[idx, "Wrong"] = wrong
        trials.at[idx, "FOLLOWED_AI"] = followed_ai
        trials.at[idx, "CHOOSE_OPTIMAL"] = choose_optimal
        trials.at[idx, "AI_Correct"] = ai_correct
        trials.at[idx, "SDT_Outcome"] = sdt
        trials.at[idx, "Appropriate_Reliance"] = appropriate
        trials.at[idx, "CA"] = 1 if sdt == "Correct Acceptance" else 0
        trials.at[idx, "CR"] = 1 if sdt == "Correct Rejection" else 0
        trials.at[idx, "FA"] = 1 if sdt == "False Acceptance" else 0
        trials.at[idx, "FR"] = 1 if sdt == "False Rejection" else 0
        trials.at[idx, "Rec_Correct_Schedule"] = info["rec_correct"]

        if str(old_ai_rec).strip() != new_ai_rec or str(old_true_route).strip() != new_true_route:
            log_rows.append({
                "Participant_ID": pid,
                "Scenario_ID": sid,
                "SCN_ID": row.get("SCN_ID"),
                "MODEL": row.get("MODEL"),
                "AI_REC_old": old_ai_rec, "AI_REC_new": new_ai_rec,
                "TRUE_ROUTE_old": old_true_route, "TRUE_ROUTE_new": new_true_route,
                "SDT_Outcome_new": sdt,
            })

    if unmatched:
        print(f"[WARN] {len(unmatched)} trial rows had no matching Schedule_Long entry "
              f"(left completely untouched): {unmatched[:10]}{' ...' if len(unmatched) > 10 else ''}")

    # Recompute Block_Accuracy = mean(AI_Correct) per (Participant_ID, MODEL, VIS),
    # Experiment phase only (matches the existing null pattern for Practice).
    exp_mask = trials["Phase"] == "Experiment"
    block_means = (
        trials[exp_mask]
        .groupby(["Participant_ID", "MODEL", "VIS"])["AI_Correct"]
        .transform("mean")
    )
    trials.loc[exp_mask, "Block_Accuracy"] = block_means

    log_df = pd.DataFrame(log_rows)
    return trials, log_df


def build_model_summary(trials: pd.DataFrame) -> pd.DataFrame:
    exp = trials[trials["Phase"] == "Experiment"]
    rows = []
    for pid, g in exp.groupby("Participant_ID"):
        opt = g[g["MODEL"] == "OPT"]["AI_Correct"]
        sub = g[g["MODEL"] == "SUB"]["AI_Correct"]
        opt_acc = opt.mean() if len(opt) else float("nan")
        sub_acc = sub.mean() if len(sub) else float("nan")
        rows.append({
            "Participant_ID": pid,
            "OPT_accuracy": opt_acc,
            "SUB_accuracy": sub_acc,
            "Abs_Diff": abs(opt_acc - sub_acc) if pd.notna(opt_acc) and pd.notna(sub_acc) else float("nan"),
        })
    return pd.DataFrame(rows).sort_values("Participant_ID").reset_index(drop=True)


def make_chart(model_summary: pd.DataFrame, out_path: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    df = model_summary.sort_values("Participant_ID")
    x = np.arange(len(df))
    width = 0.38

    fig, ax = plt.subplots(figsize=(14, 6))
    ax.bar(x - width / 2, df["OPT_accuracy"], width, label="OPT (expect 4/5 = 0.80)", color="#2563EB")
    ax.bar(x + width / 2, df["SUB_accuracy"], width, label="SUB (expect 2/4 = 0.50)", color="#F59E0B")
    ax.axhline(0.8, color="#2563EB", linestyle="--", linewidth=1, alpha=0.7)
    ax.axhline(0.5, color="#F59E0B", linestyle="--", linewidth=1, alpha=0.7)

    ax.set_xticks(x)
    ax.set_xticklabels(df["Participant_ID"], rotation=90, fontsize=8)
    ax.set_ylabel("AI recommendation accuracy (fraction of trials AI_REC == TRUE_ROUTE)")
    ax.set_ylim(0, 1.05)
    ax.set_title("Per-participant OPT vs SUB recommendation accuracy (after correction)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--schedule", default=str(DEFAULT_SCHEDULE))
    ap.add_argument("--raw", default=str(DEFAULT_RAW))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--chart", default=str(DEFAULT_CHART))
    args = ap.parse_args()

    schedule_path = Path(args.schedule)
    raw_path = Path(args.raw)
    out_path = Path(args.out)
    chart_path = Path(args.chart)

    if not schedule_path.exists():
        raise SystemExit(f"Schedule file not found: {schedule_path}")
    if not raw_path.exists():
        raise SystemExit(f"Raw data file not found: {raw_path}")

    print(f"Loading answer key from {schedule_path} (sheet Schedule_Long) ...")
    sched_map = load_schedule_map(schedule_path)
    print(f"  {len(sched_map)} participant/scenario recommendation entries loaded.")

    print(f"Loading raw trial data from {raw_path} (sheet Trials) ...")
    raw_xl = pd.ExcelFile(raw_path)
    trials = raw_xl.parse("Trials")
    print(f"  {len(trials)} rows loaded.")

    trials_fixed, log_df = correct_trials(trials, sched_map)
    print(f"Corrected {len(log_df)} rows (AI_REC and/or TRUE_ROUTE changed).")

    model_summary = build_model_summary(trials_fixed)
    print("\nRecomputed Model_Summary (first 10 rows):")
    print(model_summary.head(10).to_string(index=False))
    print(f"\nMean OPT_accuracy across participants: {model_summary['OPT_accuracy'].mean():.3f} (target 0.80)")
    print(f"Mean SUB_accuracy across participants: {model_summary['SUB_accuracy'].mean():.3f} (target 0.50)")

    # Sanity cross-check: recomputed AI_Correct should agree with Schedule_Long's own Rec_Correct label.
    exp = trials_fixed[trials_fixed["Phase"] == "Experiment"]
    disagreement = exp[
        ((exp["AI_Correct"] == 1) & (exp["Rec_Correct_Schedule"] != "כן"))
        | ((exp["AI_Correct"] == 0) & (exp["Rec_Correct_Schedule"] != "לא"))
    ]
    if len(disagreement):
        print(f"[WARN] {len(disagreement)} rows where recomputed AI_Correct disagrees with "
              f"Schedule_Long's own Rec_Correct label - investigate before trusting this output.")
    else:
        print("Cross-check OK: recomputed AI_Correct agrees with Schedule_Long's Rec_Correct for every trial.")

    print(f"\nWriting corrected workbook to {out_path} ...")
    other_sheets = {}
    for name in raw_xl.sheet_names:
        if name in ("Trials", "Model_Summary"):
            continue
        try:
            other_sheets[name] = raw_xl.parse(name)
        except Exception as e:
            print(f"[WARN] Could not copy sheet '{name}' through unchanged: {e}")

    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        trials_fixed.to_excel(writer, sheet_name="Trials", index=False)
        model_summary.to_excel(writer, sheet_name="Model_Summary", index=False)
        log_df.to_excel(writer, sheet_name="Corrections_Log", index=False)
        for name, df in other_sheets.items():
            df.to_excel(writer, sheet_name=name[:31], index=False)

    print(f"Rendering validation chart to {chart_path} ...")
    chart_path.parent.mkdir(parents=True, exist_ok=True)
    make_chart(model_summary, chart_path)

    print("\nDone.")
    print(f"  Corrected workbook: {out_path}")
    print(f"  Chart:              {chart_path}")
    print(f"  NOTE: ChartData / Pivot Table 1 / Analysis sheets were copied through unchanged "
          f"(they look pivot/formula-derived in Excel - refresh them there against the new Trials data).")
    print(f"  NOTE: True_ORG and ERROR_REC were left untouched - their derivation wasn't reliably "
          f"inferable from the data (see script docstring).")


if __name__ == "__main__":
    main()
