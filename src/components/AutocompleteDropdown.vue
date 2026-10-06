<script setup lang="ts">
import type { AutocompleteSuggestion } from '@/types'

defineProps<{
  items: readonly AutocompleteSuggestion[]
  activeIndex: number
  failed: boolean
}>()

const emit = defineEmits<{
  pick: [value: string]
}>()

function handleMousedown(e: MouseEvent, value: string) {
  e.preventDefault()
  emit('pick', value)
}
</script>

<template>
  <div v-if="!failed" class="autocomplete-dropdown">
    <div
      v-for="(item, index) in items"
      :key="item.value"
      class="autocomplete-item"
      :class="{ active: index === activeIndex }"
      @mousedown="handleMousedown($event, item.value)"
    >
      <span class="autocomplete-label">{{ item.label }}</span>
      <span
        v-if="item.count !== null"
        class="autocomplete-count"
      >{{ item.count.toLocaleString() }}</span>
    </div>
  </div>
  <div v-else class="autocomplete-dropdown autocomplete-failed">
    <span class="autocomplete-label">Tag suggestions unavailable</span>
  </div>
</template>

<style scoped>
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
</style>
