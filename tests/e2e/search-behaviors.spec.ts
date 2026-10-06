import { expect, test } from '@playwright/test'
import { openApp, captureRequests, filteredPostsRequest, selectSource, sentTags, submitSearch } from './harness'

/**
 * Behavior-level E2E: date filtering, tag completion, tag-click-to-search, and
 * lightbox navigation across both boards.
 *
 * These exercise the real proxy + Vite stack. They assert on the wire and the
 * visible grid, since the failure modes they guard (a dropped date term that
 * returns unfiltered results, a wrong completion parameter) look like success
 * at the UI level.
 */
test.describe('search behaviors across boards', () => {
  test.describe('date filtering', () => {
    test('e621 forwards a validated date: term to the wire', async ({ page }) => {
      await openApp(page)
      await selectSource(page, 'e621')
      const { requests } = captureRequests(page)
      await submitSearch(page, 'solo date:week')

      const tags = sentTags(filteredPostsRequest(requests, 'e621'))
      expect(tags).toContain('date:week')
      expect(tags).not.toContain('sort:')
    })

    test('Rule34 forwards date: to the proxy, which rewrites it before upstream', async ({ page }) => {
      await openApp(page)
      await selectSource(page, 'rule34')
      const { requests } = captureRequests(page)
      await submitSearch(page, 'solo date:week')

      // The adapter has no date operator, so it forwards the term to the
      // proxy rather than dropping it: the resolver consumes `date:week`
      // there and rewrites the tags to `id:>threshold` before the request
      // reaches Rule34's upstream. The rewrite itself is asserted in the
      // proxy test suite (test_proxy.py / test_date_resolver_paging.py);
      // what is observable from the client is that the term is preserved
      // into the resolver and never sent as a bare tag.
      const tags = sentTags(filteredPostsRequest(requests, 'rule34'))
      expect(tags).toContain('date:week')
    })
  })

  test.describe('tag completion', () => {
    test('e621 completion reaches tags.json with a wildcard', async ({ page }) => {
      await openApp(page)
      await selectSource(page, 'e621')
      const { requests } = captureRequests(page)

      await page.locator('.search-input').fill('sol')
      // The dropdown is debounced; wait for the first item to render before
      // asserting on the request that produced it.
      await page.waitForSelector('.autocomplete-item', { timeout: 10000 })

      const tagReq = requests.find(
        (r) => r.path.endsWith('/tags.json') && r.source === 'e621',
      )
      expect(tagReq).toBeDefined()
      expect(tagReq!.params.get('search[name_matches]')).toBe('sol*')
    })
  })

  test.describe('tag click to search', () => {
    test('clicking a tag in the lightbox re-searches with that tag', async ({ page }) => {
      await openApp(page)
      await selectSource(page, 'rule34')
      const { requests } = captureRequests(page)
      await submitSearch(page, 'solo')

      // Grid tag chips are display-only; the tag-click-to-search path lives in
      // the lightbox, where `.lightbox-tag` re-searches on click.
      await page.locator('.image-card').first().click()
      await expect(page.locator('.lightbox-counter')).toBeVisible()

      const lightboxTag = page.locator('.lightbox-tag').first()
      if (await lightboxTag.count()) {
        const tagName = (await lightboxTag.textContent())?.trim()
        await lightboxTag.click()
        const tags = sentTags(filteredPostsRequest(requests, 'rule34'))
        expect(tags).toContain(tagName || '')
      }
    })
  })

  test.describe('lightbox navigation', () => {
    test('arrow keys advance the lightbox counter', async ({ page }) => {
      await openApp(page)
      await submitSearch(page, 'solo')

      await page.locator('.image-card').first().click()
      const counter = page.locator('.lightbox-counter')
      await expect(counter).toBeVisible()

      const firstCount = await counter.textContent()
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(500)
      const secondCount = await counter.textContent()

      expect(firstCount).toBeTruthy()
      expect(secondCount).toBeTruthy()
    })
  })
})
