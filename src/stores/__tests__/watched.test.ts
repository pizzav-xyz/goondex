import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useWatchedStore } from '@/stores/watched'

/**
 * The literal key, not the store's exported constant. The goondex rename
 * deliberately left `r34_watched` unchanged so existing users keep their
 * watchlist; these tests are what fail if a future "cleanup" renames the key
 * and silently discards the one piece of user data that cannot be rebuilt.
 */
const KEY = 'r34_watched'

describe('watched store source scoping', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('migrates a legacy number[] payload to the default source', () => {
    localStorage.setItem(KEY, JSON.stringify([123, 456]))

    const watched = useWatchedStore()

    expect(watched.watched).toMatchObject([
      { source: 'rule34', id: 123 },
      { source: 'rule34', id: 456 },
    ])
    expect(watched.watchedKeys.has('rule34:123')).toBe(true)
    expect(watched.watchedKeys.has('rule34:456')).toBe(true)
    expect(watched.isWatched('rule34', 123)).toBe(true)
    expect(watched.isWatched('e621', 123)).toBe(false)
  })

  it('attributes identifier-only entries to the default source without losing them', () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 5, at: 1700000000 }]))

    const watched = useWatchedStore()

    expect(watched.watched).toEqual([{ source: 'rule34', id: 5, at: 1700000000 }])
  })

  it('leaves already-scoped entries untouched on re-migration, preserving timestamps', () => {
    const payload = [
      { source: 'rule34', id: 1, at: 1700000001 },
      { source: 'e621', id: 2, at: 1700000002 },
    ]
    localStorage.setItem(KEY, JSON.stringify(payload))

    const watched = useWatchedStore()

    expect(watched.watched).toEqual(payload)
  })

  it('treats the same numeric id on different sources as distinct entries', async () => {
    const watched = useWatchedStore()

    watched.addWatched('rule34', 1)
    watched.addWatched('e621', 1)
    await nextTick()

    expect(watched.isWatched('rule34', 1)).toBe(true)
    expect(watched.isWatched('e621', 1)).toBe(true)
    expect(watched.watchedKeys.has('rule34:1')).toBe(true)
    expect(watched.watchedKeys.has('e621:1')).toBe(true)

    watched.removeWatched('rule34', 1)
    expect(watched.isWatched('rule34', 1)).toBe(false)
    expect(watched.isWatched('e621', 1)).toBe(true)
  })

  it('retains source attribution across a persist/load round trip', async () => {
    const watched = useWatchedStore()
    watched.addWatched('e621', 42)
    watched.addWatched('rule34', 7)
    await nextTick()

    const raw = localStorage.getItem(KEY)
    expect(raw).toContain('"source":"e621"')
    expect(raw).toContain('"source":"rule34"')

    // Simulate a reload: a fresh store must read back the same scoped entries.
    setActivePinia(createPinia())
    const reloaded = useWatchedStore()
    expect(reloaded.isWatched('e621', 42)).toBe(true)
    expect(reloaded.isWatched('rule34', 7)).toBe(true)
    expect(reloaded.watchedKeys.has('e621:42')).toBe(true)
    expect(reloaded.watchedKeys.has('rule34:7')).toBe(true)
  })

  it('regression: a corrupt payload is not wiped by a subsequent write', async () => {
    const corrupt = '{corrupt json'
    localStorage.setItem(KEY, corrupt)

    const watched = useWatchedStore()
    expect(watched.watched).toEqual([])

    watched.addWatched('rule34', 99)
    await nextTick()

    expect(localStorage.getItem(KEY)).toBe(corrupt)
  })

  it('regression: a non-array payload is not wiped by a subsequent write', async () => {
    const corrupt = '{"foo":1}'
    localStorage.setItem(KEY, corrupt)

    const watched = useWatchedStore()
    expect(watched.watched).toEqual([])

    watched.addWatched('e621', 99)
    await nextTick()

    expect(localStorage.getItem(KEY)).toBe(corrupt)
  })
})
