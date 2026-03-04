# Old Experiment (Visualization-First Format)

This folder contains the **original experiment** with visualization-first ordering:
Vis A (Model A + Model B) → Vis B (Model A + Model B) → Vis C (Model A + Model B).

**To run:** Open `index.html` in a browser (serve from project root: `python -m http.server 8000`).

**Shared assets** (Scenarios, Images, Videos, style.css) are in the parent folder.

**Data pipeline:**
1. `Untitled-1.ipynb` – Generate participant JSONs from `Experiment_Order_Expanded.xlsx`
2. `python_scripts/build_scenario_questions_old.py` – Build scenario questions from `SCN_Questions_catalog.xlsx`
3. `python_scripts/update_correct_routes_old.py` – Fill correct routes
4. `python_scripts/update_correct_answers_old.py` – Fill correct answers
5. `python_scripts/update_recommendations_old.py` – Fill AI recommendations from `rec_long.xlsx`

For the **current experiment** (model-ordered), use `../experiment_model_ordered/index.html`.
