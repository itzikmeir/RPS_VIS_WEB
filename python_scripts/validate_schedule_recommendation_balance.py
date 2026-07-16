"""
Design-level validation: for every participant in Models_Experiment_Order_Expanded_V2.xlsx
(sheet Schedule_Long), walk every Experiment-phase trial and check whether the
System_Recommendation actually equals the Correct_Answer (i.e. whether the
recommendation is genuinely correct), independent of the Rec_Correct label.

By design every participant should get exactly:
  OPT model : 4/5  = 80% of trials with a correct recommendation
  SUB model : 2/4  = 50% of trials with a correct recommendation

This does NOT read any actual experiment run / raw response data - it only
checks the schedule/answer-key file itself, so it will catch design bugs
(e.g. a "wrong" recommendation slot that accidentally recommends the correct
route) before a single participant ever runs the experiment.

Usage:
  python python_scripts/validate_schedule_recommendation_balance.py
  python python_scripts/validate_schedule_recommendation_balance.py --schedule <path to xlsx>
"""
import argparse
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from route_utils import normalize_route_letter  # noqa: E402

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SCHEDULE = ROOT_DIR / "Model_Ordered_experiment" / "Models_Experiment_Order_Expanded_V2.xlsx"
DEFAULT_REPORT = ROOT_DIR / "Model_Ordered_experiment" / "schedule_recommendation_balance_report.csv"
DEFAULT_CHART = ROOT_DIR / "Model_Ordered_experiment" / "schedule_recommendation_balance.png"

EXPECTED_PCT = {"OPT": 80.0, "SUB": 50.0}
EXPECTED_FRACTION = {"OPT": "4/5", "SUB": "2/4"}


def load_experiment_trials(schedule_path: Path) -> pd.DataFrame:
    df = pd.read_excel(schedule_path, sheet_name="Schedule_Long")
    df = df.dropna(subset=["Participant_ID", "Scenario_ID"])
    df = df[df["Participant_ID"].astype(str).str.strip().str.upper().str.startswith("P")].copy()

    df["Participant_ID"] = df["Participant_ID"].astype(str).str.strip().str.upper()
    df["Correct_Answer_norm"] = df["Correct_Answer"].map(normalize_route_letter)
    df["System_Recommendation_norm"] = df["System_Recommendation"].map(normalize_route_letter)
    df["is_correct_rec"] = df["Correct_Answer_norm"] == df["System_Recommendation_norm"]

    exp = df[df["Phase"] == "ניסוי"].copy()
    exp = exp[exp["ModelType"].isin(["OPT", "SUB"])]
    return exp


def build_per_participant_table(exp: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for pid, g in exp.groupby("Participant_ID"):
        row = {"Participant_ID": pid}
        for model in ("OPT", "SUB"):
            gm = g[g["ModelType"] == model]
            n_total = len(gm)
            n_correct = int(gm["is_correct_rec"].sum())
            pct = (n_correct / n_total * 100) if n_total else float("nan")
            row[f"{model}_n_trials"] = n_total
            row[f"{model}_n_correct"] = n_correct
            row[f"{model}_pct_correct"] = pct
            row[f"{model}_matches_design"] = abs(pct - EXPECTED_PCT[model]) < 1e-6 if n_total else False

            # "As planned": trust the Rec_Correct label itself, no route-letter check.
            n_labeled_correct = int((gm["Rec_Correct"].astype(str).str.strip() == "כן").sum())
            pct_labeled = (n_labeled_correct / n_total * 100) if n_total else float("nan")
            row[f"{model}_pct_as_planned"] = pct_labeled
        rows.append(row)
    return pd.DataFrame(rows).sort_values("Participant_ID").reset_index(drop=True)


def make_chart(table: pd.DataFrame, out_path: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    x = np.arange(len(table))
    width = 0.38

    fig, ax = plt.subplots(figsize=(14, 6))
    opt_colors = ["#2563EB" if ok else "#EF4444" for ok in table["OPT_matches_design"]]
    sub_colors = ["#F59E0B" if ok else "#EF4444" for ok in table["SUB_matches_design"]]

    ax.bar(x - width / 2, table["OPT_pct_correct"], width, color=opt_colors)
    ax.bar(x + width / 2, table["SUB_pct_correct"], width, color=sub_colors)
    ax.axhline(80, color="#2563EB", linestyle="--", linewidth=1, alpha=0.7)
    ax.axhline(50, color="#F59E0B", linestyle="--", linewidth=1, alpha=0.7)

    ax.set_xticks(x)
    ax.set_xticklabels(table["Participant_ID"], rotation=90, fontsize=8)
    ax.set_ylabel("% of Experiment-phase trials where System_Recommendation == Correct_Answer")
    ax.set_ylim(0, 105)
    ax.set_title("Schedule_Long design check - recommendation accuracy per participant\n(red = deviates from the intended 80% / 50% split)")

    from matplotlib.patches import Patch
    legend_handles = [
        Patch(color="#2563EB", label="OPT, matches design (80%)"),
        Patch(color="#F59E0B", label="SUB, matches design (50%)"),
        Patch(color="#EF4444", label="Deviates from design"),
    ]
    ax.legend(handles=legend_handles, loc="lower right")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def make_comparison_chart(table: pd.DataFrame, out_path: Path) -> None:
    """Two panels, both built only from Schedule_Long (no participant data):
    top = trusting the Rec_Correct label as-is ("as planned");
    bottom = actually checking System_Recommendation == Correct_Answer ("as realized").
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    from matplotlib.patches import Patch

    x = np.arange(len(table))
    width = 0.38

    fig, (ax_top, ax_bot) = plt.subplots(2, 1, figsize=(14, 10), sharex=True)

    # Top panel: as planned (Rec_Correct label)
    ax_top.bar(x - width / 2, table["OPT_pct_as_planned"], width, color="#2563EB", label="OPT")
    ax_top.bar(x + width / 2, table["SUB_pct_as_planned"], width, color="#F59E0B", label="SUB")
    ax_top.axhline(80, color="#2563EB", linestyle="--", linewidth=1, alpha=0.7)
    ax_top.axhline(50, color="#F59E0B", linestyle="--", linewidth=1, alpha=0.7)
    ax_top.set_ylim(0, 105)
    ax_top.set_ylabel("% Rec_Correct = \"כן\"\n(trusting the label)")
    ax_top.set_title("AS PLANNED - trusting the Rec_Correct label in Schedule_Long (design intent)")
    ax_top.legend(loc="lower right")

    # Bottom panel: as realized (route-letter check)
    opt_colors = ["#2563EB" if ok else "#EF4444" for ok in table["OPT_matches_design"]]
    sub_colors = ["#F59E0B" if ok else "#EF4444" for ok in table["SUB_matches_design"]]
    ax_bot.bar(x - width / 2, table["OPT_pct_correct"], width, color=opt_colors)
    ax_bot.bar(x + width / 2, table["SUB_pct_correct"], width, color=sub_colors)
    ax_bot.axhline(80, color="#2563EB", linestyle="--", linewidth=1, alpha=0.7)
    ax_bot.axhline(50, color="#F59E0B", linestyle="--", linewidth=1, alpha=0.7)
    ax_bot.set_xticks(x)
    ax_bot.set_xticklabels(table["Participant_ID"], rotation=90, fontsize=8)
    ax_bot.set_ylim(0, 105)
    ax_bot.set_ylabel("% System_Recommendation == Correct_Answer\n(actually checking the routes)")
    ax_bot.set_title("AS REALIZED - checking whether the recommended route actually equals the correct route")
    legend_handles = [
        Patch(color="#2563EB", label="OPT, matches design (80%)"),
        Patch(color="#F59E0B", label="SUB, matches design (50%)"),
        Patch(color="#EF4444", label="Deviates from design"),
    ]
    ax_bot.legend(handles=legend_handles, loc="lower right")

    fig.suptitle("Both panels use ONLY Models_Experiment_Order_Expanded_V2.xlsx - no participant/raw data involved",
                 fontsize=10, y=0.995)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--schedule", default=str(DEFAULT_SCHEDULE))
    ap.add_argument("--report", default=str(DEFAULT_REPORT))
    ap.add_argument("--chart", default=str(DEFAULT_CHART))
    ap.add_argument("--comparison-chart", default=str(ROOT_DIR / "Model_Ordered_experiment" / "schedule_planned_vs_realized.png"))
    args = ap.parse_args()

    schedule_path = Path(args.schedule)
    if not schedule_path.exists():
        raise SystemExit(f"Schedule file not found: {schedule_path}")

    print(f"Loading {schedule_path} (sheet Schedule_Long) ...")
    exp = load_experiment_trials(schedule_path)
    n_participants = exp["Participant_ID"].nunique()
    print(f"  {len(exp)} Experiment-phase trial rows across {n_participants} participants.")

    table = build_per_participant_table(exp)

    n_opt_ok = int(table["OPT_matches_design"].sum())
    n_sub_ok = int(table["SUB_matches_design"].sum())
    print(f"\nOPT model matches design (exactly 80% = 4/5) for {n_opt_ok}/{len(table)} participants.")
    print(f"SUB model matches design (exactly 50% = 2/4) for {n_sub_ok}/{len(table)} participants.")

    bad = table[~table["OPT_matches_design"] | ~table["SUB_matches_design"]]
    if len(bad):
        print(f"\n{len(bad)} participant(s) deviate from the intended split:")
        cols = ["Participant_ID", "OPT_n_correct", "OPT_n_trials", "OPT_pct_correct",
                "SUB_n_correct", "SUB_n_trials", "SUB_pct_correct"]
        print(bad[cols].to_string(index=False))
    else:
        print("\nEvery participant matches the intended 80% / 50% split exactly.")

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(report_path, index=False, encoding="utf-8-sig")
    print(f"\nFull per-participant report written to {report_path}")

    chart_path = Path(args.chart)
    make_chart(table, chart_path)
    print(f"Chart written to {chart_path}")

    comparison_path = Path(args.comparison_chart)
    make_comparison_chart(table, comparison_path)
    print(f"Planned-vs-realized comparison chart written to {comparison_path}")


if __name__ == "__main__":
    main()
