import json
import os
from typing import Dict, Tuple

import math
import pandas as pd


ROOT_DIR = os.path.dirname(__file__)
INPUT_EXCEL = os.path.join(ROOT_DIR, "rec_long.xlsx")
PARTICIPANTS_DIR = os.path.join(ROOT_DIR, "participants_json")
COMBINED_JSON_PATH = os.path.join(ROOT_DIR, "participants_all.json")


def is_nan(value) -> bool:
  """
  Return True if value is NaN / pandas NA.
  """
  if value is None:
    return False
  if isinstance(value, float) and math.isnan(value):
    return True
  try:
    return pd.isna(value)
  except Exception:
    return False


def normalize_participant_id(pid: str) -> str:
  """
  Ensure participant IDs are in the form 'P001' etc.
  """
  pid = str(pid).strip().upper()
  if not pid.startswith("P"):
    pid = "P" + pid
  return pid


def build_recommendation_map() -> Dict[Tuple[str, str], Dict[str, str]]:
  """
  Build mapping: (participant_id, scenario_id) -> {
    'rec_correct': 'כן'/'לא'/...,
    'correct_answer': 'א׳'/'ב׳'/...,
    'system_recommendation': 'א׳'/'ב׳'/...
  }
  """
  # The long-format recommendations live in the 'Schedule_Long' sheet.
  df = pd.read_excel(INPUT_EXCEL, sheet_name="Schedule_Long")

  required_cols = [
    "Participant_ID",
    "Scenario_ID",
    "Rec_Correct",
    "Correct_Answer",
    "System_Recommendation",
  ]
  missing = [c for c in required_cols if c not in df.columns]
  if missing:
    # If the user hasn't added these columns yet, just return an empty map
    print(f"[WARN] Missing expected columns in {INPUT_EXCEL}: {missing} – no recommendations will be applied.")
    return {}

  mapping: Dict[Tuple[str, str], Dict[str, str]] = {}

  for _, row in df.iterrows():
    pid_raw = row.get("Participant_ID")
    scenario_raw = row.get("Scenario_ID")
    if is_nan(pid_raw) or is_nan(scenario_raw):
      continue

    pid = normalize_participant_id(pid_raw)
    scenario_id = str(scenario_raw).strip()
    if not scenario_id:
      continue

    rec_correct = None if is_nan(row.get("Rec_Correct")) else str(row.get("Rec_Correct")).strip()
    correct_answer = None if is_nan(row.get("Correct_Answer")) else str(row.get("Correct_Answer")).strip()
    system_rec = None if is_nan(row.get("System_Recommendation")) else str(row.get("System_Recommendation")).strip()

    mapping[(pid, scenario_id)] = {
      "rec_correct": rec_correct,
      "correct_answer": correct_answer,
      "system_recommendation": system_rec,
    }

  return mapping


def update_participant_file(path: str, rec_map: Dict[Tuple[str, str], Dict[str, str]]) -> dict:
  """
  Update rec_correct, correct_route, and ai_recommended_route in a single participant JSON file
  based on rec_long.xlsx.
  """
  with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

  pid = data.get("participant_id")
  if not pid:
    return data

  changed = False

  def apply_update(trial):
    nonlocal changed
    sid = trial.get("scenario_id")
    if not sid:
      return

    key = (pid, sid)
    if key not in rec_map:
      return

    rec_info = rec_map[key]

    # rec_correct as string from Excel (e.g., 'כן' / 'לא')
    if rec_info.get("rec_correct") is not None:
      if trial.get("rec_correct") != rec_info["rec_correct"]:
        trial["rec_correct"] = rec_info["rec_correct"]
        changed = True

    # correct_answer (א׳ / ב׳ / ג׳) -> update correct_route
    if rec_info.get("correct_answer"):
      if trial.get("correct_route") != rec_info["correct_answer"]:
        trial["correct_route"] = rec_info["correct_answer"]
        changed = True

    # System_recommendation -> ai_recommended_route
    if rec_info.get("system_recommendation"):
      if trial.get("ai_recommended_route") != rec_info["system_recommendation"]:
        trial["ai_recommended_route"] = rec_info["system_recommendation"]
        changed = True

  # Practice trials
  for trial in data.get("practice", []):
    apply_update(trial)

  # Experimental trials
  for cond in data.get("conditions", []):
    for model in cond.get("models", []):
      for trial in model.get("trials", []):
        apply_update(trial)

  if changed:
    with open(path, "w", encoding="utf-8") as f:
      json.dump(data, f, ensure_ascii=False, indent=2)

  return data


def main():
  rec_map = build_recommendation_map()
  print(f"Loaded {len(rec_map)} participant-scenario recommendation entries from '{INPUT_EXCEL}'")

  if not os.path.isdir(PARTICIPANTS_DIR):
    raise SystemExit(f"Participants directory not found: {PARTICIPANTS_DIR}")

  combined = []
  files = sorted(
    f for f in os.listdir(PARTICIPANTS_DIR)
    if f.lower().endswith(".json")
  )

  for fname in files:
    path = os.path.join(PARTICIPANTS_DIR, fname)
    pdata = update_participant_file(path, rec_map)
    combined.append(pdata)
    print(f"Processed {fname}")

  # Rebuild combined JSON so it stays in sync
  with open(COMBINED_JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(combined, f, ensure_ascii=False, indent=2)

  print(f"Updated {len(files)} participant files and rewrote '{COMBINED_JSON_PATH}'")


if __name__ == "__main__":
  main()

