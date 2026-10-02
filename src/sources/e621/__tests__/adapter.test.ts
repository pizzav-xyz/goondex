import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Wire-level tests for the e621 adapter. These assert the exact request it
 * emits, because every failure they guard is invisible in a passing response:
 * `v2=true` still returns 200 with valid-looking data, an omitted `limit`
 * silently truncates at 75, and an out-of-range `limit` answers 410.
 *
 * Responses are the real captured fixtures from 2026-10-01 (task 5.8).
 */

const fetchMock = vi.fn()
const queueAdd = vi.fn()

vi.mock('@/api/requestPrimitives', () => ({
  createSourceFetch: () => fetchMock,
  // The real queue enforces 1000ms spacing, which would make this suite take
  // minutes. Spacing itself is covered in requestPrimitives.test.ts; here the
  // queue is a pass-through so the emitted request can be inspected.
  getSourceQueue: () => ({ add: queueAdd }),
  cacheKeyFor: (source: string, key: string) => `${source}:${key}`,
}))

const { e621Adapter } = await import('@/sources/e621')

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tests', 'fixtures',
)
const fixture = (name: string): string =>
  readFileSync(join(FIXTURE_DIR, name), 'utf8')

/**
 * The URL the adapter requested, with its query parsed. The `/e621` routing
 * prefix is stripped from `path` so the assertions below read as upstream
 * paths; `routedPath` keeps the prefix visible where routing itself is under
 * test.
 */
function lastRequest(): { path: string; routedPath: string; params: URLSearchParams } {
  const calls = fetchMock.mock.calls
  const url = calls[calls.length - 1][0] as string
  const [routedPath, query] = url.split('?')
  return {
    routedPath,
    path: routedPath.replace(/^\/e621/, ''),
    params: new URLSearchParams(query ?? ''),
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  queueAdd.mockReset()
  queueAdd.mockImplementation((fn: () => Promise<unknown>) => fn())
  fetchMock.mockResolvedValue(fixture('e621_posts.json'))
  e621Adapter.clearCache()
})

describe('search request shape', () => {
  it('uses the posts.json route', async () => {
    await e621Adapter.search({ query: 'solo', page: 0, limit: 100 })
    expect(lastRequest().path).toBe('/posts.json')
  })

  // Named regression: the proxy derives the upstream board from the path
  // prefix, and `/api/posts.json` is the Rule34 route. Omitting `/e621` sends
  // every e621 request to Rule34, which answers 404 — the failure surfaces as
  // an empty search, not as a wrong-source warning, so it is invisible without
  // asserting the prefix.
  it('routes every request through the /e621 path prefix', async () => {
    await e621Adapter.search({ query: 'solo', page: 0, limit: 100 })
    expect(lastRequest().routedPath).toBe('/e621/posts.json')

    await e621Adapter.autocomplete('so')
    expect(lastRequest().routedPath).toBe('/e621/tags.json')

    fetchMock.mockResolvedValue(fixture('e621_post_detail.json'))
    await e621Adapter.postDetail(6749715)
    expect(lastRequest().routedPath).toBe('/e621/posts/6749715.json')
  })

  // Named regression: the default page size is 75, so omitting `limit` silently
  // truncates every page while looking like a complete result set.
  it('named regression: always sends an explicit limit', async () => {
    await e621Adapter.search({ query: 'solo', page: 0, limit: 100 })
    expect(lastRequest().params.get('limit')).toBe('100')
  })

  it('clamps the limit to the 320 cap rather than letting upstream 410', async () => {
    await e621Adapter.search({ query: 'solo', page: 0, limit: 5000 })
    expect(Number(lastRequest().params.get('limit'))).toBe(320)
  })

  // Named regression: `v2=true` reshapes the response — tags become a flat
  // array and fields move under files/stats — which would silently break the
  // normalizer while every request still returns HTTP 200.
  it('named regression: never sends v2=true', async () => {
    await e621Adapter.search({ query: 'solo', page: 0, limit: 100 })
    expect(lastRequest().params.has('v2')).toBe(false)
  })

  it('sends page 1 for the first page — e621 pages are 1-based', async () => {
    await e621Adapter.search({ query: 'solo', page: 0, limit: 100 })
    expect(lastRequest().params.get('page')).toBe('1')
  })

  it('keeps rating in its short spelling, which is the only one e621 parses', async () => {
    await e621Adapter.search({ query: 'rating:explicit solo', page: 0, limit: 100 })
    const tags = lastRequest().params.get('tags') ?? ''
    expect(tags).toContain('rating:e')
    expect(tags).not.toContain('rating:explicit')
  })
})

describe('response handling', () => {
  it('unwraps the legacy {"posts":[…]} envelope', async () => {
    const { posts } = await e621Adapter.search({ query: 'solo', page: 0, limit: 100 })
    const captured = JSON.parse(fixture('e621_posts.json')) as { posts: unknown[] }
    expect(posts).toHaveLength(captured.posts.length)
    expect(posts[0].source).toBe('e621')
  })

  it('rejects an over-limit 410 as a page-size error, not a throttle', async () => {
    fetchMock.mockResolvedValue('{"success":false,"message":"Limit must be between 0 and 320.","code":null}')
    // Force a non-200 through the fetch layer.
    queueAdd.mockImplementation(async () => {
      throw Object.assign(new Error('410'), { status: 410 })
    })
    await expect(
      e621Adapter.search({ query: 'solo', page: 0, limit: 5000 }),
    ).rejects.toMatchObject({ kind: 'page-size' })
  })

  it('treats 429 and 503 identically, as a rate limit', async () => {
    for (const status of [429, 503]) {
      e621Adapter.clearCache()
      queueAdd.mockImplementation(async () => {
        throw Object.assign(new Error(String(status)), { status })
      })
      await expect(
        e621Adapter.search({ query: `solo${status}`, page: 0, limit: 100 }),
      ).rejects.toMatchObject({ kind: 'rate-limited' })
    }
  })

  it('treats an empty body as no results rather than a parse failure', async () => {
    fetchMock.mockResolvedValue('')
    const { posts } = await e621Adapter.search({ query: 'zzznothing', page: 0, limit: 100 })
    expect(posts).toEqual([])
  })

  it('surfaces a bare JSON string body as an error rather than data', async () => {
    fetchMock.mockResolvedValue('"Limit must be between 0 and 320."')
    await expect(
      e621Adapter.search({ query: 'solo', page: 0, limit: 100 }),
    ).rejects.toMatchObject({ kind: 'parse' })
  })
})

describe('autocomplete', () => {
  it('uses name_matches with a trailing wildcard', async () => {
    await e621Adapter.autocomplete('sol')
    const { path, params } = lastRequest()
    expect(path).toBe('/tags.json')
    expect(params.get('search[name_matches]')).toBe('sol*')
  })

  // Named regression: search[prefix], search[name_prefix], and
  // search[starts_with] do not exist server-side and are silently ignored,
  // which yields unfiltered defaults rather than an error.
  it('named regression: sends none of the parameters that do not exist', async () => {
    await e621Adapter.autocomplete('sol')
    const { params } = lastRequest()
    expect(params.has('search[prefix]')).toBe(false)
    expect(params.has('search[name_prefix]')).toBe(false)
    expect(params.has('search[starts_with]')).toBe(false)
  })

  it('never sends v2=true on the tags route either', async () => {
    await e621Adapter.autocomplete('sol')
    expect(lastRequest().params.has('v2')).toBe(false)
  })

  it('parses the bare top-level array shape', async () => {
    fetchMock.mockResolvedValue(fixture('e621_tags.json'))
    const suggestions = await e621Adapter.autocomplete('sol')
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions[0].value).toBeTruthy()
  })

  it('handles the {"tags":[…]} shape defensively', async () => {
    fetchMock.mockResolvedValue('{"tags":[{"name":"solo","post_count":5}]}')
    const suggestions = await e621Adapter.autocomplete('solo')
    expect(suggestions).toEqual([
      { label: 'solo', value: 'solo', count: 5 },
    ])
  })

  it('treats a zero-result body as no suggestions', async () => {
    fetchMock.mockResolvedValue(fixture('e621_tags_empty.json'))
    expect(await e621Adapter.autocomplete('zzznotatag')).toEqual([])
  })
})

describe('post detail', () => {
  it('uses the plural /posts/<id>.json route', async () => {
    fetchMock.mockResolvedValue(fixture('e621_post_detail.json'))
    await e621Adapter.postDetail(123)
    expect(lastRequest().path).toBe('/posts/123.json')
  })

  it('unwraps the {"post":{…}} envelope', async () => {
    fetchMock.mockResolvedValue(fixture('e621_post_detail.json'))
    const post = await e621Adapter.postDetail(123)
    expect(post.id).toBeGreaterThan(0)
    expect(post.tags.length).toBeGreaterThan(0)
  })

  it('errors when the envelope carries no post', async () => {
    fetchMock.mockResolvedValue('{"post":null}')
    await expect(e621Adapter.postDetail(1)).rejects.toMatchObject({ kind: 'parse' })
  })
})