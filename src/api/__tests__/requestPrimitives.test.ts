import { afterEach, describe, expect, it } from 'vitest'
import { cacheKeyFor, getSourceQueue, resetSourceQueues } from '@/api/requestPrimitives'

afterEach(() => {
  resetSourceQueues()
})

describe('per-source spacing', () => {
  // Real timers at a tiny interval: faking time does not work here because
  // p-queue reads the wall clock itself, so a fake clock would make this test
  // pass without proving any spacing actually happened.
  it('keeps a minimum gap between request starts', async () => {
    const queue = getSourceQueue('rule34', 50)
    const starts: number[] = []

    await Promise.all(
      [1, 2, 3].map(() =>
        queue.add(async () => {
          starts.push(Date.now())
        }),
      ),
    )

    expect(starts).toHaveLength(3)
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1]
      // Allow a millisecond of timer slop in the tolerant direction only.
      expect(gap).toBeGreaterThanOrEqual(45)
    }
  })

  it('serializes requests rather than running them in parallel', async () => {
    const queue = getSourceQueue('e621', 10)
    let inFlight = 0
    let maxInFlight = 0

    await Promise.all(
      Array.from({ length: 4 }, () =>
        queue.add(async () => {
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          await new Promise<void>((resolve) => setTimeout(resolve, 5))
          inFlight--
        }),
      ),
    )

    // e621's 429s come from a concurrency-based load shedder, so overlapping
    // requests are the specific failure being prevented.
    expect(maxInFlight).toBe(1)
  })
})

describe('queue memoization', () => {
  it('returns the same queue for the same source', () => {
    expect(getSourceQueue('rule34', 800)).toBe(getSourceQueue('rule34', 800))
  })

  // Named regression: spacing is a property of the upstream, not the caller.
  // Two adapters pointed at Rule34 must share one queue, or a search racing a
  // post-detail request halves the effective interval and lands back on the
  // 429 cliff that the spacing exists to avoid.
  it('named regression: two adapters for one source share a single queue', () => {
    const first = getSourceQueue('rule34', 800)
    const second = getSourceQueue('rule34', 800)
    expect(first).toBe(second)
  })

  it('does not let a shorter interval override the first declared spacing', async () => {
    // p-queue exposes no interval getter, so the held spacing is asserted by
    // measurement rather than by reading the queue's internals.
    const queue = getSourceQueue('rule34', 50)
    const sameQueue = getSourceQueue('rule34', 10)
    expect(sameQueue).toBe(queue)

    const starts: number[] = []
    await Promise.all(
      [1, 2].map(() =>
        queue.add(async () => {
          starts.push(Date.now())
        }),
      ),
    )
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(45)
  })

  it('keeps distinct sources on distinct queues', () => {
    const rule34 = getSourceQueue('rule34', 800)
    const e621 = getSourceQueue('e621', 1000)
    expect(rule34).not.toBe(e621)
  })

  it('starts fresh after a reset', () => {
    const before = getSourceQueue('rule34', 800)
    resetSourceQueues()
    expect(getSourceQueue('rule34', 800)).not.toBe(before)
  })
})

describe('cache namespacing', () => {
  // Named regression: searching `solo` on both boards produces an identical
  // key, so an unprefixed key serves Rule34's page labeled as e621's.
  it('named regression: identical queries on two sources get distinct keys', () => {
    expect(cacheKeyFor('rule34', 'tags=solo&page=0')).not.toBe(
      cacheKeyFor('e621', 'tags=solo&page=0'),
    )
  })

  it('includes the source id as a prefix', () => {
    expect(cacheKeyFor('e621', 'k')).toBe('e621:k')
    expect(cacheKeyFor('rule34', 'k')).toBe('rule34:k')
  })

  it('is stable for the same source and key', () => {
    expect(cacheKeyFor('rule34', 'k')).toBe(cacheKeyFor('rule34', 'k'))
  })
})