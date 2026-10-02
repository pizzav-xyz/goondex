/**
 * CSP host-coverage test. The `img-src`/`media-src` host list in index.html is
 * deliberately maintained by hand — no build-time generator for a four-host
 * list — so this test is what prevents a silent block when a source gains a
 * media host the CSP does not name: the browser would refuse the request and
 * blank the tile with no error anywhere in the app.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rule34Adapter } from '@/sources/rule34'
import { e621Adapter } from '@/sources/e621'
import { indexHtmlPlugin } from '../../../vite.config'

const indexHtml = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8')

function cspDirective(directive: string): string {
  const match = indexHtml.match(
    new RegExp(`${directive}\\s+([^;"]+)`),
  )
  if (!match) return ''
  return match[1] ?? ''
}

function cspCovers(host: string): boolean {
  // The wildcard `https://*.rule34.xxx` covers api-cdn.rule34.xxx and its
  // split video host; the two e621 hosts are named explicitly.
  const wildcard = `*.${host.split('.').slice(-2).join('.')}`
  for (const directive of ['img-src', 'media-src']) {
    const value = cspDirective(directive)
    if (value.includes(host) || value.includes(wildcard)) return true
  }
  return false
}

describe('index.html CSP covers every declared media host', () => {
  it('names a CSP meta tag at all', () => {
    expect(indexHtml).toContain('Content-Security-Policy')
  })

  it.for([...rule34Adapter.capabilities.mediaHosts, ...e621Adapter.capabilities.mediaHosts])(
    'covers %s in img-src or media-src',
    (host) => {
      expect(cspCovers(host)).toBe(true)
    },
  )

  it('keeps the wildcard form for the Rule34 video host', () => {
    // Rule34 video file_url/sample_url land on api-cdn-mp4.rule34.xxx and
    // preview_url can differ from file_url's host, so both must be covered.
    expect(cspCovers('api-cdn.rule34.xxx')).toBe(true)
    expect(cspCovers('api-cdn-mp4.rule34.xxx')).toBe(true)
  })

  it('names both e621 server hosts explicitly', () => {
    expect(cspCovers('static1.e621.net')).toBe(true)
    expect(cspCovers('static1.e926.net')).toBe(true)
  })
})

describe('the loopback connect-src exception is dev-only', () => {
  const plugin = indexHtmlPlugin() as unknown as {
    transformIndexHtml: (html: string, ctx: { server?: unknown }) => string
  }
  const devHtml = indexHtml

  it('keeps the exception in a dev-server context', () => {
    const out = plugin.transformIndexHtml(devHtml, { server: {} })
    expect(out).toContain('http://127.0.0.1:*')
  })

  it('strips the exception from a production build', () => {
    const out = plugin.transformIndexHtml(devHtml, {})
    expect(out).not.toContain('127.0.0.1:*')
    expect(out).not.toContain('localhost:*')
    expect(out).toContain('connect-src')
  })
})