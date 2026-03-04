## System Architecture Overview

This document describes the **original experiment** (visualization‑first format) in the project root: `index.html`, `app.js`, `style.css`. For the **model‑ordered experiment** (Model A → Model B), see `Model_Ordered_experiment/README.md`.

The system is a browser‑based experiment for evaluating route‑planning visualizations and AI recommendation behavior. It is entirely static (HTML/JS/CSS + JSON + images) and can be run from a simple HTTP server.

**High‑level components (original experiment):**

- `index.html` – Shell HTML page that loads the app.
- `app.js` – Single‑page application implementing all UI, flow control, and logging.
- `style.css` – Visual styling for the app.
- `participants_json/*.json` – Per‑participant experimental schedules.
- `participants_all.json` – Combined participant schedule.
- `questions/questions.json` – All experiment instructions, intro pages, questionnaires, and demographic questions.
- `questions/scenario_questions.json` – Per‑scenario multiple‑choice questions (3 per scenario).
- `Scenarios/Correct_Scenarios/*.html` – Scenario screens with “correct” AI recommendations.
- `Scenarios/Inaccurate_Scenarios/*.html` – Scenario screens with “inaccurate” AI recommendations.
- `Images/*.png` – Static explanation images used in intro and summary pages.
- Python helper scripts – Offline data preparation (Excel → JSON).
 - Log analysis HTML tools – Offline inspection/CSV export of saved logs (`log_results_viewer.html`, `logs_overview.html`).

Everything runs client‑side in the browser; no backend server is required beyond static file hosting.

---

## Data Preparation Pipeline (Offline, Python)

Several Python scripts prepare the JSON that drives the experiment. They are designed to be run from the project root.

### 1. Generate per‑participant schedules

- **File**: `Untitled-1.ipynb`
- **Input**: `Experiment_Order_Expanded.xlsx`
- **Output**:
  - `participants_json/PXXX.json`
  - `participants_all.json`

What it does:

- Reads the experimental design (practice + 3 visualization conditions, each with 2 models and multiple trials).
- For each participant:
  - Builds `practice` trials with `scenario_id`, `difficulty`, etc.
  - Builds `conditions[*].models[*].trials[*]` with the correct `scenario_id`s and metadata.
- Writes one JSON per participant plus a combined file.

### 2. Build scenario question catalog

- **File**: `python_scripts/build_scenario_questions_old.py` (run from project root)
- **Input**: `SCN_Questions_catalog.xlsx`
- **Output**: `questions/scenario_questions.json`

What it does:

- For each scenario row in the Excel:
  - Reads `Scenario_ID`, `Scenario_ID_H/R/S`.
  - Reads `Q1/O1/A1`, `Q2/O2/A2`, `Q3/O3/A3`.
- Splits option text into choices and infers the correct answer index.
- Writes a flat list `{scenario_id, question_id (sa_1..3), question_text, options[], correct_answer_index}` under `scenario_questions`.

### 3. Fill `correct_route` per trial

- **File**: `python_scripts/update_correct_routes_old.py` (run from project root)
- **Input**:
  - `SCN_Questions_catalog.xlsx` (`CORRECT_ROUTE`)
  - `participants_json/*.json`
- **Output**:
  - Updated `participants_json/PXXX.json` with `correct_route` filled.
  - Updated `participants_all.json`.

What it does:

- Maps `Scenario_ID`(+ variants) → `CORRECT_ROUTE` (e.g. א׳/ב׳/ג׳).
- For each participant:
  - Updates `practice[*].correct_route`.
  - Updates `conditions[*].models[*].trials[*].correct_route`.
- Rewrites the combined participants file.

### 4. Fill `correct_answers` for scenario questions

- **File**: `python_scripts/update_correct_answers_old.py` (run from project root)
- **Input**:
  - `questions/scenario_questions.json`
  - `participants_json/*.json`
- **Output**:
  - Updated `participants_json/PXXX.json` with `correct_answers.Q1..Q3` filled.
  - Updated `participants_all.json`.

What it does:

- For each `(scenario_id, sa_1/sa_2/sa_3)` entry:
  - Uses `correct_answer_index` to fetch the answer text and maps to `Q1/Q2/Q3`.
- For each participant trial:
  - Writes the correct answer text into `trial.correct_answers.Q1..Q3`.

### 5. Apply AI recommendation plan per participant/scenario

- **File**: `python_scripts/update_recommendations_old.py` (run from project root)
- **Input**:
  - `rec_long.xlsx` (sheet `Schedule_Long` – one row per `(Participant_ID, Scenario_ID)` with columns `Rec_Correct`, `Correct_Answer`, `System_Recommendation`)
  - `participants_json/*.json`
- **Output**:
  - `participants_json/PXXX.json` with:
    - `rec_correct` (כן/לא) per trial.
    - `correct_route` overwritten from `Correct_Answer` if provided.
    - `ai_recommended_route` filled from `System_Recommendation`.
  - Updated `participants_all.json`.

What it does:

- Builds a mapping `(participant_id, scenario_id)` → `{rec_correct, correct_answer, system_recommendation}`.
- Walks practice and experiment trials and applies:
  - `trial.rec_correct`
  - `trial.correct_route`
  - `trial.ai_recommended_route`

### 6. Wire scenario HTML files to the parent app

- **File**: `python_scripts/wire_scenario_postmessage.py` (run from project root)
- **Input**:
  - `Scenarios/SCN_*.html` (legacy, optional)
  - `Scenarios/Correct_Scenarios/SCN_*.html`
  - `Scenarios/Inaccurate_Scenarios/SCN_*.html`
- **Output**: Updated scenario HTML files with `postMessage` wiring.

What it does:

- Replaces the old `doConfirm` click handler in each scenario HTML with a function that:
  - Sends `{type: "scenario_route_selected", route: picked, scenarioName: DATA.scenarioName}` to `window.parent`.
  - Closes the local confirm modal.
- This message is used by `app.js` to:
  - Log the trial (user route vs AI vs optimal).
  - Close the fullscreen iframe.
  - Move to the per‑scenario questionnaire.

---

## Front-End Application (`index.html`, `app.js`, `style.css`)

### 1. Entry point: `index.html`

Minimal HTML:

- Loads `style.css` and `app.js`.
- Provides a `<div id="app"></div>` root.
- The app is a single `render()` loop controlled by `state` in `app.js`.

To run:

- From project root:
  - `python -m http.server 8000`
  - Open `http://localhost:8000/index.html` in a browser.

### 2. Global application state (`app.js`)

Key fields in the global `state` object:

- `participantId`
- `schedule` – current participant’s schedule (from `participants_json/PXXX.json`).
- `questionsConfig` – full questions config (from `questions/questions.json`).
- `scenarioQuestions` – per‑scenario questions (from `questions/scenario_questions.json`).
- `debugMode` – enables developer shortcuts/overlays.
- Phase pointers:
  - `stage`: `"login" | "pre" | "practice" | "experiment" | "end"`.
  - `pageType`: phase‑specific subpage (e.g., `"info" | "scenario_intro" | "trial" | "trial_questions" | "model_summary_workload" | ...`).
- Indexes into schedule:
  - `practiceIndex`, `conditionIndex`, `modelIndex`, `trialIndex`.
- Logging:
  - `logs.pages[]`
  - `logs.trials[]`
  - `logs.questionnaires[]`
  - `logs.interactions[]`

### 3. High-Level Flow

1. **Login (`stage = "login"`)**
   - `renderLoginPage`:
     - Participant enters ID (normalized to `P###`).
     - Debug mode checkbox.
     - Additional instruction block (experimenter checklist).
   - On Start:
     - Loads participant schedule from `participants_json/PXXX.json`.
     - Loads questions and scenario questions.
     - Moves to `stage = "pre"` (intro flow).

2. **Intro / Instruction Pages (`stage = "pre"`)**
   - `PRE_INTRO_PAGE_IDS` defines sequence:
     - `ishihara_test` – color vision test with Ishihara image.
     - `invitation_letter` – study invitation text.
     - `consent_form` – informed consent + form fields.
     - `experiment_video` – YouTube explainer.
     - `system_layout` – screenshot of the full system layout + checklist of UI parts.
     - `system_criteria` – screenshot of criteria legend.
     - `experiment_flow` – summary of the experiment steps + “no stopping after practice” warning.
   - `renderInfoPage`:
     - Fetches page data from `questions.json.intro_pages`.
     - Renders text, optional image, and required inputs (text, checkbox, checkbox list).
     - Performs page‑specific validation (color test answer, consent fields, checklists).
   - After last intro page:
     - `stage = "practice"`, `pageType = "scenario_intro"`, `practiceIndex = 0`.

3. **Practice Stage (`stage = "practice"`)**

   - **Scenario intro before each practice trial**
     - `renderScenarioIntroPage` (practice branch):
       - Title: `תרגול 1 – עמודות נערמות` / `תרגול 2 – רדאר` / `תרגול 3 – מפת חום`.
       - Text:
         - Intro: “בלחיצה על המשך יופיע מסך מערכת תכנון הנסיעה עם:”
         - Bullets in bold:
           - `ויזואליזציה ...`
           - `חישוב באמצעות מודל בינה מלאכותית`
         - Final sentence with bold segment:
           - `... אך **הקפד/י לבצע השוואה בין כל המסלולים** ...`
       - Visualization image: `Images/STACKED.png` / `Images/RADAR.png` / `Images/HEATֹMAP.png`.
       - Continue → `pageType = "trial"`.

   - **Practice trial (`renderTrialPage`)**
     - Looks up current trial from `state.schedule.practice[practiceIndex]`.
     - Chooses scenario folder based on `rec_correct`:
       - `"לא"` → `Scenarios/Inaccurate_Scenarios/<scenario_id>.html`.
       - Otherwise → `Scenarios/Correct_Scenarios/<scenario_id>.html`.
     - Creates a fullscreen iframe (`scenario-iframe-<scenario_id>`) over the page.
     - Waits for `postMessage` from scenario HTML with:
       - `{type: "scenario_route_selected", route: "A"/"B"/"C", scenarioName: ...}`.
     - Converts route to Hebrew, logs:
       - `true_route`, `ai_route`, `user_route`, `followed_ai`, `chose_true_optimal`.
     - Proceeds to `pageType = "trial_questions"`.

   - **Post‑trial questions (`renderTrialQuestionsPage`)**
     - Title: `שאלון לאחר תרחיש`.
     - Fixed sliders (confidence, mental workload).
     - Three scenario‑specific multiple choice questions pulled from `scenario_questions.json`.

   - After last practice trial:
     - `stage = "experiment"`, `pageType = "info"`, `conditionIndex = 0`, `modelIndex = 0`.

4. **Experiment Stage (`stage = "experiment"`)**

   - **Condition intro (`renderConditionIntroPage`)**
     - Title: visualization name only.
     - Short description + visualization image.
   - **Model intro (`renderModelIntroPage`)**
     - Title: `התחלת מודל בינה מלאכותית – מודל A/B` (display name).
     - Text: explains that upcoming scenarios use this model for route recommendations.

   - **Scenario intro (`renderScenarioIntroPage`, experiment branch)**
     - Same bullet structure as practice, but bullets mention:
       - Visualization name (from condition).
       - Display model name (`מודל A`/`מודל B` depending on `modelIndex`).

   - **Trial execution**
     - Same as in practice but now within conditions/models.

   - **Model summary questionnaires**
     - Workload summary (`renderModelSummaryWorkloadPage`):
       - Title: `שאלון מסכם מודל מודל A/B`.
       - NASA‑TLX‑style sliders.
     - Trust summary (`renderModelSummaryTrustPage`):
       - Title: same pattern.
       - Trust items in a 1–7 table.

   - After all models/conditions finished, transitions to visualization‑level questions.

5. **Visualization Preference and Interface Component Questions**

   - **Global visualization ranking (`renderVisualizationGlobalPage`)**
     - Title: `העדפת תצוגות ויזואליזציה`.
     - Shows three reminder images: stacked / radar / heatmap.
     - For each visualization:
       - Dropdown with ranks 1–3, labeled:
         - `הטובה ביותר` / `בינונית` / `פחות טובה`.
       - Logic enforces unique ranks across the three.
     - Second question on same page:
       - Text: which UI area helped most in comparing routes.
       - Shows `Images/LAYOUTS.png` under the question.
       - Dropdown options:
         - `א. המפה הגיאוגרפית`
         - `ב. גרף זמני המקטעים`
         - `ג. אזור הוויזואליזציות (עמודות נערמות / רדאר / מפת חום)`

6. **Demographics (`renderDemographicsPage`)**

   - Title: `שאלון דמוגרפי`.
   - Questions from `questions.demographics_questions`:
     - Age, gender, education, field of study, etc.
     - Navigation frequency / tech skill / viz literacy as 1–7 scales:
       - Scales visually reversed (7→1 left to right), but values remain 1–7.
       - Labels above extremes:
         - Above 1: `כמעט אף פעם`.
         - Above 7: `כל יום` (or analogous).
   - All question texts are rendered in bold; options are normal weight.

7. **End Stage (`stage = "end"`)**

   - Displays final thank‑you / experiment end page.

---

## Logging and Results

All logging is kept client‑side in `state.logs` and periodically flushed to per‑participant log files.

- **Trials**:
  - `Participants_log/PXXX_log.json` contains:
    - `trial_id`, `scenario_id`, `difficulty`.
    - `true_route`, `ai_route`, `user_route`.
    - Whether the participant followed the AI or chose the optimal route.
    - Timestamps for entry/exit.
    - Post‑scenario questionnaire answers and correctness.

- **Pages / questionnaires / interactions**:
  - `logs.pages` – each page entry/exit (for dwell time).
  - `logs.questionnaires` – all questionnaire submissions (model summary, visualization, demographics).
  - `logs.interactions` – finer‑grain data (consent form fields, system_layout checklist, etc.).

You can build separate analysis tools (e.g. `results_viewer.html`, `log_results_viewer.html`) to parse and visualize these logs.

---

## Running the Full System from Scratch (0 → 100)

1. Prepare Excel sources:
   - Fill `Experiment_Order_Expanded.xlsx` with participant‑by‑trial design.
   - Fill `SCN_Questions_catalog.xlsx` with per‑scenario Q1–Q3 and CORRECT_ROUTE.
   - Fill `rec_long.xlsx` (`Schedule_Long` sheet) with per‑participant `Rec_Correct`, `Correct_Answer`, `System_Recommendation`.

2. Generate participant schedules:
   - Open `Untitled-1.ipynb`.
   - Run to create `participants_json/` and `participants_all.json`.

3. Generate scenario question JSON:
   - Run `python python_scripts/build_scenario_questions_old.py`.

4. Fill `correct_route`:
   - Run `python python_scripts/update_correct_routes_old.py`.

5. Fill per‑trial correct answers:
   - Run `python python_scripts/update_correct_answers_old.py`.

6. Apply AI recommendation settings:
   - Run `python python_scripts/update_recommendations_old.py`.

7. Wire scenario HTMLs to the app:
   - Run `python python_scripts/wire_scenario_postmessage.py`.

8. Start a static server:
   - `python -m http.server 8000` from the project root.

9. Run an experiment:
   - Open `http://localhost:8000/index.html`.
   - Enter a participant ID (e.g. `P001`).
   - Ensure debug mode is unchecked for real sessions.
   - Run through the entire flow (pre‑intro → practice → experiment → visualization questions → demographics).

10. Collect logs:
    - After each participant, download the JSON log via the **end‑of‑flow screens**:
      - The demographics page `"שאלון דמוגרפי"` triggers `downloadLogs()` when pressing `"המשך"` (in addition to logging the questionnaire).
      - The final `"סיום הניסוי"` page has a button to download the log again as a safety net.
    - Copy `Participants_log/PXXX_log.json` files and, if needed, use:
      - `log_results_viewer.html` for per‑participant inspection and questionnaire CSV export (including `scenario_id`, `rec_correct`, `ai_recommended_route`, `correct_route` where linked to a trial).
      - `logs_overview.html` for multi‑participant summaries and combined CSV exports (all trials and all questionnaires).

