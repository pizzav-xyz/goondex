import { expect, test } from '@playwright/test'
import {
  openApp,
  captureRequests,
  collectConsoleErrors,
  filteredPostsRequest,
  sentTags,
  selectSource,
  submitSearch,
  submitSearchExpectingNothing,
} from './harness'

/**
 * The two boards spell the same rating filter differently. A wrong spelling does
 * not fail — e621 answers 200 with unfiltered results and Rule34 treats an
 * unknown tag as a tag with no posts — so the only reliable check is to read
 * what went on the wire.
 */
test.describe('rating emission per board', () => {
  test('Rule34 sends long rating forms and no short ones', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'rule34')
    const { requests } = captureRequests(page)
    await submitSearch(page, 'rating:explicit solo')

    const tags = sentTags(filteredPostsRequest(requests, 'rule34'))
    expect(tags).toContain('rating:explicit')
    expect(tags).not.toMatch(/rating:[sqe]\b/)
  })

  test('e621 sends short rating forms and no long ones', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'e621')
    const { requests } = captureRequests(page)
    await submitSearch(page, 'rating:explicit solo')

    const tags = sentTags(filteredPostsRequest(requests, 'e621'))
    expect(tags).toContain('rating:e')
    expect(tags).not.toContain('rating:explicit')
  })

  test('an unrecognized rating is rejected in the browser, never forwarded', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'e621')
    const { requests } = captureRequests(page)
    await submitSearch(page, 'rating:spicy solo')

    const tags = sentTags(filteredPostsRequest(requests, 'e621'))
    expect(tags).not.toContain('rating:spicy')
    expect(tags).not.toMatch(/rating:/)
  })

  test('rating filter is effective, not decorative', async ({ page }) => {
    await openApp(page)
    await selectSource(page, 'rule34')
    // Rule34 returns a zero-byte body for no matches rather than `[]`, so an
    // empty grid is the only available signal that the filter excluded posts.
    await submitSearchExpectingNothing(page, 'rating:safe solo')
  })

  test('both boards render without console errors', async ({ page }) => {
    await openApp(page)
    const errors = collectConsoleErrors(page)
    await selectSource(page, 'rule34')
    await submitSearch(page, 'solo')
    await selectSource(page, 'e621')
    await submitSearch(page, 'solo')
    expect(errors).toEqual([])
  })
})