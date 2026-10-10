import { useBufferProgress } from './useBufferProgress'
import { isVideo } from '@/sources/media'
import type { Post } from '@/types'

/**
 * Backward-compatible facade for useBufferProgress.
 * Prefer `useBufferProgress` directly for per-post status and progress.
 */
export function useVideoBuffer() {
  return useBufferProgress()
}

export function canBufferMore(posts: Post[]): boolean {
  const { bufferedIds, bufferingIds, pendingIds } = useBufferProgress()
  return posts
    .filter(isVideo)
    .some(p => 
      !bufferedIds.value.has(p.id) && 
      !bufferingIds.value.has(p.id) && 
      !pendingIds.value.has(p.id)
    )
}