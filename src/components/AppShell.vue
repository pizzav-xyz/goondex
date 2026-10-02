<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useActiveSource } from '@/sources/registry'
import { useTheme } from '@/composables/useTheme'
import { WATCHED_MODES } from '@/types'

const emit = defineEmits<{
  'open-settings': []
}>()

const settings = useSettingsStore()
const { cycleTheme } = useTheme()
const activeSource = computed(() => useActiveSource().value)

const WATCHED_ICONS: Record<string, string> = {
  show: 'visibility',
  dim: 'visibility',
  hide: 'visibility_off',
}
const WATCHED_LABELS: Record<string, string> = {
  show: 'Show all',
  dim: 'Dim watched',
  hide: 'Hide watched',
}

const themeIcon = computed(() =>
  settings.theme === 'dark' ? 'light_mode' : 'dark_mode',
)
const watchedIcon = computed(() => WATCHED_ICONS[settings.watchedMode])
const watchedLabel = computed(() => WATCHED_LABELS[settings.watchedMode])
const isWatchedActive = computed(() => settings.watchedMode !== 'show')

function cycleWatchedMode() {
  const idx = WATCHED_MODES.indexOf(settings.watchedMode)
  settings.setWatchedMode(WATCHED_MODES[(idx + 1) % WATCHED_MODES.length])
}
</script>

<template>
  <v-app>
    <v-app-bar color="surface" flat>
      <v-app-bar-title class="app-title">
        <v-icon icon="explore" color="primary" class="mr-2" />
        <span class="app-name">trawl-comb</span>
        <v-chip
          size="x-small"
          variant="tonal"
          color="primary"
          class="ml-2 source-chip"
          :title="`Active source: ${activeSource.label}`"
        >
          {{ activeSource.label }}
        </v-chip>
      </v-app-bar-title>

      <v-btn
        :icon="watchedIcon"
        :variant="isWatchedActive ? 'flat' : 'text'"
        :color="isWatchedActive ? 'secondary' : undefined"
        :aria-label="watchedLabel"
        :title="watchedLabel"
        @click="cycleWatchedMode"
      />
      <v-btn
        :icon="themeIcon"
        variant="text"
        aria-label="Toggle theme"
        title="Toggle theme"
        @click="cycleTheme"
      />
      <v-btn
        icon="settings"
        variant="text"
        aria-label="Settings"
        title="Settings"
        @click="emit('open-settings')"
      />
    </v-app-bar>

    <v-main>
      <slot />
    </v-main>
  </v-app>
</template>

<style scoped>
.app-title {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 1.125rem;
  letter-spacing: -0.01em;
}

:deep(.v-toolbar) {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

:deep(.v-toolbar .v-btn) {
  width: 40px;
  height: 40px;
}
</style>
