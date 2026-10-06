import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
const queueAdd = vi.fn()

vi.mock('@/api/requestPrimitives', () => ({
  createSourceFetch: () => fetchMock,
  getSourceQueue: () => ({ add: queueAdd }),
  cacheKeyFor: (source: string, key: string) => `${source}:${key}`,
}))

const { rule34Adapter } = await import('@/sources/rule34')

function lastRequest(): { path: string; params: URLSearchParams } {
  const calls = fetchMock.mock.calls
  const url = calls[calls.length - 1][0] as string
  const [path, query] = url.split('?')
  return { path, params: new URLSearchParams(query ?? '') }
}

beforeEach(() => {
  fetchMock.mockReset()
  queueAdd.mockReset()
  queueAdd.mockImplementation((fn: () => Promise<unknown>) => fn())
  rule34Adapter.clearCache()
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
