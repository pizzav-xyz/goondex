/**
 * e621 source adapter.
 *
 * Endpoints (all live-verified 2026-10-01):
 *   search:       GET /posts.json?limit=…&page=…&tags=…
 *   autocomplete: GET /tags.json?search[name_matches]=…&limit=…
 *   detail:       GET /posts/<id>.json
 *
 * Capabilities (Verified 2026-10-01):
 *   maxPageSize: 320 (over-limit → HTTP 410 Gone with a JSON body).
 *   Always send an explicit `limit` — default is 75, which silently truncates.
 *   nativeDateFilter: true — `date:` passed through verbatim after grammar
 *     validation in the shared normalizer.
 *   auth: HTTP Basic ONLY (single code path). No query-param fallback.
 *   Permitted hosts: static1.e621.net, static1.e926.net.
 *   videoExtensions: ['webm', 'mp4'] — gif is treated as video-capable by
 *     the shared helpers alongside the array.
 *
 * Legacy JSON shape is pinned: wrapped `{"posts":[...]}` for search and
 * `{"post":{...}}` for detail. NEVER send `v2=true`, which reshapes the
 * response and would silently break the normalizer.
 */

import type {
  AutocompleteSuggestion,
  Post,
  SearchOutcome,
  SearchRequest,
  SourceAdapter,
  SourceCapabilities,
} from '../types'
import { SourceRequestError } from '../types'
import {
  AUTOCOMPLETE_MAX_RESULTS,
  AUTOCOMPLETE_CACHE_MAX,
  AUTOCOMPLETE_CACHE_TTL,
  MAX_LIMIT,
  PAGE_SIZE,
  SEARCH_CACHE_MAX,
  SEARCH_CACHE_TTL,
} from '@/config'
import { cacheKeyFor, createSourceFetch, getSourceQueue } from '@/api/requestPrimitives'
import { TTLCache } from '@/utils/cache'
import { normalizeQueryDetailed } from '../queryNormalizer'
import { normalizePost, type E621WirePost } from './normalize'

export const E621_CAPABILITIES: SourceCapabilities = {
  ratingFilter: true,
  ratings: ['safe', 'questionable', 'explicit'],
  nativeDateFilter: true,
  ordering: true,
  sortFields: ['id', 'score', 'date'],
  tagCompletion: true,
  maxPageSize: 320,
  authMechanism: 'basic',
  mediaHosts: ['static1.e621.net', 'static1.e926.net'],
  videoExtensions: ['webm', 'mp4'],
  minRequestInterval: 1000,
}

class E621Adapter implements SourceAdapter {
  readonly id = 'e621' as const
  readonly label = 'e621'
  readonly capabilities = E621_CAPABILITIES

  #fetch = createSourceFetch()
  #searchCache = new TTLCache<Post[]>(SEARCH_CACHE_TTL, SEARCH_CACHE_MAX)
  #autocompleteCache = new TTLCache<AutocompleteSuggestion[]>(
    AUTOCOMPLETE_CACHE_TTL,
    AUTOCOMPLETE_CACHE_MAX,
  )

  async search({ query, page = 0, limit = PAGE_SIZE }: SearchRequest): Promise<SearchOutcome> {
    const { query: upstream, dropped } = normalizeQueryDetailed(query, 'e621')

    const clampedLimit = Math.min(limit, MAX_LIMIT, E621_CAPABILITIES.maxPageSize)
    const params: Record<string, string> = {
      limit: String(clampedLimit),
      page: String(page + 1), // e621 page is 1-based
    }
    if (upstream) params.tags = upstream

    // v2=true reshapes the response (tags→flat array, fields under files/stats).
    // The legacy wrapped shape is the default; never opt into v2.
    // params.v2 = 'true' // NEVER

    const cacheKey = cacheKeyFor(this.id, new URLSearchParams(params).toString())
    const cached = this.#searchCache.get(cacheKey)
    if (cached) return { posts: cached, dropped }

    const raw = await this.#request('/posts.json', params)
    // An absent `posts` key is an empty page, not a crash: a bare 0-byte or
    // truncated body must read as "no matches" rather than a TypeError.
    const entries = (raw as { posts?: E621WirePost[] }).posts ?? []
    const posts = entries.map((entry) => normalizePost(entry))
    this.#searchCache.set(cacheKey, posts)
    return { posts, dropped }
  }

  async autocomplete(query: string): Promise<AutocompleteSuggestion[]> {
    const trimmed = query.trim()
    if (!trimmed) return []

    const cacheKey = cacheKeyFor(this.id, `autocomplete:${trimmed}`)
    const cached = this.#autocompleteCache.get(cacheKey)
    if (cached) return cached

    const params: Record<string, string> = {
      'search[name_matches]': `${trimmed}*`,
      limit: String(AUTOCOMPLETE_MAX_RESULTS),
    }

    // e621 completion is `name_matches`-ONLY with `*` wildcards working
    // anywhere. `search[prefix]`, `search[name_prefix]`,
    // `search[starts_with]` do not exist and are silently ignored.
    const raw = await this.#request('/tags.json', params)
    const suggestions = this.#parseSuggestions(raw as unknown[])

    this.#autocompleteCache.set(cacheKey, suggestions)
    return suggestions
  }

  async postDetail(id: number): Promise<Post> {
    // GET /posts/<id>.json → {"post":{...}} is the canonical route.
    // `tags=id:<n>` also works inside posts.json; `search[id]=` does NOT filter.
    // `/post/<id>.json` (singular) is 404.
    // Note: detail data can differ from the index entry (score, fav count, updated_at).
    const raw = await this.#request(`/posts/${id}.json`, {})
    const post = (raw as { post: unknown }).post
    if (!post) {
      throw new SourceRequestError(`e621 post ${id} was not found`, 'parse')
    }
    return normalizePost(post as Parameters<typeof normalizePost>[0])
  }

  async #request(path: string, params: Record<string, string>): Promise<unknown> {
    const queryString = new URLSearchParams(params).toString()
    const queue = getSourceQueue(this.id, E621_CAPABILITIES.minRequestInterval)

    let text: string
    try {
      text = await queue.add(() =>
        this.#fetch<string, 'text'>(
          `/e621${path}?${queryString}`,
          { responseType: 'text' },
        ),
      )
    } catch (error) {
      throw classifyRequestError(error)
    }

    if (!text || text.trim() === '') return {}

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new SourceRequestError('Unexpected response from server', 'parse')
    }

    // Upstream reports some errors as a bare JSON string rather than a payload.
    if (typeof parsed === 'string') {
      throw new SourceRequestError(parsed, 'parse')
    }

    return parsed
  }

  #parseSuggestions(raw: unknown[]): AutocompleteSuggestion[] {
    // e621 returns a BARE TOP-LEVEL ARRAY on success, but {"tags":[]} on
    // zero results. Handle both shapes.
    const arr = Array.isArray(raw) ? raw : (raw as { tags: unknown[] })?.tags ?? []
    const suggestions: AutocompleteSuggestion[] = []

    for (const entry of arr) {
      const item = (entry ?? {}) as Record<string, unknown>
      const value = String(item.name ?? '')
      if (!value) continue

      suggestions.push({
        label: value,
        value,
        count: typeof item.post_count === 'number' ? item.post_count : null,
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

function classifyRequestError(error: unknown): SourceRequestError {
  if (error instanceof SourceRequestError) return error

  const status = extractStatus(error)
  if (status === 429 || status === 503) {
    return new SourceRequestError('Rate limited by e621', 'rate-limited', null)
  }
  if (status === 410) {
    return new SourceRequestError('Page size rejected by e621', 'page-size', null)
  }
  if (status === 401 || status === 403) {
    return new SourceRequestError('e621 rejected the credentials', 'auth')
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

export const e621Adapter = new E621Adapter()