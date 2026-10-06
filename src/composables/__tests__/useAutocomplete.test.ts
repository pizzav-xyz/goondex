import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTOCOMPLETE_MAX_RESULTS } from '@/config'
import { useAutocomplete } from '@/composables/useAutocomplete'
import type { AutocompleteSuggestion } from '@/types'

const solo: AutocompleteSuggestion = { label: 'solo', value: 'solo', count: 5 }

function setup(
  fetchImpl: (query: string) => Promise<AutocompleteSuggestion[]>,
  input = 'solo',
) {
  let current = input
  const ac = useAutocomplete(fetchImpl, () => current)
  const setInput = (value: string): void => {
    current = value
  }
  return { ...ac, setInput }
}

describe('useAutocomplete success and failure states', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('shows suggestions on success', async () => {
    const ac = setup(async () => [solo])
    ac.request('solo')
    await vi.advanceTimersByTimeAsync(400)
    expect(ac.items.value).toHaveLength(1)
    expect(ac.visible.value).toBe(true)
    expect(ac.failed.value).toBe(false)
    vi.useRealTimers()
  })

  it('marks a rejected request as failed with no items', async () => {
    const ac = setup(async () => {
      throw new Error('network down')
    })
    ac.request('solo')
    await vi.advanceTimersByTimeAsync(400)
    expect(ac.items.value).toEqual([])
    expect(ac.visible.value).toBe(false)
    expect(ac.failed.value).toBe(true)
    vi.useRealTimers()
  })

  it('treats a timeout rejection as failed, not empty', async () => {
    const ac = setup(async () => {
      throw new Error('timeout of 15000ms exceeded')
    })
    ac.request('solo')
    await vi.advanceTimersByTimeAsync(400)
    expect(ac.failed.value).toBe(true)
    expect(ac.items.value).toEqual([])
    expect(ac.visible.value).toBe(false)
    vi.useRealTimers()
  })

  it('keeps an empty success distinct from failure', async () => {
    const ac = setup(async () => [], 'zzznotatag')
    ac.request('zzznotatag')
    await vi.advanceTimersByTimeAsync(400)
    expect(ac.items.value).toEqual([])
    expect(ac.visible.value).toBe(false)
    expect(ac.failed.value).toBe(false)
    vi.useRealTimers()
  })

  it('caps suggestions at the configured maximum', async () => {
    const many: AutocompleteSuggestion[] = Array.from({ length: 40 }, (_, i) => ({
      label: `t${i}`,
      value: `t${i}`,
      count: null,
    }))
    const ac = setup(async () => many, 'test')
    ac.request('test')
    await vi.advanceTimersByTimeAsync(400)
    expect(ac.items.value).toHaveLength(AUTOCOMPLETE_MAX_RESULTS)
    expect(ac.visible.value).toBe(true)
    expect(ac.failed.value).toBe(false)
    vi.useRealTimers()
  })

  it('clears prior items on a successful empty response', async () => {
    let calls = 0
    const ac = setup(async () => {
      calls += 1
      return calls === 1 ? [solo] : []
    })
    ac.request('solo')
    await vi.advanceTimersByTimeAsync(400)
    expect(ac.items.value).toHaveLength(1)
    expect(ac.visible.value).toBe(true)
    ac.setInput('solox')
    ac.request('solox')
    await vi.advanceTimersByTimeAsync(400)
    expect(ac.items.value).toEqual([])
    expect(ac.visible.value).toBe(false)
    expect(ac.failed.value).toBe(false)
    vi.useRealTimers()
  })
})

describe('useAutocomplete stale-state clearing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('clears items and the failure flag on short input', async () => {
    const ac = setup(async () => {
      throw new Error('network down')
    })
    ac.request('solo')
    await vi.advanceTimersByTimeAsync(400)
    expect(ac.failed.value).toBe(true)
    ac.request('s')
    await vi.advanceTimersByTimeAsync(400)
    expect(ac.items.value).toEqual([])
    expect(ac.visible.value).toBe(false)
    expect(ac.failed.value).toBe(false)
    vi.useRealTimers()
  })

  it('clears items on empty success after a failure', async () => {
    let calls = 0
    const ac = setup(async () => {
      calls += 1
      if (calls === 1) throw new Error('HTTP 500')
      return []
    })
    ac.request('solo')
    await vi.advanceTimersByTimeAsync(400)
    expect(ac.failed.value).toBe(true)
    ac.request('solo')
    await vi.advanceTimersByTimeAsync(400)
    expect(ac.items.value).toEqual([])
    expect(ac.visible.value).toBe(false)
    expect(ac.failed.value).toBe(false)
    vi.useRealTimers()
  })

  it('ignores a stale response after the input changed', async () => {
    const ac = setup(async (query: string) => {
      if (query === 'solo') {
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
        return [solo]
      }
      return []
    }, 'solo')
    const pending = ac.request('solo')
    ac.setInput('solox')
    ac.request('solox')
    await vi.advanceTimersByTimeAsync(600)
    await pending
    expect(ac.items.value).toEqual([])
    expect(ac.visible.value).toBe(false)
    expect(ac.failed.value).toBe(false)
    vi.useRealTimers()
  })

  it('ignores a stale failure after the input changed', async () => {
    const ac = setup(async (query: string) => {
      if (query === 'solo') throw new Error('network down')
      return []
    }, 'solo')
    const pending = ac.request('solo')
    ac.setInput('solox')
    ac.request('solox')
    await vi.advanceTimersByTimeAsync(600)
    await pending
    expect(ac.failed.value).toBe(false)
    expect(ac.items.value).toEqual([])
    expect(ac.visible.value).toBe(false)
    vi.useRealTimers()
  })

  it('dismiss resets the list and the failure flag together', async () => {
    const ac = setup(async () => {
      throw new Error('network down')
    })
    ac.request('solo')
    await vi.advanceTimersByTimeAsync(400)
    expect(ac.failed.value).toBe(true)
    ac.dismiss()
    expect(ac.items.value).toEqual([])
    expect(ac.visible.value).toBe(false)
    expect(ac.failed.value).toBe(false)
    vi.useRealTimers()
  })
})
