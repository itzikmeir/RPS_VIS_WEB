## Data Loading and Saving – Review vs. Intended Design

This document summarizes how the system currently **loads** data (schedules, questions, scenarios) and **saves** logs, and highlights a few important differences or caveats. No code changes were made here; this is documentation only.

---

## 1. Data Loading

### 1.1 Participant Schedule

**Code path**

- `loadParticipantSchedule(id)` in `app.js`:

```js
async function loadParticipantSchedule(id) {
  try {
    const url = `participants_json/${id}.json`;
    const res = await fetch(url, { cache: "no-store" });
    
    if (!res.ok) {
      throw new Error(`Cannot load JSON for ${id} (HTTP ${res.status})`);
    }
    
    const data = await res.json();
    return data;
  } catch (e) {
    console.error("Error loading participant schedule:", e);
    throw e;
  }
}
```

**What actually happens**

- When the participant enters an ID on the login page, `renderLoginPage` normalizes it (adds a leading `P` if needed) and calls `loadParticipantSchedule(id)`.
- The JSON structure is expected to match what `Untitled-1.ipynb` produces:
  - `practice[]`
  - `conditions[].models[].trials[]`
- If the file is missing or invalid, the app throws and shows an error (via console, plus a visible message).

**Notes / Caveats**

- There is no fallback or alternative scheduling source; if the JSON doesn’t match the expected structure (e.g., missing `conditions` array), runtime errors can occur later in rendering.

### 1.2 Questions Config

**Code path**

```js
async function loadQuestionsConfig() {
  try {
    const url = `questions/questions.json`;
    const res = await fetch(url, { cache: "no-store" });
    
    if (!res.ok) {
      return null;
    }
    
    const data = await res.json();
    return data;
  } catch (e) {
    return null;
  }
}
```

**What actually happens**

- Loaded once after login. If the fetch fails, `questionsConfig` is set to `null`.
- Later code often assumes `questionsConfig` is present but uses defensive checks for specific sections, e.g.:
  - `if (state.questionsConfig && state.questionsConfig.intro_pages) {...}`
  - `if (state.questionsConfig && state.questionsConfig.model_summary_questions) {...}`

**Notes / Caveats**

- If `questions.json` is missing or malformed, the app falls back to hard‑coded default strings in some places (`renderInfoPage` fallback titles/text), but:
  - More complex structures (e.g., model summary questions, demographics) won’t be available.
  - This will degrade functionality (missing questions) but usually won’t crash the app.

### 1.3 Scenario Questions

**Code path**

```js
async function loadScenarioQuestions() {
  try {
    const url = `questions/scenario_questions.json`;
    const res = await fetch(url, { cache: "no-store" });
    
    if (!res.ok) {
      return null;
    }
    
    const data = await res.json();
    return data;
  } catch (e) {
    return null;
  }
}

function getScenarioQuestions(scenarioId) {
  if (!state.scenarioQuestions || !state.scenarioQuestions.scenario_questions) {
    return [];
  }
  
  const allQuestions =
    state.scenarioQuestions.scenario_questions.filter(q => q.scenario_id === scenarioId);
  
  const grouped = {};
  allQuestions.forEach(q => {
    if (!grouped[q.question_id]) {
      grouped[q.question_id] = [];
    }
    grouped[q.question_id].push(q);
  });
  
  return [
    grouped["sa_1"] ? grouped["sa_1"][0] : null,
    grouped["sa_2"] ? grouped["sa_2"][0] : null,
    grouped["sa_3"] ? grouped["sa_3"][0] : null
  ].filter(q => q !== null);
}
```

**What actually happens**

- Loaded once after login; stored in `state.scenarioQuestions`.
- For a given `scenario_id`, the app:
  - Filters all entries in `scenario_questions.scenario_questions`.
  - Groups by `question_id` (`sa_1..sa_3`).
  - Picks the first entry for each group.
- `renderTrialQuestionsPage` then:
  - Renders each question with radio buttons.
  - Logs answers including `answer_index`, `answer_text`, `correct_answer_index`, and `is_correct`.

**Notes / Caveats**

- If `scenario_questions.json` contains multiple entries for the same `(scenario_id, question_id)`, only the **first** is used.
- If there are fewer than 3 questions, missing ones are silently skipped.

### 1.4 Scenario HTML Selection

**Code path (simplified)** – in `renderTrialPage`:

```js
const t = getCurrentTrial();

// Determine folder based on rec_correct
const scenarioFolder =
  t.rec_correct === "לא"
    ? "Scenarios/Inaccurate_Scenarios"
    : "Scenarios/Correct_Scenarios";

const scenarioFilePath = getScenarioFilePath(t.scenario_id, scenarioFolder);

if (scenarioFilePath) {
  // Create fullscreen iframe, src = scenarioFilePath
} else {
  // Show placeholder (no route selection)
}
```

**What actually happens**

- `rec_correct` is expected to be `"כן"` / `"לא"` from `update_recommendations.py`.
- If `rec_correct` is anything other than `"לא"` (including `undefined`), the system uses the **Correct_Scenarios** folder.
- `getScenarioFilePath` prepends the chosen folder to:
  - Either an explicit map entry from `SCENARIO_FILE_MAP`.
  - Or `<scenario_id>.html`.

**Notes / Caveats**

- Behavior when `rec_correct` is missing:
  - Defaults to **Correct_Scenarios**, which is consistent with the current design (documented in `README.md`).
- If a scenario HTML is missing in the chosen folder:
  - The app falls back to a placeholder div (`MAP IFRAME PLACEHOLDER`), and route logging still happens via a generic continue button (using `ai_recommended_route` or debug defaults).

---

## 2. Data Saving / Logging

All logs are accumulated in `state.logs` and only written out when `downloadLogs()` is called (e.g., from a debug control or explicit action).

### 2.1 Structure of `state.logs`

```js
state.logs = {
  pages: [],
  trials: [],
  questionnaires: [],
  interactions: []
};
```

### 2.2 Page Logs

**Code**

```js
function logPageEntry(pageName, metadata = {}) {
  state.currentPageEnterTs = Date.now();
  state.currentPageName = pageName;
  
  state.logs.pages.push({
    page_name: pageName,
    stage: state.stage,
    page_type: state.pageType,
    metadata: metadata,
    enter_ts: state.currentPageEnterTs,
    exit_ts: null
  });
}

function logPageExit(pageName, exitTs = null) {
  const ts = exitTs || Date.now();
  const pageLog = state.logs.pages.find(
    p => p.page_name === pageName && p.exit_ts === null
  );
  if (pageLog) {
    pageLog.exit_ts = ts;
  }
}
```

**Behavior**

- Every time a page is rendered, `logPageEntry` is called with a specific `pageName` (e.g., `LoginPage`, `ScenarioIntroPage`, `TrialPage`).
- On navigation away from that page, `logPageExit` is called to fill in `exit_ts`.
- Page logs include:
  - `stage` (login / pre / practice / experiment / end)
  - `page_type` (e.g. info / trial / trial_questions / model_summary)
  - Optional `metadata` (e.g. condition index, model index, scenario ID).

### 2.3 Trial Logs

**Code snippet** – in `renderTrialPage` when the route is confirmed:

```js
const trialKey = getCurrentTrialKey();
const trialLog = {
  trial_id: trialKey,
  participant_id: state.participantId,
  stage: state.stage,
  condition_index: (state.stage === "experiment" ? state.conditionIndex : null),
  model_index: (state.stage === "experiment" ? state.modelIndex : null),
  trial_index: (state.stage === "practice" ? state.practiceIndex : state.trialIndex),
  scenario_id: t.scenario_id,
  difficulty: t.difficulty,
  true_route: t.correct_route,
  ai_route: t.ai_recommended_route,
  model_type: (state.stage === "experiment"
               ? state.schedule.conditions[state.conditionIndex].models[state.modelIndex].model_type
               : null),
  user_route: userRoute,
  followed_ai: followedAi,
  chose_true_optimal: choseOptimal,
  start_ts: state.currentPageEnterTs,
  end_ts: Date.now()
};

state.logs.trials.push(trialLog);
logPageExit("TrialPage");
```

**Behavior**

- For each practice and experiment trial, the log captures:
  - Participant, scenario, difficulty, model, condition.
  - `true_route` vs `ai_route` vs `user_route`.
  - Whether the user followed the AI and whether they chose the true optimal route.
  - Timing (start/end timestamps).

**Notes / Caveats**

- The `start_ts` is taken from `state.currentPageEnterTs` set at `logPageEntry("TrialPage", ...)`, so:
  - If `logPageEntry` is ever skipped or overwritten mid‑page, timing accuracy would suffer. The current implementation calls it once at the beginning of `renderTrialPage`, which is correct.

### 2.4 Questionnaire Logs

**Post‑scenario questionnaire**

- After each trial, `renderTrialQuestionsPage` builds an `answers` object with:
  - Fixed questions (confidence, mental workload).
  - Scenario questions (`scenario_answers` with index/text/correctness).
- Then it logs a questionnaire entry:

```js
const trialKey = getCurrentTrialKey();
const questionnaireLog = {
  trial_id: trialKey,
  participant_id: state.participantId,
  stage: state.stage,
  condition_index: (state.stage === "experiment" ? state.conditionIndex : null),
  model_index: (state.stage === "experiment" ? state.modelIndex : null),
  trial_index: (state.stage === "practice" ? state.practiceIndex : state.trialIndex),
  questionnaire_type: "post_scenario",
  answers: Object.keys(answers).length > 0 ? answers : null,
  correct: t.correct_answers || null,
  enter_ts: state.currentPageEnterTs,
  exit_ts: Date.now()
};

state.logs.questionnaires.push(questionnaireLog);
```

**Model summary workload / trust**

- At the end of each model:
  - Workload page logs `questionnaire_type: "model_summary"` with workload answers.
  - Trust page merges workload answers (`state.tempWorkloadAnswers`) with trust answers and logs another `model_summary` entry.

**Visualization global + interface component**

- `renderVisualizationGlobalPage` logs:
  - Rank answers for each viz (1–3, though displayed as labels).
  - `help_element` (which part of the interface helped most).

**Demographics**

- `renderDemographicsPage` collects all demographic answers into one `questionnaire_type: "demographics"` entry at the end.

### 2.5 Interactions

- Various pages push additional interaction events to `state.logs.interactions`, e.g.:
  - Consent form contents.
  - Which system_layout items were checked.
  - Etc.

These are not tied to a formal questionnaire type but carry a `page_name`, `interaction_type`, and `data` payload.

### 2.6 Saving Logs

**Code**

```js
function downloadLogs() {
  const blob = new Blob([JSON.stringify(state.logs, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.participantId}_log.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

**Behavior**

- This is a purely client‑side download:
  - No automatic saving to `Participants_log/` directory.
  - The user/experimenter must explicitly trigger `downloadLogs()` (through a debug button or manual call).
- The downloaded filename is `<participantId>_log.json` (matching the log viewer expectations).

**Difference vs. some documentation**

- Some documentation mentions `Participants_log/PXXX_log.json` as if logs were stored automatically.
- In reality:
  - The browser downloads a file; it does **not** automatically place it under `Participants_log/`.
  - Any `Participants_log` directory usage relies on the user manually saving/moving the downloaded file into that folder.

---

## 3. Notable Differences / Things to Be Aware Of

1. **Logs are not automatically written to `Participants_log/`**
   - Contrary to some descriptions, the actual implementation **only** uses a client‑side download via `downloadLogs()`.
   - To mirror the expected `Participants_log/PXXX_log.json` structure, the experimenter must manually store the downloaded file in that directory.

2. **Visualization-condition preference question options**
   - `visualization_condition_question` in `questions.json` currently has an empty `options: []`.
   - `renderVisualizationConditionPage` builds options dynamically from `getDisplayModelName(conditionIndex, 0/1)`, so:
     - This works as long as there are exactly 2 models per condition.
     - The JSON config is not strictly authoritative for options.

3. **Global visualization ranking labels vs. stored values**
   - Participants see text labels (`הטובה ביותר`/`בינונית`/`פחות טובה`), but:
     - Stored values remain numeric 1–3 (based on `option.value = rank`).
   - This is intentional, but worth remembering when analyzing data.

4. **Reversed demographic scales**
   - Numeric values for `navigation_use`, `tech_skill`, `viz_literacy` are still 1–7.
   - Visually, the order is reversed (7→1 left to right), with text labels at extremes:
     - 1 → `כמעט אף פעם`
     - 7 → `כל יום` (or analogous).
   - Analysis scripts must assume the numeric meaning is unchanged (higher is “more”).

5. **Fallbacks if configuration files are missing**
   - If `questions.json` or `scenario_questions.json` fail to load:
     - The app continues with limited functionality (fallback text).
     - Some pages/questions will be missing; there is no explicit hard error or “experiment cannot proceed” message.

6. **Scenario selection when `rec_correct` is missing**
   - If `rec_correct` is not set, the app defaults to `Scenarios/Correct_Scenarios`.
   - This matches the current README description but is important when verifying experiment manipulations based on accurate vs. inaccurate AI recommendations.

Overall, the loading/saving pipeline is consistent and functional, but **automatic saving to a `Participants_log` folder is not implemented** – logs are only available via manual download, and several behaviors (viz preference options, reversed scales) rely on implicit assumptions that analysis code should respect.

