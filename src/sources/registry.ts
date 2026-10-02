import { computed, type ComputedRef } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import type { SourceAdapter, SourceId } from './types'
import { DEFAULT_SOURCE_ID } from './types'
import { rule34Adapter } from './rule34'
import { e621Adapter } from './e621'

/**
 * The source registry: every adapter the app can talk to, plus the lookup and
 * dispatch helpers the rest of the app uses.
 *
 * Application code reaches the active source only through `useActiveSource`,
 * so no shared module needs to know which board is selected. Adding a third
 * source means registering it here and adding its id to `SOURCE_IDS` — no other
 * shared code changes.
 */

const ADAPTERS = new Map<SourceId, SourceAdapter>([
  ['rule34', rule34Adapter],
  ['e621', e621Adapter],
])

export const registeredSources: readonly SourceAdapter[] = [...ADAPTERS.values()]

/**
 * Looks up an adapter by id, falling back to the default for an unknown id —
 * which can come from persisted storage written by another build, and should
 * degrade to the default board rather than throw on every request.
 *
 * Backed by a `Map` rather than an object literal because `in` and property
 * access walk the prototype chain: an object registry resolves `__proto__` and
 * `constructor` to inherited members, returning something that is not an
 * adapter at all.
 */
export function getSource(id?: string | null): SourceAdapter {
  if (id !== null && id !== undefined) {
    const found = ADAPTERS.get(id as SourceId)
    if (found) return found
  }
  return ADAPTERS.get(DEFAULT_SOURCE_ID) as SourceAdapter
}

/**
 * The active adapter, derived from the persisted selection.
 *
 * A `computed` over the settings value rather than a second ref, so the active
 * source cannot drift out of sync with what is stored.
 */
export function useActiveSource(): ComputedRef<SourceAdapter> {
  const settings = useSettingsStore()
  return computed(() => getSource(settings.activeSource))
}