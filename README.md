## Experiment Data & App Pipeline

---

### Model-Ordered Experiment (New Format)

A **separate experiment platform** uses the **Model-first** order: Model A (Vis1, Vis2, Vis3) → Model B (Vis1, Vis2, Vis3), with NASA TLX after each visualization and Trust after each model.

**Practice:** 6 practices total – 2 × עמודות נערמות, 2 × רדאר, 2 × מפת חום. Before each trial, the scenario intro shows the visualization image (STACKED.png, RADAR.png, HEATֹMAP.png) and "דגשים" guidelines.

- **Platform:** `experiment_model_ordered/index.html`
- **Data:** `Model_Ordered_experiment/Models_Experiment_Order_Expanded.xlsx` (or `.csv`)
- **Full documentation:** See `Model_Ordered_experiment/README.md`

**Quick start:**
1. `python build_model_ordered_participants.py`
2. `python update_correct_routes_model_ordered.py`
3. (Optional) `python update_recommendations_model_ordered.py`
4. Open `experiment_model_ordered/index.html` in a browser

---

### Original Experiment (Visualization-first)

### 1. Generate participant schedules JSON

- **File**: `Untitled-1.ipynb`  
- **Input**: `Experiment_Order_Expanded.xlsx`  
- **Output**:  
  - `participants_json/PXXX.json` – per‑participant schedule and trial list.  
  - `participants_all.json` – combined list of all participants.  
- **What it does**:  
  - Reads the experiment design Excel (practice + 3 conditions, models, repetitions).  
  - For each participant, builds:  
    - `practice` trials with `scenario_id`, difficulty, etc.  
    - `conditions[*].models[*].trials[*]` with the correct `scenario_id`s.  
  - Writes one JSON per participant plus a combined file.  
- **How to run**:  
  - Open `Untitled-1.ipynb` in Jupyter / VSCode / Cursor.  
  - Make sure `INPUT_PATH` points to `Experiment_Order_Expanded.xlsx`.  
  - Run the main cell (entire notebook). You should see messages like:  
    - `Written XX participant JSON files to 'participants_json'`  
    - `Combined JSON written to 'participants_all.json'`

---

### 2. Build scenario‑specific question catalog

- **File**: `build_scenario_questions.py`  
- **Input**: `SCN_Questions_catalog.xlsx`  
- **Output**: `questions/scenario_questions.json`  
- **What it does**:  
  - Reads one row per scenario from `SCN_Questions_catalog.xlsx`.  
  - For each row:  
    - Uses `Scenario_ID_H / R / S` (and `Scenario_ID`) as scenario IDs.  
    - Reads `Q1/O1/A1`, `Q2/O2/A2`, `Q3/O3/A3`.  
    - Parses the multi‑line options (O*) and infers the correct option index from A*.  
  - Produces `scenario_questions.json` with entries like:  
    - `{"scenario_id": "SCN_001_H", "question_id": "sa_1", "question_text": "...", "options": [...], "correct_answer_index": 0}`  
- **How to run** (from project root):  
  - `python build_scenario_questions.py`  
  - Expect a message like:  
    - `Wrote NNN scenario-question entries for 30 rows to 'questions\scenario_questions.json'`

---

### 3. Fill `correct_route` for all participants

- **File**: `update_correct_routes.py`  
- **Input**:  
  - `SCN_Questions_catalog.xlsx` (column `CORRECT_ROUTE`)  
  - `participants_json/*.json`  
- **Output**:  
  - Updated `participants_json/PXXX.json` (each trial has `correct_route` filled).  
  - Updated `participants_all.json`.  
- **What it does**:  
  - Builds a mapping from each scenario ID (`Scenario_ID`, `Scenario_ID_H/R/S`) to its `CORRECT_ROUTE` (e.g. `"א׳"`, `"ב׳"`, `"ג׳"`).  
  - Walks all participant JSONs and sets/overwrites `correct_route` for:  
    - `practice[*].correct_route`  
    - `conditions[*].models[*].trials[*].correct_route`  
  - Regenerates `participants_all.json` from the updated per‑participant files.  
- **How to run** (from project root):  
  - `python update_correct_routes.py`  
  - Expect output like:  
    - `Loaded XXX scenario -> correct_route mappings from 'SCN_Questions_catalog.xlsx'`  
    - `Processed P001.json ...`  
    - `Updated 30 participant files and rewrote 'participants_all.json'`

---

### 4. Wire scenarios to the parent app (only if scenario HTMLs change)

- **File**: `wire_scenario_postmessage.py`  
- **Input**:  
  - `Scenarios/Correct_Scenarios/SCN_*.html`  
  - `Scenarios/Inaccurate_Scenarios/SCN_*.html`  
- **Output**: Modified scenario HTML files in both subfolders under `Scenarios/`.  
- **What it does**:  
  - Replaces the old confirm handler in every `SCN_*.html` with a `postMessage` call that sends:  
    - `{ type: "scenario_route_selected", route: picked, scenarioName: ... }`  
  - This lets `app.js` receive the route choice and advance from the map to the questions page.  
- **How to run** (from project root, usually only once after regenerating scenarios):  
  - `python wire_scenario_postmessage.py`

---

### 5. (Optional) Update per-participant AI recommendations

- **File**: `update_recommendations.py`  
- **Input**: `rec_long.xlsx` with columns (per row):  
  - `participant_id` – e.g. `P001` (or `001`, which will be normalized to `P001`)  
  - `Scenario_ID` – e.g. `SCN_004_H`  
  - `Rec_Correct` – whether the AI recommendation is correct for this trial (e.g. `כן` / `לא`)  
  - `correct_answer` – the true optimal route for that participant & scenario (e.g. `א׳` / `ב׳` / `ג׳`)  
  - `System_recommendation` – the route recommended by the system (e.g. `א׳` / `ב׳` / `ג׳`)  
- **Output**:  
  - Updated `participants_json/PXXX.json` with, per trial:  
    - `rec_correct` – copied from `Rec_Correct`.  
    - `correct_route` – overwritten from `correct_answer`.  
    - `ai_recommended_route` – filled from `System_recommendation`.  
  - Updated `participants_all.json`.  
- **What it does**:  
  - Reads `rec_long.xlsx` and builds a mapping per `(participant_id, Scenario_ID)`.  
  - For each participant JSON:  
    - Looks up each `practice` and `conditions[*].models[*].trials[*]` by `(participant_id, scenario_id)`.  
    - Writes `rec_correct`, `correct_route`, and `ai_recommended_route` according to the Excel.  
- **How to run** (from project root):  
  - Make sure `rec_long.xlsx` has the columns above (exact English names).  
  - `python update_recommendations.py`  
  - You should see something like:  
    - `Loaded N participant-scenario recommendation entries from 'rec_long.xlsx'`  
    - `Processed P001.json ...`  
    - `Updated 30 participant files and rewrote 'participants_all.json'`

---

### 6. Run the experiment web app

- **Key files**:  
  - `index.html`  
  - `app.js`  
  - `style.css`  
  - `Scenarios/Correct_Scenarios/SCN_*.html` – scenarios where the AI recommendation should be correct.  
  - `Scenarios/Inaccurate_Scenarios/SCN_*.html` – scenarios where the AI recommendation should be inaccurate.  
  - `questions/` (`questions.json`, `scenario_questions.json`)  
  - `participants_json/` (per‑participant schedules)  
- **What it does**:  
  - `index.html` loads `app.js` into the `#app` div.  
  - `app.js`:  
    - Loads question configuration (`questions/questions.json`) and scenario questions (`questions/scenario_questions.json`).  
    - Loads a participant schedule (`participants_json/PXXX.json`) based on the entered ID.  
    - For each trial, looks at `rec_correct` in the trial data:  
      - If `rec_correct === "לא"` → loads `Scenarios/Inaccurate_Scenarios/<scenario_id>.html`.  
      - Otherwise → loads `Scenarios/Correct_Scenarios/<scenario_id>.html`.  
    - Receives route selection via `postMessage` from the iframe, then shows:  
      - 2 fixed slider questions.  
      - 3 scenario‑specific multiple‑choice questions.  
    - Logs the session into `Participants_log/PXXX_log.json`.  
- **How to run**:  
  - Open `index.html` in a browser (ideally via a simple HTTP server).  
  - Enter a participant ID (e.g. `P001`) and follow the flow.

---

### 7. Inspect and export results (HTML tools)

- **File**: `log_results_viewer.html`  
  - **Purpose**: Inspect a **single participant** log interactively.  
  - **Input**: `Participants_log/PXXX_log.json` (load via file input in the browser).  
  - **Features**:  
    - Summary cards (trial counts, followed AI, optimal choices, total time).  
    - Detailed views for practice/experiment trials, page visits, and all questionnaires.  
    - **Questionnaires CSV export** button that downloads a UTF‑8 CSV with, per answered question:  
      - Participant and questionnaire metadata (type, stage, condition/model indices, trial_id).  
      - Question group/id/label.  
      - **Scenario metadata**: `scenario_id`, `rec_correct`, `ai_recommended_route`, `correct_route` (when linked to a trial).  
      - Answer value and correctness (for scenario questions).  

- **File**: `logs_overview.html`  
  - **Purpose**: Inspect and export **multiple participants’ logs at once**.  
  - **Input**: Select multiple `Participants_log/PXXX_log.json` files in the browser.  
  - **Features**:  
    - High‑level stats across all loaded logs (participants, trials, questionnaires, overall accuracy).  
    - Per‑participant summary table (trials, questionnaires, pages, interactions, % optimal trials).  
    - CSV exports for:  
      - **All questionnaires** (same columns as the per‑participant viewer, for all participants).  
      - **All trials** (participant, stage, condition/model indices, scenario_id, difficulty, `true_route`, `ai_route`, `user_route`, `followed_ai`, `chose_true_optimal`, `rec_correct`, timestamps).  
    - CSVs are emitted with a UTF‑8 BOM so Excel correctly displays Hebrew text.

---

### Recommended order when updating data

1. **Update experiment design** in `Experiment_Order_Expanded.xlsx` → run `Untitled-1.ipynb`.  
2. **Update scenario questions / options / correct answers** in `SCN_Questions_catalog.xlsx` → run `build_scenario_questions.py`.  
3. **Update correct routes** (same Excel) → run `update_correct_routes.py`.  
4. **(Optional) Update per-participant AI recommendations** in `rec_long.xlsx` → run `update_recommendations.py`.  
5. **If you regenerated scenario HTMLs** from another tool → run `wire_scenario_postmessage.py`.  
6. Open `index.html` and test a full run for a participant (e.g. `P001`).

