<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useVideoBuffer } from '@/composables/useVideoBuffer'
import type { Post } from '@/types'

const { getBufferedUrl } = useVideoBuffer()

const props = defineProps<{
  modelValue: boolean
  currentPost: Post | null
  posts: Post[]
  isWatched: (post: Post) => boolean
  watchedMode: 'show' | 'dim' | 'hide'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'fetch-post': [id: number]
  'open': [post: Post]
  'close': [playbackTime: number | null]
  'tag-click': [tag: string]
  'toggle-watch': [post: Post]
}>()

const showInfo = ref(false)
const videoRef = ref<HTMLVideoElement | null>(null)

const post = computed(() => props.currentPost)
const skipWatched = computed(() => props.watchedMode === 'hide')
const index = computed(() => {
  if (!post.value) return -1
  return props.posts.findIndex(p => p.id === post.value!.id)
})

// Find the next valid index in a direction, skipping watched when applicable
function findNavEdge(dir: number): number {
  let idx = index.value + dir
  if (skipWatched.value) {
    while (idx >= 0 && idx < props.posts.length && props.isWatched(props.posts[idx]!)) {
      idx += dir
    }
  }
  return idx
}

const prevDisabled = computed(() => findNavEdge(-1) < 0)
const nextDisabled = computed(() => findNavEdge(1) >= props.posts.length)

const navigableIndex = computed(() => {
  if (!skipWatched.value || index.value < 0) return index.value
  let count = 0
  for (let i = 0; i < index.value; i++) {
    if (!props.isWatched(props.posts[i]!)) count++
  }
  return count
})
const navigableTotal = computed(() => {
  if (!skipWatched.value) return props.posts.length
  return props.posts.filter(p => !props.isWatched(p)).length
})
const isVideo = computed(() => post.value?.fileExt === 'webm' || post.value?.fileExt === 'mp4')
const mediaUrl = computed(() => {
  if (!post.value) return ''
  if (isVideo.value) {
    // Prefer cached blob URL for instant playback
    const cached = getBufferedUrl(post.value)
    if (cached) return cached
    return post.value.fileUrl || post.value.sampleUrl
  }
  return post.value.fileUrl || post.value.sampleUrl || post.value.previewUrl
})
const aspectRatio = computed(() => {
  if (!post.value || !post.value.width || !post.value.height) return 1
  return post.value.width / post.value.height
})
const mediaStyle = computed(() => {
  const r = aspectRatio.value
  if (r < 0.3) {
    return { width: 'min(40vw, 400px)', height: 'auto', maxHeight: 'none' }
  }
  if (r > 3) {
    return { height: 'min(50vh, 400px)', width: 'auto', maxWidth: '100%' }
  }
  return { maxHeight: '85vh', maxWidth: '100%' }
})
const tags = computed(() => post.value?.tags ?? [])
const watched = computed(() => post.value ? props.isWatched(post.value) : false)
const meta = computed(() => {
  if (!post.value) return []
  const items: Array<{ label: string; value: string; domain?: string }> = []
  if (post.value.score != null) items.push({ label: 'Score', value: String(post.value.score) })
  if (post.value.rating) items.push({ label: 'Rating', value: post.value.rating })
  if (post.value.sourceUrl) {
    let url = post.value.sourceUrl
    if (!/^https?:\/\//.test(url)) url = 'https://' + url
    let domain = ''
    try { domain = new URL(url).hostname } catch {}
    items.push({ label: 'Source', value: url, domain })
  }
  return items
})

function getVideoTime(): number | null {
  return videoRef.value ? videoRef.value.currentTime : null
}

function pauseVideo() {
  if (videoRef.value) videoRef.value.pause()
}

function close() {
  const time = getVideoTime()
  pauseVideo()
  emit('close', time)
  emit('update:modelValue', false)
}

function nav(dir: number) {
  const nextIdx = findNavEdge(dir)
  if (nextIdx >= 0 && nextIdx < props.posts.length) {
    pauseVideo()
    emit('open', props.posts[nextIdx])
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
  if (e.key === 'ArrowLeft') nav(-1)
  if (e.key === 'ArrowRight') nav(1)
}

function onTagClick(tag: string) {
  close()
  emit('tag-click', tag)
}

watch(() => props.modelValue, (open) => {
  if (open) {
    document.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
    if (post.value) emit('fetch-post', post.value.id!)
  } else {
    document.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="lightbox">
      <div v-if="modelValue && post" class="lightbox">
        <div class="lightbox-header">
          <span class="lightbox-counter">{{ navigableIndex + 1 }} / {{ navigableTotal }}</span>
          <div class="lightbox-nav">
            <v-btn icon variant="text" :disabled="prevDisabled" size="small" @click="nav(-1)">
              <v-icon>chevron_left</v-icon>
            </v-btn>
            <v-btn icon variant="text" :disabled="nextDisabled" size="small" @click="nav(1)">
              <v-icon>chevron_right</v-icon>
            </v-btn>
            <v-btn icon variant="text" size="small" @click="showInfo = !showInfo">
              <v-icon>{{ showInfo ? 'info_i' : 'info' }}</v-icon>
            </v-btn>
            <v-btn icon variant="text" size="small" @click="emit('toggle-watch', post)">
              <v-icon>{{ watched ? 'visibility' : 'visibility_off' }}</v-icon>
            </v-btn>
            <v-btn icon variant="text" size="small" @click="close">
              <v-icon>close</v-icon>
            </v-btn>
          </div>
        </div>

        <div class="lightbox-body" @click.self="close">
          <button class="lightbox-nav-btn prev" :disabled="prevDisabled" @click="nav(-1)">
            <v-icon>chevron_left</v-icon>
          </button>

          <video v-if="isVideo" ref="videoRef" class="lightbox-media" controls autoplay loop playsinline :src="mediaUrl ?? ''" :style="mediaStyle" />
          <img v-else class="lightbox-media" :src="mediaUrl ?? ''" :alt="post.tags.join(' ')" :style="mediaStyle" />

          <button class="lightbox-nav-btn next" :disabled="nextDisabled" @click="nav(1)">
            <v-icon>chevron_right</v-icon>
          </button>
        </div>

        <Transition name="slide-up">
          <div v-if="showInfo" class="lightbox-footer">
            <div class="lightbox-meta">
              <div v-for="m in meta" :key="m.label" class="lightbox-meta-item">
                <span class="lightbox-meta-label">{{ m.label }}</span>
                <span class="lightbox-meta-value">
                  <a v-if="m.domain" :href="m.value" target="_blank" rel="noopener" class="lightbox-source-link">
                    <v-icon size="14" class="mr-1">open_in_new</v-icon>
                    {{ m.value.length > 40 ? m.value.slice(0, 40) + '...' : m.value }}
                    <span class="lightbox-source-domain">{{ m.domain }}</span>
                  </a>
                  <template v-else>{{ m.value }}</template>
                </span>
              </div>
            </div>
            <div class="lightbox-tags">
              <span v-for="t in tags" :key="t" class="lightbox-tag" @click.stop="onTagClick(t)">{{ t }}</span>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.94);
}

.lightbox-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  color: white;
  flex-shrink: 0;
}

.lightbox-counter {
  font-size: 14px;
  opacity: 0.7;
}

.lightbox-nav {
  display: flex;
  gap: 4px;
}

.lightbox-nav :deep(.v-btn) {
  color: white;
}

.lightbox-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: auto;
  min-height: 50vh;
  padding: 8px;
}

.lightbox-media {
  object-fit: contain;
  border-radius: 4px;
}

.lightbox-nav-btn {
  position: sticky;
  align-self: center;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.12);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(8px);
  transition: background 0.15s;
  z-index: 1;
}

.lightbox-nav-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.24);
}

.lightbox-nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.lightbox-nav-btn.prev {
  top: 50%;
}

.lightbox-nav-btn.next {
  top: 50%;
}

.lightbox-footer {
  color: white;
  background: rgba(0, 0, 0, 0.85);
  flex-shrink: 0;
  padding: 16px 20px;
}

.lightbox-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin-bottom: 12px;
}

.lightbox-meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lightbox-meta-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.lightbox-meta-value {
  font-size: 14px;
  font-weight: 500;
}

.lightbox-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.lightbox-tag {
  display: inline-flex;
  padding: 3px 10px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.lightbox-tag:hover {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.2);
  color: white;
}

.lightbox-source-link {
  display: inline-flex;
  align-items: center;
  color: var(--v-inverse-primary);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  word-break: break-all;
}

.lightbox-source-link:hover {
  opacity: 0.8;
}

.lightbox-source-domain {
  font-size: 12px;
  opacity: 0.45;
  margin-left: 4px;
}

/* Transitions */
.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity 0.25s ease;
}

.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(20px);
  opacity: 0;
}
</style>
