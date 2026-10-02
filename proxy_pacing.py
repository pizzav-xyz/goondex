"""Outbound request pacing for the proxy.

One spacing gate per source, keyed by source id. The two upstreams throttle
independently, so a burst on one must not starve or trip the other. The
single-threaded server already serializes handlers; the lock only guards the
per-source timestamps.
"""

import threading
import time

import proxy_config

_last_request_by_source = {}
_lock = threading.Lock()


def rate_wait(source):
    """Block until the source is clear to make an upstream request.

    Two gates apply: the source's minimum spacing since its own last request,
    and any active rate-limit cooldown recorded for it. Both are per source, so
    a throttle on one board never delays the other.
    """
    spacing = proxy_config.MIN_SPACING_SECONDS[source]

    # Imported here rather than at module scope: proxy_transport imports this
    # module, so a top-level import would be a cycle.
    from proxy_transport import cooldown_remaining

    with _lock:
        cooldown = cooldown_remaining(source)
        now = time.monotonic()
        last = _last_request_by_source.get(source, 0.0)
        wait = max(spacing - (now - last), cooldown)
        if wait > 0:
            time.sleep(wait)
        _last_request_by_source[source] = time.monotonic()


def reset_pacing():
    """Test-only: drop per-source timestamps so a test observes a fresh interval."""
    with _lock:
        _last_request_by_source.clear()
