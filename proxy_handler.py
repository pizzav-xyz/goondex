"""HTTP request handling, routed per source.

`/video` serves media bytes; everything else forwards to the source that owns
the path. The source is read from the URL (`/e621/...` is e621, everything else
Rule34), so no board-specific hostname or parameter is hardcoded here.
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import proxy_config
import proxy_transport
from proxy_allowlist import is_allowed_media_url, source_for_media_url
from proxy_date_resolver import DateResolver

_date_resolver = DateResolver()


class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/video':
            self._handle_video_proxy(parsed)
        else:
            self._handle_api_proxy(parsed)

    def _send_error(self, status, message):
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(message.encode())

    def _send_bytes(self, status, content_type, content):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _handle_video_proxy(self, parsed):
        params = parse_qs(parsed.query)
        target_url = params.get('url', [''])[0]
        if not target_url:
            self._send_error(400, "missing url param")
            return

        source = source_for_media_url(target_url)

        # SSRF boundary: only hosts a declared source serves may be fetched
        # server-side. Matching is boundary-correct, so a lookalike such as
        # `evilrule34.xxx` does not slip through a bare suffix comparison.
        if not is_allowed_media_url(target_url, source):
            self._send_error(403, "forbidden: host is not a permitted media host")
            return

        try:
            r = proxy_transport.send(source, target_url, proxy_config.VIDEO_TIMEOUT)
        except Exception:
            self._send_error(502, "failed to fetch video")
            return

        self._send_bytes(
            r.status_code,
            r.headers.get("content-type", "video/mp4"),
            r.content,
        )

    def _handle_api_proxy(self, parsed):
        source = proxy_config.source_for_path(parsed.path)
        params = parse_qs(parsed.query, keep_blank_values=True)
        path = proxy_config.strip_source_prefix(source, parsed.path)

        if proxy_config.DATE_RESOLUTION_ENABLED[source]:
            raw_tags = params.get('tags', [''])[0]
            cleaned_tags, days, notice = _date_resolver.extract_date_tags(raw_tags)
            params['tags'] = [cleaned_tags]

            if days is not None:
                threshold = _date_resolver.threshold_for(days)
                if threshold is None:
                    # Fail loudly instead of searching more broadly. Rule34 has
                    # no date operator at all, so an unresolvable window has no
                    # honest approximation: the user is told, rather than shown
                    # a plausible-looking grid of unrelated posts.
                    self._send_error(
                        502,
                        notice
                        or "The requested date filter could not be resolved, "
                        "so no results were returned.",
                    )
                    return
                params['tags'] = [f"id:>{threshold} {cleaned_tags}".strip()]

        _date_resolver.set_auth(proxy_config.ENV_API_KEY, proxy_config.ENV_USER_ID)
        # Credentials are environment-owned for both boards; a client-supplied
        # value must never override them.
        params.pop('api_key', None)
        params.pop('user_id', None)

        target = proxy_transport.build_url(source, path, params)

        try:
            r = proxy_transport.send(source, target, proxy_config.API_TIMEOUT)
        except Exception:
            self._send_error(502, "failed to reach upstream API")
            return

        self._send_bytes(
            r.status_code,
            r.headers.get("content-type", "application/json"),
            r.content,
        )

    def log_message(self, format, *args):
        pass