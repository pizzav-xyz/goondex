import { expect, test, type Page } from '@playwright/test'
import { openApp, openLightbox, selectSource, submitSearch } from './harness'

/**
 * The two boards use independent id spaces: post 100 on Rule34 has nothing to do
 * with post 100 on e621. An unscoped watchlist would mark both watched, and since
 * the watchlist is the only user data that cannot be rebuilt, the scoping has to
 * hold across a source switch rather than just within one session.
 */

/** The lightbox toolbar, in DOM order: prev, next, info, watch, close. */
const NAV_BUTTONS = '.lightbox-nav .v-btn'
const WATCH_TOGGLE_INDEX = 3

/**
 * Reads the watchlist straight out of localStorage, the way an upgrade would.
 *
 * Retried rather than read once: the store persists through a Vue watcher, so a
 * read issued in the same tick as the click sees the pre-toggle value and the
 * assertion fails for a reason that has nothing to do with the app.
 */
async function watchedKeys(page: Page, minCount = 0): Promise<string[]> {
  await expect
    .poll(async () => (await readWatchedKeys(page)).length, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(minCount)
  return readWatchedKeys(page)
}

async function readWatchedKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('r34_watched') ?? '[]') as {
      source?: string
      id: number
    }[]
    return raw.map((entry) => `${entry.source ?? 'rule34'}:${entry.id}`)
  })
}

async function watchedIcon(page: Page): Promise<string> {
  return (await page.locator(NAV_BUTTONS).nth(WATCH_TOGGLE_INDEX).innerText()).trim()
}

/** Clicks the watch toggle and waits for the icon to reach the expected state. */
async function toggleWatch(page: Page, expected: 'visibility' | 'visibility_off'): Promise<void> {
  await page.locator(NAV_BUTTONS).nth(WATCH_TOGGLE_INDEX).click()
  await expect(page.locator(NAV_BUTTONS).nth(WATCH_TOGGLE_INDEX)).toContainText(expected)
}

async function closeLightbox(page: Page): Promise<void> {
  await page.locator(NAV_BUTTONS).nth(4).click()
  await expect(page.locator('.lightbox-counter')).toHaveCount(0)
}

test.describe('watchlist scoping across a source switch', () => {
  test('the same numeric id is watched on one board and not the other', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'rule34')
    await submitSearch(page, 'solo')
    await openLightbox(page)

    expect(await watchedIcon(page)).toBe('visibility')
    await toggleWatch(page, 'visibility_off')

    const afterRule34 = await watchedKeys(page, 1)
    expect(afterRule34.some((k) => k.startsWith('rule34:'))).toBe(true)

    await closeLightbox(page)
    await selectSource(page, 'e621')
    await submitSearch(page, 'solo')
    await openLightbox(page)

    // A fresh board's posts start unwatched even where ids overlap.
    expect(await watchedIcon(page)).toBe('visibility')
  })

  test('switching back restores the watch state rather than losing it', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'rule34')
    await submitSearch(page, 'solo')
    await openLightbox(page)
    await toggleWatch(page, 'visibility_off')
    const watchedOnRule34 = await watchedKeys(page, 1)

    await closeLightbox(page)
    await selectSource(page, 'e621')
    await submitSearch(page, 'solo')
    await closeLightbox(page)
    await selectSource(page, 'rule34')
    await submitSearch(page, 'solo')
    await openLightbox(page)

    expect(await watchedKeys(page)).toEqual(watchedOnRule34)
  })

  test('watching on both boards accumulates entries instead of replacing them', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'rule34')
    await submitSearch(page, 'solo')
    await openLightbox(page)
    await toggleWatch(page, 'visibility_off')
    await closeLightbox(page)

    await selectSource(page, 'e621')
    await submitSearch(page, 'solo')
    await openLightbox(page)
    await toggleWatch(page, 'visibility_off')

    const keys = await watchedKeys(page, 2)
    expect(keys.some((k) => k.startsWith('rule34:'))).toBe(true)
    expect(keys.some((k) => k.startsWith('e621:'))).toBe(true)
  })

  test('a watchlist written before source scoping still loads as Rule34', async ({ page }) => {
    await openApp(page)

    // Written into localStorage directly rather than through the UI, because the
    // shape this guards is the one no current version can produce: bare ids with
    // no source attribution, exactly as older builds serialized them. The
    // migration has to attribute them to the default board instead of discarding
    // the one thing a user cannot regenerate.
    await page.evaluate(() => {
      localStorage.setItem('r34_watched', JSON.stringify([1609000, 1609001]))
    })
    await page.reload()
    await expect(page.locator('.image-card').first()).toBeVisible()

    const keys = await watchedKeys(page)
    expect(keys).toContain('rule34:1609000')
    expect(keys).toContain('rule34:1609001')
  })

  test('unwatching removes the entry for that board only', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'rule34')
    await submitSearch(page, 'solo')
    await openLightbox(page)
    await toggleWatch(page, 'visibility_off')
    const afterWatch = await watchedKeys(page, 1)
    await toggleWatch(page, 'visibility')
    await expect.poll(async () => (await readWatchedKeys(page)).length).toBe(afterWatch.length - 1)
    const afterUnwatch = await readWatchedKeys(page)

    expect(afterUnwatch.length).toBe(afterWatch.length - 1)
  })
})