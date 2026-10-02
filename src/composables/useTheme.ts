import { computed, watchEffect } from 'vue'
import { useTheme as useVuetifyTheme } from 'vuetify'
import { ACCENT_PALETTE, useSettingsStore } from '@/stores/settings'
import type { AccentColorVariant, ThemeMode } from '@/types'
import { THEME_MODES } from '@/types'

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

function setRootAccentTokens(accent: AccentColorVariant, inversePrimary: string) {
  const root = document.documentElement
  const { r, g, b } = hexToRgb(accent.primary)
  root.style.setProperty('--md-primary', accent.primary)
  root.style.setProperty('--md-on-primary', accent.onPrimary)
  root.style.setProperty('--md-primary-container', accent.primaryContainer)
  root.style.setProperty('--md-on-primary-container', accent.onPrimaryContainer)
  root.style.setProperty('--md-inverse-primary', inversePrimary)
  root.style.setProperty('--md-focus-ring', `0 0 0 4px rgba(${r}, ${g}, ${b}, 0.24)`)
}

function setVuetifyAccentColors(colors: Record<string, string>, accent: AccentColorVariant, inversePrimary: string) {
  colors.primary = accent.primary
  colors['on-primary'] = accent.onPrimary
  colors['primary-container'] = accent.primaryContainer
  colors['on-primary-container'] = accent.onPrimaryContainer
  colors['inverse-primary'] = inversePrimary
}

/**
 * Manages theme toggling: system → light → dark → system
 * Drives Vuetify's own theme system (not CSS classes on <html>).
 */
export function useTheme() {
  const settings = useSettingsStore()
  const vuetifyTheme = useVuetifyTheme()

  const currentTheme = computed(() => settings.theme)

  function resolveThemeName(mode: ThemeMode): string {
    if (mode === 'dark') return 'dark'
    if (mode === 'light') return 'light'
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function cycleTheme() {
    const idx = THEME_MODES.indexOf(settings.theme)
    const next = THEME_MODES[(idx + 1) % THEME_MODES.length]
    settings.setTheme(next)
    vuetifyTheme.global.name.value = resolveThemeName(next)
  }

  watchEffect(() => {
    vuetifyTheme.global.name.value = resolveThemeName(settings.theme)
  })

  watchEffect(() => {
    const accent = ACCENT_PALETTE.find((item) => item.id === settings.accentId) ?? ACCENT_PALETTE[0]
    const isDark = vuetifyTheme.global.current.value.dark
    const activeAccent = isDark ? accent.dark : accent.light
    const inversePrimary = isDark ? accent.light.primary : accent.dark.primary
    setVuetifyAccentColors(vuetifyTheme.global.current.value.colors, activeAccent, inversePrimary)
    setRootAccentTokens(activeAccent, inversePrimary)
    // Force Vuetify to pick up the color mutations by re-assigning the theme name.
    // Direct property writes on the colors object are not reactive in Vuetify's
    // internal system, so toggling the name triggers a full theme recomputation.
    const currentName = vuetifyTheme.global.name.value
    vuetifyTheme.global.name.value = ''
    vuetifyTheme.global.name.value = currentName
  })

  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', () => {
      if (settings.theme === 'system') {
        vuetifyTheme.global.name.value = resolveThemeName('system')
      }
    })
  }

  vuetifyTheme.global.name.value = resolveThemeName(settings.theme)

  return { currentTheme, cycleTheme }
}
