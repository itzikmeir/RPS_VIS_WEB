#!/usr/bin/env python3
"""
Automated test runner for the Itzik experiment platform.
Runs all tests and reports failures.

Usage:
  python run_tests.py              # Run all tests
  python run_tests.py -v           # Verbose
  python run_tests.py --no-pipeline  # Skip pipeline tests (faster)
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


def run_unittest(verbose=False, skip_pipeline=False):
    """Run tests using unittest."""
    import unittest
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    # Add test modules
    if not skip_pipeline:
        suite.addTests(loader.loadTestsFromName("tests.test_pipeline"))
    suite.addTests(loader.loadTestsFromName("tests.test_data_integrity"))
    suite.addTests(loader.loadTestsFromName("tests.test_multi_correct_answers"))
    suite.addTests(loader.loadTestsFromName("tests.test_log_viewers"))
    # Browser tests use pytest; skip in unittest mode to avoid import issues
    # Run with: python -m pytest tests/test_frontend_browser.py -v
    runner = unittest.TextTestRunner(verbosity=2 if verbose else 1)
    result = runner.run(suite)
    return result.wasSuccessful()


def run_pytest(verbose=False, skip_pipeline=False):
    """Run tests using pytest if available."""
    try:
        import pytest
    except ImportError:
        return run_unittest(verbose, skip_pipeline)
    args = ["-q"] if not verbose else ["-v"]
    if skip_pipeline:
        args.extend(["--ignore=tests/test_pipeline.py"])
    args.extend([str(ROOT / "tests")])
    return pytest.main(args) == 0


def main():
    parser = argparse.ArgumentParser(description="Run Itzik platform tests")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    parser.add_argument("--no-pipeline", action="store_true", help="Skip pipeline script tests")
    parser.add_argument("--pytest", action="store_true", help="Use pytest instead of unittest")
    args = parser.parse_args()
    if args.pytest:
        ok = run_pytest(args.verbose, args.no_pipeline)
    else:
        ok = run_unittest(args.verbose, args.no_pipeline)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
