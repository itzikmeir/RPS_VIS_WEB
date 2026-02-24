# Model-Ordered Experiment App

Web app for the **model-first** experiment: Model A (Vis1, Vis2, Vis3) → Model B (Vis1, Vis2, Vis3), with NASA TLX after each visualization and Trust after each model.

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Entry point – login and experiment flow |
| `app.js` | Experiment logic, persistence, resume |
| `admin_storage.html` | View/export/clear localStorage sessions |
| `log_results_viewer.html` | Single-participant log viewer |
| `logs_overview.html` | Multi-participant log overview and CSV export |
| `questions/` | `questions.json`, `scenario_questions.json` |
| `participants_json/` | Per-participant schedules (from build scripts) |

## Run

1. Serve via HTTP (e.g. `python -m http.server 8000` from project root)
2. Open `experiment_model_ordered/index.html`
3. Enter participant ID (e.g. P001)

## Persistence

- Progress saved to localStorage after each trial and questionnaire
- Resume modal on re-login if stored data exists
- Logs kept after completion (not cleared)
- If storage is full, oldest participant's data is evicted

## Full Documentation

Data preparation, pipeline, and JSON structure: **`../Model_Ordered_experiment/README.md`**
