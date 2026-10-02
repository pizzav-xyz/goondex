import { expect, test } from '@playwright/test'
import { openApp, captureRequests, filteredPostsRequest, selectSource, sentTags, submitSearch } from './harness'

/**
 * Rule34 cannot express an ordering through the tags the client sends, so the
 * term is dropped. The failure this guards is silence: a dropped term still
 * returns a full, valid page, so without an explicit notice the user has no way
 * to know their ordering was ignored.
 */
test.describe('dropped filter reporting on Rule34', () => {
  test('a sort: term is reported and never reaches the wire', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'rule34')
    const { requests } = captureRequests(page)
    await submitSearch(page, 'solo sort:updated')

    const notice = page.locator('.dropped-list')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('sort:updated')

    const tags = sentTags(filteredPostsRequest(requests, 'rule34'))
    expect(tags).toContain('solo')
    expect(tags).not.toContain('sort:')
  })

  test('the notice names the real reason rather than a generic failure', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'rule34')
    await submitSearch(page, 'solo sort:updated')
    await expect(page.locator('.dropped-list')).toContainText(/not sent/i)
  })

  test('e621 applies sort: natively and reports nothing', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'e621')
    const { requests } = captureRequests(page)
    await submitSearch(page, 'solo sort:id:desc')

    const tags = sentTags(filteredPostsRequest(requests, 'e621'))
    expect(tags).toContain('order:id_desc')
    await expect(page.locator('.dropped-list')).toHaveCount(0)
  })

  test('an unorderable field is reported on e621 rather than dropped in silence', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'e621')
    const { requests } = captureRequests(page)
    await submitSearch(page, 'solo sort:updated')

    await expect(page.locator('.dropped-list')).toContainText('sort:updated')
    // "updated" is not an orderable field, so nothing reaches the wire.
    expect(sentTags(filteredPostsRequest(requests, 'e621'))).not.toContain('order:')
  })

  test('the notice can be dismissed', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'rule34')
    await submitSearch(page, 'solo sort:updated')
    await expect(page.locator('.dropped-list')).toBeVisible()

    await page.locator('.v-alert__close button, .v-alert button[aria-label="Close"]').first().click()
    await expect(page.locator('.dropped-list')).toHaveCount(0)
  })
})