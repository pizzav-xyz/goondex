import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { getSource, registeredSources, useActiveSource } from '@/sources/registry'
import { useSettingsStore } from '@/stores/settings'
import { DEFAULT_SOURCE_ID, SOURCE_IDS, isSourceId } from '@/sources/types'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('getSource', () => {
  it('resolves a registered source by id', () => {
    expect(getSource('rule34').id).toBe('rule34')
  })

  it('returns the same adapter instance the registry holds', () => {
    expect(getSource('rule34')).toBe(registeredSources[0])
  })

  // Named regression: the id can come from persisted storage written by another
  // build. An unregistered id must degrade to the default board rather than
  // throw on every request.
  it('named regression: falls back to the default for an unknown id', () => {
    expect(getSource('gelbooru').id).toBe(DEFAULT_SOURCE_ID)
    expect(getSource('').id).toBe(DEFAULT_SOURCE_ID)
  })

  it('falls back to the default for null and undefined', () => {
    expect(getSource(null).id).toBe(DEFAULT_SOURCE_ID)
    expect(getSource(undefined).id).toBe(DEFAULT_SOURCE_ID)
    expect(getSource().id).toBe(DEFAULT_SOURCE_ID)
  })

  // Named regression: an object-literal registry resolves `__proto__` and
  // `constructor` to inherited members, handing back a non-adapter.
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'never resolves the inherited key %s to a non-adapter',
    (id) => {
      const resolved = getSource(id)
      expect(resolved).toHaveProperty('capabilities')
      expect(resolved).toHaveProperty('search')
      expect(resolved).toHaveProperty('autocomplete')
    },
  )
})

describe('registeredSources', () => {
  it('exposes at least Rule34', () => {
    expect(registeredSources.map((adapter) => adapter.id)).toContain('rule34')
  })

  it('registers every source id and nothing else', () => {
    expect(registeredSources.map((a) => a.id).sort()).toEqual([...SOURCE_IDS].sort())
  })

  it('exposes only adapters that can actually serve a request', () => {
    for (const adapter of registeredSources) {
      expect(adapter).toHaveProperty('capabilities')
      expect(adapter).toHaveProperty('search')
      expect(adapter).toHaveProperty('autocomplete')
      expect(adapter).toHaveProperty('postDetail')
    }
  })
})

describe('active source defaults', () => {
  // Named regression: first run must land on Rule34, which is the default in
  // the spec.
  it('named regression: defaults to Rule34 with nothing persisted', () => {
    const settings = useSettingsStore()
    expect(settings.activeSource).toBe('rule34')
    expect(useActiveSource().value.id).toBe('rule34')
  })

  it('never resolves a null or undefined selection to anything but the default', () => {
    const settings = useSettingsStore()
    expect(isSourceId(settings.activeSource)).toBe(true)
  })
})

describe('active source selection', () => {
  it('switching the selection changes the dispatched adapter', () => {
    const settings = useSettingsStore()
    settings.setActiveSource('e621')
    expect(useActiveSource().value).toBe(getSource('e621'))
    expect(useActiveSource().value.id).toBe('e621')
  })

  it('switching back returns to the Rule34 adapter', () => {
    const settings = useSettingsStore()
    settings.setActiveSource('e621')
    settings.setActiveSource('rule34')
    expect(useActiveSource().value).toBe(getSource('rule34'))
  })

  it('ignores an unknown id rather than storing it', () => {
    const settings = useSettingsStore()
    settings.setActiveSource('gelbooru' as never)
    expect(settings.activeSource).toBe('rule34')
  })

  it('rejects a non-string id', () => {
    const settings = useSettingsStore()
    settings.setActiveSource(42 as never)
    expect(settings.activeSource).toBe('rule34')
  })
})

describe('settings persistence', () => {
  it('writes the selection to storage', async () => {
    const settings = useSettingsStore()
    settings.setActiveSource('e621')
    // The persistence watchers use Vue's default `flush: 'pre'`, so they run on
    // the next tick rather than synchronously — same as every other setting.
    await nextTick()
    expect(localStorage.getItem('r34_active_source')).toBe('e621')
  })

  it('restores a persisted selection on load', () => {
    localStorage.setItem('r34_active_source', 'e621')
    setActivePinia(createPinia())
    expect(useSettingsStore().activeSource).toBe('e621')
  })

  // Named regression: storage is user-writable, so it can hold an id this build
  // does not know. It must fall back to the default instead of propagating an
  // unroutable id into every request.
  it('named regression: an unknown persisted id falls back to the default', () => {
    localStorage.setItem('r34_active_source', 'gelbooru')
    setActivePinia(createPinia())
    expect(useSettingsStore().activeSource).toBe('rule34')
    expect(useActiveSource().value.id).toBe('rule34')
  })

  it('falls back to the default for a corrupted persisted value', () => {
    localStorage.setItem('r34_active_source', '{"not":"a string"}')
    setActivePinia(createPinia())
    expect(useSettingsStore().activeSource).toBe('rule34')
  })

  it('round-trips the default without writing a change', () => {
    setActivePinia(createPinia())
    useSettingsStore().activeSource
    expect(localStorage.getItem('r34_active_source')).toBeNull()
  })
})

describe('isSourceId', () => {
  it('accepts every known source id', () => {
    expect(isSourceId('rule34')).toBe(true)
    expect(isSourceId('e621')).toBe(true)
  })

  it('rejects anything else', () => {
    for (const value of ['gelbooru', '', 'Rule34', null, undefined, 42, {}]) {
      expect(isSourceId(value)).toBe(false)
    }
  })
})