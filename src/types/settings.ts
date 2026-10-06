/**
 * Runtime list beside each mode union, so the store's validity check, the
 * settings toggle, and the app-bar cycling order read one source instead of
 * three hand-kept copies that can drift.
 */
export const WATCHED_MODES = ['show', 'dim', 'hide'] as const
export type WatchedMode = (typeof WATCHED_MODES)[number]

export const THEME_MODES = ['system', 'light', 'dark'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

/**
 * Single source for the mode labels and icons shown in AppShell and
 * SettingsPanel. The value unions above stay the source of truth for validity;
 * these arrays are display order plus presentation, so adding a mode means
 * editing one place instead of three hand-kept copies.
 */
export interface ModeMeta<T extends string> {
  value: T
  label: string
  icon: string
}

export const WATCHED_MODE_META: readonly ModeMeta<WatchedMode>[] = [
  { value: 'show', label: 'Show all', icon: 'visibility' },
  { value: 'dim', label: 'Dim watched', icon: 'visibility' },
  { value: 'hide', label: 'Hide watched', icon: 'visibility_off' },
]

export const THEME_MODE_META: readonly ModeMeta<ThemeMode>[] = [
  { value: 'light', label: 'Light', icon: 'light_mode' },
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
  { value: 'system', label: 'System', icon: 'contrast' },
]

export interface AccentColorVariant {
  primary: string
  onPrimary: string
  primaryContainer: string
  onPrimaryContainer: string
}

export interface AccentColor {
  id: string
  label: string
  light: AccentColorVariant
  dark: AccentColorVariant
}

export type AccentColorId = string
