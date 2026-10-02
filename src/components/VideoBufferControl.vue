<script setup lang="ts">
import { ref, computed } from 'vue'
import { useVideoBuffer } from '@/composables/useVideoBuffer'
import { hasVideoSupport, isVideo } from '@/sources/media'
import { watchedKey } from '@/stores/watched'
import type { Post } from '@/types'

const props = defineProps<{
  /** Total posts currently loaded */
  totalCount: number
  /** All loaded posts for buffering */
  posts: Post[]
  /** Current watched mode */
  watchedMode: 'show' | 'dim' | 'hide'
  /** Set of watched source:id keys */
  watchedKeys: Set<string>
}>()

const { buffering, bufferedCount, bufferVideos, cancelBuffer } = useVideoBuffer()

/** Withheld entirely when the active source serves no video. */
const videoSupported = hasVideoSupport()

/** Number of videos to buffer next */
const bufferCount = ref<string>('20')
const bufferCountNum = computed(() => {
  const n = parseInt(bufferCount.value, 10)
  return isNaN(n) || n < 1 ? 0 : n
})

const videoPostCount = computed(() => props.posts.filter(isVideo).length)
const canBuffer = computed(() => bufferCountNum.value > 0 && videoPostCount.value > 0)

async function handleBuffer() {
  if (buffering.value) {
    cancelBuffer()
  } else {
    // Filter out watched posts when in hide mode
    const toBuffer = props.watchedMode === 'hide'
      ? props.posts.filter(p => !props.watchedKeys.has(watchedKey(p.source, p.id)))
      : props.posts
    await bufferVideos(toBuffer, bufferCountNum.value)
  }
}
</script>

<template>
  <div v-if="videoSupported" class="video-buffer-control">
    <div class="buffer-controls">
      <v-text-field
        v-model="bufferCount"
        label="Buffer next"
        type="number"
        min="1"
        density="comfortable"
        variant="outlined"
        hide-details
        class="buffer-input"
        :disabled="buffering"
      />
      <span class="buffer-label">videos</span>
      <v-btn
        :color="buffering ? 'error' : 'primary'"
        rounded="pill"
        :disabled="!canBuffer"
        :loading="buffering"
        @click="handleBuffer"
      >
        <v-icon start>{{ buffering ? 'stop' : 'wifi' }}</v-icon>
        {{ buffering ? 'Stop' : 'Buffer' }}
      </v-btn>
    </div>

    <div class="buffer-status">
      <div class="status-text">
        <template v-if="buffering">
          Buffering... {{ bufferedCount }} cached
        </template>
        <template v-else-if="bufferedCount > 0">
          {{ totalCount.toLocaleString() }} loaded — {{ bufferedCount }} buffered
        </template>
        <template v-else>
          {{ videoPostCount.toLocaleString() }} videos loaded
        </template>
      </div>
      <v-progress-linear
        v-if="buffering"
        indeterminate
        color="primary"
        height="2"
        class="status-progress"
      />
    </div>
  </div>
</template>

<style scoped>
.video-buffer-control {
  padding: 12px 16px;
  background: rgb(var(--v-theme-surface-container));
  border-radius: 12px;
  margin-bottom: 12px;
}

.buffer-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.buffer-input {
  max-width: 120px;
}

.buffer-label {
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
  white-space: nowrap;
}

.buffer-status {
  margin-top: 8px;
}

.status-text {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
  margin-bottom: 4px;
}

.status-progress {
  margin-top: 4px;
}
</style>
