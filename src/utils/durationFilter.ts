import type { Post } from '@/types'

/** A parsed duration comparison condition. */
export interface DurationCondition {
  operator: '>' | '>=' | '<' | '<=' | '=' | 'between'
  value: number
  /** Upper bound when operator is 'between' */
  maxValue?: number
}

/** Matches `duration:...` tokens in a tag string. */
const DURATION_TAG_RE = /\bduration:((?:>=|<=|>|<|=)?\d+(?:-\d+)?)\b/g

/**
 * Parse all `duration:` conditions from a tag string.
 *
 * Supported syntax (seconds):
 *   duration:>30     – strictly greater than 30
 *   duration:>=30    – 30 or more
 *   duration:<60     – strictly less than 60
 *   duration:<=60    – 60 or less
 *   duration:31      – exactly 31
 *   duration:30-60   – between 30 and 60 inclusive
 */
export function parseDurationFilter(tags: string): DurationCondition[] {
  const conditions: DurationCondition[] = []
  let match: RegExpExecArray | null

  // Reset lastIndex for global regex
  DURATION_TAG_RE.lastIndex = 0

  while ((match = DURATION_TAG_RE.exec(tags)) !== null) {
    const spec = match[1]

    // range: 30-60
    const rangeMatch = spec.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      conditions.push({
        operator: 'between',
        value: parseInt(rangeMatch[1], 10),
        maxValue: parseInt(rangeMatch[2], 10),
      })
      continue
    }

    // operator-prefixed: >30, >=30, <60, <=60, =30
    const opMatch = spec.match(/^(>=|<=|>|<|=)(\d+)$/)
    if (opMatch) {
      const op = opMatch[1] as DurationCondition['operator']
      conditions.push({
        operator: op === '=' ? '=' : op,
        value: parseInt(opMatch[2], 10),
      })
      continue
    }

    // bare number: 31 (exact match)
    const num = parseInt(spec, 10)
    if (!isNaN(num)) {
      conditions.push({ operator: '=', value: num })
    }
  }

  return conditions
}

/**
 * Remove all `duration:` tokens from a tag string.
 * Returns the cleaned string suitable for sending to the API.
 */
export function stripDurationTags(tags: string): string {
  return tags
    .replace(DURATION_TAG_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Check if a single post's duration satisfies a condition. */
function matchesCondition(
  duration: number | null,
  cond: DurationCondition,
): boolean {
  // Non-video posts (null duration) never match a duration filter
  if (duration === null || duration === undefined) return false

  switch (cond.operator) {
    case '>':  return duration > cond.value
    case '>=': return duration >= cond.value
    case '<':  return duration < cond.value
    case '<=': return duration <= cond.value
    case '=':  return Math.abs(duration - cond.value) < 0.5
    case 'between':
      return duration >= cond.value && duration <= (cond.maxValue ?? cond.value)
    default:   return false
  }
}

/**
 * Client-side filter: keep only posts whose video duration satisfies
 * ALL provided conditions (AND logic).
 *
 * Uses `durationMap` (postId → seconds) obtained from probing actual
 * video files. Posts without a known duration are excluded when any
 * duration filter is active.
 */
export function filterByDuration(
  posts: Post[],
  conditions: DurationCondition[],
  durationMap: Map<number, number>,
): Post[] {
  if (conditions.length === 0) return posts
  return posts.filter(post => {
    const dur = durationMap.get(post.id) ?? post.duration ?? null
    return conditions.every(c => matchesCondition(dur, c))
  })
}
