import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useWatchedStore } from '@/stores/watched'

/**
 * Focused on the write path only. The store's own suite already covers load and
 * migration; what it did not cover is whether an entry added through the public
 * API actually reaches localStorage, which is the failure a user would report as
 * "my watchlist keeps forgetting itself".
 */
describe('watchlist persistence on write', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  const stored = (): { source?: string; id: number }[] =>
    JSON.parse(localStorage.getItem('r34_watched') ?? '[]') as { source?: string; id: number }[]

  it('writes an added entry to storage, not just to memory', async () => {
    const store = useWatchedStore()
    store.addWatched('rule34', 123)
    await nextTick()

    expect(store.isWatched('rule34', 123)).toBe(true)
    expect(stored()).toEqual([{ source: 'rule34', id: 123, at: expect.any(Number) }])
  })

  it('persists entries added on two different sources', async () => {
    const store = useWatchedStore()
    store.addWatched('rule34', 1)
    store.addWatched('e621', 1)
    await nextTick()

    expect(stored()).toHaveLength(2)
    expect(stored().map((e) => e.source).sort()).toEqual(['e621', 'rule34'])
  })

  it('persists a removal', async () => {
    const store = useWatchedStore()
    store.addWatched('rule34', 1)
    store.removeWatched('rule34', 1)
    await nextTick()

    expect(stored()).toEqual([])
  })

  it('persists a toggle in both directions', async () => {
    const store = useWatchedStore()
    store.toggleWatched('e621', 9)
    await nextTick()
    expect(stored()).toHaveLength(1)

    store.toggleWatched('e621', 9)
    await nextTick()
    expect(stored()).toEqual([])
  })
})