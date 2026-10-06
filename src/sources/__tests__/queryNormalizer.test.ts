import { describe, expect, it } from 'vitest'
import { normalizeQuery, normalizeQueryDetailed } from '@/sources/queryNormalizer'

/**
 * The full translation matrix, both boards against every canonical operator.
 * This is the guard against a change to one board's translation silently
 * breaking the other — the failure mode that produces a plausible-looking
 * but wrong grid, because both boards fail open.
 */

const R34 = 'rule34' as const
const E621 = 'e621' as const

describe('rating translation', () => {
  it('emits long forms verbatim on Rule34', () => {
    expect(normalizeQuery('rating:explicit', R34).query).toBe('rating:explicit')
    expect(normalizeQuery('rating:questionable', R34).query).toBe('rating:questionable')
  })

  it('forwards rating:safe to Rule34 rather than dropping it', () => {
    // Rule34 has no safe-rated posts, so matching nothing is the CORRECT
    // empty answer. Dropping the term would return explicit posts as though
    // a safe filter had been applied.
    const result = normalizeQuery('rating:safe', R34)
    expect(result.query).toBe('rating:safe')
    expect(result.dropped).toEqual([])
  })

  it('emits short forms only on e621', () => {
    expect(normalizeQuery('rating:explicit', E621).query).toBe('rating:e')
    expect(normalizeQuery('rating:questionable', E621).query).toBe('rating:q')
    expect(normalizeQuery('rating:safe', E621).query).toBe('rating:s')
  })

  it.each([R34, E621])('rejects short-form canonical input on %s', (target) => {
    for (const term of ['rating:s', 'rating:q', 'rating:e']) {
      const result = normalizeQuery(term, target)
      expect(result.query).not.toContain('rating:')
      expect(result.dropped).toHaveLength(1)
      expect(result.dropped[0].term).toBe(term)
    }
  })

  it.each([R34, E621])('rejects an unrecognized rating rather than failing open on %s', (target) => {
    // e621 silently drops an unparseable rating and returns UNFILTERED
    // results, so forwarding it is the dangerous outcome.
    const result = normalizeQuery('rating:zzz', target)
    expect(result.query).toBe('')
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0].reason).toMatch(/not a recognized rating/i)
  })
})

describe('sort translation', () => {
  it.each([
    ['sort:id', 'order:id_desc'],
    ['sort:id:asc', 'order:id_asc'],
    ['sort:id:desc', 'order:id_desc'],
    ['sort:score', 'order:score'],
    ['sort:score:asc', 'order:score_asc'],
    ['sort:score:desc', 'order:score'],
    ['sort:date', 'order:created_desc'],
    ['sort:date:asc', 'order:created_asc'],
    ['sort:date:desc', 'order:created_desc'],
  ])('%s -> %s on e621', (input, expected) => {
    const result = normalizeQuery(input, E621)
    expect(result.query).toBe(expected)
    expect(result.dropped).toEqual([])
  })

  // Named regression: bare `order:score` already means descending. A
  // well-meaning future "always be explicit" change would emit order:score_desc
  // and silently reverse the user's ordering.
  it('named regression: sort:score emits bare order:score on e621', () => {
    expect(normalizeQuery('sort:score', E621).query).toBe('order:score')
  })

  // Named regression: bare `order:id` means ASCENDING on e621, so the
  // ascending form must be explicit or the request is inverted.
  it('named regression: sort:id:asc emits order:id_asc on e621', () => {
    expect(normalizeQuery('sort:id:asc', E621).query).toBe('order:id_asc')
  })

  it('never uses the space or colon separated direction forms', () => {
    for (const input of ['sort:id:asc', 'sort:score:asc', 'sort:date:asc']) {
      const query = normalizeQuery(input, E621).query
      expect(query).not.toMatch(/order:[^_]*[ :]/)
    }
  })

  it.each([
    'sort:id', 'sort:id:asc', 'sort:id:desc',
    'sort:score', 'sort:score:asc', 'sort:score:desc',
    'sort:date', 'sort:date:asc', 'sort:date:desc',
  ])('drops %s on Rule34 with a notice that states the real order', (term) => {
    const result = normalizeQuery(term, R34)
    expect(result.query).toBe('')
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0].term).toBe(term)
    expect(result.dropped[0].reason).toMatch(/not supported on Rule34/i)
    expect(result.dropped[0].reason).toMatch(/newest first/i)
    expect(result.dropped[0].reason).toMatch(/not sent/i)
  })

  it('rejects an unorderable field on e621', () => {
    const result = normalizeQuery('sort:favcount', E621)
    expect(result.query).toBe('')
    expect(result.dropped).toHaveLength(1)
  })

  it('rejects an invalid direction on e621', () => {
    const result = normalizeQuery('sort:id:sideways', E621)
    expect(result.query).toBe('')
    expect(result.dropped).toHaveLength(1)
  })
})

describe('date term handling', () => {
  it('forwards a valid date term to e621 verbatim', () => {
    expect(normalizeQuery('date:week', E621).query).toBe('date:week')
    expect(normalizeQuery('date:30day', E621).query).toBe('date:30day')
    expect(normalizeQuery('date:2024-01-01', E621).query).toBe('date:2024-01-01')
    expect(normalizeQuery('date:>=2weeks', E621).query).toBe('date:>=2week')
  })

  it('consumes a date term on Rule34 and never sends it upstream', () => {
    const result = normalizeQueryDetailed('date:week', R34)
    expect(result.query).toBe('')
    expect(result.consumed.dateTerms).toEqual(['week'])
    // Consumed into the threshold path is NOT a drop.
    expect(result.dropped).toEqual([])
  })

  it('canonicalises plural units to the documented singular spelling', () => {
    expect(normalizeQuery('date:30days', E621).query).toBe('date:30day')
    expect(normalizeQuery('date:2weeks', E621).query).toBe('date:2week')
  })

  // Trap 1: a bare 4-digit number means that many DAYS ago.
  it('rejects a bare year rather than emitting 2024 days ago', () => {
    const result = normalizeQuery('date:2024', E621)
    expect(result.query).toBe('')
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0].reason).toMatch(/days ago, not the year/i)
  })

  // Trap 2: sub-day units require an explicit count.
  it.each(['hour', 'minute', 'second'])('rejects a bare %s', (unit) => {
    const result = normalizeQuery(`date:${unit}`, E621)
    expect(result.query).toBe('')
    expect(result.dropped).toHaveLength(1)
  })

  it.each([
    ['date:1hour', 'date:1hour'],
    ['date:30minutes', 'date:30minute'],
    ['date:45seconds', 'date:45second'],
  ])('accepts %s with an explicit count, canonicalising the unit', (term, expected) => {
    const result = normalizeQuery(term, E621)
    expect(result.query).toBe(expected)
    expect(result.dropped).toEqual([])
  })

  it('rejects an unrecognized date unit instead of letting it fall through as a tag', () => {
    const result = normalizeQuery('date:fortnight', E621)
    expect(result.query).toBe('')
    expect(result.dropped).toHaveLength(1)
  })

  it('accepts bare day counts, which mean days', () => {
    expect(normalizeQuery('date:30', E621).query).toBe('date:30')
  })
})

describe('duration terms', () => {
  it('is consumed clientside on rule34 and never sent upstream', () => {
    const result = normalizeQueryDetailed('duration:>30', R34)
    expect(result.query).toBe('')
    // Honored by another mechanism, so not reported as a drop.
    expect(result.dropped).toEqual([])
  })

  it('consumes every duration form on rule34', () => {
    for (const term of ['duration:>30', 'duration:>=60', 'duration:<120', 'duration:30-60']) {
      expect(normalizeQuery(term, R34).query).toBe('')
    }
  })

  it('is consumed clientside on every source, never forwarded upstream', () => {
    for (const term of ['duration:>30', 'duration:>=60', 'duration:<120', 'duration:30-60']) {
      expect(normalizeQueryDetailed(term, E621).query).toBe('')
    }
  })

  it('defaults to clientside consumption when no capability is declared', () => {
    expect(normalizeQuery('duration:>30', E621).query).toBe('')
  })
})

describe('passthrough', () => {
  it('passes a bare tag through unchanged on both boards', () => {
    for (const target of [R34, E621]) {
      expect(normalizeQuery('solo', target).query).toBe('solo')
    }
  })

  it('passes an excluded tag through with its marker intact', () => {
    for (const target of [R34, E621]) {
      expect(normalizeQuery('-solo', target).query).toBe('-solo')
    }
  })

  it('passes an unrecognized qualified term through on both boards', () => {
    for (const target of [R34, E621]) {
      expect(normalizeQuery('score:>=10', target).query).toBe('score:>=10')
      expect(normalizeQuery('type:animated', target).query).toBe('type:animated')
      expect(normalizeQuery('pool:2', target).query).toBe('pool:2')
    }
  })

  it('does NOT strip an e621-only operator sent to Rule34', () => {
    // Rule34's operator set cannot be enumerated reliably, so stripping on
    // suspicion would silently discard what the user asked for.
    expect(normalizeQuery('favcount:>10', R34).query).toBe('favcount:>10')
  })

  it('passes a native e621 order: term through verbatim rather than rewriting it', () => {
    expect(normalizeQuery('order:id_desc', E621).query).toBe('order:id_desc')
  })

  it('keeps a parenthesized OR-group intact', () => {
    const query = 'tag1 ( tag2 ~ tag3 )'
    expect(normalizeQuery(query, E621).query).toBe(query)
  })
})

describe('drop list discipline', () => {
  it('is empty when nothing was dropped', () => {
    expect(normalizeQuery('solo rating:explicit', E621).dropped).toEqual([])
    expect(normalizeQuery('solo -rating:explicit', R34).dropped).toEqual([])
  })

  it('reports every dropped term, each with a reason', () => {
    const result = normalizeQuery('sort:id sort:score rating:zzz', R34)
    expect(result.dropped).toHaveLength(3)
    for (const entry of result.dropped) {
      expect(entry.term).toBeTruthy()
      expect(entry.reason).toBeTruthy()
    }
  })

  it('keeps honored terms while disclosing the dropped one', () => {
    const result = normalizeQuery('solo sort:id rating:explicit', R34)
    expect(result.query).toBe('solo rating:explicit')
    expect(result.dropped.map((d) => d.term)).toEqual(['sort:id'])
  })
})

describe('purity', () => {
  it('returns the same result for the same arguments', () => {
    const query = 'solo rating:explicit sort:score date:week duration:>30'
    const first = normalizeQueryDetailed(query, E621)
    const second = normalizeQueryDetailed(query, E621)
    expect(second).toEqual(first)
  })

  it('does not mutate its input', () => {
    const query = 'rating:explicit sort:score'
    normalizeQuery(query, E621)
    expect(query).toBe('rating:explicit sort:score')
  })
})
