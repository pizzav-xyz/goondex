import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Wire-level tests for the Rule34 adapter. These assert the exact request the
 * adapter emits, because the failure modes they guard are invisible in the
 * response: a no-op parameter, a misrouted page index, or a body rejected for
 * its declared media type all "work" until a user's results are quietly wrong.
 */

const fetchMock = vi.fn()
const queueAdd = vi.fn()

vi.mock('@/api/requestPrimitives', () => ({
  createSourceFetch: () => fetchMock,
  // The real queue enforces 800ms spacing, which would make this suite take
  // minutes. Spacing itself is covered in requestPrimitives.test.ts; here the
  // queue is a pass-through so the emitted request can be inspected.
  getSourceQueue: () => ({ add: queueAdd }),
  cacheKeyFor: (source: string, key: string) => `${source}:${key}`,
}))

const { rule34Adapter } = await import('@/sources/rule34')
const { RULE34_CAPABILITIES } = await import('@/sources/rule34')

/** The URL the adapter requested, with its query parsed. */
function lastRequest(): { path: string; params: URLSearchParams } {
  const calls = fetchMock.mock.calls
  const url = calls[calls.length - 1][0] as string
  const [path, query] = url.split('?')
  return { path, params: new URLSearchParams(query ?? '') }
}

const wirePost = {
  id: '1',
  tags: 'solo female',
  change: '1700000000',
  rating: 'explicit',
  score: '3',
  image: '1/2/a.jpg',
  file_url: 'https://api-cdn.rule34.xxx/images/1/2/a.jpg',
  preview_url: 'https://api-cdn.rule34.xxx/preview/1/2/a.jpg',
  sample_url: '',
  width: '800',
  height: '600',
  source: '',
  owner: 'someone',
}

beforeEach(() => {
  fetchMock.mockReset()
  queueAdd.mockReset()
  queueAdd.mockImplementation((fn: () => Promise<unknown>) => fn())
  fetchMock.mockResolvedValue(JSON.stringify([wirePost]))
  rule34Adapter.clearCache()
})

describe('search request shape', () => {
  it('addresses Rule34 through index.php with the dapi marker', async () => {
    await rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })
    const { path, params } = lastRequest()
    expect(path).toBe('/index.php')
    expect(params.get('page')).toBe('dapi')
    expect(params.get('s')).toBe('post')
    expect(params.get('q')).toBe('index')
    expect(params.get('json')).toBe('1')
  })

  // Named regression: Rule34 paginates on `pid`. Sending the page index in
  // `page` instead breaks the query — HTTP 200 with a 0-byte body, which reads
  // as "no results" rather than as an error.
  it('named regression: paginates with pid, not page', async () => {
    await rule34Adapter.search({ query: 'solo', page: 5, limit: 100 })
    const { params } = lastRequest()
    expect(params.get('pid')).toBe('5')
    expect(params.get('page')).toBe('dapi')
  })

  // Named regression: `rating=` is a complete no-op upstream — `rating=safe`
  // returns explicit posts, byte-identically to sending no parameter. It must
  // not be emitted in any form.
  it('named regression: never sends a rating= parameter', async () => {
    await rule34Adapter.search({ query: 'rating:explicit solo', page: 0, limit: 100 })
    const { params } = lastRequest()
    expect([...params.keys()]).not.toContain('rating')
    expect(params.get('tags')).toContain('rating:explicit')
  })

  it('emits long-form rating terms, which are the only spelling Rule34 filters on', async () => {
    await rule34Adapter.search({ query: 'rating:questionable', page: 0, limit: 100 })
    expect(lastRequest().params.get('tags')).toBe('rating:questionable')
  })

  it('never emits a short-form rating spelling', async () => {
    await rule34Adapter.search({ query: 'rating:safe', page: 0, limit: 100 })
    const tags = lastRequest().params.get('tags') ?? ''
    expect(tags).not.toMatch(/rating:[sqe]\b/)
  })

  it('drops a sort term and reports it rather than sending it', async () => {
    const outcome = await rule34Adapter.search({ query: 'solo sort:id', page: 0, limit: 100 })
    const { params } = lastRequest()
    expect(params.get('tags')).toBe('solo')
    expect(outcome.dropped).toHaveLength(1)
    expect(outcome.dropped[0].term).toBe('sort:id')
    expect(outcome.dropped[0].reason).toMatch(/newest first/i)
  })

  // Rule34 has no date operator, so the term is routed into the proxy's
  // threshold resolver rather than sent as a tag. Rule34 zeroes unknown
  // qualified tags, so sending it would silently return nothing.
  it('routes a date term to the proxy resolver instead of sending it as a tag', async () => {
    await rule34Adapter.search({ query: 'solo date:week', page: 0, limit: 100 })
    expect(lastRequest().params.get('tags')).toContain('date:week')
  })

  it('reports no drop for a date term, since the resolver honors it', async () => {
    const outcome = await rule34Adapter.search({ query: 'solo date:week', page: 0, limit: 100 })
    expect(outcome.dropped).toEqual([])
  })

  it('omits tags entirely for an empty query', async () => {
    await rule34Adapter.search({ query: '', page: 0, limit: 100 })
    expect(lastRequest().params.has('tags')).toBe(false)
  })
})

describe('page size clamping', () => {
  it('clamps an over-limit request to the source maximum', async () => {
    await rule34Adapter.search({ query: 'solo', page: 0, limit: 5000 })
    // Upstream silently clamps at HTTP 200 with no truncation signal, so the
    // clamp has to happen here or the request is accepted and misread.
    expect(lastRequest().params.get('limit')).toBe('1000')
  })

  it('leaves a within-limit request untouched', async () => {
    await rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })
    expect(lastRequest().params.get('limit')).toBe('100')
  })

  it('declares 1000 as the source maximum', () => {
    expect(RULE34_CAPABILITIES.maxPageSize).toBe(1000)
  })
})

describe('capability declaration', () => {
  it('declares the corrected spacing, not the old 500ms', () => {
    // Upstream's 429 cliff sits at ≈1.25 req/s, so the previous 500ms interval
    // was above it.
    expect(RULE34_CAPABILITIES.minRequestInterval).toBeGreaterThanOrEqual(800)
  })

  it('declares exactly the two ratings Rule34 can express', () => {
    expect([...RULE34_CAPABILITIES.ratings].sort()).toEqual(['explicit', 'questionable'])
  })

  it('declares no ordering support, because sort= is ignored upstream', () => {
    expect(RULE34_CAPABILITIES.ordering).toBe(false)
    expect(RULE34_CAPABILITIES.sortFields).toEqual([])
  })

  it('declares no native date filter', () => {
    expect(RULE34_CAPABILITIES.nativeDateFilter).toBe(false)
  })

  it('permits both media hosts, since video resolves to the mp4 one', () => {
    expect(RULE34_CAPABILITIES.mediaHosts).toContain('api-cdn.rule34.xxx')
    expect(RULE34_CAPABILITIES.mediaHosts).toContain('api-cdn-mp4.rule34.xxx')
  })

  it('declares mp4 and gif as video, with no webm', () => {
    // 0 webm across a 600-post video sample and no webm mirror on any host.
    expect([...RULE34_CAPABILITIES.videoExtensions].sort()).toEqual(['gif', 'mp4'])
  })
})

describe('search response normalization', () => {
  it('returns canonical posts carrying their source', async () => {
    const outcome = await rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })
    expect(outcome.posts).toHaveLength(1)
    expect(outcome.posts[0].source).toBe('rule34')
    expect(outcome.posts[0].tags).toEqual(['solo', 'female'])
  })

  it('treats a zero-byte body as an empty result, not an error', async () => {
    // This is how Rule34 answers a query it dislikes; treating it as a parse
    // failure would turn "no results" into a visible error.
    fetchMock.mockResolvedValue('')
    const outcome = await rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })
    expect(outcome.posts).toEqual([])
  })

  it('surfaces an XML error body as an error', async () => {
    fetchMock.mockResolvedValue('<?xml version="1.0"?><error>Invalid tags</error>')
    await expect(rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })).rejects.toThrow(
      /Invalid tags/,
    )
  })

  it('surfaces an HTML body as an error rather than parsing it', async () => {
    fetchMock.mockResolvedValue('<!DOCTYPE html><html><body>down</body></html>')
    await expect(rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })).rejects.toThrow(
      /HTML/,
    )
  })

  it('surfaces a bare JSON string body as an error', async () => {
    fetchMock.mockResolvedValue('"Something went wrong"')
    await expect(rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })).rejects.toThrow(
      /Something went wrong/,
    )
  })

  it('classifies a 429 as rate-limited with no invented retry delay', async () => {
    // Rule34's 429 has an empty body and no Retry-After, so there is no server
    // hint to honor and none may be fabricated.
    fetchMock.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }))
    await expect(rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })).rejects.toMatchObject({
      kind: 'rate-limited',
      retryAfterMs: null,
    })
  })

  it('classifies a 403 as an auth failure, not a network failure', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }))
    await expect(rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })).rejects.toMatchObject({
      kind: 'auth',
    })
  })

  it('classifies a transport failure as network', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'))
    await expect(rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })).rejects.toMatchObject({
      kind: 'network',
    })
  })
})

describe('caching', () => {
  it('serves a repeated search from cache without a second request', async () => {
    await rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })
    await rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still reports dropped terms on a cached search', async () => {
    await rule34Adapter.search({ query: 'sort:id', page: 0, limit: 100 })
    const second = await rule34Adapter.search({ query: 'sort:id', page: 0, limit: 100 })
    // The drop is a property of the query, not of the response, so it must
    // survive the cache or a repeat search would claim the sort was honored.
    expect(second.dropped).toHaveLength(1)
  })

  it('issues a new request for a different page', async () => {
    await rule34Adapter.search({ query: 'solo', page: 0, limit: 100 })
    await rule34Adapter.search({ query: 'solo', page: 1, limit: 100 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('autocomplete', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(
      JSON.stringify([
        { label: 'solo (12345)', value: 'solo' },
        { label: 'solesmasher (7)', value: 'solesmasher' },
      ]),
    )
  })

  it('addresses the autocomplete endpoint', async () => {
    await rule34Adapter.autocomplete('sol')
    expect(lastRequest().path).toBe('/autocomplete.php')
    expect(lastRequest().params.get('q')).toBe('sol')
  })

  // Named regression: this endpoint answers `content-type: text/html` with a
  // JSON body. Rejecting on the declared media type discards every suggestion.
  it('named regression: parses a JSON body declared as text/html', async () => {
    const suggestions = await rule34Adapter.autocomplete('sol')
    expect(suggestions).toHaveLength(2)
  })

  it('extracts the parenthesized count out of the label', async () => {
    const [first] = await rule34Adapter.autocomplete('sol')
    expect(first.label).toBe('solo')
    expect(first.value).toBe('solo')
    expect(first.count).toBe(12345)
  })

  it('strips only a trailing parenthesized group', async () => {
    fetchMock.mockResolvedValue(JSON.stringify([{ label: 'tag(name) (5)', value: 'tag(name)' }]))
    const [only] = await rule34Adapter.autocomplete('tag')
    expect(only.label).toBe('tag(name)')
    expect(only.count).toBe(5)
  })

  it('reports an absent count as null rather than zero', async () => {
    fetchMock.mockResolvedValue(JSON.stringify([{ label: 'solo', value: 'solo' }]))
    const [only] = await rule34Adapter.autocomplete('solo')
    expect(only.count).toBeNull()
  })

  it('discards a suggestion with no searchable value', async () => {
    fetchMock.mockResolvedValue(JSON.stringify([{ label: '', value: '' }]))
    expect(await rule34Adapter.autocomplete('x')).toEqual([])
  })

  it('issues no request for an empty query', async () => {
    expect(await rule34Adapter.autocomplete('   ')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns nothing for a prefixed term rather than unrelated suggestions', async () => {
    // Rule34's completion index has no metatag rows, so a prefixed term has no
    // suggestions even though the same term works as a search.
    fetchMock.mockResolvedValue('')
    expect(await rule34Adapter.autocomplete('user:')).toEqual([])
  })

  it('caps the suggestion count', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ label: `t${i}`, value: `t${i}` }))
    fetchMock.mockResolvedValue(JSON.stringify(many))
    const suggestions = await rule34Adapter.autocomplete('t')
    expect(suggestions.length).toBeLessThanOrEqual(8)
  })
})

describe('post detail', () => {
  it('looks a post up by an id: tag on the index endpoint', async () => {
    await rule34Adapter.postDetail(12345)
    const { path, params } = lastRequest()
    expect(path).toBe('/index.php')
    expect(params.get('tags')).toBe('id:12345')
    expect(params.get('limit')).toBe('1')
  })

  it('returns the post carrying the requested id', async () => {
    fetchMock.mockResolvedValue(JSON.stringify([{ ...wirePost, id: '999' }]))
    const post = await rule34Adapter.postDetail(12345)
    expect(post.id).toBe(12345)
  })

  it('throws when the lookup finds nothing', async () => {
    fetchMock.mockResolvedValue('[]')
    await expect(rule34Adapter.postDetail(1)).rejects.toMatchObject({ kind: 'parse' })
  })
})