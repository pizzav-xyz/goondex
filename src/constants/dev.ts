/**
 * Dev-only state persistence with a TTL, shared by the settings and watched
 * stores. Both previously carried the same read-check-write-clear block, so a
 * change to the expiry rule had to be made twice and one copy could drift.
 *
 * The `r34_*` key prefix throughout is intentionally historical: the project
 * was renamed to goondex, but renaming stored keys would orphan every
 * user's existing watchlist and settings on upgrade.
 */

export const DEV_TTL = 24 * 60 * 60 * 1000

/**
 * Reads a JSON value stored alongside a timestamp key, clearing both when the
 * value is missing or past its TTL. Returns null outside a dev build, on any
 * parse error, or on expiry — a corrupt value must not throw during store
 * initialization.
 */
export function readWithTtl<T>(valueKey: string, tsKey: string): T | null {
  if (!import.meta.env.DEV) return null
  try {
    const ts = Number(localStorage.getItem(tsKey))
    if (!ts || Date.now() - ts > DEV_TTL) {
      localStorage.removeItem(valueKey)
      localStorage.removeItem(tsKey)
      return null
    }
    return JSON.parse(localStorage.getItem(valueKey) || 'null') as T | null
  } catch {
    return null
  }
}

/** Stores a JSON value with a fresh timestamp. No-op outside a dev build. */
export function writeWithTtl(valueKey: string, tsKey: string, value: unknown): void {
  if (!import.meta.env.DEV) return
  localStorage.setItem(valueKey, JSON.stringify(value))
  localStorage.setItem(tsKey, String(Date.now()))
}

/** Removes both keys. Runs in any build: clearing stale state is always safe. */
export function clearWithTtl(valueKey: string, tsKey: string): void {
  localStorage.removeItem(valueKey)
  localStorage.removeItem(tsKey)
}