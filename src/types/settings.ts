/**
 * Runtime list beside each mode union, so the store's validity check, the
 * settings toggle, and the app-bar cycling order read one source instead of
 * three hand-kept copies that can drift.
 */
export const WATCHED_MODES = ['show', 'dim', 'hide'] as const
export type WatchedMode = (typeof WATCHED_MODES)[number]

export const THEME_MODES = ['system', 'light', 'dark'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

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
