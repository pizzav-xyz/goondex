<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useAPIClient } from '@/composables/useAPIClient'
import { useActiveSource } from '@/sources/registry'
import { AUTOCOMPLETE_DEBOUNCE, AUTOCOMPLETE_MAX_RESULTS } from '@/config'
import SyntaxHelp from './SyntaxHelp.vue'
import type { AutocompleteSuggestion } from '@/types'

const emit = defineEmits<{
  search: [params: { tags: string; ratings: string[] }]
}>()

const searchInput = ref('')
const activeTags = ref<string[]>([])
const activeRatings = ref<string[]>([])
const showSyntaxHelp = ref(false)
const autocompleteItems = ref<AutocompleteSuggestion[]>([])
const showAutocomplete = ref(false)
const acIndex = ref(-1)
const acFailed = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const dropdownRef = ref<HTMLDivElement | null>(null)
const api = useAPIClient()
const caps = computed(() => useActiveSource().value.capabilities)

const RATING_LABELS: Record<string, string> = {
  safe: 'Safe',
  questionable: 'Questionable',
  explicit: 'Explicit',
}

/** Only ratings the active adapter can actually express are offered. */
const RATINGS = computed(() =>
  (caps.value.ratingFilter ? caps.value.ratings : []).map((value) => ({
    label: RATING_LABELS[value] ?? value,
    value,
  })),
)

const hasActiveFilters = computed(() => activeRatings.value.length > 0 || activeTags.value.length > 0)

// Debounced autocomplete fetch
const fetchAutocomplete = useDebounceFn(async (query: string) => {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length < 2) {
    autocompleteItems.value = []
    showAutocomplete.value = false
    acFailed.value = false
    return
  }

  try {
    const results = await api.autocomplete(trimmedQuery)
    if (searchInput.value.trim() !== trimmedQuery) return

    const sliced = results.slice(0, AUTOCOMPLETE_MAX_RESULTS)
    acFailed.value = false
    if (!sliced.length) {
      showAutocomplete.value = false
      return
    }

    autocompleteItems.value = sliced
    showAutocomplete.value = true
    acIndex.value = -1
  } catch {
    // A failed request is reported distinctly from zero matches: showing no
    // dropdown here would read as "this tag does not exist".
    autocompleteItems.value = []
    showAutocomplete.value = false
    acFailed.value = true
  }
}, AUTOCOMPLETE_DEBOUNCE)

watch(searchInput, (val) => fetchAutocomplete(val))

function addTag(tag: string) {
  const normalized = tag.trim()
  if (!normalized || activeTags.value.includes(normalized)) return
  activeTags.value.push(normalized)
}

function removeTag(tag: string) {
  activeTags.value = activeTags.value.filter((t) => t !== tag)
  submitSearch()
}

function toggleRating(rating: string) {
  const idx = activeRatings.value.indexOf(rating)
  if (idx >= 0) activeRatings.value.splice(idx, 1)
  else activeRatings.value.push(rating)
  submitSearch()
}

function pickTag(tag: string) {
  const normalized = tag.trim()
  if (!normalized || activeTags.value.includes(normalized)) {
    searchInput.value = ''
    showAutocomplete.value = false
    return
  }
  activeTags.value.push(normalized)
  searchInput.value = ''
  showAutocomplete.value = false
  acIndex.value = -1
  submitSearch()
}

function submitSearch() {
  const manual = searchInput.value.trim()
  if (manual) {
    const tokens = manual.split(/\s+/).filter(Boolean)
    for (const token of tokens) {
      if (!activeTags.value.includes(token)) {
        activeTags.value.push(token)
      }
    }
  }
  searchInput.value = ''
  emit('search', {
    tags: activeTags.value.join(' '),
    ratings: [...activeRatings.value],
  })
}

function clearAll() {
  activeRatings.value = []
  activeTags.value = []
  submitSearch()
}

function addTagAndSearch(tag: string) {
  addTag(tag)
  submitSearch()
}

function handleKeydown(e: KeyboardEvent) {
  if (!showAutocomplete.value || !autocompleteItems.value.length) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitSearch()
    }
    return
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    acIndex.value = Math.min(acIndex.value + 1, autocompleteItems.value.length - 1)
    updateInputFromAc()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    acIndex.value = Math.max(acIndex.value - 1, -1)
    updateInputFromAc()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (acIndex.value >= 0 && autocompleteItems.value[acIndex.value]) {
      pickTag(autocompleteItems.value[acIndex.value].value)
    } else {
      submitSearch()
    }
  } else if (e.key === 'Escape') {
    showAutocomplete.value = false
    acIndex.value = -1
  }
}

function updateInputFromAc() {
  if (acIndex.value >= 0 && autocompleteItems.value[acIndex.value]) {
    searchInput.value = autocompleteItems.value[acIndex.value].value
  }
}

function handleBlur() {
  setTimeout(() => {
    showAutocomplete.value = false
    acIndex.value = -1
  }, 200)
}

function handleMousedown(e: MouseEvent, tag: string) {
  e.preventDefault()
  pickTag(tag)
}

// Expose for parent (lightbox tag click)
defineExpose({
  addTagAndSearch,
  setTags(tags: string[]) {
    activeTags.value = Array.isArray(tags)
      ? [...new Set(tags.map((t) => String(t || '').trim()).filter(Boolean))]
      : []
  },
  setRatings(ratings: string[]) {
    activeRatings.value = Array.isArray(ratings) ? [...ratings] : []
  },
})
</script>

<template>
  <div class="search-container">
    <!-- Search Bar -->
    <div class="search-bar">
      <div class="search-input-wrap">
        <v-icon icon="search" size="20" class="search-icon" />
        <input
          ref="inputRef"
          v-model="searchInput"
          type="text"
          class="search-input"
          placeholder="Search tags..."
          autocomplete="off"
          spellcheck="false"
          @keydown="handleKeydown"
          @blur="handleBlur"
        />
        <!-- Autocomplete Dropdown -->
        <div
          v-if="showAutocomplete && autocompleteItems.length"
          ref="dropdownRef"
          class="autocomplete-dropdown"
        >
          <div
            v-for="(item, index) in autocompleteItems"
            :key="item.value"
            class="autocomplete-item"
            :class="{ active: index === acIndex }"
            @mousedown="handleMousedown($event, item.value)"
          >
            <span class="autocomplete-label">{{ item.label }}</span>
            <span
              v-if="item.count !== null"
              class="autocomplete-count"
            >{{ item.count.toLocaleString() }}</span>
          </div>
        </div>
        <div
          v-else-if="acFailed"
          class="autocomplete-dropdown autocomplete-failed"
        >
          <span class="autocomplete-label">Tag suggestions unavailable</span>
        </div>
      </div>
      <v-btn
        color="primary"
        rounded="pill"
        class="search-btn"
        @click="submitSearch"
      >
        Search
      </v-btn>
      <v-btn
        icon="help"
        variant="text"
        size="small"
        class="search-help-btn"
        aria-label="Search syntax help"
        title="Search syntax help"
        @click="showSyntaxHelp = !showSyntaxHelp"
      />
    </div>

    <!-- Active Tags -->
    <div v-if="activeTags.length" class="active-tags">
      <v-chip
        v-for="tag in activeTags"
        :key="tag"
        size="small"
        color="primary"
        variant="flat"
        closable
        class="tag-chip"
        @click:close="removeTag(tag)"
      >
        {{ tag }}
      </v-chip>
    </div>

    <!-- Filter Row: Rating Chips -->
    <div v-if="RATINGS.length" class="filter-row">
      <v-chip
        v-for="r in RATINGS"
        :key="r.value"
        size="small"
        :variant="activeRatings.includes(r.value) ? 'flat' : 'outlined'"
        :color="activeRatings.includes(r.value) ? 'secondary' : undefined"
        class="rating-chip"
        @click="toggleRating(r.value)"
      >
        {{ r.label }}
      </v-chip>
      <v-chip
        v-if="hasActiveFilters"
        size="small"
        variant="text"
        class="clear-chip"
        @click="clearAll"
      >
        Clear filters
      </v-chip>
    </div>

    <!-- Syntax Help Panel -->
    <SyntaxHelp v-if="showSyntaxHelp" @tag-click="addTagAndSearch" />
  </div>
</template>

<style scoped>
/* ── Search Container ────────────────────────── */
.search-container {
  padding: 12px 16px;
  background: var(--md-surface);
  border-bottom: 1px solid var(--md-outline-variant);
}

.search-bar {
  display: flex;
  gap: 12px;
  max-width: 1200px;
  margin: 0 auto;
  align-items: center;
}

.search-input-wrap {
  flex: 1;
  position: relative;
}

.search-input {
  width: 100%;
  height: 48px;
  padding: 0 16px 0 48px;
  border: 1px solid var(--md-outline);
  border-radius: var(--md-shape-full);
  background: var(--md-surface-container-highest);
  color: var(--md-on-surface);
  font: inherit;
  font-size: 16px;
  transition: border-color var(--md-motion-fast) var(--md-motion-standard),
              box-shadow var(--md-motion-fast) var(--md-motion-standard);
}

.search-input:focus {
  outline: none;
  border-color: var(--md-primary);
  box-shadow: var(--md-focus-ring);
}

.search-input::placeholder {
  color: var(--md-on-surface-variant);
}

.search-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--md-on-surface-variant);
  pointer-events: none;
}

.search-btn {
  height: 48px !important;
  padding: 0 24px !important;
}

.search-help-btn {
  flex-shrink: 0;
}

/* ── Autocomplete ─────────────────────────────── */
.autocomplete-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 200;
  background: var(--md-surface-container);
  border: 1px solid var(--md-outline-variant);
  border-radius: var(--md-shape-md);
  box-shadow: var(--md-elevation-2);
  max-height: 320px;
  overflow-y: auto;
}

.autocomplete-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background var(--md-motion-fast) var(--md-motion-standard);
}

.autocomplete-item:hover,
.autocomplete-item.active {
  background: var(--md-surface-container-high);
}

.autocomplete-failed {
  padding: 12px 16px;
}

.autocomplete-failed .autocomplete-label {
  color: var(--md-on-surface-variant);
  font-size: 13px;
}

.autocomplete-label {
  flex: 1;
  color: var(--md-on-surface);
  font-size: 14px;
}

.autocomplete-count {
  color: var(--md-on-surface-variant);
  font-size: 12px;
}

/* ── Filter Row & Chips ───────────────────────── */
.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  max-width: 1200px;
  margin-inline: auto;
}

.clear-chip {
  font-size: 13px;
  text-transform: none;
}

/* ── Active Tags ──────────────────────────────── */
.active-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  max-width: 1200px;
  margin-inline: auto;
}

.tag-chip {
  font-size: 12px;
}

/* ── Responsive ───────────────────────────────── */
@media (max-width: 639px) {
  .search-bar {
    flex-direction: column;
  }

  .search-btn {
    width: 100%;
  }
}
</style>
