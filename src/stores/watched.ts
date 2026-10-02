import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { DEV_TTL } from '@/constants/dev'
import type { Post } from '@/types'
import { DEFAULT_SOURCE_ID, isSourceId, type SourceId } from '@/sources/types'

const KEY_WATCHED = 'r34_watched'
const KEY_LIGHTBOX_POST = 'r34_lightbox_post'
const KEY_LIGHTBOX_POST_TS = 'r34_lightbox_post_ts'

export interface WatchedEntry {
  source: SourceId
  id: number
  at: number
}

export function watchedKey(source: SourceId, id: number): string {
  return `${source}:${id}`
}

export const useWatchedStore = defineStore('watched', () => {
  // --- Load from localStorage ---
  function loadWatched(): { entries: WatchedEntry[]; ok: boolean } {
    let raw: unknown
    try {
      raw = JSON.parse(localStorage.getItem(KEY_WATCHED) || '[]')
    } catch {
      return { entries: [], ok: false }
    }
    if (!Array.isArray(raw)) return { entries: [], ok: false }
    // Migrate old format (number[]) to scoped entries on the default source.
    if (raw.length && typeof raw[0] === 'number') {
      return {
        entries: (raw as number[])
          .filter((id) => typeof id === 'number')
          .map((id) => ({ source: DEFAULT_SOURCE_ID, id, at: Date.now() })),
        ok: true,
      }
    }
    const entries: WatchedEntry[] = []
    for (const e of raw) {
      if (typeof e !== 'object' || e === null) continue
      const rec = e as Record<string, unknown>
      if (typeof rec.id !== 'number' || typeof rec.at !== 'number') continue
      // Identifier-only entries predate scoping: attribute to the default
      // source so nothing is lost. Already-scoped entries pass through
      // untouched, including their original timestamps.
      const source = isSourceId(rec.source) ? rec.source : DEFAULT_SOURCE_ID
      entries.push({ source, id: rec.id, at: rec.at })
    }
    return { entries, ok: true }
  }
  const initial = loadWatched()
  const loadOk = initial.ok
  const watched = ref<WatchedEntry[]>(initial.entries)

  const watchedKeys = computed(() => new Set(watched.value.map((w) => watchedKey(w.source, w.id))))

  function addWatched(source: SourceId, postId: number) {
    watched.value = watched.value.filter((w) => !(w.source === source && w.id === postId))
    watched.value.unshift({ source, id: postId, at: Date.now() })
  }

  function removeWatched(source: SourceId, postId: number) {
    watched.value = watched.value.filter((w) => !(w.source === source && w.id === postId))
  }

  function toggleWatched(source: SourceId, postId: number) {
    if (isWatched(source, postId)) removeWatched(source, postId)
    else addWatched(source, postId)
  }

  function isWatched(source: SourceId, postId: number): boolean {
    return watchedKeys.value.has(watchedKey(source, postId))
  }

  // Persist only when the initial parse succeeded: a corrupt payload must not
  // be overwritten with an empty list on the next write.
  function persist() {
    if (!loadOk) return
    localStorage.setItem(KEY_WATCHED, JSON.stringify(watched.value))
  }

  watch(watched, persist, { deep: true })

  // --- Lightbox State ---
  interface LightboxSaved {
    post: Post
    _playbackTime: number | null
  }

  function getLightboxPost(): LightboxSaved | null {
    if (!import.meta.env.DEV) return null
    try {
      const ts = Number(localStorage.getItem(KEY_LIGHTBOX_POST_TS))
      if (!ts || Date.now() - ts > DEV_TTL) {
        localStorage.removeItem(KEY_LIGHTBOX_POST)
        localStorage.removeItem(KEY_LIGHTBOX_POST_TS)
        return null
      }
      return JSON.parse(localStorage.getItem(KEY_LIGHTBOX_POST) || 'null')
    } catch { return null }
  }

  function setLightboxPost(post: Post, playbackTime: number | null) {
    if (!import.meta.env.DEV) return
    localStorage.setItem(KEY_LIGHTBOX_POST, JSON.stringify({ post, _playbackTime: playbackTime }))
    localStorage.setItem(KEY_LIGHTBOX_POST_TS, String(Date.now()))
  }

  function clearLightboxPost() {
    localStorage.removeItem(KEY_LIGHTBOX_POST)
    localStorage.removeItem(KEY_LIGHTBOX_POST_TS)
  }

  return {
    watched, watchedKeys,
    addWatched, removeWatched, toggleWatched, isWatched,
    getLightboxPost, setLightboxPost, clearLightboxPost,
  }
})
