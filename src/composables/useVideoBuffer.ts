import { ref } from 'vue'
import type { Post } from '@/types'
import { MAX_CONCURRENT_BUFFER } from '@/config'
import { isVideo, getMediaUrl } from '@/sources/media'

/** Global buffer state shared across components */
const buffer = new Map<number, string>() // post ID → blob URL
const buffering = ref(false)
const bufferedCount = ref(0)
let abortController: AbortController | null = null

async function fetchOne(post: Post, signal: AbortSignal): Promise<void> {
  const id = post.id
  if (buffer.has(id)) return

  const url = getMediaUrl(post)
  if (!url) return

  const proxyUrl = `/api/video?url=${encodeURIComponent(url)}`
  const res = await fetch(proxyUrl, { signal })
  if (!res.ok) return

  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  buffer.set(id, blobUrl)
  bufferedCount.value = buffer.size
}

/**
 * Pre-fetch video files into memory as blob URLs.
 * Usage: await bufferVideos(posts, count)
 */
async function bufferVideos(posts: Post[], count: number): Promise<void> {
  if (buffering.value) return

  // Only buffer video posts that aren't already cached
  const targets = posts
    .filter(p => isVideo(p) && !buffer.has(p.id))
    .slice(0, count)

  if (targets.length === 0) return

  buffering.value = true
  abortController = new AbortController()
  const signal = abortController.signal

  try {
    // Process in batches of MAX_CONCURRENT
    for (let i = 0; i < targets.length; i += MAX_CONCURRENT_BUFFER) {
      if (signal.aborted) break
      const batch = targets.slice(i, i + MAX_CONCURRENT_BUFFER)
      await Promise.allSettled(batch.map(p => fetchOne(p, signal)))
    }
  } finally {
    buffering.value = false
    abortController = null
  }
}

/** Get cached blob URL for a post, or null if not buffered */
function getBufferedUrl(post: Post): string | null {
  return buffer.get(post.id) ?? null
}

/** Check if a post is already buffered */
function isBuffered(post: Post): boolean {
  return buffer.has(post.id)
}

/** Cancel any in-progress buffering */
function cancelBuffer(): void {
  abortController?.abort()
  abortController = null
  buffering.value = false
}

/** Revoke all cached blob URLs and clear the buffer */
function clearBuffer(): void {
  cancelBuffer()
  for (const blobUrl of buffer.values()) {
    URL.revokeObjectURL(blobUrl)
  }
  buffer.clear()
  bufferedCount.value = 0
}

/** Revoke a single entry */
function unbuffer(postId: number): void {
  const blobUrl = buffer.get(postId)
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl)
    buffer.delete(postId)
    bufferedCount.value = buffer.size
  }
}

export function useVideoBuffer() {
  return {
    buffering,
    bufferedCount,
    bufferVideos,
    getBufferedUrl,
    isBuffered,
    cancelBuffer,
    clearBuffer,
    unbuffer,
  }
}
