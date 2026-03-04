import json
from pathlib import Path


def fix_practice_scenarios(participants_dir: Path) -> None:
    """
    For every participant JSON in `participants_dir`, update the practice
    section so that:
      - practice slot 1 has scenario_id == "SCN_003_S"
      - practice slot 3 has scenario_id == "SCN_001_H"

    Only the `scenario_id` field is modified; all other fields
    (difficulty, correct_route, ai_recommended_route, correct_answers, etc.)
    are left as-is.
    """
    for path in sorted(participants_dir.glob("P*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"Skipping {path.name}: failed to read/parse JSON ({e})")
            continue

        practice = data.get("practice")
        if not isinstance(practice, list):
            print(f"Skipping {path.name}: no 'practice' list found")
            continue

        changed = False

        for entry in practice:
            if not isinstance(entry, dict):
                continue
            slot = entry.get("slot")
            if slot == 1:
                old_id = entry.get("scenario_id")
                entry["scenario_id"] = "SCN_001_S"
                if old_id != entry["scenario_id"]:
                    changed = True
            elif slot == 3:
                old_id = entry.get("scenario_id")
                entry["scenario_id"] = "SCN_003_H"
                if old_id != entry["scenario_id"]:
                    changed = True

        if changed:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"Updated practice scenario_ids in {path.name}")
        else:
            print(f"No changes needed for {path.name}")


if __name__ == "__main__":
    # Scripts live in python_scripts/; project root is parent
    ROOT_DIR = Path(__file__).resolve().parent.parent
    participants_dir = ROOT_DIR / "experiment_model_ordered" / "participants_json"
    fix_practice_scenarios(participants_dir)
