import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { ACCENT_PALETTE, DEFAULT_ACCENT_ID } from '@/constants/accents'
import { readWithTtl, writeWithTtl } from '@/constants/dev'
import type { AccentColorId, ThemeMode, WatchedMode } from '@/types'
import { THEME_MODES, WATCHED_MODES } from '@/types'
import type { SourceId } from '@/sources/types'
import { DEFAULT_SOURCE_ID, isSourceId } from '@/sources/types'

export { ACCENT_PALETTE }

/**
 * The `r34_` prefix is intentionally historical and must NOT be "corrected"
 * to match the project name. The project is now goondex, but these keys
 * are user data: renaming them would silently orphan every existing user's
 * settings on upgrade.
 */
const KEYS = {
  THEME: 'r34_theme',
  ACCENT: 'r34_accent',
  WATCHED_MODE: 'r34_hide_watched',
  ACTIVE_SOURCE: 'r34_active_source',
  SEARCH_STATE: 'r34_search_state',
  SEARCH_STATE_TS: 'r34_search_state_ts',
} as const

const VALID_THEMES: ThemeMode[] = [...THEME_MODES]

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

  // --- Watched Mode ---
  function readWatchedMode(): WatchedMode {
    const val = localStorage.getItem(KEYS.WATCHED_MODE)
    if (val === 'true') return 'hide'
    if (val === 'false') return 'show'
    if (val !== null && (WATCHED_MODES as readonly string[]).includes(val)) return val as WatchedMode
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
    return readWithTtl<SavedSearchState>(KEYS.SEARCH_STATE, KEYS.SEARCH_STATE_TS)
  }

  function setSearchState(state: SavedSearchState) {
    writeWithTtl(KEYS.SEARCH_STATE, KEYS.SEARCH_STATE_TS, state)
  }

  // --- Persist all reactive state to localStorage ---
  watch(theme, (v) => localStorage.setItem(KEYS.THEME, v))
  watch(accentId, (v) => localStorage.setItem(KEYS.ACCENT, v))
  watch(watchedMode, (v) => localStorage.setItem(KEYS.WATCHED_MODE, v))
  watch(activeSource, (v) => localStorage.setItem(KEYS.ACTIVE_SOURCE, v))

  return {
    theme, setTheme,
    accentId, accentColor, setAccent,
    watchedMode, setWatchedMode,
    activeSource, setActiveSource,
    getSearchState, setSearchState,
  }
})
