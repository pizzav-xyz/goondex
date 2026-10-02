"""Process-wide proxy configuration: credentials, port file, and timeouts.

Single owner of the values both the handler and the date resolver read, so a
tuning change touches one place instead of two hardcoded call sites.
"""

import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

ENV_API_KEY = os.environ.get("R34_API_KEY", "").strip()
ENV_USER_ID = os.environ.get("R34_USER_ID", "").strip()
E621_LOGIN = os.environ.get("E621_LOGIN", "").strip()
E621_API_KEY = os.environ.get("E621_API_KEY", "").strip()

PORT_FILE = os.path.join(os.path.dirname(__file__), ".proxy-port")

API_TIMEOUT = 15
VIDEO_TIMEOUT = 30

CLIENT_ID = "trawl-comb/0.1 (personal client)"

RULE34_SOURCE = "rule34"
E621_SOURCE = "e621"

SOURCE_IDS = (RULE34_SOURCE, E621_SOURCE)

UPSTREAM_BASE_URL = {
    RULE34_SOURCE: "https://api.rule34.xxx",
    E621_SOURCE: "https://e621.net",
}

# Rule34-only date synthesis. e621 carries a native `date:` operator, so the
# resolver never runs for it.
DATE_RESOLUTION_ENABLED = {
    RULE34_SOURCE: True,
    E621_SOURCE: False,
}

MEDIA_HOSTS = {
    RULE34_SOURCE: ("api-cdn.rule34.xxx", "api-cdn-mp4.rule34.xxx"),
    E621_SOURCE: ("static1.e621.net", "static1.e926.net"),
}

# Minimum seconds between upstream requests, per source. Rule34's 429 cliff
# sits near 1.25 req/s, so 0.8 s is the floor; e621 stays at 1.0 s sustained,
# fully serialized. The client enforces its own matching queue; the effective
# interval is the max of the two.
MIN_SPACING_SECONDS = {
    RULE34_SOURCE: 0.8,
    E621_SOURCE: 1.0,
}


def source_for_path(path):
    """Route a rewritten proxy path to its source.

    The Vite rewrite strips `/api` and leaves the upstream path. e621 paths
    carry an `/e621` prefix so the two boards never share a route; everything
    else stays on Rule34 for backward compatibility.
    """
    if path == "/e621" or path.startswith("/e621/"):
        return E621_SOURCE
    return RULE34_SOURCE


def strip_source_prefix(source, path):
    """Remove the routing prefix, leaving the upstream path."""
    if source == E621_SOURCE:
        stripped = path[len("/e621"):]
        return stripped if stripped.startswith("/") else "/" + stripped
    return path
