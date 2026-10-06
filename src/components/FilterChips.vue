<script setup lang="ts">
defineProps<{
  activeTags: readonly string[]
  ratings: readonly { label: string; value: string }[]
  activeRatings: readonly string[]
  hasActiveFilters: boolean
}>()

const emit = defineEmits<{
  removeTag: [tag: string]
  toggleRating: [rating: string]
  clear: []
}>()
</script>

<template>
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
      @click:close="emit('removeTag', tag)"
    >
      {{ tag }}
    </v-chip>
  </div>

  <!-- Filter Row: Rating Chips -->
  <div v-if="ratings.length" class="filter-row">
    <v-chip
      v-for="r in ratings"
      :key="r.value"
      size="small"
      :variant="activeRatings.includes(r.value) ? 'flat' : 'outlined'"
      :color="activeRatings.includes(r.value) ? 'secondary' : undefined"
      class="rating-chip"
      @click="emit('toggleRating', r.value)"
    >
      {{ r.label }}
    </v-chip>
    <v-chip
      v-if="hasActiveFilters"
      size="small"
      variant="text"
      class="clear-chip"
      @click="emit('clear')"
    >
      Clear filters
    </v-chip>
  </div>
</template>

<style scoped>
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
</style>
