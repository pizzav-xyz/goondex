import { ref, reactive, computed, type Ref } from 'vue'
import { toValue } from 'vue'
import { MAX_CONCURRENT_BUFFER } from '@/config'
import { isVideo, getMediaUrl } from '@/sources/media'
import type { Post } from '@/types'

/** Per-post buffer status */
export type BufferStatus = 'idle' | 'pending' | 'buffering' | 'buffered' | 'failed'

/** Module-level reactive state shared across all component instances.
 * Both maps are reactive so per-post computeds (`getPostStatus`, `getBufferedUrl`)
 * re-evaluate when entries change — a plain Map would silently never update. */
const buffer = reactive(new Map<number, string>()) // postId -> blobUrl
const statusMap = reactive(new Map<number, BufferStatus>()) // postId -> status
const buffering = ref(false)
const abortController: { current: AbortController | null } = { current: null }

/** Reactive set of buffered post IDs for O(1) lookups in templates */
const bufferedIds = ref<Set<number>>(new Set())
const pendingIds = ref<Set<number>>(new Set())
const bufferingIds = ref<Set<number>>(new Set())
const failedIds = ref<Set<number>>(new Set())

/** Internal: update status and sync reactive sets */
function setStatus(postId: number, status: BufferStatus): void {
  const prev = statusMap.get(postId)
  if (prev === status) return

  statusMap.set(postId, status)

  // Remove from all sets first
  bufferedIds.value.delete(postId)
  pendingIds.value.delete(postId)
  bufferingIds.value.delete(postId)
  failedIds.value.delete(postId)

  // Add to appropriate set
  switch (status) {
    case 'buffered':
      bufferedIds.value.add(postId)
      break
    case 'buffering':
      bufferingIds.value.add(postId)
      break
    case 'pending':
      pendingIds.value.add(postId)
      break
    case 'failed':
      failedIds.value.add(postId)
      break
    // 'idle' - in no set
  }
}

/** Internal: get status, defaulting to 'idle' */
function getStatus(postId: number): BufferStatus {
  return statusMap.get(postId) ?? 'idle'
}

/** Computed progress summary */
const progress = computed(() => ({
  done: bufferedIds.value.size + failedIds.value.size,
  total: bufferedIds.value.size + pendingIds.value.size + bufferingIds.value.size + failedIds.value.size,
  get percent(): number {
    const total = this.total
    return total > 0 ? Math.round((this.done / total) * 100) : 0
  },
}))

/** Computed buffered count (alias for backward compat) */
const bufferedCount = computed(() => bufferedIds.value.size)

/** Check if a specific post is buffered */
function isBuffered(post: Post): boolean {
  return bufferedIds.value.has(post.id)
}

/** Get status for a specific post */
function getPostStatus(post: Post): BufferStatus {
  return getStatus(post.id)
}

/** Get buffered blob URL for a post, or null if not buffered */
function getBufferedUrl(post: Post): string | null {
  return buffer.get(post.id) ?? null
}

/** Fetch a single video into buffer */
async function fetchOne(post: Post, signal: AbortSignal): Promise<void> {
  const id = post.id
  if (buffer.has(id)) return

  const url = getMediaUrl(post)
  if (!url) {
    setStatus(id, 'failed')
    return
  }

  setStatus(id, 'buffering')

  const proxyUrl = `/api/video?url=${encodeURIComponent(url)}`
  try {
    const res = await fetch(proxyUrl, { signal })
    if (!res.ok) {
      setStatus(id, 'failed')
      return
    }
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    buffer.set(id, blobUrl)
    setStatus(id, 'buffered')
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      setStatus(id, 'idle')
    } else {
      setStatus(id, 'failed')
    }
  }
}

/**
 * Pre-fetch video files into memory as blob URLs.
 * Usage: await bufferVideos(posts, count)
 */
async function bufferVideos(posts: Post[], count: number): Promise<void> {
  if (buffering.value) return

  // Only buffer video posts that aren't already cached or pending/buffering
  const targets = posts
    .filter(p => isVideo(p) && getStatus(p.id) === 'idle')
    .slice(0, count)

  if (targets.length === 0) return

  buffering.value = true
  abortController.current = new AbortController()
  const signal = abortController.current.signal

  // Mark all targets as pending initially
  for (const p of targets) {
    setStatus(p.id, 'pending')
  }

  try {
    // Process in batches of MAX_CONCURRENT_BUFFER
    for (let i = 0; i < targets.length; i += MAX_CONCURRENT_BUFFER) {
      if (signal.aborted) break
      const batch = targets.slice(i, i + MAX_CONCURRENT_BUFFER)
      await Promise.allSettled(batch.map(p => fetchOne(p, signal)))
    }
  } finally {
    buffering.value = false
    abortController.current = null
  }
}

/** Cancel any in-progress buffering */
function cancelBuffer(): void {
  abortController.current?.abort()
  abortController.current = null
  buffering.value = false

  // Reset buffering/pending back to idle
  for (const id of bufferingIds.value) {
    setStatus(id, 'idle')
  }
  for (const id of pendingIds.value) {
    setStatus(id, 'idle')
  }
}

/** Revoke all cached blob URLs and clear the buffer */
function clearBuffer(): void {
  cancelBuffer()
  for (const blobUrl of buffer.values()) {
    URL.revokeObjectURL(blobUrl)
  }
  buffer.clear()
  statusMap.clear()
  bufferedIds.value.clear()
  pendingIds.value.clear()
  bufferingIds.value.clear()
  failedIds.value.clear()
}

/** Revoke a single entry */
function unbuffer(postId: number): void {
  const blobUrl = buffer.get(postId)
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl)
    buffer.delete(postId)
  }
  statusMap.delete(postId)
  bufferedIds.value.delete(postId)
  pendingIds.value.delete(postId)
  bufferingIds.value.delete(postId)
  failedIds.value.delete(postId)
}

export function useBufferProgress() {
  return {
    // Global state
    buffering,
    bufferedCount,
    progress,
    bufferedIds: bufferedIds as Ref<Readonly<Set<number>>>,
    pendingIds: pendingIds as Ref<Readonly<Set<number>>>,
    bufferingIds: bufferingIds as Ref<Readonly<Set<number>>>,
    failedIds: failedIds as Ref<Readonly<Set<number>>>,

    // Per-post queries
    isBuffered,
    getPostStatus,
    getBufferedUrl,

    // Actions
    bufferVideos,
    cancelBuffer,
    clearBuffer,
    unbuffer,
  }
}

/** Options for the wrapper composable used by VideoBufferControl */
interface UseBufferProgressOptions {
  posts: Post[] | (() => Post[]) | import('vue').Ref<Post[]> | import('vue').ComputedRef<Post[]>
  watchedMode: 'show' | 'dim' | 'hide'
  watchedKeys: Set<string>
  totalCount: number
  bufferTarget: import('vue').ComputedRef<number>
}

/**
 * Wrapper composable that provides computeds for VideoBufferControl UI.
 * This is the version used by the component; prefer `useBufferProgress()` for raw state.
 */
export function useBufferProgressUI(options: UseBufferProgressOptions) {
  const core = useBufferProgress()
  
  const posts = computed(() => toValue(options.posts))
  const videoPosts = computed(() => posts.value.filter(isVideo))
  const videoPostCount = computed(() => videoPosts.value.length)
  
  /** Progress percentage relative to buffer target (e.g., 10 videos requested) */
  const bufferPercentage = computed(() => {
    const target = options.bufferTarget.value
    if (target <= 0) return 0
    return Math.min(100, Math.round((core.bufferedCount.value / target) * 100))
  })

  /** Buffer segments for progress bar visualization */
  const bufferSegments = computed(() => {
    if (videoPostCount.value === 0) return []
    const segments: Array<{ start: number; end: number }> = []
    let segmentStart: number | null = null

    videoPosts.value.forEach((post, idx) => {
      const buffered = core.isBuffered(post)
      if (buffered && segmentStart === null) {
        segmentStart = idx
      } else if (!buffered && segmentStart !== null) {
        segments.push({ start: segmentStart, end: idx - 1 })
        segmentStart = null
      }
    })

    if (segmentStart !== null) {
      segments.push({ start: segmentStart, end: videoPostCount.value - 1 })
    }

    return segments
  })

  return {
    // Core state
    buffering: core.buffering,
    bufferedCount: core.bufferedCount,
    progress: core.progress,
    
    // Computeds for UI
    videoPostCount,
    bufferPercentage,
    bufferSegments,
    
    // Per-post queries
    isBuffered: core.isBuffered,
    getPostStatus: core.getPostStatus,
    getBufferedUrl: core.getBufferedUrl,
    
    // Actions
    bufferVideos: core.bufferVideos,
    cancelBuffer: core.cancelBuffer,
    clearBuffer: core.clearBuffer,
    unbuffer: core.unbuffer,
  }
}

// Type exports for consumers
export type UseBufferProgressReturn = ReturnType<typeof useBufferProgress>
export type UseBufferProgressUIReturn = ReturnType<typeof useBufferProgressUI>