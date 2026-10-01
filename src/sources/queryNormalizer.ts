/**
 * The one shared query normalizer.
 *
 * A pure function that rewrites a canonical, user-typed query into the form
 * the target source actually honors, and reports every term it could not
 * carry over. Both adapters call THIS function — the translation table is
 * never duplicated per board, because two rating tables would drift, and
 * drift there is invisible: it produces a plausible but wrong result set,
 * since BOTH boards fail open on a rating term they cannot parse.
 *
 * ## Canonical syntax
 *
 * Only these are translated. Everything else passes through verbatim, which
 * preserves each source's power-user syntax:
 *
 *   rating:<safe|questionable|explicit>   long forms ONLY
 *   sort:<id|score|date>[:asc|:desc]
 *   date:<…>                              validated, then forwarded or consumed
 *   duration:<…>                          consumed client-side on every source
 *
 * Bare tags, `-exclusion`, `~` OR-groups, and unknown `prefix:value` terms
 * pass through untouched. An unknown operator is NOT stripped: the boards'
 * operator sets cannot be enumerated reliably, so removing a term on
 * suspicion would silently discard something the user asked for.
 *
 * Verified against both live APIs on 2026-10-01.
 */

import type { DroppedTerm, SourceId } from './types'
import { canonicalizeDateTerm, validateDateTerm } from './e621DateGrammar'

export interface NormalizedQuery {
  /** The query to send upstream. Never contains a consumed or dropped term. */
  readonly query: string
  /** Terms not sent and not honored, each with a user-facing reason. */
  readonly dropped: readonly DroppedTerm[]
}

/** Terms consumed client-side, reported separately from `dropped`. */
export interface ConsumedTerms {
  /** `date:` values destined for the rate-derived id-threshold path. */
  readonly dateTerms: readonly string[]
}

export interface NormalizeResult extends NormalizedQuery {
  readonly consumed: ConsumedTerms
}

/**
 * Canonical rating values — long forms only.
 *
 * Short forms (`rating:e`) are rejected as unrecognized rather than
 * silently accepted, following the same portability rule the date grammar
 * uses. A rating the source cannot parse must never be forwarded: e621
 * *drops* an unparseable rating and returns UNFILTERED results.
 */
const CANONICAL_RATING_VALUES = ['safe', 'questionable', 'explicit'] as const

/**
 * Rating spelling per board.
 *
 * Rule34 accepts only the long forms; the short forms match nothing there.
 * e621's server reads only the FIRST CHARACTER of the value, downcased, and
 * requires it to be in {s,q,e} — so the short forms are its canonical
 * spelling and the long forms work only by accident.
 *
 * `rating:safe` on Rule34 is forwarded verbatim and matches nothing. That is
 * the CORRECT empty answer: Rule34 exposes no safe-rated posts at all.
 * Translating it would fabricate results; dropping it would return explicit
 * posts as though a safe filter had been applied.
 */
const RATING_SPELLING: Record<SourceId, Record<string, string>> = {
  rule34: {
    safe: 'rating:safe',
    questionable: 'rating:questionable',
    explicit: 'rating:explicit',
  },
  e621: {
    safe: 'rating:s',
    questionable: 'rating:q',
    explicit: 'rating:e',
  },
}

/**
 * Canonical `sort:` -> e621's `order:` token.
 *
 * e621's `order:` is a SINGLE token with an underscore suffix
 * (`order:id_desc`); the space form silently returns 0 results and the colon
 * form is invalid. Bare `order:id` means ASCENDING — the opposite of every
 * other field — which is why direction is written explicitly except where
 * bare already means descending.
 */
const E621_ORDER: Record<string, string> = {
  'id:desc': 'order:id_desc',
  'id:asc': 'order:id_asc',
  'score:desc': 'order:score',
  'score:asc': 'order:score_asc',
  'date:desc': 'order:created_desc',
  'date:asc': 'order:created_asc',
}

const RULE34_SORT_DROP_REASON =
  'Ordering is not supported on Rule34; results are newest first. The sort term was not sent.'

/** A `duration:` term is consumed client-side on every source. */
const DURATION_RE = /^duration:/
/** A `date:` term, capture only the value. */
const DATE_RE = /^date:(.*)$/
/** Leading exclusion marker, if any. */
const NEGATION_RE = /^-(.*)$/

/**
 * Normalize a canonical query for one target source.
 *
 * Pure: the result depends only on the two arguments — no network, no clock,
 * no shared mutable state — so the whole translation matrix is unit-testable
 * without a running proxy.
 */
export function normalizeQueryDetailed(
  canonicalQuery: string,
  target: SourceId,
): NormalizeResult {
  const dropped: DroppedTerm[] = []
  const dateTerms: string[] = []
  const out: string[] = []

  for (const token of tokenize(canonicalQuery)) {
    // Preserve a leading exclusion marker; translate the rest.
    const negation = token.match(NEGATION_RE)
    const body = negation ? negation[1] : token
    const prefix = negation ? '-' : ''

    // ── duration: — consumed client-side on EVERY source ────────────────
    if (DURATION_RE.test(body)) {
      // Honored by another mechanism, so NOT a drop.
      continue
    }

    // ── date: — consumed on Rule34, validated + forwarded on e621 ───────
    const dateMatch = body.match(DATE_RE)
    if (dateMatch) {
      const value = dateMatch[1]
      if (target === 'rule34') {
        // Rule34 has NO date or time operator at all and zeroes any unknown
        // qualified tag, so the term is routed into the rate-derived id
        // threshold and never sent upstream.
        dateTerms.push(value)
        continue
      }

      const validation = validateDateTerm(value)
      if (!validation.valid) {
        // Rejected rather than forwarded: e621 answers a malformed date with
        // HTTP 422, which is a different condition from a valid empty result.
        dropped.push({ term: token, reason: validation.reason ?? 'Invalid date syntax.' })
        continue
      }
      out.push(`${prefix}date:${canonicalizeDateTerm(value)}`)
      continue
    }

    // ── rating: — translated to the board's own spelling ────────────────
    if (body.startsWith('rating:')) {
      const value = body.slice('rating:'.length).toLowerCase()
      if (!(CANONICAL_RATING_VALUES as readonly string[]).includes(value)) {
        // Never forwarded: an unparseable rating FAILS OPEN, silently
        // returning unfiltered results.
        dropped.push({
          term: token,
          reason:
            `"${value}" is not a recognized rating. Use rating:safe, ` +
            'rating:questionable, or rating:explicit.',
        })
        continue
      }
      const spelling = RATING_SPELLING[target][value]
      if (negation) {
        // `-rating:x` is a valid exclusion on both boards; keep it excluded.
        continue
      }
      out.push(spelling)
      continue
    }

    // ── sort: — translated on e621, dropped with a notice on Rule34 ─────
    if (body.startsWith('sort:')) {
      const spec = body.slice('sort:'.length)
      const [rawField, rawDirection] = spec.split(':')
      const field = rawField?.toLowerCase() ?? ''
      const direction = (rawDirection ?? 'desc').toLowerCase()

      if (negation) {
        dropped.push({ term: token, reason: 'An ordering term cannot be excluded.' })
        continue
      }

      if (target === 'rule34') {
        // `sort=` is ENTIRELY ignored on Rule34 — every value returns the
        // same newest-id-first set, and no seed parameter has any effect.
        // Translating would be a no-op that looks honored.
        dropped.push({ term: token, reason: RULE34_SORT_DROP_REASON })
        continue
      }

      if (field !== 'id' && field !== 'score' && field !== 'date') {
        dropped.push({
          term: token,
          reason:
            `"${field}" is not an orderable field on e621. Use sort:id, ` +
            'sort:score, or sort:date.',
        })
        continue
      }
      if (direction !== 'asc' && direction !== 'desc') {
        dropped.push({
          term: token,
          reason: `"${rawDirection}" is not a direction. Use asc or desc.`,
        })
        continue
      }

      out.push(E621_ORDER[`${field}:${direction}`])
      continue
    }

    // ── everything else — verbatim ─────────────────────────────────────
    // Includes bare tags, -exclusion, ~ OR-groups, and any unknown
    // `prefix:value`. A native e621 `order:` is also NOT canonical and is
    // forwarded as typed rather than rewritten.
    out.push(token)
  }

  return {
    query: out.join(' '),
    dropped,
    consumed: { dateTerms },
  }
}

/**
 * Normalize a query, returning only the upstream query and dropped terms.
 * Callers that do not need the consumed-term detail use this.
 */
export function normalizeQuery(
  canonicalQuery: string,
  target: SourceId,
): NormalizedQuery {
  const { query, dropped } = normalizeQueryDetailed(canonicalQuery, target)
  return { query, dropped }
}

/**
 * Split a query into terms.
 *
 * Parenthesized OR-groups stay intact as single terms so their internal
 * spacing is not mistaken for term boundaries.
 */
function tokenize(query: string): string[] {
  const tokens: string[] = []
  let depth = 0
  let current = ''

  for (const char of query.trim()) {
    if (char === '(') {
      depth++
      current += char
    } else if (char === ')') {
      depth = Math.max(0, depth - 1)
      current += char
    } else if (/\s/.test(char) && depth === 0) {
      if (current) tokens.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) tokens.push(current)

  return tokens
}
