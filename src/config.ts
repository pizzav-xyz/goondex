export const PAGE_SIZE = 100
export const MAX_LIMIT = 1000
export const API_TIMEOUT = 15_000
export const RETRY_COUNT = 2
export const SEARCH_CACHE_TTL = 300_000
export const SEARCH_CACHE_MAX = 50
export const AUTOCOMPLETE_CACHE_TTL = 120_000
export const AUTOCOMPLETE_CACHE_MAX = 100
export const MAX_CONCURRENT_BUFFER = 3
export const MAX_CONCURRENT_PROBE = 15
export const PROBE_TIMEOUT = 12_000
export const AUTOCOMPLETE_DEBOUNCE = 300
export const AUTOCOMPLETE_MAX_RESULTS = 8
export const SKELETON_COUNT = 12
export const ROOT_MARGIN = '200px'
// Owned by proxy.py, which hardcodes the same values (RATE_SAMPLE_PAGE,
// _cache_ttl). These TS copies exist only as documentation of the proxy's
// sampler tuning — nothing client-side reads them, and deleting them while the
// proxy keeps its own would entrench the duplication.
export const RATE_SAMPLE_PAGE = 10000
export const DATE_RESOLVER_TTL = 3600
