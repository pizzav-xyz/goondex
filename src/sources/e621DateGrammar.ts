/**
 * e621's `date:` grammar, as a single reference implementation.
 *
 * This is the ONLY place the grammar is described. `queryNormalizer` calls
 * `validateDateTerm`; nothing else may hand-roll date syntax.
 *
 * Source of truth: e621ng `app/logical/parse_value.rb` (commit 9ecbb7e),
 * cross-checked live on 2026-10-01. This module validates *syntax only* and
 * never performs date arithmetic — the server does the arithmetic.
 *
 * ## Grammar
 *
 * Seven units, singular and plural both valid and byte-identical in result:
 *   second(s), minute(s), hour(s), day(s), week(s), month(s), year(s)
 *
 * Abbreviations: s, mi, h, d, w, mo, y
 *
 * Relative forms (emit a LOWER bound, i.e. `>= now-N`):
 *   date:30day, date:30days, date:1week, date:2weeks
 *   date:30            — a BARE NUMBER means DAYS, not years
 *   date:30day_ago, date:5days_ago, date:1week_ago
 *   date:30dayago, date:5daysago
 *   date:today, date:yesterday, date:decade
 *   date:yesterweek, date:yestermonth, date:yesteryear  (accept counts)
 *   date:day, date:week, date:month, date:year  (= 1 unit ago)
 *
 * Absolute forms (a bare absolute date is a single-day exact match):
 *   date:2024-01-01, date:april/27/2012
 *
 * Comparison prefixes: >, <, >=, <=
 * Inclusive ranges: a..b, ..b, a..
 * Comma lists are accepted, capped server-side at 320 entries.
 *
 * ## The two traps
 *
 * 1. **Never emit a bare year.** `date:2024` means 2024 DAYS AGO — a
 *    single-day slice around 2021, not the year 2024. Year intent must use
 *    the absolute form (`date:2024-01-01`).
 * 2. **Bare `hour`/`minute`/`second` are invalid.** Only day/week/month/year
 *    work bare; the sub-day units REQUIRE an explicit number.
 */

const UNITS = [
  'second', 'minute', 'hour', 'day', 'week', 'month', 'year',
] as const

const ABBREVIATIONS: Record<string, (typeof UNITS)[number]> = {
  s: 'second',
  mi: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  mo: 'month',
  y: 'year',
}

/** Units that are valid without an explicit count. */
const BARE_OK_UNITS = new Set(['day', 'week', 'month', 'year'])

const KEYWORD_DATES = new Set([
  'today',
  'yesterday',
  'decade',
  'yesterweek',
  'yestermonth',
  'yesteryear',
])

/** A bare 4+ digit number means DAYS, so a bare year must never be emitted. */
const BARE_NUMBER_RE = /^\d{4,}$/
/** A `YYYY-MM-DD` or `YYYY/MM/DD` absolute date. */
const ABSOLUTE_DATE_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/
/** e.g. `april/27/2012` */
const NAMED_ABSOLUTE_DATE_RE = /^[a-z]+[/-]\d{1,2}[/-]\d{1,2,4}$/i

export type DateTermProblem =
  | 'empty'
  | 'bare-year'
  | 'bare-sub-day-unit'
  | 'unrecognized'

export interface DateTermValidation {
  readonly valid: boolean
  /** Present only when invalid; a user-facing explanation. */
  readonly problem?: DateTermProblem
  readonly reason?: string
}

/**
 * Normalize a unit spelling to its canonical singular form.
 * `days` -> `day`, `w` -> `week`, `mi` -> `minute`.
 */
function canonicalUnit(raw: string): (typeof UNITS)[number] | null {
  const lower = raw.toLowerCase()
  const singular = lower.endsWith('s') ? lower.slice(0, -1) : lower
  if ((UNITS as readonly string[]).includes(singular)) {
    return singular as (typeof UNITS)[number]
  }
  return ABBREVIATIONS[lower] ?? null
}

/** Validate one `date:` value against e621's grammar. Syntax only. */
function validateValue(value: string): DateTermValidation {
  const v = value.trim()
  if (v === '') return { valid: false, problem: 'empty', reason: 'empty date' }

  // Comma list: validate every element.
  if (v.includes(',')) {
    for (const part of v.split(',')) {
      const result = validateValue(part)
      if (!result.valid) return result
    }
    return { valid: true }
  }

  // Inclusive range: a..b, ..b, a..  — validate both open sides.
  if (v.includes('..')) {
    const [from, to] = v.split('..')
    if (from !== '' && !validateValue(from).valid) {
      return validateValue(from)
    }
    if (to !== '' && !validateValue(to).valid) {
      return validateValue(to)
    }
    return { valid: true }
  }

  // Comparison prefix: >, >=, <, <=
  const comparison = v.match(/^(>=|<=|>|<)(.+)$/)
  if (comparison) {
    return validateValue(comparison[2])
  }

  // Absolute date forms.
  if (ABSOLUTE_DATE_RE.test(v) || NAMED_ABSOLUTE_DATE_RE.test(v)) {
    return { valid: true }
  }

  // Keywords, optionally with a count (yesterweek, 2yesterweek).
  const bareWord = v.toLowerCase()
  if (KEYWORD_DATES.has(bareWord)) return { valid: true }
  const keywordWithCount = bareWord.match(/^(\d+)?(yesterweek|yestermonth|yesteryear)$/)
  if (keywordWithCount) return { valid: true }

  // Bare number means DAYS. A 4+ digit bare number is almost certainly a
  // year the user meant, and sending it would silently return a slice of
  // unrelated history — so reject it rather than forward it.
  if (/^\d+$/.test(v)) {
    if (BARE_NUMBER_RE.test(v)) {
      return {
        valid: false,
        problem: 'bare-year',
        reason:
          `date:${v} would mean ${v} days ago, not the year ${v}. ` +
          'Use an absolute date such as date:2024-01-01.',
      }
    }
    return { valid: true }
  }

  // <count><unit>, with optional _ago / ago suffix.
  //   30day, 30days, 1week, 2w, 30day_ago, 5daysago
  const counted = v.match(/^(\d+)([a-z]+?)(_ago|ago)?$/i)
  if (counted) {
    const unit = canonicalUnit(counted[2])
    if (unit) return { valid: true }

    return {
      valid: false,
      problem: 'unrecognized',
      reason: `"${counted[2]}" is not a unit e621's date filter understands.`,
    }
  }

  // Bare unit with no count: only day/week/month/year are valid bare.
  const bareUnit = canonicalUnit(v)
  if (bareUnit) {
    if (BARE_OK_UNITS.has(bareUnit)) return { valid: true }
    return {
      valid: false,
      problem: 'bare-sub-day-unit',
      reason: `date:${v} needs an explicit count — a bare "${bareUnit}" is not valid. Try date:1${bareUnit}.`,
    }
  }

  return {
    valid: false,
    problem: 'unrecognized',
    reason: `"${v}" is not valid date syntax for e621.`,
  }
}

/**
 * Validate the value of a `date:` term. Returns whether it is safe to
 * forward verbatim, plus a user-facing reason when it is not.
 */
export function validateDateTerm(value: string): DateTermValidation {
  return validateValue(value)
}

/**
 * Canonicalize plural units to the documented singular form so only one
 * spelling reaches the wire. `date:30days` -> `date:30day`.
 *
 * e621 accepts both spellings with byte-identical results; canonicalizing
 * keeps the wire format to one shape. This is spelling only — the value is
 * not re-encoded and its meaning is not changed.
 */
export function canonicalizeDateTerm(value: string): string {
  return value
    .split(',')
    .map((part) => canonicalizeValue(part.trim()))
    .join(',')
}

function canonicalizeValue(v: string): string {
  if (v === '') return v

  // Preserve comparison prefixes and ranges.
  if (v.includes('..')) {
    const [from, to] = v.split('..')
    return `${canonicalizeValue(from)}..${canonicalizeValue(to)}`
  }

  const comparison = v.match(/^(>=|<=|>|<)(.+)$/)
  if (comparison) return `${comparison[1]}${canonicalizeValue(comparison[2])}`

  const counted = v.match(/^(\d+)([a-z]+?)((?:_ago|ago)?)$/i)
  if (counted) {
    const unit = canonicalUnit(counted[2])
    if (unit) return `${counted[1]}${unit}${counted[3]}`
  }

  return v
}

/**
 * The reference grammar, for documentation and tests. Exported so the
 * syntax help and the test suite cannot drift from the implementation.
 */
export const E621_DATE_GRAMMAR_REFERENCE = {
  units: [...UNITS],
  abbreviations: Object.keys(ABBREVIATIONS),
  bareNumberMeans: 'days',
  bareUnitsAllowed: [...BARE_OK_UNITS],
  keywords: [...KEYWORD_DATES],
} as const
