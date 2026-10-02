## Purpose

Defines how date-based tag filtering behaves across sources: passed through natively where a source supports a `date:` operator, and derived from an estimated posting rate where it does not, with honest reporting whenever a filter cannot be applied.

## ADDED Requirements

### Requirement: Date Filter Capability Is Declared Per Source

Each adapter SHALL declare whether its source supports a native date filter. The system SHALL consult that declaration before applying a date filter.

#### Scenario: Source with native support

- **WHEN** the active source declares native date filter support
- **THEN** the date term SHALL be passed through to that source unchanged as part of the search query, once it has been validated against that source's date grammar

#### Scenario: Source without native support

- **WHEN** the active source declares no native date filter support
- **THEN** the system SHALL derive an equivalent identifier threshold for that source, and the date term itself SHALL never be sent to that source

#### Scenario: Native support costs no extra requests

- **WHEN** a date filter is applied on a source with native support
- **THEN** the system SHALL NOT issue auxiliary requests to estimate a posting rate

### Requirement: Native Date Grammar Is Validated Before Passthrough

Before a date term is passed through to a source that supports date filtering natively, it SHALL be validated against that source's actual date grammar. A term the grammar would not accept SHALL be rejected rather than forwarded, because the sources differ in what they accept and forwarding a term that is not valid syntax produces a result that is wrong in a way the user cannot diagnose. (Verified 2026-10-01)

#### Scenario: A valid term is forwarded unchanged

- **WHEN** a date term matches the source's documented grammar
- **THEN** it SHALL be forwarded verbatim, because the source interprets it correctly and re-encoding it would risk changing its meaning

#### Scenario: The full grammar the native source accepts is honored

- **WHEN** a date term uses any form the native source documents as valid
- **THEN** it SHALL be accepted and forwarded, and the recognized forms SHALL cover singular and plural units, abbreviated units, bare day counts, an "ago" suffix, named relative keywords, absolute calendar dates, comparison prefixes, and inclusive ranges, because the native source's grammar is substantially broader than a single-unit form (Verified 2026-10-01)

#### Scenario: A term outside the grammar is rejected rather than forwarded

- **WHEN** a date term uses a form the native source does not accept
- **THEN** the system SHALL reject it with a clear explanation and SHALL NOT forward it, because the native source's failure response for a malformed date term is distinct from a valid empty result and forwarding would present the wrong condition

#### Scenario: A bare number is understood as days, not as an unrelated unit

- **WHEN** a date term is a bare number
- **THEN** the system SHALL interpret it as a count of days, matching the native source's own interpretation of a bare number

### Requirement: Bare Four-Digit Numbers Are Never Emitted As Date Terms

A four-digit bare number SHALL NOT be emitted as a date term, because the native source interprets a bare number as a count of days and a four-digit number therefore means that many days in the past rather than the year a user would read it as. (Verified 2026-10-01)

#### Scenario: A year is emitted as an explicit absolute date, not a bare number

- **WHEN** a user requests a calendar year
- **THEN** the system SHALL emit an explicit absolute date form covering that year, and SHALL NOT emit the bare four-digit year as the date term

#### Scenario: A year request reaches the native source as an absolute date

- **WHEN** a year-based date filter is passed through to the native source
- **THEN** it SHALL reach the source as a form the source reads as that calendar year, so that the user receives the year they asked for rather than a slice of unrelated history (Verified 2026-10-01)

#### Scenario: A bare four-digit term typed by the user is not forwarded as-is

- **WHEN** a user's date term is a bare four-digit number
- **THEN** the system SHALL NOT forward it verbatim, because the native source would read it as that many days ago and return a single-day slice from a year the user did not ask for

### Requirement: Date Term Units Are Accepted In Both Singular And Plural Form

A date term SHALL be recognized in singular and plural unit form so that the same intent is not rejected merely because of its spelling, and the term forwarded to a source SHALL be canonicalized to that source's documented form. (Verified 2026-10-01)

#### Scenario: A plural unit is recognized

- **WHEN** a date term expresses more than one unit using a plural unit spelling
- **THEN** the system SHALL recognize it as the same intent as its singular spelling, because a plural spelling that is not recognized currently falls through and is misread as an ordinary tag that the source then matches nothing for

#### Scenario: Both spellings reach the source as the same query

- **WHEN** singular and plural spellings of the same date intent are applied
- **THEN** they SHALL produce the same result set, because the native source treats both spellings as equivalent

#### Scenario: Recognition does not depend on the proxy's own unit list

- **WHEN** a date term's unit is recognized
- **THEN** recognition SHALL accept both singular and plural forms, and SHALL NOT be limited to a single hardcoded set of singular units, because the current recognizer accepts only singular units and rejects the plural spelling outright (Verified 2026-10-01)

### Requirement: Derived Identifier Threshold Paginated To Its Own Depth

Where a date filter is translated into an identifier threshold, the source's pagination parameter SHALL be used correctly and the search SHALL be paginated deeply enough to reach the requested age, because a source's identifier density makes the requested range lie far beyond the first pages. (Verified 2026-10-01)

#### Scenario: The source's own pagination parameter is used

- **WHEN** a page of results is requested from a source
- **THEN** the request SHALL use that source's own pagination parameter, and SHALL NOT use a generic page parameter, because one source's generic page parameter silently returns a zero-byte body instead of results (Verified 2026-10-01)

#### Scenario: Paging through a large identifier range

- **WHEN** a date filter translates into a threshold whose matching posts span more pages than a single request returns
- **THEN** the system SHALL follow successive pages until the range is covered, because a fixed page budget would silently truncate an old date range to only its newest matching posts

#### Scenario: Repeated pagination requests are stable

- **WHEN** the same page is requested more than once
- **THEN** it SHALL return the same posts, so that deep pagination terminates rather than looping or re-yielding a page it has already seen (Verified 2026-10-01)

#### Scenario: A wrong pagination parameter yields empty results rather than an error

- **WHEN** a source receives a pagination parameter it does not support
- **THEN** it SHALL answer with a success status and an empty body rather than an error, so the system SHALL detect the empty body as an empty result and SHALL NOT retry the same wrong parameter indefinitely (Verified 2026-10-01)

### Requirement: Date Filter Emitted As An Identifier Threshold

Where a source lacks a native date operator, the system SHALL translate a date filter into an equivalent identifier threshold derived from an estimated posting rate, and SHALL combine that threshold conjunctively with the user's other search terms.

#### Scenario: Date filter becomes an identifier threshold

- **WHEN** a date filter is applied on a source without native date support
- **THEN** the request SHALL include an identifier lower-bound term derived from the date range and the estimated posting rate, alongside the user's other terms

#### Scenario: Estimated-rate term combined conjunctively

- **WHEN** both a date filter and other search terms are present
- **THEN** the resulting search SHALL require both the identifier threshold and the other terms

#### Scenario: Filtered results exclude out-of-range posts

- **WHEN** a date filter is applied on a source that exposes a creation time
- **THEN** returned posts SHALL all fall within the requested date range

#### Scenario: Derived-threshold accuracy is bounded by the source's own timestamps

- **WHEN** a date filter is translated into an identifier threshold on a source whose only timestamp is a modification time
- **THEN** the system SHALL derive the threshold from that source's own timestamp field and SHALL NOT require a creation time the source does not expose, because the threshold estimates age from posting density and identifier order rather than from any individual post's timestamp (Verified 2026-10-01)

### Requirement: Posting-Rate Estimation Limited To Sources Needing It

Rate estimation SHALL be performed only for sources that lack native date support. The system SHALL NOT perform rate estimation for a source with native support.

The system SHALL estimate a source's posting rate by sampling the source's posts at two separated points and deriving the rate from the identifier difference and elapsed time between them. The estimate SHALL be reused across requests until it is re-derived, and the derivation SHALL read each source's own timestamp encoding.

#### Scenario: Rate derived from two samples

- **WHEN** an estimate is derived
- **THEN** it SHALL be computed from the identifier gap and elapsed time between a newest sample and a sample taken a declared distance back

#### Scenario: Estimate reused until stale

- **WHEN** a cached estimate exists and has not exceeded its declared lifetime
- **THEN** the cached estimate SHALL be reused rather than re-derived

#### Scenario: Estimate re-derived when stale

- **WHEN** the cached estimate has exceeded its declared lifetime
- **THEN** a new estimate SHALL be derived

#### Scenario: Rate estimation skipped for sources with native support

- **WHEN** a date filter is applied on a source that natively supports date filtering
- **THEN** no posting-rate estimation SHALL be performed

#### Scenario: Source timestamp encoding honored

- **WHEN** deriving an estimate from a source whose timestamps are ISO 8601 with an offset
- **THEN** the offset SHALL be accounted for so the derived rate reflects real elapsed time

#### Scenario: Estimation failure is handled explicitly

- **WHEN** an estimate cannot be derived
- **THEN** the system SHALL NOT proceed as though a threshold were known, and the outcome SHALL be reported rather than silently returning unfiltered results

### Requirement: Native Date Filtering Verified To Actually Filter

For a source declaring native date support, the system SHALL confirm that the returned posts fall within the requested range, so that a source which silently ignores the date term is detected rather than trusted.

#### Scenario: Results fall within the requested range

- **WHEN** a date filter is applied on a source with native support
- **THEN** every returned post's creation time SHALL fall within the requested range

#### Scenario: Source that ignores the term is caught

- **WHEN** a source declares native date support but returns posts outside the requested range
- **THEN** the condition SHALL be surfaced rather than the results being presented as correctly filtered

### Requirement: Unresolvable Date Filter Reported

When a date filter is requested and no threshold can be produced, the system SHALL tell the user that the date filter could not be applied. It SHALL NOT return an unfiltered result set in a way that implies the filter was honored.

#### Scenario: Estimation fails during a date-filtered search

- **WHEN** a date-filtered search is issued and no threshold can be derived
- **THEN** the user SHALL be informed that the date filter was not applied

#### Scenario: Date tag not silently discarded

- **WHEN** a date filter cannot be applied
- **THEN** the date term SHALL NOT be silently stripped from the user's query and replaced by a broad search without notice

#### Scenario: The strip-and-search-unfiltered defect is what is being prevented

- **WHEN** the threshold derivation fails
- **THEN** the system SHALL report the failure and SHALL NOT proceed with the date term removed and the remaining terms searched unfiltered, because that is the current behavior: the date term is stripped and the search runs with no notice, presenting a completely unfiltered result set as though the filter had been applied (Verified 2026-10-01)

#### Scenario: Failure is reported rather than logged and swallowed

- **WHEN** the threshold derivation fails
- **THEN** the failure SHALL be reported to the user and SHALL NOT be only logged while the search proceeds, because a logged-and-swallowed failure is indistinguishable to the user from a correctly filtered result set

#### Scenario: Threshold derivation reports success or failure as a single outcome

- **WHEN** the system determines whether a threshold can be produced
- **THEN** that determination SHALL yield either a threshold or an explicit failure, and SHALL NOT yield neither while the caller proceeds as though a threshold were known (Verified 2026-10-01)

### Requirement: Multiple Date Filters

Where more than one date term appears in a single query, the system SHALL apply the most restrictive applicable constraint rather than discarding all but one silently, and SHALL inform the user how multiple date terms were resolved.

#### Scenario: Multiple date terms narrowed to one

- **WHEN** a query contains more than one date term
- **THEN** the narrowest of those constraints SHALL be applied and the user SHALL be told how the terms were resolved

#### Scenario: Single date term unchanged

- **WHEN** a query contains exactly one date term
- **THEN** that term SHALL be applied without any narrowing notice

### Requirement: Date Term Syntax Portability

Date terms SHALL be recognized in the same user-facing syntax regardless of active source, so that the same query text means the same thing when the source changes.

#### Scenario: Same syntax recognized on either source

- **WHEN** a query uses the recognized date-term syntax
- **THEN** it SHALL be interpreted identically on every source, whether or not that source applies it natively

#### Scenario: Unrecognized date syntax rejected

- **WHEN** a date term uses an unrecognized unit or form
- **THEN** the system SHALL reject it and SHALL NOT silently treat it as an ordinary tag

### Requirement: Native Date Filtering Is Verified, Not Assumed

A source that declares a native `date:` operator SHALL be confirmed to actually
apply it, so that a source silently ignoring the term is caught rather than
trusted on the strength of its declared capability.

#### Scenario: Out-of-range native date window returns nothing

- **WHEN** a search is issued against a native-date source with a date window
  that no post can satisfy, such as a `date:week` filter combined with an
  `id:` bound far below the newest id
- **THEN** the source SHALL return zero posts, demonstrating the date term was
  applied rather than ignored (Verified 2026-10-01: `date:week` → 0 posts,
  `date:year` → 5 posts over the same id window)

#### Scenario: Documented relative forms behave as documented

- **WHEN** a relative date form is issued against a native-date source
- **THEN** its singular and plural spellings SHALL return identical result
  counts, and a bare number SHALL be interpreted as that many days ago
  (Verified 2026-10-01: `date:30days` and `date:30day` both returned 0 over
  the same id window)

#### Scenario: Capability declaration is not sufficient evidence

- **WHEN** a source declares `nativeDateFilter`
- **THEN** that declaration SHALL NOT by itself be treated as proof the term is
  honored, and the verification above SHALL be performed against the live API

### Requirement: Ordering Parameters Are Verified Against Live Results

A translated ordering parameter SHALL be confirmed to actually order results as
the mapping claims, and not merely accepted with HTTP 200. A silently ignored
ordering term is indistinguishable from an applied one by status code alone.

#### Scenario: Creation-order mapping is confirmed live

- **WHEN** `sort:date` is translated to `order:created_desc` and sent to the
  source
- **THEN** the returned page SHALL be monotonically ordered by creation time in
  that direction, and the ascending form SHALL reach genuinely older posts
  (Verified 2026-10-01: `order:created_desc` returned 8 posts descending from
  `2026-10-02T17:01:18`; `order:created_asc` reached `2007-02-10`, id 14)

#### Scenario: Order parameter forms are distinguished from silent zeros

- **WHEN** an ordering term is emitted
- **THEN** the underscore suffix form SHALL be used, since the space and colon
  forms return zero results rather than an error, making the mistake invisible
  to any check that only asserts a successful response
