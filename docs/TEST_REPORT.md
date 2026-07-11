# Test Report – Itzik Experiment Platform

## Running Tests

```bash
# From project root
python run_tests.py -v
```

## Test Suite Summary

| Category | Tests | Description |
|----------|-------|-------------|
| **Pipeline** | 5 | Runs each Python script (build participants, scenario questions, correct answers, correct routes, recommendations) |
| **Data Integrity** | 11 | Validates participant JSON structure, scenario questions, required files, app.js symbols |
| **Log Viewers** | 4 | Checks log_results_viewer.html and logs_overview.html exist and have model-ordered structure |
| **Browser** (optional) | 4 | Playwright tests for frontend (requires `pip install playwright && playwright install chromium`) |

## Last Run

Run `python run_tests.py -v` to see current results. All 21 core tests should pass.

## Optional: Browser Tests

```bash
pip install playwright
playwright install chromium
python -m pytest tests/test_frontend_browser.py -v
```

## Test Files

- `tests/test_pipeline.py` – Pipeline script execution
- `tests/test_data_integrity.py` – Data structure validation
- `tests/test_log_viewers.py` – Log viewer HTML
- `tests/test_frontend_browser.py` – Playwright browser automation
- `experiment_model_ordered/test_debug.html` – Manual debug page (open in browser)

## Failures

If any test fails, the output will show the assertion and traceback. Common issues:

1. **Pipeline scripts fail**: Missing Excel/CSV files in `Model_Ordered_experiment/`
2. **Data integrity fails**: Run pipeline scripts first (`build_model_ordered_participants.py`, etc.)
3. **Log viewer fails**: Ensure `log_results_viewer.html` and `logs_overview.html` exist in `experiment_model_ordered/`
