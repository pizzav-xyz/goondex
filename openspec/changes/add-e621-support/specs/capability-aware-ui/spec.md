## Purpose

Defines how the user interface adapts to the active source's declared capabilities, so that controls for unsupported features are not offered and a requested filter that the active source cannot honor is reported honestly rather than silently returning unfiltered results.

## ADDED Requirements

### Requirement: Controls Reflect Active Source Capabilities

Search controls SHALL be rendered according to the active source's declared capabilities. A control for a capability the active source does not support SHALL NOT be offered as an enabled, applicable control.

#### Scenario: Supported control offered

- **WHEN** the active source declares support for a capability
- **THEN** the corresponding control SHALL be available to the user

#### Scenario: Unsupported control not offered as applicable

- **WHEN** the active source declares no support for a capability
- **THEN** the corresponding control SHALL NOT be presented as an applicable option for that source

#### Scenario: Controls re-evaluated on source change

- **WHEN** the active source changes
- **THEN** the available controls SHALL be re-evaluated against the newly active source's capabilities

### Requirement: Honest Reporting of Unhonorableable Filters

When a user requests a filter the active source cannot honor, the system SHALL inform the user that the filter was not applied and SHALL NOT present the unfiltered result set as if the filter had been applied. This applies both to filters the source cannot express and to filters the client fails to translate into a form the source honors. (Verified 2026-10-01)

#### Scenario: A date filter that cannot be derived is reported

- **WHEN** a user submits a date filter on a source where no equivalent constraint can be produced
- **THEN** the system SHALL tell the user that the date filter was not applied and SHALL NOT return results as though it were

#### Scenario: A filter the client fails to translate is reported, not sent

- **WHEN** a submitted filter cannot be translated into any form the active source honors
- **THEN** the system SHALL report that it was not applied and SHALL NOT send it in a form the source would silently ignore

#### Scenario: Supported filter applied silently

- **WHEN** a user submits a filter the active source does support
- **THEN** the filter SHALL be applied and no unsupported-filter notice SHALL be shown

#### Scenario: Partial support disclosed

- **WHEN** a source supports only some of the requested filter's forms
- **THEN** the system SHALL state which parts were not applied

#### Scenario: A source's silent disregard of a filter is not mistaken for a filtered result

- **WHEN** a source ignores a filter that was sent to it
- **THEN** the system SHALL not present the returned posts as satisfying that filter, because both sources ignore a rating supplied as a request parameter and return unfiltered or mixed-rating results that would otherwise read as a filtered set (Verified 2026-10-01)

#### Scenario: Every dropped term is shown

- **WHEN** the query normalizer reports one or more dropped terms
- **THEN** the system SHALL display each dropped term together with the reason it was dropped, and SHALL NOT discard any of them silently

#### Scenario: A dropped term is named in the user's own words

- **WHEN** a dropped term is displayed
- **THEN** the display SHALL identify the specific term the user typed so the user can recognize and correct it

#### Scenario: A dropped ordering term is dropped with an explanation, not a wrong order

- **WHEN** a user requests an ordering the active source cannot honor
- **THEN** the system SHALL report that the ordering was not sent and SHALL state what order the results actually arrive in, and SHALL NOT return the results in a different order as though the request were honored, because Rule34 ignores every ordering parameter and always returns newest first (Verified 2026-10-01)

#### Scenario: A dropped term does not suppress the rest of the search

- **WHEN** one term is dropped and other terms are honored
- **THEN** the honored terms SHALL still be applied and the results SHALL still be shown, with the dropped term disclosed alongside them

#### Scenario: Ordering dropped by translation is disclosed rather than silently absent

- **WHEN** a source's normalizer drops an ordering term in order to translate a query
- **THEN** the notice SHALL reach the user, so that a user who asked for a specific order always learns it was not applied (Verified 2026-10-01)

### Requirement: Rating Filter Expressed as a Searchable Term

Rating filtering SHALL be expressed in a way the active source actually honors. A source that ignores a rating filter supplied as a request parameter SHALL receive it as part of the search query instead, and the tag spelling used SHALL be the one that source's filter mechanism actually recognizes. (Verified 2026-10-01)

#### Scenario: Rating filter reaches the source effectively

- **WHEN** a user applies rating filters on a source that does not honor a rating request parameter
- **THEN** the rating SHALL be conveyed as part of the search query so the returned posts match the requested ratings

#### Scenario: Rating filter verifiable

- **WHEN** results are returned for a rating filter
- **THEN** every returned post's rating SHALL be one of the requested ratings

#### Scenario: Rating filter composes with other terms

- **WHEN** a rating filter is applied alongside other search terms
- **THEN** the results SHALL satisfy both the rating selection and the other terms

#### Scenario: The rating request parameter is never sent

- **WHEN** a rating filter is applied on either source
- **THEN** no rating request parameter SHALL be sent, because a rating request parameter is a complete no-op on Rule34 and does not exist for post search on e621, so sending one returns unfiltered or misleadingly mixed results (Verified 2026-10-01)

#### Scenario: Rating options offered match the active source's own vocabulary

- **WHEN** rating options are presented for the active source
- **THEN** the options offered SHALL be exactly the ratings that source expresses, because the sources do not share a vocabulary and Rule34 expresses no safe rating at all (Verified 2026-10-01)

#### Scenario: A rating the source does not express is withheld rather than offered

- **WHEN** a canonical rating exists that the active source does not express
- **THEN** that option SHALL NOT be offered as a usable choice on that source, and the withholding SHALL be stated rather than the option being offered and then failing to filter (Verified 2026-10-01)

#### Scenario: Rule34's rating options are limited to its two ratings

- **WHEN** rating options are presented for Rule34
- **THEN** only its explicit and questionable ratings SHALL be offered, because Rule34 contains no safe-rated posts, so offering a safe filter would return an empty set that reads as a bug rather than as the truth about the board (Verified 2026-10-01)

#### Scenario: e621's rating options cover all three of its ratings

- **WHEN** rating options are presented for e621
- **THEN** safe, questionable, and explicit SHALL all be offered, because e621 expresses all three (Verified 2026-10-01)

#### Scenario: A rating filter that the source would ignore is never sent

- **WHEN** a rating term's spelling would not be recognized by the active source's filter mechanism
- **THEN** the system SHALL refuse to send it and SHALL say so, because e621 silently discards an unrecognized rating term and returns unfiltered results, which would present mixed ratings as a filtered set (Verified 2026-10-01)

#### Scenario: A safe-rating request on Rule34 is answered honestly

- **WHEN** a user requests a safe-rating filter on a source that exposes no safe-rated posts
- **THEN** the system SHALL report that the source has no safe-rated posts rather than presenting an empty result set as though the filter had run (Verified 2026-10-01)

### Requirement: Ordering Controls Reflect Source Support

Ordering controls SHALL be offered only for sources that honor an ordering request, and the control's field choices SHALL be limited to the fields that source can actually order by.

#### Scenario: Ordering control withheld on a source that ignores ordering

- **WHEN** the active source's adapter declares no ordering support
- **THEN** the ordering control SHALL NOT be offered for that source, because Rule34 ignores every ordering parameter, so offering the control would suggest an ordering that never takes effect (Verified 2026-10-01)

#### Scenario: Ordering control offered on a source that honors ordering

- **WHEN** the active source's adapter declares ordering support
- **THEN** the ordering control SHALL be available, with both ascending and descending choices stated explicitly

#### Scenario: Orderable fields are limited to the source's real sort fields

- **WHEN** the ordering control offers field choices for the active source
- **THEN** the choices SHALL be limited to fields that source can genuinely order by, because e621 silently ignores several plausible-looking field names and would otherwise present an unfiltered-by-order result set as sorted (Verified 2026-10-01)

#### Scenario: An ordering the source cannot honor is not silently re-sorted locally

- **WHEN** the source does not honor a requested ordering
- **THEN** the system SHALL disclose that fact rather than sorting the returned page locally and presenting it as the requested ordering

### Requirement: Video Buffering Eligibility

Video buffering SHALL be offered only for posts that are eligible under the active source's declared video extensions and the post's own media type. Video support is derived from a non-empty `videoExtensions` array, never from a separate boolean flag.

#### Scenario: Buffering offered for eligible video

- **WHEN** the post's media extension is in the active source's `videoExtensions` (with `gif` matched as video-capable alongside the array)
- **THEN** buffering SHALL be offered for that post

#### Scenario: Buffering withheld for non-video

- **WHEN** a post is not a recognized video
- **THEN** buffering SHALL NOT be offered for that post

#### Scenario: Buffering withheld when source declares no video extensions

- **WHEN** the active source declares an empty `videoExtensions` set
- **THEN** video buffering SHALL NOT be offered

### Requirement: Source Attribution in the Interface

The interface SHALL make the active source apparent to the user, so that per-source differences in results are attributable and the user is never uncertain which board they are browsing.

#### Scenario: Active source indicated

- **WHEN** the user is browsing results
- **THEN** the interface SHALL make the active source readily apparent

#### Scenario: Source change is visible

- **WHEN** the active source changes
- **THEN** the change SHALL be reflected in the interface

### Requirement: Error Surface Fidelity

Request failures SHALL be surfaced with a condition that reflects the actual cause. A rate-limit rejection SHALL NOT be presented as a generic failure, and a rejection caused by a missing required request header SHALL NOT be presented as an unexplained error.

#### Scenario: Rate limit distinguished

- **WHEN** a source rejects a request due to rate limiting
- **THEN** the user-visible condition SHALL identify it as rate limiting

#### Scenario: Missing required header explained

- **WHEN** a request is rejected because a required client identification header was absent
- **THEN** the user-visible condition SHALL state that the client's identification was rejected

#### Scenario: Generic failure still surfaced

- **WHEN** a request fails for a reason with no more specific classification
- **THEN** the failure SHALL still be surfaced to the user rather than swallowed

#### Scenario: Broken image presents a fallback, never a permanent blank

- **WHEN** a grid image fails to load, including transiently
- **THEN** the tile SHALL present a fallback presentation with a retry rather than blanking permanently for that component instance

#### Scenario: Pagination loading state shown while more pages remain

- **WHEN** further pages are available under the active source's pagination
- **THEN** a loading state SHALL be shown during pagination rather than a silent stall
