import { ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { AUTOCOMPLETE_DEBOUNCE, AUTOCOMPLETE_MAX_RESULTS } from '@/config'
import type { AutocompleteSuggestion } from '@/types'

export function useAutocomplete(
  fetchSuggestions: (query: string) => Promise<AutocompleteSuggestion[]>,
  getCurrentInput: () => string,
) {
  const items = ref<AutocompleteSuggestion[]>([])
  const visible = ref(false)
  const index = ref(-1)
  const failed = ref(false)

  function hideList(): void {
    items.value = []
    visible.value = false
    index.value = -1
  }

  function dismiss(): void {
    hideList()
    failed.value = false
  }

  const request = useDebounceFn(async (query: string) => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      dismiss()
      return
    }
    try {
      const results = await fetchSuggestions(trimmed)
      if (getCurrentInput().trim() !== trimmed) return
      failed.value = false
      const sliced = results.slice(0, AUTOCOMPLETE_MAX_RESULTS)
      if (!sliced.length) {
        hideList()
        return
      }
      items.value = sliced
      visible.value = true
      index.value = -1
    } catch {
      if (getCurrentInput().trim() !== trimmed) return
      hideList()
      failed.value = true
    }
  }, AUTOCOMPLETE_DEBOUNCE)

  return { items, visible, index, failed, request, dismiss }
}
