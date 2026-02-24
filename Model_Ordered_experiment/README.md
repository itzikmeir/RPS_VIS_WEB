# Model-Ordered Experiment – New Format

This document describes the **new experiment order** (Model-first) and how to load, run, and save data for the experiment platform in `../experiment_model_ordered/`.

---

## Experiment Flow: Old vs New

### Old Format (Visualization-first)
```
Vis A (Model A + Model B) → Vis B (Model A + Model B) → Vis C (Model A + Model B)
```
- Conditions = Visualizations (עמודות נערמות, רדאר, מפת חום)
- Within each condition: Model 1 trials → Model 2 trials → Workload + Trust → Model preference question
- After all conditions: Vis preference → Demographics

### New Format (Model-first)
```
Model A (Vis A, Vis B, Vis C) → Model B (Vis A, Vis B, Vis C)
```
- Models = Model A (first), Model B (second) – order from `סדר_מודלים`
- Within each model: Vis 1 trials → **NASA TLX** → Vis 2 trials → **NASA TLX** → Vis 3 trials → **NASA TLX** → **Trust in Model**
- After both models: **Model selection (A/B)** → Vis preference → **Interface focus area (map/timeline/vis)** → Demographics

---

## Data Files in This Folder

| File | Purpose |
|------|---------|
| `Models_Experiment_Order_Expanded.xlsx` | Main design: participant order, practice, models, visualizations, scenario IDs |
| `models_rec_long.xlsx` | Per-participant AI recommendations (correct_route, ai_recommended_route, rec_correct) |
| `models_SCN_Questions_catalog.xlsx` | Scenario questions, correct answers, correct routes |

---

## CSV/Excel Column Structure

### Participant & Order
- `Participant_ID` – e.g. P001, P002
- `סדר_מודלים` – Model order (e.g. "תת-אופטימלי ← אופטימלי" or "אופטימלי ← תת-אופטימלי")
- `סדר_תנאים` – Visualization order (e.g. "עמודות נערמות ← רדאר ← מפת חום")

### Practice (6 rounds: 2 per visualization type)
Order: **עמודות נערמות** (2) → **רדאר** (2) → **מפת חום** (2)

- `תרגול_R1_Scenario_ID` … `תרגול_R6_Scenario_ID` (suffix _S, _R, _H indicates viz type)
- `תרגול_R1_קושי` … `תרגול_R6_קושי` (E/H)

Before each practice trial, the scenario intro shows the visualization image (STACKED.png, RADAR.png, HEATֹMAP.png) and "דגשים" guidelines.

### Model 1
- `מודל_1_סוג_מודל` – SUB or OPT
- `מודל_1_סדר_ויזואליזציות` – e.g. "עמודות נערמות ← רדאר ← מפת חום"
- `מודל_1_VIS1_ויזואליזציה` – First visualization name (e.g. "עמודות נערמות")
- `מודל_1_VIS1_R1_Scenario_ID` … `מודל_1_VIS1_R5_Scenario_ID`
- `מודל_1_VIS1_R1_קושי` … `מודל_1_VIS1_R5_קושי`
- Same pattern for `מודל_1_VIS2_*` and `מודל_1_VIS3_*`

### Model 2
- Same structure: `מודל_2_סוג_מודל`, `מודל_2_VIS1_*`, `מודל_2_VIS2_*`, `מודל_2_VIS3_*`

---

## Pipeline: Load Data → Run Experiment → Save Results

### Step 1: Generate Participant JSON Files

**File:** `build_model_ordered_participants.py` (in project root)

**Input:** `Model_Ordered_experiment/Models_Experiment_Order_Expanded.xlsx`

**Output:**
- `experiment_model_ordered/participants_json/P001.json`, P002.json, …
- `experiment_model_ordered/participants_all.json`

**What it does:**
- Reads the new Excel structure (models → visualizations → trials)
- Builds per-participant JSON with:
  - `practice[]` – 6 practice trials
  - `models[]` – 2 models, each with `visualizations[]` (3 vis), each with `trials[]`
- Writes one JSON per participant and a combined file

**How to run:**
```bash
python build_model_ordered_participants.py
```

---

### Step 2: Build Scenario Questions

**File:** `build_scenario_questions_model_ordered.py` (in project root)

**Input:** `Model_Ordered_experiment/models_SCN_Questions_catalog.xlsx` (sheet "קטלוג תרחישים")

**Output:** `experiment_model_ordered/questions/scenario_questions.json`

**What it does:** Reads Q1/O1/A1, Q2/O2/A2, Q3/O3/A3 from the catalog, parses options, infers correct answers, and produces scenario_questions.json for the app.

**How to run:**
```bash
python build_scenario_questions_model_ordered.py
```

---

### Step 3: Fill Correct Answers (Q1, Q2, Q3)

**File:** `update_correct_answers_model_ordered.py` (in project root)

**Input:** `experiment_model_ordered/questions/scenario_questions.json`, `participants_json/*.json`

**Output:** Updated participant JSONs with `correct_answers` per trial (e.g. `{"Q1": "א", "Q2": "ב", "Q3": "2"}`)

**How to run:**
```bash
python update_correct_answers_model_ordered.py
```
(Run after Step 2)

---

### Step 4: Fill Correct Routes

**File:** `update_correct_routes_model_ordered.py` (in project root)

**Input:** `Model_Ordered_experiment/models_SCN_Questions_catalog.xlsx` (sheet "קטלוג תרחישים"), `participants_json/*.json`

**Output:** Updated participant JSONs with `correct_route` per trial (e.g. "א׳", "ב׳", "ג׳")

**How to run:**
```bash
python update_correct_routes_model_ordered.py
```

---

### Step 5: Update AI Recommendations (optional)

**File:** `update_recommendations_model_ordered.py` (in project root)

**Input:** `Model_Ordered_experiment/models_rec_long.xlsx` (sheet `Schedule_Long`)

**Output:** Updated participant JSONs with `rec_correct`, `correct_route`, `ai_recommended_route`

**Required columns:** `Participant_ID`, `Scenario_ID`, `Rec_Correct`, `Correct_Answer`, `System_Recommendation`

**How to run:**
```bash
python update_recommendations_model_ordered.py
```

---

### Step 6: Run the Experiment

**Platform:** `../experiment_model_ordered/`

**Key files:**
- `index.html` – Entry point
- `app.js` – Experiment logic (Model→Vis order, NASA TLX per vis, Trust per model)
- `log_results_viewer.html` – Single-participant log viewer
- `logs_overview.html` – Multi-participant log overview and CSV export
- `admin_storage.html` – View/export/clear localStorage-backed session data
- `style.css` – Styling (from parent)
- `questions/questions.json` – Includes Interface focus area question
- `participants_json/` – Per-participant schedules
- `Scenarios/`, `Images/`, `Videos/` – Shared assets (paths go to parent)

**How to run:**
1. Serve the project via HTTP (e.g. `python -m http.server 8000` from project root, or use Live Server)
2. Open `experiment_model_ordered/index.html`
3. Enter participant ID (e.g. P001)
4. Complete the experiment flow

---

### Step 7: Save & Inspect Results

**Logs:** The app downloads a JSON log file at the end (e.g. `P001_log.json`). Save it to `experiment_model_ordered/Participants_log/` for the single-participant viewer.

**Log structure:**
- `pages` – Page visits with enter/exit timestamps
- `trials` – Each scenario trial (scenario_id, user_route, followed_ai, chose_true_optimal, model_index, vis_index)
- `questionnaires` – Post-scenario, NASA TLX (per visualization), Trust (per model), model selection, vis preference, interface focus, demographics

**Viewing results:**
- Use `experiment_model_ordered/log_results_viewer.html` (load a single participant log from `Participants_log/P001_log.json`)
- Use `experiment_model_ordered/logs_overview.html` (select multiple log JSON files, view summary, export CSVs)

Place downloaded log files in `experiment_model_ordered/Participants_log/` to view them with the single-participant viewer.

---

## Real-time Data Persistence and Recovery

The experiment app saves data to **localStorage** in real time to prevent loss from refresh, accidental exit, or browser close.

**How it works:**
- After every trial, questionnaire, page visit, and interaction, data is written to `localStorage` under key `experiment_model_ordered_log_<ParticipantID>`
- On login, if stored data exists for that participant, a modal offers: **Resume from last point** or **Start fresh**
- Logs are **kept in storage** after experiment completion (not cleared on download)
- A `beforeunload` warning prompts the user when closing or refreshing during an active session
- If storage is full when saving, the app removes the **oldest** participant's data (by `savedAt` timestamp) and retries until the save succeeds

**Admin page:** `experiment_model_ordered/admin_storage.html`
- Lists all stored sessions (participant ID, saved-at timestamp, trial count, questionnaire count)
- **Download JSON** – export a participant's stored log
- **Clear** – remove one participant's stored data
- **Clear All** – remove all stored sessions

**Limitations:**
- Data is per-origin, per-browser (does not sync across devices)
- Clearing browser data removes stored logs
- Private/incognito mode may clear data when the session ends

---

## Participant JSON Structure (New Format)

```json
{
  "participant_id": "P001",
  "model_order_text": "תת-אופטימלי ← אופטימלי",
  "visualization_order_text": "עמודות נערמות ← רדאר ← מפת חום",
  "practice": [
    { "slot": 1, "scenario_id": "SCN_001_S", "difficulty": "E", "correct_route": "א׳", "correct_answers": {"Q1": "א", "Q2": "ב", "Q3": "2"}, ... }
  ],
  "models": [
    {
      "index": 1,
      "model_type": "SUB",
      "visualization_order_text": "עמודות נערמות ← רדאר ← מפת חום",
      "visualizations": [
        {
          "index": 1,
          "visualization": "עמודות נערמות",
          "trials": [
            { "slot": 1, "scenario_id": "SCN_021_S", "difficulty": "E", "correct_route": "ג׳", "ai_recommended_route": "ג׳", "correct_answers": {"Q1": "ג", "Q2": "א", "Q3": "2"}, "rec_correct": "כן", ... }
          ]
        },
        { "index": 2, "visualization": "רדאר", "trials": [...] },
        { "index": 3, "visualization": "מפת חום", "trials": [...] }
      ]
    },
    {
      "index": 2,
      "model_type": "OPT",
      "visualizations": [...]
    }
  ]
}
```

---

## Questionnaire Placement

| Questionnaire | When |
|---------------|------|
| Post-scenario (confidence, mental workload, sa_1–3) | After each scenario trial |
| NASA TLX (workload) | After each visualization block within a model |
| Trust in Model | After all 3 visualizations in a model |
| Model selection (A/B) | After both models |
| Visualization preference | After model selection |
| Interface focus area (map/timeline/vis) | After vis preference |
| Demographics | At the end |

---

## Recommended Update Order

1. Update `Models_Experiment_Order_Expanded.xlsx` → run `build_model_ordered_participants.py`
2. Update scenario questions in `models_SCN_Questions_catalog.xlsx` (sheet "קטלוג תרחישים") → run `build_scenario_questions_model_ordered.py`
3. Run `update_correct_answers_model_ordered.py`
4. Run `update_correct_routes_model_ordered.py`
5. (Optional) Update `models_rec_long.xlsx` → run `update_recommendations_model_ordered.py`
6. Test with `experiment_model_ordered/index.html` (e.g. P001)
7. Run automated tests: `python run_tests.py -v` (from project root)
