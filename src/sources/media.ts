import { useActiveSource } from './registry'
import type { Post } from './types'

/**
 * Shared media predicates reading the active adapter's declared capabilities,
 * replacing the per-component `fileExt === 'webm' || 'mp4'` checks that
 * disagreed across boards: Rule34 serves mp4 and gif, e621 serves webm and
 * mp4, so a hardcoded set is wrong on one of them.
 */

export function isVideo(post: Post): boolean {
  return useActiveSource().value.capabilities.videoExtensions.includes(post.fileExt)
}

/**
 * Shared media URL selection for PLAYBACK. Video posts terminate at
 * `sampleUrl` (an mp4 alternate already exists there when the file itself is
 * webm); images fall through sample → file → preview.
 */
export function getMediaUrl(post: Post): string | null {
  if (isVideo(post)) {
    return post.fileUrl || post.sampleUrl
  }
  return post.sampleUrl || post.fileUrl || post.previewUrl
}

/**
 * Still-image URL for grid tiles. Deliberately never `fileUrl` for a video
 * post: that is the video file itself, and an `<img>` element cannot decode it,
 * so a grid that used the playback chain blanked every video tile. `previewUrl`
 * is the thumbnail both boards serve for video.
 */
export function getThumbnailUrl(post: Post): string | null {
  if (isVideo(post)) {
    return post.previewUrl || post.sampleUrl
  }
  return post.sampleUrl || post.previewUrl || post.fileUrl
}

/** Whether the active source serves video at all. */
export function hasVideoSupport(): boolean {
  return useActiveSource().value.capabilities.videoExtensions.length > 0
}