<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useVideoBuffer } from '@/composables/useVideoBuffer'
import { canBufferMore as canBufferMoreFn } from '@/composables/useVideoBuffer'
import { hasVideoSupport } from '@/sources/media'
import { watchedKey } from '@/stores/watched'
import { useBufferProgressUI } from '@/composables/useBufferProgress'
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

const { buffering, bufferVideos, cancelBuffer } = useVideoBuffer()

/** Withheld entirely when the active source serves no video. */
const videoSupported = computed(() => hasVideoSupport())

/** Number of videos to buffer next */
const bufferCount = ref<string>('20')
const bufferCountNum = computed(() => {
  const n = parseInt(bufferCount.value, 10)
  return isNaN(n) || n < 1 ? 0 : n
})

const { videoPostCount, bufferPercentage, bufferSegments, bufferedCount } = useBufferProgressUI({
  posts: () => props.posts,
  watchedMode: props.watchedMode,
  watchedKeys: props.watchedKeys,
  totalCount: props.totalCount,
  bufferTarget: bufferCountNum,
})

const canBuffer = computed(() => bufferCountNum.value > 0 && canBufferMoreFn(props.posts))

/** Accessibility: prefers-reduced-motion */
const prefersReducedMotion = ref(false)
let mediaQuery: MediaQueryList | null = null

function updateReducedMotion() {
  if (mediaQuery) {
    prefersReducedMotion.value = mediaQuery.matches
  }
}

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  mediaQuery.addEventListener('change', updateReducedMotion)
  updateReducedMotion()
})

onUnmounted(() => {
  mediaQuery?.removeEventListener('change', updateReducedMotion)
})

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
  <div v-if="videoSupported" class="video-buffer-control" :class="{ 'reduced-motion': prefersReducedMotion }">
    <div class="buffer-header">
      <div class="buffer-title-row">
        <h3 class="buffer-title">Video Buffer</h3>
        <span class="buffer-count-badge" :class="{ 'buffering': buffering }">
          {{ bufferedCount }} / {{ bufferCountNum }}
        </span>
      </div>
      <div class="buffer-percentage" :class="{ 'buffering': buffering }">
        {{ bufferPercentage }}% buffered
      </div>
    </div>

    <!-- Visual Buffer Progress Bar - thin video player style -->
    <div class="buffer-progress-container" role="progressbar" :aria-valuenow="bufferPercentage" aria-valuemin="0" aria-valuemax="100" :aria-label="`Video buffer: ${bufferPercentage} percent`">
      <div class="buffer-progress-track">
        <!-- Buffered segments (loaded chunks) -->
        <div 
          v-for="(segment, segIdx) in bufferSegments" 
          :key="segIdx"
          class="buffer-segment"
          :style="{
            left: `${(segment.start / videoPostCount) * 100}%`,
            width: `${((segment.end - segment.start + 1) / videoPostCount) * 100}%`
          }"
        />
        <!-- Active buffering indicator -->
        <div 
          v-if="buffering" 
          class="buffer-active-indicator"
          :style="{ left: `${bufferPercentage}%` }"
        />
        <!-- Progress fill -->
        <div class="buffer-progress-fill" :style="{ width: `${bufferPercentage}%` }" />
      </div>
    </div>

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
        class="buffer-action-btn"
      >
        <v-icon start>{{ buffering ? 'stop' : 'wifi' }}</v-icon>
        {{ buffering ? 'Stop' : 'Buffer' }}
      </v-btn>
    </div>

    <div class="buffer-status" v-if="!buffering && bufferedCount > 0">
      <div class="status-text">
        {{ totalCount.toLocaleString() }} loaded — {{ bufferedCount }} buffered ({{ bufferPercentage }}%)
      </div>
    </div>
  </div>
</template>

<style scoped>
.video-buffer-control {
  padding: 10px 12px;
  background: rgb(var(--v-theme-surface-container));
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: var(--md-shape-md);
  margin-bottom: 8px;
  transition: border-color var(--md-motion-medium) var(--md-motion-standard);
}

.video-buffer-control:hover {
  border-color: rgb(var(--v-theme-outline));
}

.reduced-motion * {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
}

.buffer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.buffer-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.buffer-title {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
  letter-spacing: 0.1px;
}

.buffer-count-badge {
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent);
  padding: 1px 6px;
  border-radius: var(--md-shape-full);
  transition: all var(--md-motion-fast) var(--md-motion-standard);
}

.buffer-count-badge.buffering {
  color: rgb(var(--v-theme-error));
  background: color-mix(in srgb, rgb(var(--v-theme-error)) 12%, transparent);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.reduced-motion .buffer-count-badge.buffering {
  animation: none;
}

.buffer-percentage {
  font-size: 11px;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface-variant));
  transition: color var(--md-motion-fast) var(--md-motion-standard);
}

.buffer-percentage.buffering {
  color: rgb(var(--v-theme-primary));
}

/* Buffer Progress Bar - thin video player style */
.buffer-progress-container {
  position: relative;
  height: 6px;
  margin: 8px 0 12px;
  border-radius: var(--md-shape-full);
  background: color-mix(in srgb, rgb(var(--v-theme-surface-variant)) 40%, transparent);
  overflow: hidden;
}

.buffer-progress-track {
  position: relative;
  height: 100%;
  border-radius: var(--md-shape-full);
  overflow: hidden;
}

/* Buffered segments - the loaded chunks */
.buffer-segment {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgb(var(--v-theme-primary));
  border-radius: var(--md-shape-full);
  transition: all var(--md-motion-medium) var(--md-motion-emphasized-decel);
}

.reduced-motion .buffer-segment {
  transition: none;
}

/* Active buffering position indicator */
.buffer-active-indicator {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: rgb(var(--v-theme-primary));
  border-radius: 1px;
  box-shadow: 0 0 6px 2px color-mix(in srgb, rgb(var(--v-theme-primary)) 50%, transparent);
  animation: buffering-sweep 1.2s ease-in-out infinite;
  z-index: 2;
}

@keyframes buffering-sweep {
  0% { opacity: 0.5; box-shadow: 0 0 4px 1px rgb(var(--v-theme-primary)); }
  50% { opacity: 1; box-shadow: 0 0 10px 3px rgb(var(--v-theme-primary)); }
  100% { opacity: 0.5; box-shadow: 0 0 4px 1px rgb(var(--v-theme-primary)); }
}

.reduced-motion .buffer-active-indicator {
  animation: none;
  opacity: 0.7;
}

/* Overall progress fill */
.buffer-progress-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, rgb(var(--v-theme-primary)) 20%, transparent)
  );
  border-radius: var(--md-shape-full);
  pointer-events: none;
  transition: width var(--md-motion-medium) var(--md-motion-emphasized-decel);
}

.reduced-motion .buffer-progress-fill {
  transition: none;
}

.buffer-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.buffer-input {
  max-width: 100px;
  min-width: 80px;
}

.buffer-label {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.buffer-action-btn {
  height: 32px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0.2px;
  font-size: 12px;
  transition: all var(--md-motion-fast) var(--md-motion-standard);
}

.buffer-action-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--md-elevation-1);
}

.buffer-action-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: var(--md-elevation-0);
}

.reduced-motion .buffer-action-btn:hover:not(:disabled) {
  transform: none;
}

.buffer-status {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid color-mix(in srgb, rgb(var(--v-theme-outline-variant)) 30%, transparent);
}

.status-text {
  font-size: 11px;
  color: rgb(var(--v-theme-on-surface-variant));
  line-height: 1.4;
}

/* Loading state enhancement */
.video-buffer-control:has(.buffer-action-btn[v-loading]) {
  background: color-mix(in srgb, rgb(var(--v-theme-primary-container)) 20%, rgb(var(--v-theme-surface-container)));
}
</style>