<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAPIClient } from '@/composables/useAPIClient'
import { useAutocomplete } from '@/composables/useAutocomplete'
import { useSearchFilters } from '@/composables/useSearchFilters'
import SyntaxHelp from './SyntaxHelp.vue'
import AutocompleteDropdown from './AutocompleteDropdown.vue'
import FilterChips from './FilterChips.vue'

const emit = defineEmits<{
  search: [params: { tags: string; ratings: string[] }]
}>()

const searchInput = ref('')
const showSyntaxHelp = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const api = useAPIClient()

const {
  items: autocompleteItems,
  visible: showAutocomplete,
  index: acIndex,
  failed: acFailed,
  request: fetchAutocomplete,
  dismiss: resetAutocomplete,
} = useAutocomplete(
  (query: string) => api.autocomplete(query),
  () => searchInput.value,
)

const {
  activeTags,
  activeRatings,
  RATINGS,
  hasActiveFilters,
  addTag,
  removeTag,
  toggleRating,
  clearAll,
} = useSearchFilters()

// Debounced autocomplete fetch
watch(searchInput, (val) => fetchAutocomplete(val))

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
  resetAutocomplete()
  emit('search', {
    tags: activeTags.value.join(' '),
    ratings: [...activeRatings.value],
  })
}

function pickTag(tag: string) {
  const normalized = tag.trim()
  if (!normalized || activeTags.value.includes(normalized)) {
    searchInput.value = ''
    resetAutocomplete()
    return
  }
  activeTags.value.push(normalized)
  searchInput.value = ''
  resetAutocomplete()
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
    resetAutocomplete()
  }
}

function updateInputFromAc() {
  if (acIndex.value >= 0 && autocompleteItems.value[acIndex.value]) {
    searchInput.value = autocompleteItems.value[acIndex.value].value
  }
}

function handleBlur() {
  setTimeout(() => {
    resetAutocomplete()
  }, 200)
}

// Expose for parent (lightbox tag click, URL/dev-state restore)
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
        <AutocompleteDropdown
          v-if="showAutocomplete && autocompleteItems.length"
          :items="autocompleteItems"
          :active-index="acIndex"
          :failed="false"
          @pick="pickTag"
        />
        <AutocompleteDropdown
          v-else-if="acFailed"
          :items="[]"
          :active-index="-1"
          :failed="true"
          @pick="pickTag"
        />
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

    <FilterChips
      :active-tags="activeTags"
      :ratings="RATINGS"
      :active-ratings="activeRatings"
      :has-active-filters="hasActiveFilters"
      @remove-tag="removeTag"
      @toggle-rating="toggleRating"
      @clear="clearAll"
    />

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
