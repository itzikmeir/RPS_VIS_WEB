"""
Before/after comparison: per-participant AI recommendation accuracy
(AI_REC == TRUE_ROUTE, per OPT/SUB model), computed BOTH from the original
(pre-correction) raw Trials data and from the corrected version (after
injecting Schedule_Long as the answer key).

This does NOT involve participant choices (USER_CHOICE) at all - it is a
pure check of "was the recommendation itself the correct one", same metric
on both sides, so the two panels are directly comparable.

Usage:
  python python_scripts/compare_ai_accuracy_before_after.py
  python python_scripts/compare_ai_accuracy_before_after.py --raw <original xlsx> --schedule <corrected schedule xlsx>
"""
import argparse
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from route_utils import normalize_route_letter  # noqa: E402

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_RAW = Path.home() / "Downloads" / "Experiment_Raw_Data_updated.xlsx"
DEFAULT_SCHEDULE = ROOT_DIR / "Model_Ordered_experiment" / "Models_Experiment_Order_Expanded_corrected.xlsx"
DEFAULT_CHART = ROOT_DIR / "Model_Ordered_experiment" / "ai_accuracy_before_vs_after.png"


def original_accuracy(raw_path: Path) -> pd.DataFrame:
    """AI_Correct as it already existed in the raw file, before any correction."""
    trials = pd.read_excel(raw_path, sheet_name="Trials")
    trials["Participant_ID"] = trials["Participant_ID"].astype(str).str.strip()
    trials = trials[trials["Participant_ID"].str.upper().str.startswith("P")]
    exp = trials[trials["Phase"] == "Experiment"]

    rows = []
    for pid, g in exp.groupby("Participant_ID"):
        row = {"Participant_ID": pid}
        for model in ("OPT", "SUB"):
            vals = g[g["MODEL"] == model]["AI_Correct"]
            row[f"{model}_pct"] = vals.mean() * 100 if len(vals) else float("nan")
        rows.append(row)
    return pd.DataFrame(rows)


def corrected_accuracy(schedule_path: Path) -> pd.DataFrame:
    """AI_Correct recomputed straight from the corrected Schedule_Long (no raw file needed)."""
    df = pd.read_excel(schedule_path, sheet_name="Schedule_Long")
    df = df.dropna(subset=["Participant_ID", "Scenario_ID"])
    df = df[df["Participant_ID"].astype(str).str.strip().str.upper().str.startswith("P")].copy()
    df["Participant_ID"] = df["Participant_ID"].astype(str).str.strip().str.upper()
    df["is_correct"] = df["Correct_Answer"].map(normalize_route_letter) == df["System_Recommendation"].map(normalize_route_letter)

    exp = df[(df["Phase"] == "ניסוי") & (df["ModelType"].isin(["OPT", "SUB"]))]
    rows = []
    for pid, g in exp.groupby("Participant_ID"):
        row = {"Participant_ID": pid}
        for model in ("OPT", "SUB"):
            vals = g[g["ModelType"] == model]["is_correct"]
            row[f"{model}_pct"] = vals.mean() * 100 if len(vals) else float("nan")
        rows.append(row)
    return pd.DataFrame(rows)


def make_chart(before: pd.DataFrame, after: pd.DataFrame, out_path: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    merged = before.merge(after, on="Participant_ID", suffixes=("_before", "_after")).sort_values("Participant_ID")
    x = np.arange(len(merged))
    width = 0.38

    fig, (ax_top, ax_bot) = plt.subplots(2, 1, figsize=(14, 10), sharex=True, sharey=True)

    ax_top.bar(x - width / 2, merged["OPT_pct_before"], width, color="#2563EB", label="OPT")
    ax_top.bar(x + width / 2, merged["SUB_pct_before"], width, color="#F59E0B", label="SUB")
    ax_top.axhline(80, color="#2563EB", linestyle="--", linewidth=1, alpha=0.7)
    ax_top.axhline(50, color="#F59E0B", linestyle="--", linewidth=1, alpha=0.7)
    ax_top.set_ylabel("% AI_REC == TRUE_ROUTE")
    ax_top.set_title("BEFORE - original AI_REC/TRUE_ROUTE, as they were in Experiment_Raw_Data_updated.xlsx\n"
                      "(no participant choices involved - recommendation accuracy only)")
    ax_top.legend(loc="lower right")

    ax_bot.bar(x - width / 2, merged["OPT_pct_after"], width, color="#2563EB", label="OPT")
    ax_bot.bar(x + width / 2, merged["SUB_pct_after"], width, color="#F59E0B", label="SUB")
    ax_bot.axhline(80, color="#2563EB", linestyle="--", linewidth=1, alpha=0.7)
    ax_bot.axhline(50, color="#F59E0B", linestyle="--", linewidth=1, alpha=0.7)
    ax_bot.set_xticks(x)
    ax_bot.set_xticklabels(merged["Participant_ID"], rotation=90, fontsize=8)
    ax_bot.set_ylabel("% System_Recommendation == Correct_Answer")
    ax_bot.set_ylim(0, 105)
    ax_bot.set_title("AFTER - recomputed from the corrected Schedule_Long")
    ax_bot.legend(loc="lower right")

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return merged


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--raw", default=str(DEFAULT_RAW))
    ap.add_argument("--schedule", default=str(DEFAULT_SCHEDULE))
    ap.add_argument("--chart", default=str(DEFAULT_CHART))
    args = ap.parse_args()

    raw_path = Path(args.raw)
    schedule_path = Path(args.schedule)
    chart_path = Path(args.chart)

    print(f"Reading ORIGINAL (uncorrected) recommendation accuracy from {raw_path} ...")
    before = original_accuracy(raw_path)
    print(f"  Mean OPT accuracy (before): {before['OPT_pct'].mean():.1f}%  (target 80%)")
    print(f"  Mean SUB accuracy (before): {before['SUB_pct'].mean():.1f}%  (target 50%)")

    print(f"\nReading CORRECTED recommendation accuracy from {schedule_path} ...")
    after = corrected_accuracy(schedule_path)
    print(f"  Mean OPT accuracy (after):  {after['OPT_pct'].mean():.1f}%  (target 80%)")
    print(f"  Mean SUB accuracy (after):  {after['SUB_pct'].mean():.1f}%  (target 50%)")

    merged = make_chart(before, after, chart_path)
    print(f"\nChart written to {chart_path}")

    n_opt_far_before = (abs(merged["OPT_pct_before"] - 80) > 1).sum()
    n_sub_far_before = (abs(merged["SUB_pct_before"] - 50) > 1).sum()
    print(f"\nBefore correction: {n_opt_far_before}/30 participants off-target on OPT, "
          f"{n_sub_far_before}/30 off-target on SUB.")


if __name__ == "__main__":
    main()
