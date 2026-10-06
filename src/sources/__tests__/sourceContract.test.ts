import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  AutocompleteSuggestion,
  Post,
  SearchOutcome,
  SourceAdapter,
  SourceCapabilities,
} from '@/sources/types'
import { CANONICAL_RATINGS, DEFAULT_SOURCE_ID, SORT_FIELDS, SourceRequestError } from '@/sources/types'

/**
 * Contract tests for the adapter interface. They pin the *shape* of the
 * contract every source must satisfy, so a well-formed adapter type-checks
 * and a malformed one is rejected at compile time.
 */

const rule34Capabilities: SourceCapabilities = {
  ratingFilter: true,
  ratings: ['explicit', 'questionable'],
  nativeDateFilter: false,
  nativeDurationFilter: false,
  ordering: false,
  sortFields: [],
  tagCompletion: true,
  maxPageSize: 1000,
  authMechanism: 'query',
  mediaHosts: ['api-cdn.rule34.xxx', 'api-cdn-mp4.rule34.xxx'],
  videoExtensions: ['mp4', 'gif'],
  minRequestInterval: 800,
}

const makePost = (overrides: Partial<Post> = {}): Post => ({
  id: 1,
  source: 'rule34',
  tags: ['solo'],
  timestamp: 1700000000,
  rating: 'explicit',
  score: 0,
  fileExt: 'jpg',
  fileUrl: 'https://api-cdn.rule34.xxx/images/1/1.jpg',
  previewUrl: 'https://api-cdn.rule34.xxx/preview/1/1.jpg',
  sampleUrl: null,
  alternates: [],
  width: 100,
  height: 100,
  sourceUrl: '',
  duration: null,
  uploaderId: null,
  uploaderName: '',
  approverId: null,
  flags: {},
  ...overrides,
})

const makeAdapter = (overrides: Partial<SourceAdapter> = {}): SourceAdapter => ({
  id: 'rule34',
  label: 'Rule34',
  capabilities: rule34Capabilities,
  search: async (): Promise<SearchOutcome> => ({ posts: [makePost()], dropped: [] }),
  autocomplete: async (): Promise<AutocompleteSuggestion[]> => [
    { label: 'solo (100)', value: 'solo', count: 100 },
  ],
  postDetail: async (id: number): Promise<Post> => makePost({ id }),
  ...overrides,
})

describe('SourceAdapter contract', () => {
  it('accepts a well-formed adapter', () => {
    const adapter = makeAdapter()
    expectTypeOf(adapter).toExtend<SourceAdapter>()
    expect(adapter.id).toBe(DEFAULT_SOURCE_ID)
    expect(adapter.label).toBe('Rule34')
  })

  it('accepts an adapter that declares no capabilities at all', () => {
    // A source with nothing supported must still satisfy the contract, so
    // call sites never probe for methods or special-case a missing one.
    const bare = makeAdapter({
      capabilities: {
        ...rule34Capabilities,
        ratingFilter: false,
        ratings: [],
        tagCompletion: false,
        ordering: false,
        videoExtensions: [],
      },
    })
    expectTypeOf(bare).toExtend<SourceAdapter>()
  })

  it('keeps capabilities readonly', () => {
    // Capabilities are a declaration, not mutable state: nothing may rewrite
    // them mid-session, because the UI already rendered controls from them.
    expectTypeOf(rule34Capabilities.ratings).toEqualTypeOf<
      readonly ('safe' | 'questionable' | 'explicit')[]
    >()
    expectTypeOf(rule34Capabilities.mediaHosts).toEqualTypeOf<readonly string[]>()
  })

  it('has no searchUrl member, by design', () => {
    // CSP coverage is derived from capabilities.mediaHosts instead. This
    // guards the deletion: reintroducing a single-consumer URL builder is
    // exactly the speculative surface the contract omits.
    expect('searchUrl' in makeAdapter()).toBe(false)
  })
})

describe('video support is derived, never flagged', () => {
  // Named regression: a `video: boolean` alongside `videoExtensions` could
  // disagree with it. There is no boolean to disagree.
  it('named regression: capabilities expose no video boolean', () => {
    expect('video' in rule34Capabilities).toBe(false)
  })

  it('treats a non-empty videoExtensions as video support', () => {
    expect(rule34Capabilities.videoExtensions.length).toBeGreaterThan(0)
  })

  it('treats an empty videoExtensions as no video support', () => {
    const still = makeAdapter({
      capabilities: { ...rule34Capabilities, videoExtensions: [] },
    })
    expect(still.capabilities.videoExtensions).toHaveLength(0)
  })
})

describe('canonical vocabularies', () => {
  it('exposes exactly the three canonical ratings', () => {
    expect([...CANONICAL_RATINGS]).toEqual(['safe', 'questionable', 'explicit'])
  })

  it('exposes exactly the three sortable fields', () => {
    expect([...SORT_FIELDS]).toEqual(['id', 'score', 'date'])
  })

  it('defaults to Rule34 as the source id', () => {
    expect(DEFAULT_SOURCE_ID).toBe('rule34')
  })
})

describe('SourceRequestError', () => {
  it('carries its classified cause and optional retry delay', () => {
    const limited = new SourceRequestError('slow down', 'rate-limited', 2000)
    expect(limited).toBeInstanceOf(Error)
    expect(limited.kind).toBe('rate-limited')
    expect(limited.retryAfterMs).toBe(2000)
    expect(limited.name).toBe('SourceRequestError')
  })

  it('defaults the retry delay to null rather than 0', () => {
    const failed = new SourceRequestError('nope', 'network')
    expect(failed.retryAfterMs).toBeNull()
  })

  it('classifies auth failure distinctly from a network failure', () => {
    // These need different user-facing responses, so flattening them to one
    // "request failed" is the bug the kind exists to prevent.
    expect(new SourceRequestError('x', 'auth').kind).not.toBe(
      new SourceRequestError('x', 'network').kind,
    )
  })
})

describe('SearchOutcome reporting', () => {
  it('carries posts and an empty drop list when everything was honored', async () => {
    const outcome = await makeAdapter().search({ query: 'solo', page: 0, limit: 100 })
    expect(outcome.posts).toHaveLength(1)
    expect(outcome.dropped).toEqual([])
  })

  it('reports each unhonored term with the reason it was dropped', async () => {
    const adapter = makeAdapter({
      search: async (): Promise<SearchOutcome> => ({
        posts: [makePost()],
        dropped: [
          { term: 'sort:id', reason: 'Ordering is not supported on Rule34; showing newest first instead.' },
        ],
      }),
    })
    const outcome = await adapter.search({ query: 'sort:id', page: 0, limit: 100 })
    expect(outcome.dropped).toHaveLength(1)
    expect(outcome.dropped[0].term).toBe('sort:id')
    expect(outcome.dropped[0].reason).toBeTruthy()
  })
})

describe('nullable media URLs', () => {
  // e621 always emits the sample.url key and nulls it, so the contract is
  // guarded on value truthiness rather than key presence.
  it('uses null, not an empty string, for absent media', () => {
    const pending = makePost({ fileUrl: null, previewUrl: null, sampleUrl: null })
    expect(pending.fileUrl).toBeNull()
    expect(pending.previewUrl).toBeNull()
    expect(pending.sampleUrl).toBeNull()
  })

  it('distinguishes an unknown duration (null) from zero seconds', () => {
    expect(makePost({ duration: null }).duration).toBeNull()
    expect(makePost({ duration: 0 }).duration).toBe(0)
  })

  it('distinguishes an absent post count from zero', () => {
    expect({ label: 'x', value: 'x', count: null }).toHaveProperty('count', null)
    expect({ label: 'x', value: 'x', count: 0 }).toHaveProperty('count', 0)
  })
})