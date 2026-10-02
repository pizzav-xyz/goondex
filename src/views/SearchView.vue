<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SearchBar from '@/components/SearchBar.vue'
import ImageGrid from '@/components/ImageGrid.vue'
import VideoBufferControl from '@/components/VideoBufferControl.vue'
import Lightbox from '@/components/Lightbox.vue'
import { useAPIClient } from '@/composables/useAPIClient'
import { useLightbox } from '@/composables/useLightbox'
import { useVideoDuration } from '@/composables/useVideoDuration'
import { useVideoBuffer } from '@/composables/useVideoBuffer'
import { PAGE_SIZE } from '@/api/client'
import { useSettingsStore } from '@/stores/settings'
import { useWatchedStore, watchedKey } from '@/stores/watched'
import { parseDurationFilter, stripDurationTags, filterByDuration } from '@/utils/durationFilter'
import type { Post } from '@/types'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const watched = useWatchedStore()

const api = useAPIClient()
const searchBarRef = ref<InstanceType<typeof SearchBar> | null>(null)
const { probing, durationMap, probeDurations } = useVideoDuration()
const { clearBuffer } = useVideoBuffer()

const {
  showLightbox,
  lightboxPost,
  lightboxPosts,
  openLightbox,
  closeLightbox,
  handleLightboxTagClick,
  handleLightboxOpen,
  handleToggleWatch,
  isWatched,
  fetchPostDetails,
} = useLightbox({ api, watched, searchBarRef })

// Search state
const searchTags = ref('')
const searchRatings = ref<string[]>([])
const currentPage = ref(0)
const allPosts = ref<Post[]>([])
const hasDurationFilter = ref(false)
const searchError = ref<string | null>(null)

// Watched state
const watchedMode = computed(() => settings.watchedMode)
const watchedKeys = computed(() => watched.watchedKeys)

/** Whether the API returned a full page (i.e. more pages likely exist). */
const apiHasMore = computed(() => allPosts.value.length >= (currentPage.value + 1) * PAGE_SIZE)

/** Whether to keep fetching: in "hide" mode, fetch until we have enough visible posts. */
const hasMore = computed(() => {
  if (!apiHasMore.value) return false
  if (watchedMode.value !== 'hide') return true
  const visibleCount = allPosts.value.filter(p => !watchedKeys.value.has(watchedKey(p.source, p.id!))).length
  return visibleCount < PAGE_SIZE
})

/** Posts after API fetch but before duration filtering (for probing). */
const rawPosts = ref<Post[]>([])
let activeDurationConditions = parseDurationFilter('')

/** Apply duration filter using the probed duration map. */
function applyDurationFilter() {
  if (!hasDurationFilter.value) return
  allPosts.value = filterByDuration(rawPosts.value, activeDurationConditions, durationMap.value)
}

function applySearchResults(posts: Post[], append: boolean) {
  rawPosts.value = append ? [...rawPosts.value, ...posts] : posts

  if (!hasDurationFilter.value) {
    allPosts.value = rawPosts.value
  } else {
    allPosts.value = append ? [...allPosts.value, ...posts] : posts
    probeDurations(posts).then(() => applyDurationFilter())
  }
}

/** Initialize from URL or dev-persisted state, then trigger initial search */
onMounted(async () => {
  const q = typeof route.query.q === 'string' ? route.query.q : ''
  const r = typeof route.query.ratings === 'string'
    ? route.query.ratings.split(',').filter(Boolean)
    : []

  if (q || r.length) {
    searchTags.value = q
    searchRatings.value = r
    searchBarRef.value?.setTags(q.split(' ').filter(Boolean))
    searchBarRef.value?.setRatings(r)
  } else {
    const saved = settings.getSearchState()
    if (saved) {
      searchTags.value = saved.tags
      searchRatings.value = saved.ratings
      searchBarRef.value?.setTags(saved.tags.split(' ').filter(Boolean))
      searchBarRef.value?.setRatings(saved.ratings)
    }
  }

  // Restore lightbox position (dev mode)
  const savedLightbox = watched.getLightboxPost()
  if (savedLightbox) {
    lightboxPost.value = savedLightbox.post
  }

  // Trigger initial search with restored or empty state
  await doSearch(searchTags.value, searchRatings.value)
})

onUnmounted(() => {
  clearBuffer()
})

/**
 * Search handler: fetches posts, then probes video durations
 * and applies the duration filter once probing completes.
 */
async function doSearch(tags: string, ratings: string[]) {
  searchTags.value = tags
  searchRatings.value = ratings
  currentPage.value = 0
  allPosts.value = []

  // Persist in dev mode
  settings.setSearchState({ tags, ratings })

  // Parse duration conditions and strip them from the API query
  activeDurationConditions = parseDurationFilter(tags)
  hasDurationFilter.value = activeDurationConditions.length > 0
  const apiTags = stripDurationTags(tags)

  // Update URL (keep full tags including duration for shareability)
  router.replace({
    query: {
      ...(tags ? { q: tags } : {}),
      ...(ratings.length ? { ratings: ratings.join(',') } : {}),
    },
  })

  // Fetch first page
  try {
    searchError.value = null
    const posts = await api.search({
      tags: apiTags,
      page: 0,
      ratings,
    })
    applySearchResults(posts, false)
  } catch (err) {
    searchError.value = err instanceof Error ? err.message : 'Search failed'
    console.error('Search failed:', err)
  }
}

/** Load more (infinite scroll) */
async function loadMore() {
  currentPage.value++
  try {
    searchError.value = null
    const apiTags = stripDurationTags(searchTags.value)
    const posts = await api.search({
      tags: apiTags,
      page: currentPage.value,
      ratings: searchRatings.value,
    })
    applySearchResults(posts, true)
  } catch (err) {
    searchError.value = err instanceof Error ? err.message : 'Failed to load more'
    console.error('Load more failed:', err)
    currentPage.value--
  }
}
</script>

<template>
  <div class="search-view">
    <SearchBar
      ref="searchBarRef"
      @search="(params) => doSearch(params.tags, params.ratings)"
    />

    <div class="content">
      <!-- Error state -->
      <v-alert
        v-if="searchError"
        type="error"
        variant="tonal"
        closable
        class="search-error mb-4"
        @click:close="searchError = null"
      >
        {{ searchError }}
      </v-alert>

      <!-- Duration probing indicator -->
      <div v-if="probing" class="duration-probing">
        <v-progress-linear indeterminate color="primary" height="2" />
      </div>

      <VideoBufferControl
        :total-count="allPosts.length"
        :posts="allPosts"
        :watched-mode="watchedMode"
        :watched-keys="watchedKeys"
      />

      <ImageGrid
        :posts="allPosts"
        :loading="allPosts.length === 0 && currentPage === 0"
        :has-more="hasMore"
        :watched-mode="watchedMode"
        :watched-keys="watchedKeys"
        @card-click="openLightbox"
        @load-more="loadMore"
      />
    </div>

    <Lightbox
      v-model="showLightbox"
      :current-post="lightboxPost"
      :posts="lightboxPosts"
      :is-watched="isWatched"
      :watched-mode="watchedMode"
      @close="closeLightbox"
      @fetch-post="fetchPostDetails"
      @open="handleLightboxOpen"
      @tag-click="handleLightboxTagClick"
      @toggle-watch="handleToggleWatch"
    />
  </div>
</template>

<style scoped>
.search-view {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.content {
  flex: 1;
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px;
  width: 100%;
}
.duration-probing {
  max-width: 1200px;
  margin: 0 auto 8px;
}
.search-error {
  max-width: 1200px;
  margin: 0 auto 8px;
}
</style>
