import he from 'he'
import type { CanonicalRating, Post, PostFlags } from '../types'

/**
 * Rule34 wire-format → canonical `Post`.
 *
 * Pure: no network, no clock, no shared state. Every mapping here was
 * verified against the live API on 2026-10-01; see
 * `openspec/changes/add-e621-support/design.md` §2 for the field table and the
 * gotchas each mapping exists to handle.
 */

/**
 * Rule34's rating vocabulary is exactly two values wide — it has no safe
 * content at all. The one anomaly observed is a single capitalized
 * `"Explicit"` record, so matching is case-insensitive.
 */
export function normalizeRating(raw: unknown): CanonicalRating {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'questionable') return 'questionable'
  // Anything else resolves to `explicit` deterministically rather than to a
  // permissive value. Rule34 exposes nothing less restrictive than explicit,
  // so there is no safer rating this could have been.
  return 'explicit'
}

/**
 * Rule34 sends tags as one space-delimited string containing undecoded HTML
 * entities. Entities are decoded per tag rather than across the joined string,
 * so an entity that itself encodes whitespace cannot split one tag into two.
 */
export function normalizeTags(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split(/\s+/)
    .filter((tag) => tag.length > 0)
    .map((tag) => he.decode(tag))
}

/**
 * Rule34 has no extension field — the extension comes from the `image`
 * basename, which carries the extension. The media URL's own extension is the
 * fallback for when `image` is absent.
 *
 * `image` is preferred because it is the field Rule34 populates for every
 * post; the URL fallback only matters if `image` is missing.
 */
export function deriveFileExt(image: unknown, fileUrl: string | null): string {
  const fromImage = extensionOf(String(image ?? ''))
  if (fromImage) return fromImage
  return fileUrl ? extensionOf(fileUrl) : ''
}

function extensionOf(value: string): string {
  const basename = value.split('?')[0].split('/').pop() ?? ''
  const dot = basename.lastIndexOf('.')
  // `dot > 0` so a dotfile with no extension is not read as one.
  return dot > 0 ? basename.slice(dot + 1).toLowerCase() : ''
}

/** Normalizes a URL field, treating empty and null alike as absent. */
function url(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value === '' ? null : value
}

/**
 * Maps one Rule34 index/detail entry onto the canonical shape.
 *
 * `params` carries the request context because the timestamp is
 * last-modified: Rule34 exposes no creation timestamp at all, so `change` is
 * the only instant available and is not presented as a creation time.
 */
export function normalizePost(raw: unknown, params: { id?: number } = {}): Post {
  const p = (raw ?? {}) as Record<string, unknown>
  const fileUrl = url(p.file_url)

  return {
    id: params.id ?? toInt(p.id) ?? 0,
    source: 'rule34',
    tags: normalizeTags(p.tags),
    // `change` is a LAST-MODIFIED Unix-seconds value. Rule34 has no
    // `created_at`, and this is not a substitute for one.
    timestamp: toInt(p.change) ?? 0,
    rating: normalizeRating(p.rating),
    score: toInt(p.score) ?? 0,
    fileExt: deriveFileExt(p.image, fileUrl),
    fileUrl,
    previewUrl: url(p.preview_url),
    // Populated even when `sample=false`, so this is read as a plain URL and
    // never as evidence that a sample exists.
    sampleUrl: url(p.sample_url),
    // Rule34 serves a single encoding per post; no alternates exist.
    alternates: [],
    width: toInt(p.width) ?? 0,
    height: toInt(p.height) ?? 0,
    // A name string, empty on roughly 16% of posts. Empty means "no source
    // label", which is distinct from a source having one.
    sourceUrl: typeof p.source === 'string' ? p.source : '',
    // Rule34 has no duration field of any kind, only coarse duration tags
    // that are frequently absent — so duration is always probed client-side.
    duration: null,
    // `owner` is a name string and the only uploader signal; Rule34 exposes
    // no uploader id, so none is invented.
    uploaderId: null,
    uploaderName: typeof p.owner === 'string' ? p.owner : '',
    approverId: null,
    // Rule34 exposes no moderation or lifecycle flags at all.
    flags: {} as PostFlags,
  }
}

function toInt(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  const parsed = parseInt(String(raw ?? ''), 10)
  return Number.isNaN(parsed) ? null : parsed
}