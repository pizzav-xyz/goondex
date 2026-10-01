import { ofetch } from 'ofetch'
import PQueue from 'p-queue'
import type { SourceId } from '@/sources/types'
import { API_TIMEOUT, RETRY_COUNT } from '@/config'

/**
 * Request primitives shared by every source adapter: per-source spacing,
 * timeout, retry, and a cache-key namespace.
 *
 * These exist so an adapter declares *what* it needs and inherits *how* to
 * space it, rather than each adapter reimplementing a request queue. Rule 1
 * of the repo rules forbids hand-rolled work when a maintained library solves
 * it, and hand-rolled spacing is exactly the case where a subtle bug is
 * invisible in testing and only shows up as a 429 cliff in production.
 */

/**
 * One queue per source, memoized.
 *
 * Memoized per source rather than per adapter instance on purpose: spacing is
 * a property of the *upstream*, not of the caller. Two adapters pointed at
 * Rule34 must share one queue, or a search racing a post-detail request would
 * halve the effective interval and land right back on the 429 cliff.
 */
const queuesBySource = new Map<SourceId, PQueue>()

/**
 * Builds a strictly serialized queue with a guaranteed minimum gap between
 * request starts.
 *
 * `intervalCap: 1` with `interval` alone is *not* sufficient — it permits a
 * burst at each window boundary, which is precisely how a "1 req/s" limit gets
 * exceeded in practice. `carryoverIntervalCount: true` is what makes the cap
 * hold across window edges, so the effective rate is a rolling
 * 1-request-per-interval rather than a fixed-window burst.
 */
function createQueue(minIntervalMs: number): PQueue {
  return new PQueue({
    concurrency: 1,
    intervalCap: 1,
    interval: minIntervalMs,
    carryoverIntervalCount: true,
  })
}

/** Returns the shared spacing queue for a source, creating it on first use. */
export function getSourceQueue(sourceId: SourceId, minIntervalMs: number): PQueue {
  const existing = queuesBySource.get(sourceId)
  if (existing) return existing

  const queue = createQueue(minIntervalMs)
  queuesBySource.set(sourceId, queue)
  return queue
}

/**
 * A fetch instance bound to the proxy with the shared timeout and retry
 * defaults. Adapters override `timeout` per call where a source needs longer
 * (media probing) rather than constructing their own ofetch instance.
 */
export function createSourceFetch(): typeof ofetch {
  return ofetch.create({
    baseURL: '/api',
    retry: RETRY_COUNT,
    timeout: API_TIMEOUT,
  })
}

/**
 * Namespaces a cache key by source so two sources cannot collide on an
 * identical-looking key. Without this, searching `solo` on Rule34 and then on
 * e621 returns Rule34's cached page labeled as e621's.
 */
export function cacheKeyFor(sourceId: SourceId, key: string): string {
  return `${sourceId}:${key}`
}

/** Test-only: drops memoized queues so a test can observe a fresh interval. */
export function resetSourceQueues(): void {
  queuesBySource.clear()
}