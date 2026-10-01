## Purpose

Defines the single shared function that translates a canonical user-typed search query into the form a specific source actually honors, so that the same query text means the same thing on every board and no term is ever silently discarded without a reason the user can see.

## ADDED Requirements

### Requirement: One Shared Pure Query Normalizer Serves Every Source

The system SHALL implement query normalization as a single pure function in a shared module, and every source adapter SHALL call that same function. The translation logic SHALL NOT be duplicated per adapter. The function SHALL be pure, taking a canonical query and a target source and returning the translated query together with the terms it dropped and why, so that its behavior is unit-testable without a network or a running proxy. (Verified 2026-10-01)

#### Scenario: Both adapters share one implementation

- **WHEN** more than one source adapter prepares a search query
- **THEN** each SHALL call the same shared normalization function rather than carrying its own copy of the translation rules

#### Scenario: The function is pure

- **WHEN** the normalization function is called with a canonical query and a target source
- **THEN** its result SHALL depend only on those two arguments, with no network access, no clock read, and no mutable shared state

#### Scenario: A dropped term is always reported

- **WHEN** normalization removes a term from the query
- **THEN** the returned result SHALL include that term together with the reason it was removed, so that a caller cannot drop a term without also learning why

#### Scenario: Normalization does not decide what the user sees

- **WHEN** normalization reports a dropped term
- **THEN** the decision to disclose it to the user SHALL remain with the reporting layer, which SHALL never omit a term the function reported as dropped

### Requirement: Rating Terms Are Translated To Each Source's Own Recognized Spelling

The canonical rating syntax SHALL be the long form only, and the normalizer SHALL emit the spelling the target source's filter mechanism actually recognizes. A rating term SHALL be validated before being sent, because a source that cannot parse one discards it and returns unfiltered results rather than reporting an error. (Verified 2026-10-01)

#### Scenario: Canonical input accepts only the long rating form

- **WHEN** a user types a rating term
- **THEN** it SHALL be recognized in the long form only, so `rating:s`, `rating:q`, and `rating:e` SHALL be rejected as unrecognized rather than translated

#### Scenario: Explicit rating on Rule34

- **WHEN** `rating:explicit` is normalized for Rule34
- **THEN** it SHALL be emitted as `rating:explicit` verbatim

#### Scenario: Questionable rating on Rule34

- **WHEN** `rating:questionable` is normalized for Rule34
- **THEN** it SHALL be emitted as `rating:questionable` verbatim

#### Scenario: Safe rating on Rule34

- **WHEN** `rating:safe` is normalized for Rule34
- **THEN** it SHALL be forwarded as `rating:safe` rather than dropped, because Rule34 exposes no safe-rated posts so matching nothing is the correct empty answer, whereas dropping the term would return the board's explicit and questionable posts as though a safe filter had been applied (Verified 2026-10-01)

#### Scenario: Explicit rating on e621

- **WHEN** `rating:explicit` is normalized for e621
- **THEN** it SHALL be emitted as `rating:e`

#### Scenario: Questionable rating on e621

- **WHEN** `rating:questionable` is normalized for e621
- **THEN** it SHALL be emitted as `rating:q`

#### Scenario: Safe rating on e621

- **WHEN** `rating:safe` is normalized for e621
- **THEN** it SHALL be emitted as `rating:s`

#### Scenario: Only the source's short spelling is ever emitted for e621

- **WHEN** a rating term is emitted to e621
- **THEN** it SHALL be a short spelling, because e621's server reads only the first character of the value and downcases it, so `rating:safe` and `rating:explicit` work there only by accident of that parsing and SHALL NOT be relied on (Verified 2026-10-01)

#### Scenario: An unrecognized rating value is rejected before sending

- **WHEN** a rating value is not one of the three canonical values
- **THEN** the system SHALL reject it explicitly and SHALL NOT emit any rating term for it, because e621 silently discards a rating term it cannot parse and returns unfiltered results rather than reporting an error (Verified 2026-10-01)

### Requirement: Ordering Terms Are Translated On Sources That Honor Them And Dropped With A Notice On Those That Do Not

The canonical ordering syntax SHALL name a field and optionally a direction. On a source that honors ordering, the normalizer SHALL emit the source's own ordering spelling with an explicit direction. On a source that ignores ordering entirely, the normalizer SHALL drop the term and report it with a reason, never emitting a term the source discards. (Verified 2026-10-01)

#### Scenario: Descending identifier order on e621

- **WHEN** `sort:id` is normalized for e621
- **THEN** it SHALL be emitted as `order:id_desc`

#### Scenario: Ascending identifier order on e621

- **WHEN** `sort:id:asc` is normalized for e621
- **THEN** it SHALL be emitted as `order:id_asc`

#### Scenario: Descending score order on e621

- **WHEN** `sort:score` is normalized for e621
- **THEN** it SHALL be emitted as `order:score`, bare, because e621's bare ordering spelling already means descending (Verified 2026-10-01)

#### Scenario: Ascending score order on e621

- **WHEN** `sort:score:asc` is normalized for e621
- **THEN** it SHALL be emitted as `order:score_asc`

#### Scenario: Descending date order on e621

- **WHEN** `sort:date` is normalized for e621
- **THEN** it SHALL be emitted as `order:created_desc`, because e621 orders by its creation-time field and `date` is a silently ignored ordering field there (Verified 2026-10-01)

#### Scenario: Ascending date order on e621

- **WHEN** `sort:date:asc` is normalized for e621
- **THEN** it SHALL be emitted as `order:created_asc`

#### Scenario: Direction is made explicit wherever bare does not already mean descending

- **WHEN** an ordering term is translated for e621
- **THEN** the direction SHALL be written into the single token using e621's underscore suffix form and SHALL NOT use a space-separated or colon-separated direction, and a bare ordering token SHALL NOT be used for identifier ordering, because e621's bare identifier ordering means ascending and would invert the user's request (Verified 2026-10-01)

#### Scenario: Ordering is dropped on Rule34

- **WHEN** any `sort:` term is normalized for Rule34
- **THEN** the term SHALL be dropped and reported as dropped, and no ordering term SHALL be sent, because Rule34 ignores every ordering parameter and always returns newest identifier first (Verified 2026-10-01)

#### Scenario: The drop notice explains what order the user will actually get

- **WHEN** an ordering term is dropped for Rule34
- **THEN** the reported reason SHALL state that ordering is not supported on Rule34, that results arrive newest first, and that the ordering term was not sent

### Requirement: Date And Duration Terms Are Consumed Or Forwarded, Never Both

A date term SHALL be forwarded only to a source that filters natively on it, and SHALL otherwise be consumed client-side into an identifier threshold. A duration term SHALL be consumed client-side for every source. Neither SHALL ever be sent upstream on a source that cannot honor it. (Verified 2026-10-01)

#### Scenario: Date term forwarded to e621

- **WHEN** a `date:` term is normalized for e621
- **THEN** it SHALL be forwarded verbatim after its grammar has been validated

#### Scenario: Date term consumed on Rule34

- **WHEN** a `date:` term is normalized for Rule34
- **THEN** it SHALL be removed from the query and consumed into the posting-rate-derived identifier threshold, and SHALL NOT be sent to Rule34, because Rule34 has no date or time operator at all and zeroes any unknown qualified tag (Verified 2026-10-01)

#### Scenario: Duration term consumed for every source

- **WHEN** a `duration:` term is normalized for any source
- **THEN** it SHALL be removed from the query and handled client-side, and SHALL NOT be sent to the source

#### Scenario: Consumed terms are not reported as dropped

- **WHEN** a date or duration term is consumed into client-side handling
- **THEN** it SHALL NOT be reported as a dropped term, because it was honored by another mechanism rather than discarded

### Requirement: Dropped Terms Are Never Discarded Silently

Every term the normalizer drops SHALL be surfaced to the user together with its reason. The normalizer SHALL NOT drop a term without recording it. In the first version, ordering terms on the source that ignores ordering are the only case that produces a drop. (Verified 2026-10-01)

#### Scenario: A drop always carries a reason

- **WHEN** the normalizer reports a dropped term
- **THEN** the report SHALL include a human-readable reason explaining what the source does instead

#### Scenario: The drop report reaches the user

- **WHEN** the normalizer reports one or more dropped terms
- **THEN** the interface SHALL display each dropped term with its reason rather than omitting any of them

#### Scenario: Consumed terms do not appear in the drop report

- **WHEN** a term is consumed into client-side handling rather than dropped
- **THEN** it SHALL NOT be listed as dropped, so that the drop report means exactly "this term was not sent and not honored"

#### Scenario: Ordering on the ignoring source is the only drop in the first version

- **WHEN** the first version normalizes a query
- **THEN** an ordering term aimed at the source that ignores ordering SHALL be the only case that produces a dropped term, so that users are not shown notices for terms that were in fact honored (Verified 2026-10-01)

### Requirement: Terms The Normalizer Does Not Own Pass Through Verbatim

Any term outside the normalizer's own operator set SHALL be forwarded unchanged, including its prefix and its exclusion marker. This preserves each source's power-user syntax, and the normalizer SHALL NOT guess which terms a source supports. (Verified 2026-10-01)

#### Scenario: An unrecognized qualified term is forwarded unchanged

- **WHEN** a query contains a qualified term whose prefix the normalizer does not own, such as a score, type, pool, or favorite-count term
- **THEN** it SHALL be forwarded to the source exactly as written

#### Scenario: An operator belonging to e621 only is not stripped when sent to Rule34

- **WHEN** a query contains an operator e621 implements and the query is normalized for Rule34
- **THEN** the term SHALL still be forwarded unchanged, because Rule34's operator set cannot be enumerated reliably in advance, so removing a term on suspicion would silently discard something the user asked for and make no promise the term would have worked (Verified 2026-10-01)

#### Scenario: A bare tag passes through unchanged

- **WHEN** a query contains a bare tag
- **THEN** it SHALL be forwarded verbatim

#### Scenario: An excluded tag passes through unchanged

- **WHEN** a query contains a tag prefixed with an exclusion marker
- **THEN** it SHALL be forwarded verbatim with its exclusion marker intact, because exclusion is honored by both sources (Verified 2026-10-01)

#### Scenario: A grouped alternative term passes through unchanged

- **WHEN** a query contains a grouped alternative term
- **THEN** it SHALL be forwarded verbatim, and its support SHALL be documented as applying to e621 only (Verified 2026-10-01)

#### Scenario: Classification depends on the prefix alone

- **WHEN** the normalizer classifies a term
- **THEN** classification SHALL depend only on whether the term carries an operator prefix, and SHALL NOT require the operator to be one the normalizer knows

#### Scenario: Passthrough covers every term the normalizer does not own

- **WHEN** a query contains a mixture of canonical terms and terms outside the normalizer's operator set
- **THEN** only the canonical terms SHALL be translated, consumed, or dropped, and every other term SHALL survive the translation untouched

### Requirement: Native Source Ordering Syntax Is Documented As Non-Canonical And Forwarded Verbatim

A source's own ordering syntax SHALL NOT be part of the canonical query language. When a user types it anyway, the normalizer SHALL forward it verbatim and its effect SHALL be documented as depending on the target source. (Verified 2026-10-01)

#### Scenario: A native ordering term typed by a user is forwarded, not rewritten

- **WHEN** a user types e621's native `order:` term
- **THEN** the normalizer SHALL forward it verbatim rather than translating it into the canonical `sort:` syntax, because the native term is not canonical and rewriting a user's exact typed text would change what they asked for

#### Scenario: The native syntax's documented behavior differs per source

- **WHEN** a user types e621's native `order:` term
- **THEN** the documented behavior SHALL state that it orders results on e621 and matches nothing on Rule34, because Rule34 treats an unknown qualified tag as matching nothing at all rather than ignoring it (Verified 2026-10-01)

#### Scenario: The canonical ordering syntax is what the interface offers

- **WHEN** the interface presents ordering choices
- **THEN** it SHALL present the canonical `sort:` syntax, because the canonical spelling is the one with a defined translation on every source (Verified 2026-10-01)

### Requirement: Query Translation Is Covered By A Translation Matrix Test Suite

The translation behavior SHALL be locked down by automated tests covering the full matrix of both sources against every canonical operator, so that a change to one adapter's translation cannot silently break the other or diverge from the documented table. (Verified 2026-10-01)

#### Scenario: Every rating value is tested against both sources

- **WHEN** the translation matrix is exercised
- **THEN** each of the three canonical rating values SHALL be tested against both sources and SHALL produce the documented result for each

#### Scenario: Every ordering form is tested

- **WHEN** the translation matrix is exercised
- **THEN** all six canonical ordering forms SHALL be tested, each against both sources, and SHALL produce the documented result

#### Scenario: Date and duration handling are tested

- **WHEN** the translation matrix is exercised
- **THEN** date forwarding on e621 and date consumption on Rule34 SHALL both be tested, and duration consumption SHALL be tested for both sources

#### Scenario: Passthrough behavior is tested

- **WHEN** the translation matrix is exercised
- **THEN** an unrecognized qualified term, an e621-only operator sent to Rule34, a bare tag, and an excluded tag SHALL each be tested and SHALL be shown to pass through verbatim

#### Scenario: The drop list is tested for emptiness where nothing is dropped

- **WHEN** a query whose every term translates successfully is normalized for either source
- **THEN** the returned drop list SHALL be empty, so that a notice is never shown for a query nothing was dropped from

#### Scenario: Score-descending translation is pinned as a named case

- **WHEN** the translation suite runs
- **THEN** a named test case SHALL assert that `sort:score` normalized for e621 emits `order:score`, guarding the bare-means-descending rule against a well-meaning future "always be explicit" change that would silently reverse the user's ordering (Verified 2026-10-01)

#### Scenario: Ascending-identifier translation is pinned as a named case

- **WHEN** the translation suite runs
- **THEN** a named test case SHALL assert that `sort:id:asc` normalized for e621 emits `order:id_asc`, guarding against the bare-identifier-ascending trap (Verified 2026-10-01)