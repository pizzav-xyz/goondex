"""Rule34-only date-tag resolution: `date:XX` into an `id:>` threshold.

Rule34 exposes no date operator and no creation timestamp, so a date window is
reverse-engineered into an id threshold by estimating the posting rate from two
samples. Sources with a native `date:` operator never touch this module.

Two facts shape the code, both verified 2026-10-01:

- `change` is a LAST-MODIFIED time. It is the only timestamp Rule34 has, so the
  threshold is approximate by construction and drifts with posting volume.
- There is no server-side date predicate to fall back on. An unresolvable
  window therefore has NO honest approximation, which is why `threshold_for`
  reports failure and the caller surfaces it rather than widening the search.
"""

import re
import time

import proxy_config
import proxy_transport

# Both singular and plural units are accepted, because users type both and the
# units are equivalent. A narrower match would let `date:30days` fall through as
# an ordinary tag, which Rule34 zeroes — a silent empty grid.
DATE_TAG_RE = re.compile(r'\bdate:(\d+)?(day|week|month|year)s?\b')


class DateResolver:
    """Resolves date:XX tags into id:>THRESHOLD via ID-rate estimation."""

    PRESET_DAYS = {'day': 1, 'week': 7, 'month': 30, 'year': 365}
    RATE_SAMPLE_PAGE = 10000

    def __init__(self):
        self._cache = {}
        self._cache_ttl = 3600
        self._api_key = None
        self._user_id = None
        self._posts_per_day = None
        self._rate_sample_time = None

    def set_auth(self, api_key, user_id):
        if api_key:
            self._api_key = api_key
        if user_id:
            self._user_id = user_id

    def extract_date_tags(self, tags_str):
        """Split a tag string into its cleaned tags, day window, and any notice.

        When several date terms are present the NARROWEST window wins: a user
        writing `date:week date:year` is asking for the past week and mentioning
        the year as context. The previous last-wins behavior silently discarded
        the other terms instead, so the user was told about neither.
        """
        matches = DATE_TAG_RE.findall(tags_str)
        if not matches:
            return tags_str, None, None

        windows = []
        for num_str, unit in matches:
            count = int(num_str) if num_str else 1
            windows.append(count * self.PRESET_DAYS[unit])
        days = min(windows)

        notice = None
        distinct = sorted(set(windows))
        if len(distinct) > 1:
            rendered = ', '.join(f'{d}d' for d in distinct)
            notice = (
                f'Applied the narrowest of {len(distinct)} date filters '
                f'({rendered}); Rule34 date filters are approximate.'
            )

        cleaned = DATE_TAG_RE.sub('', tags_str).strip()
        cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip()
        return cleaned, days, notice

    def threshold_for(self, days):
        """The id threshold for a `days` window, or None when it cannot be found.

        Owns rate estimation internally, so there is no resolve/calibrate/
        resolve chain that can disagree with itself. None is a REPORTED failure,
        not an invitation to search more broadly.
        """
        cached = self._cache.get(days)
        if cached and time.time() - cached[1] < self._cache_ttl:
            return cached[0]

        latest_id = self._latest_id()
        if latest_id is None:
            print(f"date threshold unavailable: cannot read latest id ({days}d)", flush=True)
            return None

        rate = self._estimate_rate()
        if not rate:
            print(f"date threshold unavailable: rate estimate failed ({days}d)", flush=True)
            return None

        threshold = latest_id - int(days * rate)
        self._cache[days] = (threshold, time.time())
        return threshold

    def _latest_id(self):
        posts = self._fetch_page(limit=1, pid=0)
        return posts[0]['id'] if posts else None

    def _estimate_rate(self):
        """Posts per day, from two samples one page apart.

        Cached for the same TTL as the thresholds. One sample 10,000 posts back
        captures whatever hour-of-day it landed in, so this drifts with posting
        volume; that is pre-existing and out of scope, and the drift is part of
        why the caller reports failure rather than implying the window is exact.
        """
        now = time.time()
        if (
            self._posts_per_day
            and self._rate_sample_time
            and now - self._rate_sample_time < self._cache_ttl
        ):
            return self._posts_per_day

        newest = self._fetch_page(limit=1, pid=0)
        if not newest:
            return None

        id0 = newest[0]['id']
        ts0 = int(newest[0].get('change', 0))
        if not ts0:
            return None

        older = self._fetch_page(limit=1, pid=self.RATE_SAMPLE_PAGE)
        if not older:
            return None

        id_sample = older[0]['id']
        ts_sample = int(older[0].get('change', 0))
        if not ts_sample or ts0 == ts_sample:
            return None

        id_gap = id0 - id_sample
        time_gap = ts0 - ts_sample
        if time_gap <= 0:
            return None

        self._posts_per_day = id_gap * 86400 / time_gap
        self._rate_sample_time = now
        return self._posts_per_day

    def _fetch_page(self, limit, pid):
        """One Rule34 index page. `pid` is the 0-based page index.

        `page=` is not a pagination parameter here — sending it breaks the query
        and yields HTTP 200 with a 0-byte body — so deep windows page by `pid`.
        """
        params = {
            'page': 'dapi',
            's': 'post',
            'q': 'index',
            'json': '1',
            'sort': 'id:desc',
            'limit': str(limit),
            'pid': str(pid),
        }
        url = proxy_transport.build_url(proxy_config.RULE34_SOURCE, '/index.php', params)
        try:
            r = proxy_transport.send(
                proxy_config.RULE34_SOURCE, url, proxy_config.API_TIMEOUT
            )
            if r.status_code == 200:
                data = r.json()
                # Zero results arrive as a 0-byte body, so a non-list body is an
                # empty page rather than a parse failure.
                return data if isinstance(data, list) else []
        except Exception as e:
            print(f"date resolver fetch failed: {e}", flush=True)
        return []