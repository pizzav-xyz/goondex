"""Date resolver paging and rate-math tests.

Run from the repo root:

    uv run --with python-dotenv --with curl_cffi python -m unittest discover -s tests -t . -p 'test_*.py'
"""

import unittest
from unittest.mock import MagicMock

import proxy_date_resolver


class DeepPagingTests(unittest.TestCase):
    """pid= pagination and change-based rate math."""

    def test_pid_10000_deep_page_uses_zero_based_index(self):
        # _estimate_rate fetches pid=0 then pid=10000.
        resolver = proxy_date_resolver.DateResolver()
        resolver._fetch_page = MagicMock(side_effect=[
            [{'id': 20000, 'change': '864001'}],
            [{'id': 10000, 'change': '1'}],
        ])
        rate = resolver._estimate_rate()
        self.assertEqual(rate, 1000.0)

    def test_threshold_uses_change_based_rate_not_wall_clock(self):
        # threshold_for calls _latest_id (pid=0) then _estimate_rate
        # (pid=0, pid=10000).
        resolver = proxy_date_resolver.DateResolver()
        resolver._fetch_page = MagicMock(side_effect=[
            [{'id': 20000, 'change': '864001'}],
            [{'id': 20000, 'change': '864001'}],
            [{'id': 10000, 'change': '1'}],
        ])
        self.assertEqual(resolver.threshold_for(7), 13000)

    def test_zero_time_gap_reports_no_rate(self):
        resolver = proxy_date_resolver.DateResolver()
        resolver._fetch_page = MagicMock(side_effect=[
            [{'id': 20000, 'change': '864001'}],
            [{'id': 10000, 'change': '864001'}],
        ])
        self.assertIsNone(resolver._estimate_rate())

    def test_missing_change_reports_no_rate(self):
        resolver = proxy_date_resolver.DateResolver()
        resolver._fetch_page = MagicMock(side_effect=[
            [{'id': 20000, 'change': '864001'}],
            [{'id': 10000, 'change': '0'}],
        ])
        self.assertIsNone(resolver._estimate_rate())

    def test_page_param_is_not_used_as_pagination(self):
        resolver = proxy_date_resolver.DateResolver()
        resolver._fetch_page = MagicMock(side_effect=[
            [{'id': 20000, 'change': '864001'}],
            [{'id': 10000, 'change': '1'}],
        ])
        resolver._estimate_rate()
        calls = resolver._fetch_page.call_args_list
        self.assertEqual(calls[0].kwargs['pid'], 0)
        self.assertEqual(calls[1].kwargs['pid'], 10000)


if __name__ == '__main__':
    unittest.main()
