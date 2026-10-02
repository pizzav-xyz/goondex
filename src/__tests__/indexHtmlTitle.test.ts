/**
 * Site-name single-source test. The app bar and the document title must never
 * disagree, and the title cannot be reached at runtime, so this test pins the
 * two ends of the contract: index.html carries a placeholder rather than a
 * literal, and the build transform resolves it to SITE_NAME — or fails loudly.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SITE_NAME } from '@/constants/site'
import { indexHtmlPlugin } from '../../vite.config'

const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8')

const plugin = indexHtmlPlugin() as unknown as {
  transformIndexHtml: (html: string, ctx: { server?: unknown }) => string
}

describe('the site name has exactly one source', () => {
  it('is a non-empty display name', () => {
    expect(SITE_NAME).toBe('goondex')
  })

  it('lives in a constants module, not in a component or template', () => {
    const appShell = readFileSync(
      resolve(__dirname, '../components/AppShell.vue'),
      'utf-8',
    )
    expect(appShell).toContain('SITE_NAME')
    expect(appShell).not.toContain(`>${SITE_NAME}<`)
  })

  it('is not hardcoded in index.html', () => {
    expect(indexHtml).not.toContain(SITE_NAME)
    expect(indexHtml).toContain('%SITE_NAME%')
  })

  it('resolves into the title in a dev-server context', () => {
    const out = plugin.transformIndexHtml(indexHtml, { server: {} })
    expect(out).toContain(`<title>${SITE_NAME}</title>`)
    expect(out).not.toContain('%SITE_NAME%')
  })

  it('resolves into the title in a production build', () => {
    const out = plugin.transformIndexHtml(indexHtml, {})
    expect(out).toContain(`<title>${SITE_NAME}</title>`)
    expect(out).not.toContain('%SITE_NAME%')
  })

  it('fails loudly instead of shipping an empty title', () => {
    const withoutPlaceholder = indexHtml.replace('%SITE_NAME%', '')
    expect(() => plugin.transformIndexHtml(withoutPlaceholder, {})).toThrow(
      /index\.html is missing/,
    )
  })
})
