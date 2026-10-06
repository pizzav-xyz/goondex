import { computed, ref } from 'vue'
import { useActiveSource } from '@/sources/registry'

const RATING_LABELS: Record<string, string> = {
  safe: 'Safe',
  questionable: 'Questionable',
  explicit: 'Explicit',
}

/**
 * Shared tag/rating filter state and pure mutations.
 *
 * Does not emit; the caller emits after invoking a mutator,
 * so the same state can drive any search UI.
 */
export function useSearchFilters() {
  const caps = computed(() => useActiveSource().value.capabilities)

  const activeTags = ref<string[]>([])
  const activeRatings = ref<string[]>([])

  const RATINGS = computed(() =>
    (caps.value.ratingFilter ? caps.value.ratings : []).map((value) => ({
      label: RATING_LABELS[value] ?? value,
      value,
    })),
  )

  const hasActiveFilters = computed(
    () => activeRatings.value.length > 0 || activeTags.value.length > 0,
  )

  function addTag(tag: string) {
    const normalized = tag.trim()
    if (!normalized || activeTags.value.includes(normalized)) return
    activeTags.value.push(normalized)
  }

  function removeTag(tag: string) {
    activeTags.value = activeTags.value.filter((t) => t !== tag)
  }

  function toggleRating(rating: string) {
    const idx = activeRatings.value.indexOf(rating)
    if (idx >= 0) activeRatings.value.splice(idx, 1)
    else activeRatings.value.push(rating)
  }

  function clearAll() {
    activeRatings.value = []
    activeTags.value = []
  }

  return {
    RATINGS,
    activeTags,
    activeRatings,
    hasActiveFilters,
    addTag,
    removeTag,
    toggleRating,
    clearAll,
  }
}
