import glob
from pathlib import Path

# Scripts live in python_scripts/; project root is parent
ROOT_DIR = Path(__file__).resolve().parent.parent
SCENARIOS_DIR = ROOT_DIR / "Scenarios"

OLD_SNIPPET = (
    "document.getElementById('doConfirm').onclick = () => { alert('הבחירה נשמרה!'); "
    "document.getElementById('confirmModal').classList.remove('show'); };"
)

NEW_SNIPPET = """document.getElementById('doConfirm').onclick = () => {
    // Send selection back to parent experiment app (if running inside iframe)
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage(
                {
                    type: 'scenario_route_selected',
                    // picked is the selected route letter, e.g. 'A', 'B', 'C'
                    route: picked,
                    scenarioName: (DATA && DATA.scenarioName) ? DATA.scenarioName : 'UNKNOWN_SCENARIO'
                },
                '*'
            );
        }
    } catch (e) {
        console.error('Failed to post scenario selection to parent:', e);
    }
    document.getElementById('confirmModal').classList.remove('show');
};"""


def main():
    # Wire all scenario HTML files in both Correct_Scenarios and Inaccurate_Scenarios.
    patterns = [
        str(SCENARIOS_DIR / "SCN_*.html"),
        str(SCENARIOS_DIR / "Correct_Scenarios" / "SCN_*.html"),
        str(SCENARIOS_DIR / "Inaccurate_Scenarios" / "SCN_*.html"),
    ]

    files = []
    for pattern in patterns:
        files.extend(glob.glob(pattern))

    changed = 0

    for path in files:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()

        if OLD_SNIPPET not in text:
            continue

        new_text = text.replace(OLD_SNIPPET, NEW_SNIPPET)
        if new_text != text:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_text)
            changed += 1
            print(f"Updated: {Path(path).relative_to(SCENARIOS_DIR)}")

    print(f"Done. Updated {changed} scenario files.")


if __name__ == "__main__":
    main()
