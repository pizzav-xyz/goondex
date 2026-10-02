import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizePost, type E621WirePost } from '@/sources/e621/normalize'
import { E621_CAPABILITIES } from '@/sources/e621'

/**
 * e621 wire → canonical mapping, backed by responses captured from the live
 * API on 2026-10-01 (see task 5.8). Each `named regression` test guards a
 * specific verified quirk that a plausible-looking refactor would reintroduce.
 *
 * The fixtures are safe-rated only, so no explicit content is checked in.
 */

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tests', 'fixtures')

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8')
}

function loadPosts(name = 'e621_posts.json'): E621WirePost[] {
  return (JSON.parse(loadFixture(name)) as { posts: E621WirePost[] }).posts
}

function loadPost(name: string): E621WirePost {
  return (JSON.parse(loadFixture(name)) as { post: E621WirePost }).post
}

/** A copy of a real post with overrides applied, for the trap cases. */
function withOverrides(post: E621WirePost, overrides: Record<string, unknown>): E621WirePost {
  return { ...post, ...overrides } as E621WirePost
}

describe('legacy response shape', () => {
  it('unwraps {"posts":[…]} for search', () => {
    const parsed = JSON.parse(loadFixture('e621_posts.json')) as { posts: unknown[] }
    expect(Array.isArray(parsed.posts)).toBe(true)
    expect(parsed.posts.length).toBeGreaterThan(0)
  })

  it('unwraps {"post":{…}} for detail', () => {
    const parsed = JSON.parse(loadFixture('e621_post_detail.json')) as { post: { id: number } }
    expect(parsed.post.id).toBe(loadPost('e621_post_detail.json').id)
  })
})

describe('timestamps', () => {
  // Named regression: e621's offsets are SERVER-LOCAL, not the +00:00 the
  // docs claim. Assuming UTC shifts every timestamp by hours, which silently
  // misplaces every post relative to any date filter.
  it('named regression: parses the -04:00 offset rather than assuming UTC', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), {
      created_at: '2026-10-01T13:44:40.176-04:00',
    })
    const canonical = normalizePost(post)
    // 13:44:40 at UTC-4 is 17:44:40Z.
    expect(new Date(canonical.timestamp * 1000).toISOString()).toBe('2026-10-01T17:44:40.176Z')
  })

  it('named regression: parses the -05:00 offset used by older posts', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), {
      created_at: '2019-03-04T08:15:00.000-05:00',
    })
    const canonical = normalizePost(post)
    expect(new Date(canonical.timestamp * 1000).toISOString()).toBe('2019-03-04T13:15:00.000Z')
  })

  it('produces Unix seconds from the offset-aware ISO string', () => {
    for (const post of loadPosts()) {
      const canonical = normalizePost(post)
      expect(canonical.timestamp).toBeCloseTo(
        new Date(post.created_at).getTime() / 1000, 3,
      )
    }
  })
})

describe('tag categories', () => {
  const ALL_KEYS = [
    'general', 'artist', 'contributor', 'copyright',
    'character', 'species', 'invalid', 'meta', 'lore',
  ] as const satisfies readonly (keyof E621WirePost['tags'])[]

  it('uses exactly these nine keys — the key is `meta`, not `metatag`', () => {
    expect(Object.keys(loadPost('e621_post_detail.json').tags).sort()).toEqual([...ALL_KEYS].sort())
  })

  // Named regression: `contributor` and `meta` are both real and both easy to
  // miss. Dropping either silently loses tags the user could search for.
  it('named regression: flattens contributor and meta, not just the obvious ones', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), {
      tags: {
        general: ['solo'], artist: ['someone'], contributor: ['a_contributor'],
        copyright: ['a_copyright'], character: ['a_character'], species: ['a_species'],
        invalid: [], meta: ['a_metatag'], lore: [],
      },
    })
    const tags = normalizePost(post).tags
    expect(tags).toContain('a_contributor')
    expect(tags).toContain('a_metatag')
    // Seven non-empty categories contribute one tag each.
    expect(tags).toHaveLength(7)
  })

  it('flattens every category of a real post', () => {
    const post = loadPost('e621_post_detail.json')
    const wireCount = ALL_KEYS.reduce((n, key) => n + post.tags[key].length, 0)
    expect(normalizePost(post).tags).toHaveLength(wireCount)
  })
})

describe('nullable URLs', () => {
  // Named regression: `sample.url` is ALWAYS present as a key and is null when
  // absent — even under `has: true` for a deleted or pending file. Guarding on
  // key presence yields a null URL rendered as a broken image.
  it('named regression: a null sample url under has:true is null, not a URL', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), {
      sample: { has: true, width: 1063, height: 850, url: null, alt: null, alternates: null },
    })
    expect(normalizePost(post).sampleUrl).toBeNull()
  })

  it('tolerates a null file url on a pending post', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), {
      file: { ...loadPost('e621_post_detail.json').file, url: null },
      flags: { ...loadPost('e621_post_detail.json').flags, pending: true },
    })
    const canonical = normalizePost(post)
    expect(canonical.fileUrl).toBeNull()
    expect(canonical.flags.pending).toBe(true)
  })

  it('tolerates a null preview url on a deleted post', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), {
      preview: { ...loadPost('e621_post_detail.json').preview, url: null },
      flags: { ...loadPost('e621_post_detail.json').flags, deleted: true },
    })
    const canonical = normalizePost(post)
    expect(canonical.previewUrl).toBeNull()
    expect(canonical.flags.deleted).toBe(true)
  })

  // Named regression: width/height stay populated even when has:false, so they
  // are not a has-sample signal.
  it('named regression: populated dimensions under has:false are not a sample signal', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), {
      sample: { has: false, width: 1063, height: 850, url: null, alt: null, alternates: null },
    })
    expect(normalizePost(post).sampleUrl).toBeNull()
  })
})

describe('score', () => {
  // Named regression: `down` can be NEGATIVE, so it must not be assumed to
  // have a sign; `total` is the value to use.
  it('named regression: uses total and tolerates a negative down', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), {
      score: { up: 10, down: -2, total: 8 },
    })
    expect(normalizePost(post).score).toBe(8)
  })

  it('matches the score on every captured video post', () => {
    for (const post of loadPosts('e621_posts_video.json')) {
      expect(normalizePost(post).score).toBe(post.score.total)
    }
  })
})

describe('duration', () => {
  // Named regression: duration is a FLOAT in seconds and is null on non-video
  // (not 0, not absent). An int parse would truncate 0.999983 to 0.
  it('named regression: preserves fractional seconds', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), { duration: 0.999983 })
    expect(normalizePost(post).duration).toBe(0.999983)
  })

  it('is null on a non-video post rather than zero', () => {
    for (const post of loadPosts()) {
      expect(normalizePost(post).duration).toBeNull()
    }
  })

  it('preserves a long float duration', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), { duration: 674.377143 })
    expect(normalizePost(post).duration).toBe(674.377143)
  })
})

describe('rating', () => {
  it('maps all three e621 rating values', () => {
    const base = loadPost('e621_post_detail.json')
    expect(normalizePost(withOverrides(base, { rating: 's' })).rating).toBe('safe')
    expect(normalizePost(withOverrides(base, { rating: 'q' })).rating).toBe('questionable')
    expect(normalizePost(withOverrides(base, { rating: 'e' })).rating).toBe('explicit')
  })
})

describe('uploader and sources', () => {
  // Named regression: e621 has uploader_id/uploader_name and NO creator_* or
  // top-level status/is_pending.
  it('named regression: reads e621\'s real uploader names', () => {
    const canonical = normalizePost(loadPost('e621_post_detail.json'))
    expect(canonical.uploaderId).toBe(loadPost('e621_post_detail.json').uploader_id)
    expect(canonical.uploaderName).toBe(loadPost('e621_post_detail.json').uploader_name)
  })

  // Named regression: `sources` is an ARRAY (possibly empty) and there is no
  // singular `source` field.
  it('named regression: joins the sources array and tolerates an empty one', () => {
    const base = loadPost('e621_post_detail.json')
    expect(normalizePost(withOverrides(base, { sources: ['https://a.example/x'] })).sourceUrl)
      .toBe('https://a.example/x')
    expect(normalizePost(withOverrides(base, { sources: [] })).sourceUrl).toBe('')
  })
})

describe('flags', () => {
  it('maps all six booleans', () => {
    const canonical = normalizePost(loadPost('e621_post_detail.json'))
    expect(canonical.flags).toEqual({
      pending: false, flagged: false, noteLocked: false,
      statusLocked: false, ratingLocked: false, deleted: false,
    })
  })
})

describe('file extension', () => {
  it('prefers the dedicated ext field', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), {
      file: { ...loadPost('e621_post_detail.json').file, ext: 'png' },
    })
    expect(normalizePost(post).fileExt).toBe('png')
  })

  it('falls back to the url path only when ext is absent', () => {
    const file = { ...loadPost('e621_post_detail.json').file, ext: null }
    const post = withOverrides(loadPost('e621_post_detail.json'), { file })
    expect(normalizePost(post).fileExt).toBe('jpg')
  })
})

describe('media alternates', () => {
  // Named regression: `alternates.variants` is an OBJECT keyed by extension,
  // not an array. Iterating it as an array yields nothing, so the mp4
  // alternate for a webm post is never found and playback falls back to a
  // browser that may not support the container.
  it('named regression: variants is keyed by extension, and mp4 is preferred', () => {
    const [webmPost] = loadPosts('e621_posts_video.json')
    const alternates = normalizePost(webmPost).alternates
    const mp4 = alternates.find((a) => a.ext === 'mp4')
    expect(mp4).toBeDefined()
    expect(mp4?.preferred).toBe(true)
    expect(webmPost.file.ext).toBe('webm')
  })

  it('carries a webp alt when the source supplies one', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), {
      sample: {
        has: true, width: 320, height: 256,
        url: 'https://static1.e621.net/sample.webp',
        alt: 'https://static1.e621.net/sample_alt.webp',
        alternates: null,
      },
    })
    const alternates = normalizePost(post).alternates
    expect(alternates.some((a) => a.ext === 'webp')).toBe(true)
  })

  it('is empty when there are no alternates', () => {
    const post = withOverrides(loadPost('e621_post_detail.json'), {
      sample: { has: false, width: 0, height: 0, url: null, alt: null, alternates: null },
    })
    expect(normalizePost(post).alternates).toEqual([])
  })
})

describe('capabilities', () => {
  it('declares the live-verified limits and hosts', () => {
    expect(E621_CAPABILITIES.maxPageSize).toBe(320)
    expect(E621_CAPABILITIES.nativeDateFilter).toBe(true)
    expect(E621_CAPABILITIES.ordering).toBe(true)
    expect(E621_CAPABILITIES.authMechanism).toBe('basic')
    expect(E621_CAPABILITIES.mediaHosts).toEqual(['static1.e621.net', 'static1.e926.net'])
    expect(E621_CAPABILITIES.videoExtensions).toEqual(['webm', 'mp4'])
  })
})