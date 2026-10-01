## Purpose

Scopes every watchlist entry to the source it came from, so that posts which happen to share an identifier across different boards remain distinct, and preserves existing user watchlist data through that change.

## ADDED Requirements

### Requirement: Watchlist Entries Scoped To Their Source

Every watchlist entry SHALL identify both the source it originated from and the post identifier within that source. Two entries with the same post identifier but different originating sources SHALL be distinct entries.

#### Scenario: Same identifier on different sources are distinct

- **WHEN** a post with a given identifier is watched on one source
- **THEN** a post with the same identifier on a different source SHALL NOT be treated as already watched

#### Scenario: Entry resolves to its originating post

- **WHEN** a watchlist entry is evaluated for display
- **THEN** only the post matching both the entry's source and its identifier SHALL be considered watched

#### Scenario: Switching sources does not leak watch state

- **WHEN** the active source changes
- **THEN** watch state SHALL reflect only entries belonging to the newly active source

### Requirement: Watchlist Membership Preserved Across Source Changes

The watchlist SHALL retain entries belonging to sources that are not currently active, so that switching sources and switching back SHALL restore the prior watch state.

#### Scenario: Entries survive a source round trip

- **WHEN** a post is watched, the active source changes, and then the original source is reselected
- **THEN** that post SHALL still be watched

#### Scenario: Multiple sources accumulate

- **WHEN** posts are watched on more than one source
- **THEN** entries from all of those sources SHALL be retained

### Requirement: Lossless Migration From Identifier-Only Entries

Existing watchlist data storing only post identifiers SHALL be migrated on load so that every pre-existing entry is attributed to the default source and remains watched. Migration SHALL NOT discard any entry.

#### Scenario: Pre-existing entries attributed to the default source

- **WHEN** watchlist data containing identifier-only entries is loaded
- **THEN** every entry SHALL be attributed to the default source and SHALL remain present and watched

#### Scenario: Migration is idempotent

- **WHEN** migrated data is loaded again
- **THEN** the entries SHALL be unchanged and SHALL NOT be duplicated or lost

#### Scenario: Already-scoped entries untouched by migration

- **WHEN** watchlist data already contains source-scoped entries
- **THEN** those entries SHALL be preserved exactly as stored

#### Scenario: Corrupt data does not destroy the store

- **WHEN** stored watchlist data cannot be parsed
- **THEN** the system SHALL recover without leaving the store in a state that loses previously persisted entries on the next write

### Requirement: Ordered Retention Semantics

The watchlist SHALL retain most-recently-watched-first ordering, and re-watching an already-watched post SHALL move it to the most-recent position without creating a duplicate entry.

#### Scenario: Most recent first

- **WHEN** several posts are watched in sequence
- **THEN** the watchlist SHALL order them most-recently-watched first

#### Scenario: Re-watch moves rather than duplicates

- **WHEN** an already-watched post is watched again
- **THEN** it SHALL occupy the most-recent position and SHALL appear exactly once

### Requirement: Watchlist Filtering Scoped To Active Source

Watchlist-driven filtering of results — including dimming and hiding watched posts — SHALL consider only entries belonging to the active source.

#### Scenario: Hide mode considers active source only

- **WHEN** watched mode is set to hide and the active source is changed
- **THEN** posts hidden or shown SHALL be determined solely by entries for that active source

#### Scenario: Unwatched determination per source

- **WHEN** a post's watched state is evaluated for display
- **THEN** it SHALL be determined against entries for the post's own source
