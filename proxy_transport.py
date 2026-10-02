"""Per-source upstream transport policy: how a request is sent and read.

Every source is sent differently, and the differences are load-bearing — Rule34
needs TLS impersonation, e621 forbids it and 403s a missing `User-Agent`. They
therefore live here, keyed by source id, instead of branching inside the
handler.

Error classification lives here too, because the two boards signal failure
incompatible ways: Rule34 429s with an EMPTY body and NO `Retry-After`, while
e621 429s with an HTML body and `Retry-After: 2` and also documents 503. A
handler that assumed one shape would blind-parse HTML as JSON on one board and
find nothing to read on the other.
"""

import base64
import threading
import time
from typing import NamedTuple
from urllib.parse import urlencode

from curl_cffi import requests as cffi_requests

import proxy_config
from proxy_pacing import rate_wait

# ── Error kinds ─────────────────────────────────────────────────────────
# A failure is always classified by its real cause. `rate-limited` is the one
# kind both boards share: 429 and 503 are the same condition here (in e621's
# own code 503 means database-down and carries no separate operational meaning),
# so treating them differently would either retry an outage or abandon a
# throttle.
ERR_RATE_LIMITED = "rate-limited"
ERR_PAGE_SIZE = "page-size"
ERR_AUTH = "auth"
ERR_UPSTREAM = "upstream"
ERR_TRANSPORT = "transport"

# Statuses that mean "slow down", identical on both boards.
RATE_LIMIT_STATUSES = frozenset({429, 503})

# e621 answers an over-large `limit` with 410 Gone and an explanatory body.
# Rule34 never does — it silently clamps at HTTP 200 — so 410 is unambiguous.
PAGE_SIZE_STATUS = 410

# Where a client's own backoff should start when the server sends no hint.
DEFAULT_RETRY_AFTER_SECONDS = 5.0
# Cap on an upstream hint we would otherwise obey blindly.
MAX_RETRY_AFTER_SECONDS = 60.0


class UpstreamError(Exception):
    """An upstream response the proxy could not use as-is."""

    def __init__(self, kind, status, message, retry_after=None):
        super().__init__(message)
        self.kind = kind
        self.status = status
        self.retry_after = retry_after


class ClassifiedFailure(NamedTuple):
    """A non-200 response's cause and its human-facing detail.

    A NamedTuple rather than a bare tuple so `failure.kind` reads at the call
    site and the type checker knows the shape instead of inferring a union.
    """

    kind: str
    detail: str


def send(source, url, timeout):
    """Issue one paced GET under the source's transport policy.

    - Rule34: TLS impersonation (`impersonate="chrome"`), no explicit
      `User-Agent` — unchanged pre-existing behavior.
    - e621: PLAIN TLS. Its API guidelines explicitly forbid browser
      impersonation, and a descriptive non-browser `User-Agent` is mandatory:
      omitting it is answered with 403 by Cloudflare.

    Written as two explicit calls rather than one `**kwargs` splat, because the
    two policies differ in *which* keyword is sent, not merely its value.
    """
    rate_wait(source)

    if source == proxy_config.E621_SOURCE:
        headers = {"User-Agent": proxy_config.CLIENT_ID}
        auth = auth_headers(source)
        if auth:
            headers.update(auth)
        return cffi_requests.get(url, headers=headers, timeout=timeout)

    return cffi_requests.get(url, impersonate="chrome", timeout=timeout)


def auth_headers(source):
    """`Authorization` for the source, or None when it authenticates otherwise.

    e621 has exactly ONE auth path: HTTP Basic. There is deliberately no
    query-parameter fallback — the proxy always sets headers, so the fallback's
    documented use case (a client that cannot set headers) never occurs, and two
    auth paths for one personal client would be a silent-failure surface.
    """
    if source != proxy_config.E621_SOURCE:
        return None
    if not proxy_config.E621_LOGIN or not proxy_config.E621_API_KEY:
        # Anonymous reads are supported and are the default when unset.
        return None
    token = f"{proxy_config.E621_LOGIN}:{proxy_config.E621_API_KEY}".encode("utf-8")
    return {"Authorization": "Basic " + base64.b64encode(token).decode("ascii")}


def auth_query(source, params):
    """Extra query parameters this source authenticates with.

    Rule34 carries credentials as parameters. e621 carries none — its Basic
    header is the only path.
    """
    if source == proxy_config.E621_SOURCE:
        return {}
    if not proxy_config.ENV_API_KEY:
        return {}
    extra = {"api_key": proxy_config.ENV_API_KEY}
    if proxy_config.ENV_USER_ID:
        extra["user_id"] = proxy_config.ENV_USER_ID
    return extra


def build_url(source, path, params):
    """Compose an upstream URL from the source's base URL and query."""
    base = proxy_config.UPSTREAM_BASE_URL[source]
    merged = {**params, **auth_query(source, params)}
    query = urlencode(merged, doseq=True)
    return f"{base}{path}?{query}" if query else f"{base}{path}"


def retry_after_seconds(headers):
    """Seconds to wait, read from `Retry-After` when the server sent one.

    Rule34 sends none at all, so the caller's own schedule is used there — the
    backoff timer is ours, not the server's.
    """
    if not headers:
        return None
    raw = headers.get("retry-after") or headers.get("Retry-After")
    if raw is None:
        return None
    try:
        seconds = float(str(raw).strip())
    except (TypeError, ValueError):
        # Only the delta-seconds form is used; an HTTP-date form is not
        # produced by either board, and guessing at one would be worse than
        # using our own timer.
        return None
    if seconds < 0:
        return None
    return min(seconds, MAX_RETRY_AFTER_SECONDS)


def classify_response(
    source, status, headers, body_text
) -> ClassifiedFailure | None:
    """Return the failure's cause and detail, or None when the response is usable.

    The body is inspected only by TYPE and never parsed as JSON: e621's 429
    body is HTML and Rule34's is empty, so a blanket `json.loads` either throws
    or invents a misleading message.
    """
    if status == 200:
        return None

    if status in RATE_LIMIT_STATUSES:
        retry_after = retry_after_seconds(headers)
        if retry_after is None:
            retry_after = DEFAULT_RETRY_AFTER_SECONDS
        return ClassifiedFailure(ERR_RATE_LIMITED, f"Rate limited; retry in {retry_after:g}s.")

    if source == proxy_config.E621_SOURCE and status == PAGE_SIZE_STATUS:
        # The body here IS JSON and IS useful, but it is read defensively.
        return ClassifiedFailure(ERR_PAGE_SIZE, _limit_message(body_text))

    if status in (401, 403):
        return ClassifiedFailure(ERR_AUTH, "Upstream rejected the credentials.")

    return ClassifiedFailure(ERR_UPSTREAM, f"Upstream responded with HTTP {status}.")


def _limit_message(body_text):
    """The server's own explanation of a rejected `limit`, when it sent one."""
    if not body_text:
        return "Page size rejected by the source."
    import json

    try:
        parsed = json.loads(body_text)
    except (TypeError, ValueError):
        return "Page size rejected by the source."
    if isinstance(parsed, dict) and isinstance(parsed.get("message"), str):
        return parsed["message"]
    return "Page size rejected by the source."


_cooldown_lock = threading.Lock()
_cooldown_until = {}


def register_rate_limit(source, retry_after):
    """Hold this source off upstream for `retry_after` seconds.

    The wait is recorded rather than slept inside the handler: the server is
    single-threaded, so blocking here would stall the OTHER source behind one
    board's throttle. `rate_wait` honors the cooldown, so the next request to
    this source waits while the other board stays responsive.
    """
    delay = DEFAULT_RETRY_AFTER_SECONDS if retry_after is None else retry_after
    with _cooldown_lock:
        until = time.monotonic() + delay
        _cooldown_until[source] = max(_cooldown_until.get(source, 0.0), until)


def cooldown_remaining(source):
    """Seconds of cooldown left for the source, if any."""
    with _cooldown_lock:
        until = _cooldown_until.get(source)
        if until is None:
            return 0.0
        return max(0.0, until - time.monotonic())


def reset_cooldowns():
    """Test-only: drop recorded cooldowns."""
    with _cooldown_lock:
        _cooldown_until.clear()