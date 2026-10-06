import type {
  AutocompleteSuggestion,
  Post,
  SearchOutcome,
  SearchRequest,
  SourceAdapter,
  SourceCapabilities,
} from '../types'
import { SourceRequestError } from '../types'
import { AUTOCOMPLETE_MAX_RESULTS, AUTOCOMPLETE_CACHE_MAX, AUTOCOMPLETE_CACHE_TTL, MAX_LIMIT, PAGE_SIZE, SEARCH_CACHE_MAX, SEARCH_CACHE_TTL } from '@/config'
import { cacheKeyFor, createSourceFetch, getSourceQueue } from '@/api/requestPrimitives'
import { TTLCache } from '@/utils/cache'
import { normalizeQueryDetailed } from '../queryNormalizer'
import { normalizePost } from './normalize'

/**
 * Rule34 adapter. Behavior-preserving refactor of the pre-existing client: the
 * same endpoints, the same wire parameters, the same error detection. The
 * rating filter moves from the no-op `rating=` parameter into `rating:` search
 * terms, which is the one intentional wire change (see design.md §3).
 *
 * Facts here were verified against the live API on 2026-10-01.
 */

/**
 * `rating=safe` is a complete no-op upstream — it returns byte-identical
 * results to sending no parameter at all, and returns *explicit* posts. So the
 * parameter is not sent in any form; filtering rides on `rating:` tags.
 */
export const RULE34_CAPABILITIES: SourceCapabilities = {
  ratingFilter: true,
  // Rule34 expresses only these two. It has no safe content at all, so a
  // `safe` request is forwarded verbatim and correctly matches nothing.
  ratings: ['explicit', 'questionable'],
  nativeDateFilter: false,
  // Rule34 exposes no duration operator; durations are probed instead.
  nativeDurationFilter: false,
  // `sort=` is entirely ignored upstream — every value returns the same set.
  ordering: false,
  sortFields: [],
  tagCompletion: true,
  // Upstream silently clamps a higher `limit` at HTTP 200 with byte-identical
  // results and no truncation signal, so the clamp is applied client-side.
  maxPageSize: 1000,
  authMechanism: 'query',
  // Video posts resolve `file_url`/`sample_url` to the mp4 host while previews
  // stay on the cdn host, so both are permitted.
  mediaHosts: ['api-cdn.rule34.xxx', 'api-cdn-mp4.rule34.xxx'],
  // 0 webm observed across a 600-post `tags=video` sample and there is no webm
  // mirror on any host, so mp4 plus gif is the whole set.
  videoExtensions: ['mp4', 'gif'],
  // Upstream's 429 cliff sits at ≈1.25 req/s; the old 500ms interval was
  // above it. 800ms is the corrected floor.
  minRequestInterval: 800,
}

/** Trailing parenthesized count, e.g. `solo (12345)`. */
const COUNT_SUFFIX_RE = /\s*\((\d+)\)\s*$/

class Rule34Adapter implements SourceAdapter {
  readonly id = 'rule34' as const
  readonly label = 'Rule34'
  readonly capabilities = RULE34_CAPABILITIES

  #fetch = createSourceFetch()
  #apiKey: string
  #userId: string
  #searchCache = new TTLCache<Post[]>(SEARCH_CACHE_TTL, SEARCH_CACHE_MAX)
  #autocompleteCache = new TTLCache<AutocompleteSuggestion[]>(
    AUTOCOMPLETE_CACHE_TTL,
    AUTOCOMPLETE_CACHE_MAX,
  )

  constructor() {
    this.#apiKey = import.meta.env.R34_API_KEY || ''
    this.#userId = import.meta.env.R34_USER_ID || ''
  }

  async search({ query, page = 0, limit = PAGE_SIZE }: SearchRequest): Promise<SearchOutcome> {
    const { query: upstream, dropped, consumed } = normalizeQueryDetailed(query, 'rule34')

    // Rule34 has no date operator, so `date:` terms are resolved by the proxy
    // into an `id:>` threshold. They are re-attached here for that resolver to
    // extract; they are never treated as tags.
    const dateTerms = consumed.dateTerms.map((value) => `date:${value}`)
    const tags = [...upstream.split(' ').filter(Boolean), ...dateTerms].join(' ')

    const params: Record<string, string> = {
      page: 'dapi',
      s: 'post',
      q: 'index',
      json: '1',
      limit: String(Math.min(limit, MAX_LIMIT, RULE34_CAPABILITIES.maxPageSize)),
      // `pid` is the 0-based page index. `page=` is already spoken for by the
      // dapi marker above, and sending a page index there breaks the query:
      // HTTP 200 with a 0-byte body.
      pid: String(page),
    }
    if (tags) params.tags = tags
    if (this.#apiKey) {
      params.api_key = this.#apiKey
      if (this.#userId) params.user_id = this.#userId
    }

    const cacheKey = cacheKeyFor(this.id, new URLSearchParams(params).toString())
    const cached = this.#searchCache.get(cacheKey)
    if (cached) return { posts: cached, dropped }

    const raw = await this.#request('/index.php', params)
    const posts = raw.map((entry) => normalizePost(entry))
    this.#searchCache.set(cacheKey, posts)

    return { posts, dropped }
  }

  async autocomplete(query: string): Promise<AutocompleteSuggestion[]> {
    const trimmed = query.trim()
    if (!trimmed) return []

    const cacheKey = cacheKeyFor(this.id, `autocomplete:${trimmed}`)
    const cached = this.#autocompleteCache.get(cacheKey)
    if (cached) return cached

    const params: Record<string, string> = { q: trimmed }
    if (this.#apiKey) {
      params.api_key = this.#apiKey
      if (this.#userId) params.user_id = this.#userId
    }

    // This endpoint answers `content-type: text/html` with a JSON body, so the
    // body is parsed as JSON regardless of the declared media type. Keying on
    // the content type would discard every valid suggestion.
    const raw = await this.#request('/autocomplete.php', params)
    const suggestions = this.#parseSuggestions(raw)

    this.#autocompleteCache.set(cacheKey, suggestions)
    return suggestions
  }

  async postDetail(id: number): Promise<Post> {
    // `tags=id:<n>` with the dapi index is the detail lookup; `q=index` with an
    // empty tags set would return the whole page instead.
    const params: Record<string, string> = {
      page: 'dapi',
      s: 'post',
      q: 'index',
      json: '1',
      limit: '1',
      pid: '0',
      tags: `id:${id}`,
    }
    if (this.#apiKey) {
      params.api_key = this.#apiKey
      if (this.#userId) params.user_id = this.#userId
    }

    const raw = await this.#request('/index.php', params)
    const first = raw[0]
    if (!first) {
      throw new SourceRequestError(`Rule34 post ${id} was not found`, 'parse')
    }
    return normalizePost(first, { id })
  }

  /**
   * Runs one request through the source's spacing queue and returns the parsed
   * body, preserving the pre-existing error detection: a zero-byte body is an
   * empty result rather than a parse failure, an XML `<error>` carries its
   * message, and an HTML page means the server is down.
   */
  async #request(path: string, params: Record<string, string>): Promise<unknown[]> {
    const queryString = new URLSearchParams(params).toString()
    const queue = getSourceQueue(this.id, RULE34_CAPABILITIES.minRequestInterval)

    let text: string
    try {
      text = await queue.add(() =>
        this.#fetch<string, 'text'>(`${path}?${queryString}`, { responseType: 'text' }),
      )
    } catch (error) {
      throw classifyRequestError(error)
    }

    if (!text || text.trim() === '') return []

    const start = text.trimStart()
    if (start.startsWith('<?xml') || start.startsWith('<error>')) {
      const message = text.match(/<error>([^<]+)<\/error>/)?.[1] ?? 'Unknown API error'
      throw new SourceRequestError(message, 'parse')
    }
    if (start.startsWith('<!') || start.startsWith('<html')) {
      throw new SourceRequestError(
        'Received HTML instead of API data — server may be down',
        'parse',
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new SourceRequestError('Unexpected response from server', 'parse')
    }

    // Upstream reports some errors as a bare JSON string rather than a payload.
    // Auth failures carry a known message; anything else is a generic parse error.
    if (typeof parsed === 'string') {
      const message = parsed.trim()
      const isAuthError = /Missing authentication|api\.rule34\.xxx/.test(message)
      const kind = isAuthError ? 'auth' : 'parse'
      throw new SourceRequestError(message, kind)
    }

    return Array.isArray(parsed) ? parsed : []
  }

  /**
   * Maps autocomplete entries into the uniform suggestion shape, stripping the
   * trailing parenthesized count out of the label. Only a *trailing* group is
   * removed, because a tag name may legitimately contain parentheses.
   */
  #parseSuggestions(raw: unknown[]): AutocompleteSuggestion[] {
    const suggestions: AutocompleteSuggestion[] = []

    for (const entry of raw) {
      const item = (entry ?? {}) as Record<string, unknown>
      const rawLabel = String(item.label ?? '')
      const countMatch = rawLabel.match(COUNT_SUFFIX_RE)
      const value = String(item.value ?? rawLabel)
      if (!value) continue

      suggestions.push({
        label: countMatch ? rawLabel.replace(COUNT_SUFFIX_RE, '') : rawLabel,
        value,
        // Null when the source supplied no count, never reported as zero.
        count: countMatch ? parseInt(countMatch[1], 10) : null,
      })

      if (suggestions.length >= AUTOCOMPLETE_MAX_RESULTS) break
    }

    return suggestions
  }

  clearCache(): void {
    this.#searchCache.clear()
    this.#autocompleteCache.clear()
  }
}

/**
 * Classifies a transport failure by its real cause. Upstream sends 429 with an
 * empty body and no `Retry-After`, so status is read from the error rather than
 * from a body that may be absent or HTML.
 */
function classifyRequestError(error: unknown): SourceRequestError {
  if (error instanceof SourceRequestError) return error

  const status = extractStatus(error)
  if (status === 429 || status === 503) {
    return new SourceRequestError('Rate limited by Rule34', 'rate-limited', null)
  }
  if (status === 401 || status === 403) {
    return new SourceRequestError('Rule34 rejected the credentials', 'auth')
  }
  const message = error instanceof Error ? error.message : String(error)
  return new SourceRequestError(message, 'network')
}

function extractStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } }
  for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
    if (typeof value === 'number') return value
  }
  return null
}

export const rule34Adapter = new Rule34Adapter()