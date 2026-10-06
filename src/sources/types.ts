/**
 * Canonical, source-agnostic types for the multi-source adapter layer.
 *
 * Every board's wire format is normalized into these shapes by its own
 * adapter, so nothing downstream of an adapter branches on which board
 * produced a post. Board-specific knowledge lives only in
 * `src/sources/<source>/`.
 *
 * Facts encoded here were verified against the live APIs on 2026-10-01.
 * See `openspec/changes/add-e621-support/design.md` for the evidence.
 */

export type SourceId = 'rule34' | 'e621'

/** The rating scale both boards are mapped onto. */
export const CANONICAL_RATINGS = ['safe', 'questionable', 'explicit'] as const
export type CanonicalRating = (typeof CANONICAL_RATINGS)[number]

export const DEFAULT_SOURCE_ID: SourceId = 'rule34'

/** Single enumeration of every source id, in registry order. */
export const SOURCE_IDS = ['rule34', 'e621'] as const satisfies readonly SourceId[]

/**
 * Narrows an untrusted string to a known source id.
 *
 * Storage is user-writable and may hold an id from a build that knew a source
 * this one does not, so an unknown id must fall back to the default rather than
 * reach the registry as-is.
 */
export function isSourceId(value: unknown): value is SourceId {
  return typeof value === 'string' && (SOURCE_IDS as readonly string[]).includes(value)
}

/** Fields a source can order by. Restricted to what the sources honor. */
export const SORT_FIELDS = ['id', 'score', 'date'] as const
export type SortField = (typeof SORT_FIELDS)[number]

export type SortDirection = 'asc' | 'desc'

/**
 * How a source authenticates. Both boards fail *open* on a bad or
 * unparseable rating, so nothing here implies a credential can be validated.
 *
 * - `query`  — credentials travel as request parameters (Rule34).
 * - `basic`  — HTTP `Authorization: Basic` header only (e621).
 */
export type AuthMechanism = 'query' | 'basic'

/**
 * Capability descriptor. Each source declares what it actually supports;
 * the UI reads this instead of probing for methods or hardcoding a board.
 *
 * Video support is derived from a non-empty `videoExtensions` — there is
 * deliberately no separate boolean flag, so the two can never disagree.
 */
export interface SourceCapabilities {
  /** Rating filtering is honored via a `rating:` search term. */
  readonly ratingFilter: boolean
  /**
   * Canonical ratings this source can express. Rule34 has no `safe` posts
   * at all, so its set is two values wide (verified 2026-10-01).
   */
  readonly ratings: readonly CanonicalRating[]
  /** A native `date:` operator exists and is forwarded rather than synthesized. */
  readonly nativeDateFilter: boolean
  /** No source declares a native duration operator; duration is always probed clientside. */
  readonly nativeDurationFilter: boolean
  /** Ordering is honored; `sortFields` are the only fields it honors. */
  readonly ordering: boolean
  /** Fields this source can order by. Empty when `ordering` is false. */
  readonly sortFields: readonly SortField[]
  /** Tag completion is available. */
  readonly tagCompletion: boolean
  /** Maximum page size. Over-limit fails differently per source. */
  readonly maxPageSize: number
  readonly authMechanism: AuthMechanism
  /** Every host this source serves media from, for the SSRF allowlist and CSP. */
  readonly mediaHosts: readonly string[]
  /**
   * Container codecs this source serves as video, as the source's own values
   * (lowercase, no dot). A non-empty array means video is supported. The set is
   * per adapter because the two boards do not overlap: Rule34 serves mp4 and
   * gif with no webm mirror on any host, e621 serves webm and mp4.
   */
  readonly videoExtensions: readonly string[]
  /** Minimum milliseconds between requests to this source. */
  readonly minRequestInterval: number
}

/**
 * Moderation/lifecycle flags. e621 exposes all six; Rule34 exposes none,
 * so its entries record absence rather than substituting a plausible value.
 */
export interface PostFlags {
  pending?: boolean
  flagged?: boolean
  noteLocked?: boolean
  statusLocked?: boolean
  ratingLocked?: boolean
  deleted?: boolean
}

/**
 * The single internal post representation. Every adapter maps its own wire
 * format onto this shape; no application code reads a wire field directly.
 */
export interface Post {
  /** Post id — unique only within its own source. */
  readonly id: number
  /** Which source produced this post. */
  readonly source: SourceId
  /** Flattened tag list; prefixes (`artist:`) are preserved. */
  readonly tags: readonly string[]
  /**
   * Unix seconds. On Rule34 this is `change` — a LAST-MODIFIED time, since
   * Rule34 exposes no creation timestamp at all. On e621 it is `created_at`.
   */
  readonly timestamp: number
  readonly rating: CanonicalRating
  readonly score: number
  readonly fileExt: string
  /** Full media URL, or null when the file is pending/deleted. */
  readonly fileUrl: string | null
  readonly previewUrl: string | null
  /**
   * Sample URL, or null. Guarded on URL truthiness, never key presence:
   * e621 always emits the `sample.url` key and sets it null when absent.
   */
  readonly sampleUrl: string | null
  /** Alternate representations, e.g. an mp4 alternate for a webm post. */
  readonly alternates: readonly MediaAlternate[]
  readonly width: number
  readonly height: number
  /** Origin label(s) as untrusted free text; empty when the source has none. */
  readonly sourceUrl: string
  /** Seconds, fractional preserved. Null means unknown, not zero. */
  readonly duration: number | null
  readonly uploaderId: number | null
  readonly uploaderName: string
  readonly approverId: number | null
  readonly flags: PostFlags
}

/** An alternate encoding or representation of a post's media. */
export interface MediaAlternate {
  readonly url: string
  readonly ext: string
  /** True when this is the encoding the client prefers for playback. */
  readonly preferred: boolean
}

/** A canonical search request, before per-source translation. */
export interface SearchRequest {
  /** Canonical query text (may contain `rating:`/`sort:`/`date:` terms). */
  readonly query: string
  readonly page: number
  readonly limit: number
}

/** One uniform completion suggestion, whatever the upstream shape was. */
export interface AutocompleteSuggestion {
  readonly label: string
  readonly value: string
  /** Null when the source supplies no post count — never reported as 0. */
  readonly count: number | null
}

/** A search result plus anything the source could not honor. */
export interface SearchOutcome {
  readonly posts: readonly Post[]
  /**
   * Terms that were not sent and not honored, each with the reason. Never
   * silently discarded — the reporting layer surfaces every entry.
   */
  readonly dropped: readonly DroppedTerm[]
}

export interface DroppedTerm {
  /** The term exactly as the user typed it, so they can recognize it. */
  readonly term: string
  readonly reason: string
}

/** A failure classified by its real cause, never flattened to "failed". */
export class SourceRequestError extends Error {
  constructor(
    message: string,
    readonly kind: SourceErrorKind,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message)
    this.name = 'SourceRequestError'
  }
}

export type SourceErrorKind =
  | 'rate-limited'
  | 'auth'
  | 'page-size'
  | 'network'
  | 'parse'

/**
 * The contract every source implements.
 *
 * It is the union of every capability any source might need, with no
 * optional methods: a source that lacks a capability still satisfies this
 * interface and simply declares that capability as unsupported, so call
 * sites never probe for methods.
 *
 * There is deliberately no `searchUrl()` member. CSP host coverage is
 * derived from the already-declared `capabilities.mediaHosts`, so a
 * URL-building method would exist for a single consumer.
 */
export interface SourceAdapter {
  readonly id: SourceId
  readonly label: string
  readonly capabilities: SourceCapabilities

  /** Search posts, returning canonical posts and any unhonored terms. */
  search(request: SearchRequest): Promise<SearchOutcome>

  /** Tag completion in the uniform suggestion shape. */
  autocomplete(query: string): Promise<AutocompleteSuggestion[]>

  /** Fetch a single post by its source-local id. */
  postDetail(id: number): Promise<Post>
}
