import { ref, type Ref } from 'vue'
import type { Post } from '@/types'
import { MAX_CONCURRENT_PROBE, PROBE_TIMEOUT } from '@/config'

/** Persistent cache across searches — avoids re-probing the same videos. */
const durationCache = new Map<number, number>()

/**
 * Probe actual video durations by loading metadata from offscreen
 * `<video>` elements. Uses `preload="metadata"` so browsers only fetch
 * enough of the file to determine duration (typically just the moov atom).
 */
export function useVideoDuration() {
  const probing = ref(false)
  const durationMap: Ref<Map<number, number>> = ref(new Map(durationCache))

  /**
   * Probe durations for all video posts in the given list.
   * Returns the updated duration map. Non-video posts are skipped.
   * Already-cached posts are skipped.
   */
  async function probeDurations(posts: Post[]): Promise<Map<number, number>> {
    const videos = posts.filter(
      p =>
        !durationCache.has(p.id) &&
        (p.fileExt === 'webm' || p.fileExt === 'mp4'),
    )

    if (videos.length === 0) {
      durationMap.value = new Map(durationCache)
      return durationMap.value
    }

    probing.value = true

    let nextIdx = 0
    const slots: Promise<void>[] = []

    async function runSlot() {
      while (nextIdx < videos.length) {
        const idx = nextIdx++
        await probeOne(videos[idx])
      }
    }

    for (let s = 0; s < Math.min(MAX_CONCURRENT_PROBE, videos.length); s++) {
      slots.push(runSlot())
    }

    await Promise.allSettled(slots)

    probing.value = false
    durationMap.value = new Map(durationCache)
    return durationMap.value
  }

  function probeOne(post: Post): Promise<void> {
    return new Promise(resolve => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;pointer-events:none'

      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        video.onloadedmetadata = null
        video.onerror = null
        try { document.body.removeChild(video) } catch { /* already removed */ }
        resolve()
      }

      const timeout = setTimeout(settle, PROBE_TIMEOUT)

      video.onloadedmetadata = () => {
        const dur = video.duration
        if (isFinite(dur) && dur > 0) {
          durationCache.set(post.id, dur)
        }
        settle()
      }

      video.onerror = () => settle()

      document.body.appendChild(video)
      video.src = post.fileUrl ?? ''
    })
  }

  return {
    probing,
    durationMap,
    probeDurations,
  }
}
