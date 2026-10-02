<script setup lang="ts">
import { ref } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import ImageCard from './ImageCard.vue'
import { ROOT_MARGIN, SKELETON_COUNT } from '@/config'
import { watchedKey } from '@/stores/watched'
import type { Post } from '@/types'

const props = defineProps<{
  posts: Post[]
  loading: boolean
  hasMore: boolean
  watchedMode: 'show' | 'dim' | 'hide'
  watchedKeys: Set<string>
}>()

const emit = defineEmits<{
  'card-click': [post: Post, all: Post[]]
  'load-more': []
}>()

const sentinelRef = ref<HTMLElement | null>(null)

useIntersectionObserver(
  sentinelRef,
  ([entry]) => {
    if (entry?.isIntersecting && props.hasMore && !props.loading) {
      emit('load-more')
    }
  },
  { rootMargin: ROOT_MARGIN },
)

function handleCardClick(post: Post) {
  emit('card-click', post, props.posts)
}

function isHidden(post: Post): boolean {
  return props.watchedMode === 'hide' && props.watchedKeys.has(watchedKey(post.source, post.id!))
}
</script>

<template>
  <div v-if="loading && posts.length === 0" class="skeleton-grid">
    <div v-for="i in SKELETON_COUNT" :key="i" class="skeleton-card" />
  </div>

  <div v-else-if="!loading && posts.length === 0" class="empty-state">
    <v-icon icon="search_off" size="64" color="grey" class="mb-4" />
    <h3>No results</h3>
    <p>Try different tags or adjust your filters.</p>
  </div>

  <template v-else>
    <div class="image-grid">
      <ImageCard
        v-for="post in posts"
        v-show="!isHidden(post)"
        :key="post.id || post.previewUrl || ''"
        :post="post"
        :watched="watchedKeys.has(watchedKey(post.source, post.id!))"
        :watched-mode="watchedMode"
        @click="handleCardClick(post)"
      />
    </div>

    <div ref="sentinelRef" style="height: 1px" />
    <div v-if="loading" class="d-flex justify-center pa-4">
      <v-progress-circular indeterminate color="primary" />
    </div>
  </template>
</template>

<style scoped>
.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.skeleton-card {
  aspect-ratio: 1;
  border-radius: 12px;
  background: linear-gradient(
    90deg,
    var(--v-surface-variant) 25%,
    var(--v-surface-container-high) 50%,
    var(--v-surface-variant) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

@media (min-width: 640px) {
  .image-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
  }
}

@media (min-width: 1024px) {
  .image-grid {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  text-align: center;
  color: var(--v-theme-on-surface);
}
</style>
