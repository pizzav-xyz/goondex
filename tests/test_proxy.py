"""Proxy tests: SSRF boundary, per-source transport, error classification.

Run from the repo root:

    uv run --with python-dotenv --with curl_cffi python -m unittest discover -s tests -t . -v
"""

import unittest

import proxy_allowlist
import proxy_config
import proxy_date_resolver
import proxy_pacing
import proxy_transport

R34 = proxy_config.RULE34_SOURCE
E621 = proxy_config.E621_SOURCE


class AllowlistBoundaryTests(unittest.TestCase):
    """The allowlist is an SSRF control, so matching must be boundary-correct."""

    def test_suffix_confusion_host_is_rejected(self):
        # A bare `endswith('rule34.xxx')` accepts this registrable domain.
        self.assertFalse(
            proxy_allowlist.is_allowed_media_url('https://evilrule34.xxx/a.png', R34)
        )
        self.assertFalse(
            proxy_allowlist.is_allowed_media_url('https://notrule34.xxx/a.png', R34)
        )

    def test_declared_host_and_subdomain_are_permitted(self):
        self.assertTrue(
            proxy_allowlist.is_allowed_media_url('https://api-cdn.rule34.xxx/a.png', R34)
        )
        self.assertTrue(
            proxy_allowlist.is_allowed_media_url(
                'https://api-cdn-mp4.rule34.xxx/a.mp4', R34
            )
        )

    def test_each_source_is_scoped_to_its_own_hosts(self):
        self.assertFalse(
            proxy_allowlist.is_allowed_media_url('https://static1.e621.net/a.png', R34)
        )
        self.assertTrue(
            proxy_allowlist.is_allowed_media_url('https://static1.e621.net/a.png', E621)
        )
        self.assertTrue(
            proxy_allowlist.is_allowed_media_url('https://static1.e926.net/a.png', E621)
        )

    def test_non_media_host_is_rejected(self):
        self.assertFalse(
            proxy_allowlist.is_allowed_media_url('http://127.0.0.1:34000/x', R34)
        )
        self.assertFalse(
            proxy_allowlist.is_allowed_media_url('https://example.com/a.png', R34)
        )

    def test_malformed_url_is_rejected(self):
        self.assertFalse(proxy_allowlist.is_allowed_media_url('not a url', R34))
        self.assertFalse(proxy_allowlist.is_allowed_media_url('', R34))

    def test_media_url_resolves_to_its_owning_source(self):
        self.assertEqual(
            proxy_allowlist.source_for_media_url('https://api-cdn.rule34.xxx/a.png'),
            R34,
        )
        self.assertEqual(
            proxy_allowlist.source_for_media_url('https://static1.e926.net/a.png'),
            E621,
        )
        # Unrecognized host: no source permits it, which is what rejects it.
        self.assertIsNone(
            proxy_allowlist.source_for_media_url('https://evilrule34.xxx/a.png')
        )


class TransportPolicyTests(unittest.TestCase):
    def setUp(self):
        self._saved = (proxy_config.E621_LOGIN, proxy_config.E621_API_KEY)
        proxy_transport.reset_cooldowns()
        proxy_pacing.reset_pacing()

    def tearDown(self):
        proxy_config.E621_LOGIN, proxy_config.E621_API_KEY = self._saved
        proxy_transport.reset_cooldowns()
        proxy_pacing.reset_pacing()

    def test_rule34_url_carries_credentials_as_query_parameters(self):
        url = proxy_transport.build_url(R34, '/index.php', {'tags': 'solo'})
        self.assertIn('api_key=', url)
        self.assertIn('user_id=', url)

    def test_e621_url_carries_no_credentials(self):
        # e621 authenticates with an Authorization header only. A login/api_key
        # query pair would be a second, silently-different auth path.
        proxy_config.E621_LOGIN = 'someone'
        proxy_config.E621_API_KEY = 'secret'
        url = proxy_transport.build_url(E621, '/posts.json', {'limit': '75'})
        self.assertNotIn('api_key', url)
        self.assertNotIn('login', url)
        self.assertNotIn('secret', url)

    def test_e621_auth_header_is_basic_when_credentials_are_set(self):
        proxy_config.E621_LOGIN = 'someone'
        proxy_config.E621_API_KEY = 'secret'
        headers = proxy_transport.auth_headers(E621)
        self.assertEqual(headers['Authorization'], 'Basic c29tZW9uZTpzZWNyZXQ=')

    def test_e621_is_anonymous_when_credentials_are_unset(self):
        proxy_config.E621_LOGIN = ''
        proxy_config.E621_API_KEY = ''
        self.assertIsNone(proxy_transport.auth_headers(E621))

    def test_rule34_has_no_authorization_header(self):
        self.assertIsNone(proxy_transport.auth_headers(R34))


class ErrorClassificationTests(unittest.TestCase):
    """429 and 503 mean the same thing to this client, on either board."""

    HTML_429 = '<html><head><title>Attention Required!</title></head></html>'

    def test_rule34_429_with_empty_body_and_no_retry_after(self):
        failure = proxy_transport.classify_response(R34, 429, {}, '')
        self.assertEqual(failure.kind, proxy_transport.ERR_RATE_LIMITED)

    def test_e621_429_with_html_body_is_never_parsed_as_json(self):
        failure = proxy_transport.classify_response(
            E621, 429, {'retry-after': '2'}, self.HTML_429
        )
        self.assertEqual(failure.kind, proxy_transport.ERR_RATE_LIMITED)
        self.assertIn('2s', failure.detail)

    def test_503_is_rate_limited_on_both_sources(self):
        for source in (R34, E621):
            failure = proxy_transport.classify_response(source, 503, {}, '')
            self.assertEqual(failure.kind, proxy_transport.ERR_RATE_LIMITED)

    def test_success_is_not_an_error(self):
        self.assertIsNone(proxy_transport.classify_response(R34, 200, {}, '[]'))

    def test_e621_over_limit_410_is_a_page_size_error_not_a_throttle(self):
        body = '{"success":false,"message":"Limit must be between 0 and 320.","code":null}'
        failure = proxy_transport.classify_response(E621, 410, {}, body)
        self.assertEqual(failure.kind, proxy_transport.ERR_PAGE_SIZE)
        self.assertEqual(failure.detail, 'Limit must be between 0 and 320.')

    def test_e621_410_with_non_json_body_does_not_raise(self):
        failure = proxy_transport.classify_response(E621, 410, {}, self.HTML_429)
        self.assertEqual(failure.kind, proxy_transport.ERR_PAGE_SIZE)

    def test_401_and_403_are_auth_errors(self):
        for status in (401, 403):
            failure = proxy_transport.classify_response(E621, status, {}, '')
            self.assertEqual(failure.kind, proxy_transport.ERR_AUTH)

    def test_retry_after_is_capped_and_tolerates_junk(self):
        self.assertEqual(
            proxy_transport.retry_after_seconds({'retry-after': '99999'}), 60.0
        )
        self.assertIsNone(proxy_transport.retry_after_seconds({'retry-after': 'soon'}))
        self.assertIsNone(proxy_transport.retry_after_seconds({}))
        self.assertIsNone(proxy_transport.retry_after_seconds(None))


class CooldownTests(unittest.TestCase):
    def setUp(self):
        proxy_transport.reset_cooldowns()
        proxy_pacing.reset_pacing()

    def tearDown(self):
        proxy_transport.reset_cooldowns()
        proxy_pacing.reset_pacing()

    def test_cooldown_is_per_source(self):
        proxy_transport.register_rate_limit(R34, 30)
        self.assertGreater(proxy_transport.cooldown_remaining(R34), 0)
        self.assertEqual(proxy_transport.cooldown_remaining(E621), 0.0)


class DateExtractionTests(unittest.TestCase):
    def setUp(self):
        self.resolver = proxy_date_resolver.DateResolver()

    def test_plain_tag_passes_through_untouched(self):
        tags, days, notice = self.resolver.extract_date_tags('solo -duet')
        self.assertEqual((tags, days, notice), ('solo -duet', None, None))

    def test_singular_and_plural_units_are_equivalent(self):
        for term in ('date:30day', 'date:30days'):
            tags, days, _ = self.resolver.extract_date_tags(f'{term} solo')
            self.assertEqual(days, 30, term)
            self.assertEqual(tags, 'solo', term)

    def test_bare_unit_means_one_unit(self):
        for term, expected in (
            ('date:day', 1), ('date:week', 7), ('date:month', 30), ('date:year', 365),
        ):
            _, days, _ = self.resolver.extract_date_tags(term)
            self.assertEqual(days, expected, term)

    def test_narrowest_constraint_wins_and_the_user_is_told(self):
        _, days, notice = self.resolver.extract_date_tags('date:year date:week')
        self.assertEqual(days, 7)
        self.assertIsNotNone(notice)
        assert notice is not None
        self.assertIn('narrowest', notice)

    def test_identical_terms_produce_no_notice(self):
        _, days, notice = self.resolver.extract_date_tags('date:week date:7days')
        self.assertEqual(days, 7)
        self.assertIsNone(notice)

    def test_no_date_term_means_no_cleaning(self):
        self.assertEqual(self.resolver.extract_date_tags(''), ('', None, None))


class DateThresholdTests(unittest.TestCase):
    """threshold_for reports failure instead of falling back to a broad search."""

    class StubResolver(proxy_date_resolver.DateResolver):
        def __init__(self, latest_id, rate):
            super().__init__()
            self._latest = latest_id
            self._rate = rate

        def _latest_id(self):
            return self._latest

        def _estimate_rate(self):
            return self._rate

    def test_threshold_is_derived_from_latest_id_and_rate(self):
        resolver = self.StubResolver(10_000, 100.0)
        self.assertEqual(resolver.threshold_for(7), 9300)

    def test_unavailable_latest_id_reports_failure(self):
        self.assertIsNone(self.StubResolver(None, 100.0).threshold_for(7))

    def test_unavailable_rate_reports_failure(self):
        self.assertIsNone(self.StubResolver(10_000, None).threshold_for(7))

    def test_threshold_is_cached(self):
        resolver = self.StubResolver(10_000, 100.0)
        self.assertEqual(resolver.threshold_for(7), 9300)
        resolver._latest = None
        self.assertEqual(resolver.threshold_for(7), 9300)


class PacingTests(unittest.TestCase):
    def setUp(self):
        proxy_transport.reset_cooldowns()
        proxy_pacing.reset_pacing()

    def tearDown(self):
        proxy_transport.reset_cooldowns()
        proxy_pacing.reset_pacing()

    def test_rule34_spacing_is_at_least_the_verified_floor(self):
        # Rule34's 429 cliff sits near 1.25 req/s; the old 500ms was above it.
        self.assertGreaterEqual(proxy_config.MIN_SPACING_SECONDS[R34], 0.8)

    def test_e621_spacing_is_one_request_per_second(self):
        self.assertGreaterEqual(proxy_config.MIN_SPACING_SECONDS[E621], 1.0)

    def test_pacing_is_tracked_per_source(self):
        import time

        start = time.monotonic()
        proxy_pacing.rate_wait(R34)
        proxy_pacing.rate_wait(E621)
        # The first call per source is unpaced, so both must return immediately.
        self.assertLess(time.monotonic() - start, 0.1)


if __name__ == '__main__':
    unittest.main()