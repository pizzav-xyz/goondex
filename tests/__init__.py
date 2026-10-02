"""Proxy test suite (stdlib `unittest`, no new dependency).

Run from the repo root:

    uv run python -m unittest discover -s tests -p 'test_*.py' -v

The proxy lives at the repo root, so the root is put on `sys.path` once here
rather than in every test module.
"""

import os
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# Pretend credentials exist so config paths that gate on them are exercised;
# tests that care about the anonymous case override these explicitly.
os.environ.setdefault("R34_API_KEY", "test-key")
os.environ.setdefault("R34_USER_ID", "test-user")


if __name__ == "__main__":
    unittest.main()