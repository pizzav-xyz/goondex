## Purpose

Defines how tag suggestions are retrieved and presented per source, reconciling the two different upstream completion endpoints and their differing response shapes into one uniform suggestion contract.

## ADDED Requirements

### Requirement: Uniform Tag Suggestion Contract

Tag completion SHALL yield suggestions in one uniform shape regardless of the active source. Each suggestion SHALL carry a display label, a value used for searching, and a post count where the source provides one.

#### Scenario: Suggestions are uniform across sources

- **WHEN** tag completion runs against either source
- **THEN** the returned suggestions SHALL conform to the same shape and the same field semantics

#### Scenario: Count omitted when unavailable

- **WHEN** the active source does not supply a post count for a suggestion
- **THEN** the suggestion SHALL indicate the absence of a count rather than reporting zero

### Requirement: Completion Match Parameter Chosen Per Source

Each adapter SHALL declare the completion match parameter its source actually implements, and SHALL NOT send a parameter the source silently ignores. A silently ignored match parameter yields the source's unfiltered default set, which is wrong rather than empty. (Verified 2026-10-01)

#### Scenario: e621 completion uses its name-matches parameter with wildcards

- **WHEN** completion runs against e621
- **THEN** it SHALL query the source's name-matches parameter and SHALL express partial matching with wildcards in the term itself, because that is the only match parameter e621 implements (Verified 2026-10-01)

#### Scenario: e621 prefix parameters are never sent

- **WHEN** completion runs against e621
- **THEN** it SHALL NOT send any prefix-scoped match parameter, because e621 implements no such parameter and silently ignores it, returning its unfiltered default set instead of the requested suggestions (Verified 2026-10-01)

#### Scenario: Wildcards are matched anywhere in the term

- **WHEN** a completion term carries a wildcard
- **THEN** it SHALL be honored at any position in the term and SHALL be matched case-insensitively, because e621's matching honors a wildcard at any position without regard to case (Verified 2026-10-01)

#### Scenario: Rule34 completion keeps its own endpoint

- **WHEN** completion runs against Rule34
- **THEN** it SHALL use Rule34's own completion endpoint, and SHALL NOT be routed through the other source's match parameter, because the two sources expose completion through entirely different mechanisms (Verified 2026-10-01)

#### Scenario: Completion for a metatag-style prefix returns nothing rather than unrelated suggestions

- **WHEN** completion is requested for a metatag-style prefixed term on a source whose completion index contains no such tag
- **THEN** the source SHALL return no suggestions, because its completion index does not contain metatags as tag rows even though they work as search terms

### Requirement: Completion Response Shape Tolerated Per Source

The two completion endpoints do not agree on their response container, so the system SHALL accept each source's own success and empty-result shapes. (Verified 2026-10-01)

#### Scenario: e621 success shape and empty shape are both handled

- **WHEN** e621 completion returns results
- **THEN** the system SHALL read the result list from the source's bare top-level array form

#### Scenario: e621 empty results are not mistaken for a wrapper object

- **WHEN** e621 completion returns no results
- **THEN** the system SHALL recognize that the response is a wrapped empty object rather than an array and SHALL report zero suggestions rather than failing or returning the wrapper's keys as suggestions, because e621 changes container shape between success and zero results (Verified 2026-10-01)

#### Scenario: Related tags are read as delimited text

- **WHEN** a suggestion carries related tags
- **THEN** the system SHALL split the delimited string the source provides and SHALL NOT expect an array, because the field is a space-separated string (Verified 2026-10-01)

#### Scenario: A numeric-looking category is read as a category identifier

- **WHEN** a suggestion reports its category
- **THEN** the system SHALL read the source's numeric category identifier and SHALL NOT expect a category name, because the source returns the category as an integer

### Requirement: Completion Response Body Tolerated Despite Its Declared Type

A completion response SHALL be accepted on the strength of its parsed content and SHALL NOT be rejected because the response declares a media type that does not match its body. (Verified 2026-10-01)

#### Scenario: A JSON body labelled as markup is still parsed

- **WHEN** a completion endpoint returns a JSON body while declaring a markup media type
- **THEN** the system SHALL parse the body as the JSON it is and SHALL NOT fail the request because of the declared media type, because Rule34's completion endpoint serves a JSON body labelled as HTML (Verified 2026-10-01)

#### Scenario: Media-type-based rejection is not used to detect failure

- **WHEN** a completion response's declared media type does not match its body
- **THEN** failure SHALL be detected from the parsed body rather than from the media type, so that a mislabelled but valid response is never discarded

### Requirement: No Prefix-Scoped Completion Is Offered

Neither source implements a prefix-scoped completion match parameter, so completion SHALL NOT offer prefix-scoped queries. Verified 2026-10-01: Rule34's completion endpoint answers a prefixed term such as `user:` or `md5:ab` with an empty result set rather than prefix-scoped suggestions, and e621 implements only its name-matches parameter — `search[prefix]`, `search[name_prefix]`, and `search[starts_with]` do not exist and are silently ignored, which yields unfiltered default results instead of an error.

This requirement exists to record a verified negative, so the capability is not reintroduced expecting support that neither source provides.

#### Scenario: A prefixed term yields no suggestions rather than a wrong scope

- **WHEN** a user types a metatag-style prefixed term
- **THEN** completion SHALL return no suggestions, and SHALL NOT claim prefix-scoped support it cannot deliver, because neither source implements a prefix-scoped match parameter (Verified 2026-10-01)

#### Scenario: Suggestions retain prefixes when they do match

- **WHEN** a suggestion matches a query that carried a prefix
- **THEN** the returned suggestion SHALL retain the prefix in its value, because the prefix is part of the tag's identity and dropping it would search for something else

### Requirement: Prefix and Count Extraction From Upstream Labels

Some sources encode the post count inside the suggestion's display label using a parenthesized suffix. The system SHALL extract that count into the suggestion's count field and SHALL present a label without it. (Verified 2026-10-01)

#### Scenario: Count extracted from a parenthesized label suffix

- **WHEN** a source returns a display label with a trailing parenthesized count
- **THEN** the count SHALL populate the suggestion's count field and the trailing parenthesized text SHALL be absent from the presented label

#### Scenario: The extracted count is an integer

- **WHEN** a parenthesized count is extracted from a label suffix
- **THEN** it SHALL be parsed as an integer count of matching posts rather than left as text

#### Scenario: The count suffix is stripped from the end of the label only

- **WHEN** a parenthesized count is stripped from a label
- **THEN** only a trailing parenthesized group SHALL be removed, because the tag name itself may legitimately contain parentheses

#### Scenario: Label without a count suffix

- **WHEN** a returned display label carries no parenthesized count
- **THEN** the suggestion SHALL be presented with no count and SHALL record the count as unavailable

### Requirement: Suggestion Filtering and Limits

Completion SHALL apply the configured maximum suggestion count and SHALL discard suggestions lacking the minimum information required to be actionable.

#### Scenario: Suggestion cap applied

- **WHEN** a source returns more suggestions than the configured maximum
- **THEN** no more than that maximum SHALL be returned

#### Scenario: Incomplete suggestions discarded

- **WHEN** a returned suggestion lacks a value to search on
- **THEN** it SHALL be discarded

### Requirement: Debounced Completion Requests

Tag completion requests SHALL be debounced by the configured interval, SHALL NOT be issued for queries shorter than the configured minimum length, and SHALL be issued for an empty query so the user can discover available tags.

#### Scenario: Minimum query length enforced

- **WHEN** the user types a query shorter than the configured minimum length
- **THEN** no completion request SHALL be issued

#### Scenario: Debounce collapses rapid input

- **WHEN** the user types several characters in rapid succession
- **THEN** at most one completion request SHALL be issued per debounce interval

#### Scenario: Empty query yields suggestions

- **WHEN** the input is empty and the input is focused
- **THEN** the system SHALL offer tag suggestions for that empty query

### Requirement: Stale Response Rejection

Responses to completion requests SHALL be discarded when they no longer correspond to the current input, so that a slow earlier response cannot overwrite suggestions for newer input.

#### Scenario: Late response for superseded input

- **WHEN** a completion response arrives after the user has continued typing and the input no longer matches the request
- **THEN** that response SHALL be discarded and SHALL NOT replace current suggestions

#### Scenario: Response for current input applied

- **WHEN** a completion response arrives and still corresponds to the current input
- **THEN** it SHALL be applied
