import { describe, expect, it } from 'vitest'
import { deriveFileExt, normalizePost, normalizeRating, normalizeTags } from '@/sources/rule34/normalize'

/**
 * Rule34 wire → canonical mapping. These lock in the field quirks verified on
 * 2026-10-01; each `named regression` test below guards a specific one that
 * would otherwise be silently reintroduced by a plausible-looking refactor.
 */

describe('rating vocabulary', () => {
  it('maps both of Rule34\'s two real ratings', () => {
    expect(normalizeRating('explicit')).toBe('explicit')
    expect(normalizeRating('questionable')).toBe('questionable')
  })

  it('is case-insensitive, per the one observed capitalized record', () => {
    expect(normalizeRating('Explicit')).toBe('explicit')
    expect(normalizeRating('QUESTIONABLE')).toBe('questionable')
  })

  // Named regression: Rule34 has no safe content, so `safe` must NOT map to
  // `safe` — that would invent a rating the board cannot express.
  it('named regression: safe does not survive normalization on Rule34', () => {
    expect(normalizeRating('safe')).toBe('explicit')
    expect(normalizeRating('general')).toBe('explicit')
    expect(normalizeRating('neutral')).toBe('explicit')
  })

  it('resolves deterministically rather than permissively when unrecognized', () => {
    expect(normalizeRating('nonsense')).toBe('explicit')
    expect(normalizeRating(undefined)).toBe('explicit')
    expect(normalizeRating(null)).toBe('explicit')
  })
})

describe('tag normalization', () => {
  it('splits the space-delimited string into individual tags', () => {
    expect(normalizeTags('solo female')).toEqual(['solo', 'female'])
  })

  it('leaves no element containing a delimiter', () => {
    const tags = normalizeTags('solo  female\tanal')
    expect(tags).toEqual(['solo', 'female', 'anal'])
    for (const tag of tags) {
      expect(tag).not.toMatch(/\s/)
    }
  })

  it('drops empty entries from leading, trailing, or repeated spaces', () => {
    expect(normalizeTags('  solo   female  ')).toEqual(['solo', 'female'])
  })

  // Named regression: tags arrive with HTML entities undecoded. An encoded
  // ampersand left raw breaks tag-scoped searches, since the stored tag differs
  // from the decoded one the user must type.
  it('named regression: decodes HTML entities per tag', () => {
    expect(normalizeTags('a &amp; b')).toEqual(['a', '&', 'b'])
    expect(normalizeTags('&quot;quoted&quot;')).toEqual(['"quoted"'])
  })

  it('decodes per tag so an entity encoding whitespace cannot split one tag', () => {
    // `&#32;` is a space. Decoding after splitting is also safe here, but
    // decoding the joined string would inject a tag boundary.
    expect(normalizeTags('one&#32;two')).toEqual(['one two'])
  })

  it('preserves namespace prefixes so tag-scoped searches stay expressible', () => {
    expect(normalizeTags('artist:foo metatag:bar')).toEqual(['artist:foo', 'metatag:bar'])
  })

  it('returns an empty list for a non-string or absent field', () => {
    expect(normalizeTags(undefined)).toEqual([])
    expect(normalizeTags(null)).toEqual([])
    expect(normalizeTags(42)).toEqual([])
    expect(normalizeTags('   ')).toEqual([])
  })
})

describe('file extension derivation', () => {
  // Named regression: Rule34 has NO `file_ext` field. The extension comes from
  // the `image` basename, which carries the extension.
  it('named regression: derives the extension from the image field', () => {
    expect(deriveFileExt('1/2/abcdef.jpg', null)).toBe('jpg')
    expect(deriveFileExt('1/2/abcdef.png', null)).toBe('png')
  })

  it('lower-cases the derived extension', () => {
    expect(deriveFileExt('1/2/ABC.JPEG', null)).toBe('jpeg')
  })

  it('falls back to the media URL path only when image is absent', () => {
    expect(deriveFileExt('', 'https://api-cdn.rule34.xxx/images/1/2/x.gif')).toBe('gif')
  })

  it('prefers image over the URL when both are present', () => {
    expect(deriveFileExt('y.jpg', 'https://host/x.png')).toBe('jpg')
  })

  it('strips query strings before reading the extension', () => {
    expect(deriveFileExt('', 'https://host/x.webm?token=abc')).toBe('webm')
  })

  it('does not read a dotfile with no extension as an extension', () => {
    expect(deriveFileExt('.hidden', null)).toBe('')
  })

  it('returns an empty string when nothing can be derived', () => {
    expect(deriveFileExt('', null)).toBe('')
    expect(deriveFileExt(undefined, null)).toBe('')
  })
})

describe('normalizePost', () => {
  const wire = {
    id: '12345',
    tags: 'solo female &amp; more',
    change: '1700000000',
    rating: 'explicit',
    score: '7',
    image: '1/2/abc.jpg',
    file_url: 'https://api-cdn.rule34.xxx/images/1/2/abc.jpg',
    preview_url: 'https://api-cdn.rule34.xxx/preview/1/2/abc.jpg',
    sample_url: '',
    width: '800',
    height: '600',
    source: 'some_source',
    owner: 'uploader_name',
  }

  it('produces a canonical post carrying its source', () => {
    const post = normalizePost(wire)
    expect(post.source).toBe('rule34')
    expect(post.id).toBe(12345)
    expect(post.tags).toEqual(['solo', 'female', '&', 'more'])
  })

  it('sets timestamp from change, the only timestamp Rule34 exposes', () => {
    // Named regression: `change` is LAST-MODIFIED. Rule34 exposes no creation
    // timestamp at all, so this is not presented as a creation time.
    expect(normalizePost(wire).timestamp).toBe(1700000000)
  })

  it('normalizes numeric strings from the wire', () => {
    const post = normalizePost(wire)
    expect(post.score).toBe(7)
    expect(post.width).toBe(800)
    expect(post.height).toBe(600)
  })

  it('treats an empty URL as absent rather than as an empty string', () => {
    // e621 is the board that nulls URLs; Rule34 uses empty strings. Both mean
    // absent, so an empty string must not become a truthy unusable URL.
    expect(normalizePost(wire).sampleUrl).toBeNull()
  })

  it('keeps a populated URL', () => {
    const post = normalizePost(wire)
    expect(post.fileUrl).toBe(wire.file_url)
    expect(post.previewUrl).toBe(wire.preview_url)
  })

  // Named regression: Rule34's `owner` is a name string and the ONLY uploader
  // signal. There is no uploader id to read, so none is invented.
  it('named regression: reads uploader from owner with no invented id', () => {
    const post = normalizePost(wire)
    expect(post.uploaderName).toBe('uploader_name')
    expect(post.uploaderId).toBeNull()
  })

  it('records no moderation flags, because Rule34 exposes none', () => {
    expect(normalizePost(wire).flags).toEqual({})
  })

  // Named regression: Rule34 has no duration field of any kind, so duration is
  // null (unknown) rather than 0 — a zero would read as a zero-second video.
  it('named regression: leaves duration null so it gets probed', () => {
    expect(normalizePost(wire).duration).toBeNull()
  })

  it('leaves duration null even when a duration-like field is present', () => {
    expect(normalizePost({ ...wire, duration: 42 }).duration).toBeNull()
  })

  it('distinguishes no source label from one source label', () => {
    // `source` is empty on roughly 16% of posts; that is "no source", not "a
    // source named empty".
    expect(normalizePost({ ...wire, source: '' }).sourceUrl).toBe('')
    expect(normalizePost({ ...wire, source: undefined }).sourceUrl).toBe('')
    expect(normalizePost({ ...wire, source: 'gelbooru' }).sourceUrl).toBe('gelbooru')
  })

  it('has no alternates, because Rule34 serves one encoding per post', () => {
    expect(normalizePost(wire).alternates).toEqual([])
  })

  it('survives a completely empty payload without throwing', () => {
    const post = normalizePost({})
    expect(post.tags).toEqual([])
    expect(post.fileUrl).toBeNull()
    expect(post.previewUrl).toBeNull()
    expect(post.score).toBe(0)
    expect(post.flags).toEqual({})
  })

  it('survives a null payload without throwing', () => {
    expect(() => normalizePost(null)).not.toThrow()
  })

  it('lets a supplied request-context id win over the wire id', () => {
    // Detail lookups address the post by the id that was requested, which is
    // authoritative even when the body omits or disagrees with it.
    expect(normalizePost({ ...wire, id: '999' }, { id: 12345 }).id).toBe(12345)
  })

  it('yields null media URLs for a pending post with empty urls', () => {
    const pending = normalizePost({
      ...wire,
      file_url: '',
      preview_url: '',
      sample_url: '',
    })
    expect(pending.fileUrl).toBeNull()
    expect(pending.previewUrl).toBeNull()
    expect(pending.sampleUrl).toBeNull()
  })
})