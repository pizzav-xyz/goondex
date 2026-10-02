/**
 * e621 wire format → canonical Post normalizer.
 *
 * Facts encoded here were verified against live e621 (e621ng@9ecbb7e + live)
 * on 2026-10-01. See design.md Decision 2 for the mapping table.
 *
 * Traps the normalizer owns (all live-verified):
 * - `sample.url` is ALWAYS present as a key and is `null` when absent, even
 *   under `has: true` for a deleted/pending file. Guard on URL truthiness,
 *   never on key presence.
 * - `file.url`/`preview.url` are likewise nullable (pending/deleted posts).
 * - `tags` is an object of 9 category arrays — EXACTLY `general, artist,
 *   contributor, copyright, character, species, invalid, meta, lore`. Both
 *   `meta` and `contributor` are real and easily missed; both must be
 *   flattened.
 * - `duration` is a top-level FLOAT in seconds, `null` on non-video (not 0,
 *   not absent). Prefer it; probe only when null.
 * - `score.down` CAN be negative; use `total`.
 * - Timestamps are ISO 8601 with a SERVER-LOCAL offset (e.g. `-04:00`,
 *   `-05:00` on older posts). Parse offset-aware; never assume UTC.
 * - `alternates.variants` is an OBJECT keyed by extension (`mp4`, `webm`),
 *   not an array. The mp4 alternate is preferred for playback.
 * - `sample.alt` is a nullable webp URL.
 */

import type { Post, MediaAlternate, SourceId } from '../types'
import { parseISO } from 'date-fns'

const TAG_CATEGORIES = [
  'general', 'artist', 'contributor', 'copyright',
  'character', 'species', 'invalid', 'meta', 'lore',
] as const

/** Rating: server single-char → canonical. */
const RATING_MAP: Record<string, Post['rating']> = {
  s: 'safe',
  q: 'questionable',
  e: 'explicit',
}

export function normalizePost(e621Post: E621WirePost): Post {
  const tagArray = flattenTags(e621Post.tags)
  const timestamp = parseISO(e621Post.created_at).getTime() / 1000

  return {
    id: e621Post.id,
    source: 'e621' as SourceId,
    tags: tagArray,
    timestamp,
    rating: RATING_MAP[e621Post.rating] ?? 'explicit',
    score: e621Post.score.total,
    fileExt: e621Post.file.ext ?? inferExt(e621Post.file.url),
    fileUrl: e621Post.file.url,
    previewUrl: e621Post.preview.url,
    sampleUrl: e621Post.sample.url,
    alternates: buildAlternates(e621Post.sample.alternates, e621Post.sample.alt),
    width: e621Post.file.width,
    height: e621Post.file.height,
    sourceUrl: e621Post.sources?.join(', ') ?? '',
    duration: e621Post.duration,
    uploaderId: e621Post.uploader_id,
    uploaderName: e621Post.uploader_name,
    approverId: e621Post.approver_id,
    flags: {
      pending: e621Post.flags.pending,
      flagged: e621Post.flags.flagged,
      noteLocked: e621Post.flags.note_locked,
      statusLocked: e621Post.flags.status_locked,
      ratingLocked: e621Post.flags.rating_locked,
      deleted: e621Post.flags.deleted,
    },
  }
}

/** Flatten the 9 tag-category arrays into one array, preserving prefixes. */
function flattenTags(tags: E621Tags): readonly string[] {
  return TAG_CATEGORIES.flatMap((cat) => tags[cat] ?? [])
}

function inferExt(url: string | null): string {
  if (!url) return 'unknown'
  const m = url.match(/\.([a-z0-9]+)(?:\?|$)/i)
  return m ? m[1].toLowerCase() : 'unknown'
}

/**
 * Alternate encodings for a post's media, preferring mp4 for playback.
 *
 * `alternates` is `{}` on ordinary image posts, which is truthy — so the
 * variants object is read for keys rather than the alternates object being
 * tested for existence. Guarding on `alternates` alone would drop the webp
 * `sample.alt` that every image post actually carries.
 */
function buildAlternates(
  alternates: E621SampleAlternates | null,
  sampleAlt: string | null,
): readonly MediaAlternate[] {
  const list: MediaAlternate[] = []

  for (const [ext, data] of Object.entries(alternates?.variants ?? {})) {
    if (data.url) {
      list.push({
        url: data.url,
        ext: ext.toLowerCase(),
        preferred: ext.toLowerCase() === 'mp4',
      })
    }
  }

  if (sampleAlt) {
    list.push({ url: sampleAlt, ext: 'webp', preferred: false })
  }

  return list
}

/* ──────────────────────────────────────────────────────────────────────────
 * Wire-format types (subset). These are a single source of truth copied from
 * e621's OpenAPI spec (DonovanDMC/E621OpenAPI). Do not add fields the
 * normalizer does not read — unknown fields are ignored.
 * ────────────────────────────────────────────────────────────────────────── */

export interface E621WirePost {
  id: number
  created_at: string
  updated_at: string
  file: { width: number; height: number; ext: string | null; size: number; md5: string; url: string | null }
  preview: { width: number; height: number; url: string | null; alt: string | null }
  sample: {
    has: boolean
    width: number
    height: number
    url: string | null
    alt: string | null
    alternates: E621SampleAlternates | null
  }
  score: { up: number; down: number; total: number }
  tags: E621Tags
  rating: 's' | 'q' | 'e'
  sources: string[] | null
  uploader_id: number | null
  uploader_name: string
  approver_id: number | null
  flags: E621Flags
  duration: number | null
}

interface E621Tags {
  general: readonly string[]
  artist: readonly string[]
  contributor: readonly string[]
  copyright: readonly string[]
  character: readonly string[]
  species: readonly string[]
  invalid: readonly string[]
  meta: readonly string[]
  lore: readonly string[]
}

interface E621Flags {
  pending: boolean
  flagged: boolean
  note_locked: boolean
  status_locked: boolean
  rating_locked: boolean
  deleted: boolean
}

interface E621SampleAlternates {
  has: boolean
  original: { fps: number; codec: string; size: number; width: number; height: number; url: string }
  variants: Record<string, { fps: number; codec: string; size: number; width: number; height: number; url: string }>
  samples: Record<string, { width: number; height: number; url: string }>
}