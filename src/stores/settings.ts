import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { ACCENT_PALETTE, DEFAULT_ACCENT_ID } from '@/constants/accents'
import { DEV_TTL } from '@/constants/dev'
import type { AccentColorId, ThemeMode, WatchedMode } from '@/types'
import type { SourceId } from '@/sources/types'
import { DEFAULT_SOURCE_ID, isSourceId } from '@/sources/types'

export { ACCENT_PALETTE }

const KEYS = {
  THEME: 'r34_theme',
  ACCENT: 'r34_accent',
  SAFE_MODE: 'r34_safe_mode',
  WATCHED_MODE: 'r34_hide_watched',
  ACTIVE_SOURCE: 'r34_active_source',
  SEARCH_STATE: 'r34_search_state',
  SEARCH_STATE_TS: 'r34_search_state_ts',
} as const

const VALID_THEMES: ThemeMode[] = ['system', 'light', 'dark']

function parseThemeMode(val: string | null): ThemeMode {
  if (val && VALID_THEMES.includes(val as ThemeMode)) return val as ThemeMode
  return 'light'
}

export const useSettingsStore = defineStore('settings', () => {
  // --- Theme ---
  const theme = ref<ThemeMode>(parseThemeMode(localStorage.getItem(KEYS.THEME)))
  function setTheme(mode: ThemeMode) { theme.value = mode }

  function readAccentId(): AccentColorId {
    const val = localStorage.getItem(KEYS.ACCENT)
    if (val && ACCENT_PALETTE.some((accent) => accent.id === val)) return val
    return DEFAULT_ACCENT_ID
  }
  const accentId = ref<AccentColorId>(readAccentId())
  const accentColor = computed(() => ACCENT_PALETTE.find((accent) => accent.id === accentId.value) ?? ACCENT_PALETTE[0])
  function setAccent(id: AccentColorId) {
    if (ACCENT_PALETTE.some((accent) => accent.id === id)) accentId.value = id
  }

  // --- Safe Mode ---
  const safeMode = ref(localStorage.getItem(KEYS.SAFE_MODE) === 'true')
  function setSafeMode(val: boolean) { safeMode.value = val }

  // --- Watched Mode ---
  function readWatchedMode(): WatchedMode {
    const val = localStorage.getItem(KEYS.WATCHED_MODE)
    if (val === 'true') return 'hide'
    if (val === 'false') return 'show'
    if (val !== null && (['show', 'dim', 'hide'] as string[]).includes(val)) return val as WatchedMode
    return 'show'
  }
  const watchedMode = ref<WatchedMode>(readWatchedMode())
  function setWatchedMode(mode: WatchedMode) { watchedMode.value = mode }

  // --- Active Source ---
  // Sole owner of the persisted selection: the registry dispatches through
  // this value rather than holding a second copy, so they cannot drift.
  function readActiveSource(): SourceId {
    const val = localStorage.getItem(KEYS.ACTIVE_SOURCE)
    return isSourceId(val) ? val : DEFAULT_SOURCE_ID
  }
  const activeSource = ref<SourceId>(readActiveSource())
  function setActiveSource(id: SourceId) {
    if (isSourceId(id)) activeSource.value = id
  }

  // --- Search State (dev persistence) ---
  interface SavedSearchState { tags: string; ratings: string[] }

  function getSearchState(): SavedSearchState | null {
    if (!import.meta.env.DEV) return null
    try {
      const ts = Number(localStorage.getItem(KEYS.SEARCH_STATE_TS))
      if (!ts || Date.now() - ts > DEV_TTL) {
        localStorage.removeItem(KEYS.SEARCH_STATE)
        localStorage.removeItem(KEYS.SEARCH_STATE_TS)
        return null
      }
      return JSON.parse(localStorage.getItem(KEYS.SEARCH_STATE) || 'null')
    } catch { return null }
  }

  function setSearchState(state: SavedSearchState) {
    localStorage.setItem(KEYS.SEARCH_STATE, JSON.stringify(state))
    localStorage.setItem(KEYS.SEARCH_STATE_TS, String(Date.now()))
  }

  // --- Persist all reactive state to localStorage ---
  watch(theme, (v) => localStorage.setItem(KEYS.THEME, v))
  watch(accentId, (v) => localStorage.setItem(KEYS.ACCENT, v))
  watch(safeMode, (v) => localStorage.setItem(KEYS.SAFE_MODE, String(v)))
  watch(watchedMode, (v) => localStorage.setItem(KEYS.WATCHED_MODE, v))
  watch(activeSource, (v) => localStorage.setItem(KEYS.ACTIVE_SOURCE, v))

  return {
    theme, setTheme,
    accentId, accentColor, setAccent,
    safeMode, setSafeMode,
    watchedMode, setWatchedMode,
    activeSource, setActiveSource,
    getSearchState, setSearchState,
  }
})
