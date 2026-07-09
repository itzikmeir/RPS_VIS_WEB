"""
Shared helpers for normalizing route labels across the pipeline.

Route letters show up in three different spellings depending on which Excel
sheet or which era of the pipeline produced them:
  - Bare Hebrew letter:      "ג"
  - Hebrew + straight quote: "א'"   (ASCII apostrophe, U+0027)
  - Hebrew + geresh:         "א׳"   (correct form, U+05F3)
  - English letter:          "A"

experiment_model_ordered/app.js does strict string equality against exactly
"א׳" / "ב׳" / "ג׳" (see convertRouteToHebrew / the routeStr validity check),
so any other spelling silently breaks chose_true_optimal / followed_ai
scoring even though the recommendation still *looks* right on screen.
Always route values through normalize_route_hebrew()/normalize_route_letter()
before writing them into participant JSONs or comparing them.
"""

_LETTER_TO_HEB = {"A": "א׳", "B": "ב׳", "C": "ג׳"}
_HEB_TO_LETTER = {v: k for k, v in _LETTER_TO_HEB.items()}
_BASE_HEB = {"א": "A", "ב": "B", "ג": "C"}


def normalize_route_hebrew(value):
    """Map any spelling of a route ('C', 'ג', "ג'", 'ג׳', ...) to the
    canonical Hebrew form with a geresh ('א׳'/'ב׳'/'ג׳'). Returns None for
    NaN/empty/unrecognized input."""
    if value is None:
        return None
    try:
        import pandas as pd
        if pd.isna(value):
            return None
    except Exception:
        pass

    s = str(value).strip()
    if not s:
        return None

    # English letter
    if s.upper() in _LETTER_TO_HEB:
        return _LETTER_TO_HEB[s.upper()]

    # Hebrew, with or without a trailing quote/geresh
    base = s[0]
    if base in _BASE_HEB:
        return _LETTER_TO_HEB[_BASE_HEB[base]]

    return None


def normalize_route_letter(value):
    """Map any spelling of a route to the canonical English letter (A/B/C).
    Returns None for NaN/empty/unrecognized input."""
    heb = normalize_route_hebrew(value)
    return _HEB_TO_LETTER.get(heb)
