# RPS_VIS — Multidimensional Route Planning: Visual Explanatory AI Experiment

A browser-based controlled user experiment investigating how different AI visualization types affect **trust calibration** and **route selection** in autonomous vehicle navigation systems.

> **Research context:** M.Sc. thesis, Department of Information Systems, University of Haifa.  
> Supervised by Prof. Tsvi Kuflik and Prof. Yoel Lanir.  
> Author: Itzik Meir

---

## What This Is

Participants are presented with simulated route-planning scenarios for an autonomous vehicle. The AI system recommends one route out of three options, and the participant must decide whether to follow the recommendation or choose a different route. Each scenario is accompanied by a visual explanation of the AI's reasoning across five dimensions (comfort, safety, speed, cost, complexity).

The experiment tests **three visualization types**:
- **Heatmap** (`_H`) — color-coded table showing scores per route section
- **Stacked Bar** (`_S`) — aggregated bar charts per route
- **Radar** (`_R`) — multi-axis spider chart per route

And **two AI model types** (within-subject):
- **Optimal model** — AI recommendations are objectively correct
- **Sub-optimal model** — AI recommendations are intentionally flawed

This 2×3 design (model × visualization) allows measuring how participants calibrate their trust depending on both the accuracy of the AI and the type of visual explanation.

**Measured variables:** route choice, decision time (ms), AI agreement rate, NASA-TLX cognitive load, trust ratings, demographic data.

---

## Participant Criteria

- Age 18–65
- Normal or corrected-to-normal vision
- No color blindness (tested via Ishihara plate at experiment start)
- No physical limitations affecting mouse/keyboard use
- Valid driver's license and navigation experience preferred
- Target sample: ~30 participants

---

## Project Structure

```
RPS_VIS-main/
│
├── index.html                          # Entry point — redirects to experiment_model_ordered/
├── style.css                           # Shared stylesheet
│
├── experiment_model_ordered/           # ← ACTIVE EXPERIMENT
│   ├── index.html                      # Experiment shell
│   ├── app.js                          # All experiment logic (~4500 lines, single-file SPA)
│   ├── participants_json/              # One JSON file per participant (P001.json … P030.json)
│   ├── participants_all.json           # All participants merged (for admin overview)
│   ├── participants_log/               # Output: collected session logs (P001_log.json …)
│   ├── questions/questions.json        # All UI text, questionnaire definitions, page content
│   ├── log_results_viewer.html         # Single-participant results viewer
│   ├── logs_overview.html              # Multi-participant overview dashboard
│   ├── admin_storage.html              # Admin tool: view/export localStorage sessions
│   └── test_debug.html                 # Debug utilities
│
├── Scenarios/
│   ├── Correct_Scenarios/              # HTML scenario files where AI rec is correct (SCN_XXX_H/S/R.html)
│   └── Inaccurate_Scenarios/           # HTML scenario files where AI rec is wrong
│
├── Images/                             # UI images (visualization type illustrations, layouts)
├── Videos/Introduction.mp4            # Onboarding video shown to participants
├── color_test/colortest_74.png         # Ishihara color blindness test plate
│
├── python_scripts/                     # Data preparation scripts (run once before experiment)
│   ├── build_model_ordered_participants.py   # Excel → participants_json/*.json
│   ├── build_scenario_questions_model_ordered.py
│   ├── update_correct_routes_model_ordered.py
│   ├── update_correct_answers_model_ordered.py
│   ├── update_recommendations_model_ordered.py
│   └── wire_scenario_postmessage.py    # Injects postMessage into scenario HTML files
│
├── Model_Ordered_experiment/           # Source Excel files for experiment design
│   ├── Models_Experiment_Order_Expanded.xlsx   # Master schedule (input to Python scripts)
│   └── models_SCN_Questions_catalog.xlsx
│
├── tests/                              # Automated test suite (pytest + playwright)
├── visual_sanity_check.py              # Visual QA script for scenario rendering
└── old_experiment_order_files_by_vis_type/  # Archived previous experiment version
```

---

## How the Experiment Works

### Flow (participant perspective)

```
Login → [Screen Check*] → Color Test → Invitation → Consent Form
→ Intro Video → System Layout → Experiment Overview ("דגשים לניסוי")
→ Practice Trials (6 scenarios, 2 per visualization type)
→ Model A: Vis1 (trials + NASA-TLX) → Vis2 → Vis3 → Trust Survey
→ Model B: Vis1 (trials + NASA-TLX) → Vis2 → Vis3 → Trust Survey
→ Model Comparison → Visualization Preference → Demographics
→ End
```

\* Screen Check appears only when **Remote Experiment** mode is selected at login.

### Within each trial

1. Scenario intro page (describes the travel requirement, e.g. "prefer the safest route")
2. Scenario iframe — map + visualization — participant selects a route
3. Per-trial questionnaire — attention check questions + trust rating

### Scenario files

Each scenario is a self-contained HTML file (`SCN_XXX_H/S/R.html`) that renders the map and one visualization type. The iframe communicates the selected route back to the parent via `postMessage`. Scenarios are split into two folders based on whether the AI recommendation is correct or not — the runtime selects the correct folder per trial based on the participant's schedule.

---

## Running the Experiment

### Option A — Local (recommended for in-person sessions)

No installation required. Open in any modern browser:

```
experiment_model_ordered/index.html
```

Or serve locally to avoid browser file-access restrictions:

```bash
python -m http.server 8080
# open http://localhost:8080
```

### Option B — GitHub Pages (remote sessions)

Hosted at: **https://itzikmeir.github.io/RPS_VIS_WEB/**

Remote sessions: check **"Remote experiment with screen test"** on the login page.  
This activates a 3-step environment check (window maximized, tabs closed, screen size calibration via credit card drag).

Runtime monitors active throughout the session:
- Tab-switch events logged and shown as a red banner warning
- Window resize events logged and warned

### Screen requirements

| | Minimum | Ideal |
|---|---|---|
| Screen size | 24" | 24–27" |
| Resolution | 1920×1080 | 1920×1080 |
| Browser | Chrome / Edge (latest) | Chrome |

---

## Adding a New Participant

1. Open `Model_Ordered_experiment/Models_Experiment_Order_Expanded.xlsx` and add a row for the new participant ID (e.g., `P031`) with the assigned model order and visualization order.
2. Run the build script:
   ```bash
   python python_scripts/build_model_ordered_participants.py
   ```
   This generates `experiment_model_ordered/participants_json/P031.json`.
3. The participant can now log in using ID `P031`.

**Participant schedule structure:**

```
participants_json/P031.json
└── models[]
    └── visualizations[]
        └── trials[]
            ├── scenario_id        (e.g. "SCN_005_H")
            ├── correct_route      (e.g. "א׳")
            ├── ai_recommended_route
            ├── correct_answers    (per attention-check question)
            └── rec_correct        ("כן" / "לא")
```

---

## Collected Data

At the end of each session a JSON log is:
1. **Auto-uploaded** to a shared Google Drive folder — researcher receives it without any action from the participant
2. **Offered as a local download** as a backup

### Log file structure (`P001_log.json`)

```json
{
  "pages": [
    { "page_name": "LoginPage", "enter_ts": 1743825600000, "exit_ts": 1743825610000, "stage": "login" }
  ],
  "trials": [
    {
      "trial_id": "experiment_m0_v1_t3",
      "scenario_id": "SCN_007_H",
      "model_index": 0,
      "vis_index": 1,
      "user_route": "ב׳",
      "correct_route": "ב׳",
      "ai_route": "א׳",
      "chose_true_optimal": true,
      "followed_ai": false,
      "start_ts": 1743826000000,
      "end_ts": 1743826042000
    }
  ],
  "questionnaires": [
    { "questionnaire_type": "nasa_tlx", "answers": { ... }, "enter_ts": ..., "exit_ts": ... }
  ],
  "interactions": [
    { "interaction_type": "screen_calibration", "estimated_screen_inches": 24.1, "estimated_ppi": 91 },
    { "interaction_type": "tab_hidden", "stage": "experiment", "page_type": "trial" }
  ]
}
```

All timestamps are Unix milliseconds. **Decision time = `end_ts − start_ts`** (measured entirely on the participant's machine, no network latency).

---

## Viewing Results

### Single participant — `log_results_viewer.html`

Open in a browser and enter the participant ID. Loads `participants_log/P00X_log.json` and displays:

- Session date and start time
- Summary statistics (total trials, % optimal, % followed AI, avg decision time)
- Trial-by-trial table with route choices, correctness, and timing
- NASA-TLX scores per visualization type
- Trust ratings per model
- Demographics
- Attention-check answers

### All participants — `logs_overview.html`

Aggregate dashboard across all log files in `participants_log/`.

---

## Development

### Core file: `experiment_model_ordered/app.js`

Single-file SPA (~4500 lines). All experiment logic, rendering, and data collection in one file. State is a global `state` object; rendering is triggered by calling `render()` after mutating `state.stage` / `state.pageType`.

| `state.stage` | Description |
|---|---|
| `login` | Participant ID entry |
| `screen_check` | Environment validation (remote mode only) |
| `pre` | Pre-experiment pages (consent, video, etc.) |
| `practice` | Practice trials |
| `experiment` | Main experiment — models × visualizations × trials |
| `post` | Post-experiment questionnaires |
| `end` | Final screen, log upload/download |

Session state is also persisted to `localStorage` so interrupted sessions can be resumed.

### Content: `questions/questions.json`

All UI text, page definitions, and questionnaire items. Edit here to change displayed content without touching `app.js`.

### Python scripts (data preparation — run once)

```bash
pip install pandas openpyxl
python python_scripts/build_model_ordered_participants.py
python python_scripts/update_correct_routes_model_ordered.py
python python_scripts/update_correct_answers_model_ordered.py
python python_scripts/update_recommendations_model_ordered.py
python python_scripts/wire_scenario_postmessage.py
```

### Tests

```bash
pip install -r requirements-test.txt
python run_tests.py
```

---

## Deployment

```bash
# Commit and push to both repositories
git add .
git commit -m "your message"
git push origin master            # github.com/muhammadha04/RPS_VIS
git push web master               # github.com/itzikmeir/RPS_VIS_WEB
git push web master:main          # sync main branch for GitHub Pages
```

---

## Contact

Itzik Meir | itzikmeir@gmail.com | 054-5440818  
Department of Information Systems, University of Haifa
