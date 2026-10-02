"""SSRF allowlist for proxied media URLs.

Only hosts served by a known source may be fetched server-side. Matching is
boundary-correct: a host is permitted when it equals a declared domain or is a
subdomain of one. A bare suffix check would accept a lookalike registrable
domain such as `evilrule34.xxx`.
"""

from urllib.parse import urlparse

import proxy_config


def host_permitted(hostname, domains):
    """True when the host equals or is a subdomain of a declared domain."""
    host = (hostname or '').lower()
    for domain in domains:
        domain = domain.lower()
        if host == domain or host.endswith('.' + domain):
            return True
    return False


def source_for_media_url(target_url):
    """The source whose media hosts the URL belongs to, or None if no source does.

    A proxied media URL names no board, so ownership is resolved from its host.
    None for an unrecognized host is what makes the allowlist reject it: there
    is no source to permit it under.
    """
    try:
        hostname = (urlparse(target_url).hostname or '').lower()
    except ValueError:
        return None
    for source in proxy_config.SOURCE_IDS:
        if host_permitted(hostname, proxy_config.MEDIA_HOSTS[source]):
            return source
    return None


def is_allowed_media_url(target_url, source):
    """True when the URL's host is a permitted media host for `source`.

    `source` is required rather than optional: with it omitted, every declared
    host across all sources would be permitted, which makes the SSRF boundary
    a property of the call site instead of of this module.
    """
    try:
        hostname = urlparse(target_url).hostname or ''
    except ValueError:
        return False
    if source not in proxy_config.MEDIA_HOSTS:
        return False
    return host_permitted(hostname, proxy_config.MEDIA_HOSTS[source])
