import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Shared driver for the e2e specs.
 *
 * Every helper here goes through the real UI — clicking the source toggle,
 * typing in the search box — rather than poking Pinia or localStorage directly.
 * The bugs these specs were written for were all invisible at the component
 * level: a request routed to the wrong board returns 200, a dropped filter term
 * returns a valid page, and a mis-emitted rating form returns posts. Asserting
 * on the wire is only meaningful if the request came from the real code path.
 */

export type SourceId = 'rule34' | 'e621'

/** A request the app made to the proxy, with its query parsed. */
export interface CapturedRequest {
  /** Path after `/api/`, board prefix included: `e621/posts.json`, `index.php`. */
  readonly path: string
  readonly params: URLSearchParams
  /** The active source implied by the routing prefix. */
  readonly source: SourceId
}

/** True when a request is a post search, on either board's route shape. */
function isPostsRequest(request: CapturedRequest): boolean {
  return (
    request.path === 'index.php' ||
    request.path === 'e621/posts.json' ||
    request.path.startsWith('e621/posts/')
  )
}

const SEARCH_INPUT = '.search-input'
const SEARCH_BUTTON = '.search-bar button.v-btn--elevated'
const GRID_CARD = '.image-card'

/**
 * Opens the app and waits for its initial search to land.
 *
 * Every spec needs this before touching anything: the app fires a search on
 * mount, so a spec that clicks while that is still in flight races the request
 * queue against its own and produces intermittent timeouts.
 */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator(GRID_CARD).first()).toBeVisible()
}

/**
 * Selects a board through the settings panel and returns once the app is
 * interactive again.
 *
 * The dialog is dismissed with Escape rather than its close button: picking a
 * board leaves the panel open, and the close button's accessible name is
 * ambiguous with the app bar's own controls once both are mounted.
 */
export async function selectSource(page: Page, source: SourceId): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: source === 'e621' ? 'e621' : 'Rule34' }).click()
  const label = source === 'e621' ? 'e621' : 'Rule34'
  await expect(page.locator('.source-chip')).toHaveText(label)

  await page.keyboard.press('Escape')
  await expect(page.locator(SEARCH_BUTTON)).toBeEnabled()
}

/**
 * Records every proxy request the app makes. Starts listening before the action
 * under test so the first request of a search is never missed.
 */
export function captureRequests(page: Page): { requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return

    // Rule34 is served from `/api/index.php` with no board prefix, while e621 is
    // `/api/e621/<file>`. Splitting the pathname positionally would yield an
    // empty segment for the Rule34 shape, so the prefix is matched explicitly.
    const afterApi = url.pathname.slice('/api/'.length)
    const routed: SourceId = afterApi.startsWith('e621/') ? 'e621' : 'rule34'
    requests.push({
      path: afterApi,
      params: url.searchParams,
      source: routed,
    })
  })
  return { requests }
}

/** Clears the box and types a query without submitting it. */
export async function typeQuery(page: Page, query: string): Promise<void> {
  const input = page.locator(SEARCH_INPUT)
  await input.fill('')
  await input.fill(query)
}

/**
 * Submits the search and waits for a real response, then for the grid to fill.
 *
 * Use `submitSearchExpectingNothing` for a query whose correct answer is zero
 * results: waiting for a card here would hang on exactly the case the caller is
 * trying to prove.
 */
export async function submitSearch(page: Page, query: string): Promise<void> {
  await submit(page, query)
  await expect(page.locator(GRID_CARD).first()).toBeVisible()
}

/** Submits a search and waits for the grid to settle on zero cards. */
export async function submitSearchExpectingNothing(page: Page, query: string): Promise<void> {
  await submit(page, query)
  await expect(page.locator(GRID_CARD)).toHaveCount(0)
}

async function submit(page: Page, query: string): Promise<void> {
  await typeQuery(page, query)
  const response = page.waitForResponse((r) => /\/api\/.+\.json|\/api\/index\.php/.test(r.url()))
  await page.locator(SEARCH_BUTTON).click()
  await response
}

/** Opens the lightbox on the nth grid card and waits for it to be ready. */
export async function openLightbox(page: Page, index = 0): Promise<Locator> {
  await page.locator(GRID_CARD).nth(index).click()
  const lightbox = page.locator('.lightbox-counter')
  await expect(lightbox).toBeVisible()
  return lightbox
}

/**
 * The posts request for a source, ignoring tag-completion and detail calls.
 *
 * Returns the *last* match rather than the first: the app fires an untargeted
 * search on mount and again on every source switch, so the first captured match
 * is routinely the empty one and asserting on it passes vacuously.
 */
export function postsRequest(
  requests: readonly CapturedRequest[],
  source: SourceId,
): CapturedRequest | undefined {
  return requests.filter((r) => r.source === source && isPostsRequest(r)).at(-1)
}

/**
 * The last posts request for a source that actually carried a tag filter.
 *
 * Duration probing issues follow-up requests with a single `id:` term after the
 * user's search has already gone out, so an unfiltered search can be the most
 * recent match even though it is not the one under test. Specs asserting on
 * emitted filters must use this rather than `postsRequest`, or they assert
 * against the probe.
 */
export function filteredPostsRequest(
  requests: readonly CapturedRequest[],
  source: SourceId,
): CapturedRequest | undefined {
  return requests.filter((r) => r.source === source && sentTags(r).length > 0 && isPostsRequest(r)).at(-1)
}

/**
 * Reads the `tags` value the app actually sent upstream. Returns the empty
 * string when no filter was sent, since Rule34 expresses ordering and rating as
 * tags rather than as separate parameters.
 */
export function sentTags(request: CapturedRequest | undefined): string {
  return request?.params.get('tags') ?? ''
}

/** Every error-level console message, so specs can assert a clean console. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}