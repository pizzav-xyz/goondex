## Purpose

Defines the single canonical post shape that every board's response is converted into, so that all downstream rendering, filtering, and persistence operates on one representation regardless of which source produced the data.

## ADDED Requirements

### Requirement: Canonical Post Shape

Every post returned by any source SHALL be normalized into one canonical representation before it reaches application logic. The canonical representation SHALL carry the originating source identifier on each post.

Application code SHALL NOT read source-specific response fields directly.

#### Scenario: Heterogeneous source responses normalize to one shape

- **WHEN** posts are retrieved from two different sources with different response structures
- **THEN** both results SHALL be represented in the identical canonical shape, each post carrying its originating source

#### Scenario: Downstream code is source-agnostic

- **WHEN** application logic renders or filters a post
- **THEN** it SHALL depend only on the canonical fields and SHALL NOT branch on the post's source

### Requirement: Canonical Field Names Follow The Source's Own Names

The canonical representation SHALL use the field names the sources actually expose for uploader identity, approval, and moderation state, and SHALL NOT invent equivalents for fields a source does not provide. (Verified 2026-10-01)

#### Scenario: Uploader identity is read from the source's uploader fields

- **WHEN** a source reports who uploaded a post
- **THEN** the canonical representation SHALL carry the uploader's identifier as `uploader_id` and the uploader's name as `uploader_name`, and SHALL NOT read them from `creator_id` or `creator_name`, because no source exposes either (Verified 2026-10-01)

#### Scenario: Approver identity is read from the source's approver field

- **WHEN** a source reports who approved a post
- **THEN** the canonical representation SHALL carry the approver's identifier as `approver_id`

#### Scenario: Moderation state is read from a flags object, not top-level fields

- **WHEN** a source reports moderation or lifecycle state
- **THEN** the canonical representation SHALL carry a `flags` object whose members are the source's individual boolean states, and SHALL NOT read top-level `status` or `is_pending`, because neither source exposes either name (Verified 2026-10-01)

#### Scenario: A source that omits a field leaves the canonical field absent rather than inventing one

- **WHEN** a source exposes no value for a canonical field
- **THEN** the canonical representation SHALL record that field's absence and SHALL NOT synthesize a plausible substitute

### Requirement: Tag Normalization

Tags SHALL be normalized into a canonical list regardless of how the source encodes them. A source that returns tags as a delimited string and a source that returns tags grouped into category arrays SHALL both yield the same canonical tag list.

Where a source supports prefixed tags, tags SHALL retain their prefix so that tag-scoped searches remain expressible.

#### Scenario: Delimited string tags become a list

- **WHEN** a source returns tags as a single space-delimited string
- **THEN** the canonical form SHALL be a list of individual tags with no element containing a delimiter

#### Scenario: Category-grouped tags are flattened

- **WHEN** a source returns tags as an object of category-named arrays
- **THEN** the canonical form SHALL be a single flattened list containing every tag from every category

#### Scenario: Every category group is read, including the easily missed ones

- **WHEN** a source returns tags grouped into categories
- **THEN** the normalization SHALL iterate the groups the source actually declares rather than a hand-maintained subset, because a category key that is overlooked drops tags silently from the canonical list

#### Scenario: The meta category key is recognized under its real name

- **WHEN** a source returns a tag group whose key names the metatag category
- **THEN** the normalization SHALL read it under that category's actual key name and SHALL NOT look for an alternate spelling of it

#### Scenario: The contributor category key is recognized

- **WHEN** a source returns a tag group whose key names the contributor category
- **THEN** the normalization SHALL include that group's tags in the canonical list, because the contributor category is a real group that is easily missed

#### Scenario: Unknown tag categories are still included

- **WHEN** a source returns a tag group whose key the system does not recognize
- **THEN** the normalization SHALL still include its tags in the canonical list rather than discarding the group

#### Scenario: Prefixes are preserved

- **WHEN** a tag carries a namespace prefix
- **THEN** that prefix SHALL be retained in the canonical form

#### Scenario: Tag round-trips into a search

- **WHEN** a user activates a tag from a normalized post
- **THEN** the resulting search SHALL target that tag on the post's originating source

### Requirement: Timestamp Normalization

Timestamps SHALL be normalized to a single internal representation regardless of the source's encoding. Sources emitting Unix seconds and sources emitting ISO 8601 strings with an offset SHALL both yield the same internal representation. A source that exposes no value for a timestamp SHALL have that absence represented as such rather than filled from another field. (Verified 2026-10-01)

#### Scenario: Unix seconds normalize

- **WHEN** a source returns a time as Unix seconds
- **THEN** the canonical value SHALL represent that same instant

#### Scenario: ISO 8601 with offset normalizes

- **WHEN** a source returns a time as an ISO 8601 string including an offset
- **THEN** the canonical value SHALL represent that same instant, with the offset accounted for rather than discarded

#### Scenario: The offset is never assumed to be UTC

- **WHEN** a source returns an ISO 8601 timestamp carrying a server-local offset
- **THEN** the offset SHALL be read from the value itself and SHALL NOT be replaced with an assumed UTC offset, because the source's offsets vary with its own daylight-saving state and its documentation's literal UTC offset is wrong (Verified 2026-10-01)

#### Scenario: A last-modified time is not reported as a creation time

- **WHEN** a source exposes a modification time but no creation time
- **THEN** the canonical representation SHALL identify the value as a modification time and SHALL NOT present it as the post's creation time, because Rule34's timestamp field is last-modified Unix seconds and Rule34 exposes no creation timestamp at all (Verified 2026-10-01)

#### Scenario: A source with no creation time yields no canonical creation time

- **WHEN** a source exposes no creation time for a post
- **THEN** the canonical representation SHALL record the creation time as unavailable and SHALL NOT substitute the source's modification time for it

#### Scenario: Normalized timestamps are comparable

- **WHEN** two posts from different sources yield normalized timestamps
- **THEN** those values SHALL be directly comparable as instants on a single timeline

### Requirement: Rating Normalization

Each source's rating vocabulary SHALL be mapped onto one canonical rating scale. Every rating a source can express SHALL have a defined canonical mapping, and each source's search-side rating spelling SHALL be derived from its own vocabulary rather than assumed. (Verified 2026-10-01)

#### Scenario: Source ratings map to canonical scale

- **WHEN** posts from different sources carry their source-specific rating values
- **THEN** each SHALL be mapped to the corresponding canonical rating value

#### Scenario: Unrecognized rating handled explicitly

- **WHEN** a source returns a rating value with no defined canonical mapping
- **THEN** the system SHALL handle it deterministically and SHALL NOT silently treat it as a permissive value

#### Scenario: Each source's rating vocabulary is recorded from that source

- **WHEN** an adapter declares the ratings its source can express
- **THEN** it SHALL record the source's actual vocabulary, because the two sources do not share one: Rule34 expresses only explicit and questionable with no safe rating at all, while e621 expresses safe, questionable, and explicit (Verified 2026-10-01)

#### Scenario: Search-side rating spelling is derived per source

- **WHEN** the system emits a rating term to filter a search
- **THEN** it SHALL use the spelling that source's filter mechanism recognizes, because the two sources parse rating terms differently and a spelling that works on one does not filter on the other (Verified 2026-10-01)

#### Scenario: A rating term the source cannot parse is never sent

- **WHEN** a rating value has no spelling the target source's filter mechanism recognizes
- **THEN** the system SHALL reject it explicitly rather than send a term the source would silently ignore, because e621 drops an unparseable rating term and returns unfiltered results (Verified 2026-10-01)

#### Scenario: Rating validation happens client-side

- **WHEN** a rating term is validated before being sent
- **THEN** validation SHALL occur in the client, because a source-side parse failure fails open by returning unfiltered results rather than reporting an error (Verified 2026-10-01)

#### Scenario: A rating the source cannot express is reported rather than approximated

- **WHEN** a user requests a canonical rating the target source does not expose
- **THEN** the system SHALL report that the source cannot express that rating and SHALL NOT substitute a nearby rating that would silently return different posts

### Requirement: Score And Source Normalization

Score and originating-source signals SHALL be normalized despite differing encodings, and free-text source labels SHALL be treated as untrusted text. (Verified 2026-10-01)

#### Scenario: A combined score and a split score both yield a single score

- **WHEN** one source reports a score as a single combined integer and another reports it as separate up and down counts
- **THEN** both SHALL yield the same canonical score

#### Scenario: A negative score component is not assumed to be positive

- **WHEN** a source reports a score with an up count and a down count
- **THEN** the down count SHALL be read as a signed value and SHALL NOT be assumed non-negative, because the source's down count can be negative (Verified 2026-10-01)

#### Scenario: An absent source field and a list-shaped source field both normalize

- **WHEN** one source omits a source label on some posts and another returns a list of source labels that may be empty
- **THEN** both SHALL normalize into one canonical representation that distinguishes "no source" from "one source"

#### Scenario: Source labels are treated as untrusted text

- **WHEN** a source's label is normalized
- **THEN** it SHALL be treated as untrusted free text and SHALL NOT be interpreted as a structured value

### Requirement: Media URL Resolution

The canonical representation SHALL resolve, for each post, the URLs required for display: a full media URL, a preview URL, and a sample URL. Media URLs SHALL be taken only from hosts the originating adapter permits. Availability SHALL be judged by the truth of a URL value and never by the presence of its key. (Verified 2026-10-01)

#### Scenario: Media URLs resolved per source

- **WHEN** posts from different sources are normalized
- **THEN** each SHALL expose display, preview, and sample URLs drawn from its own source's permitted hosts

#### Scenario: Media URL falls back through the chain

- **WHEN** a source provides no full media URL but provides a sample URL
- **THEN** the canonical representation SHALL fall back to the sample URL for display

#### Scenario: Missing media URLs

- **WHEN** a source provides no usable media URL for a post
- **THEN** the canonical representation SHALL record their absence rather than substituting a placeholder

#### Scenario: A present key holding a null value means absent

- **WHEN** a source returns a URL field that exists as a key but whose value is null
- **THEN** the canonical representation SHALL treat that URL as absent, because the field's key is always present while its value is null whenever the underlying file is missing, and a key-presence check would produce an unusable URL (Verified 2026-10-01)

#### Scenario: A declared-true flag does not imply a usable URL

- **WHEN** a source declares that a sample exists but supplies a null URL for it
- **THEN** the canonical representation SHALL treat the sample as unusable, because the declaration and the URL disagree when the underlying file is gone (Verified 2026-10-01)

#### Scenario: Dimension fields are not read as an availability signal

- **WHEN** a source populates a sample's width and height while declaring that no sample exists
- **THEN** the canonical representation SHALL NOT read those dimensions as evidence that a sample is available, because they mirror the full file's dimensions (Verified 2026-10-01)

#### Scenario: Alternative media representations are captured

- **WHEN** a source offers alternate representations of a post's media alongside its primary URL
- **THEN** the canonical representation SHALL capture those alternates, because a source may expose a newer-format image variant and alternate video encodings that the primary URL does not cover (Verified 2026-10-01)

#### Scenario: A preferred video encoding is chosen over an alternate

- **WHEN** a video post's media exists in more than one encoding
- **THEN** the canonical representation SHALL prefer the encoding the system can play most reliably across browsers rather than taking whichever alternate appears first, because the two common web video formats are not equally supported and a post usually exposes both (Verified 2026-10-01)

### Requirement: Video Detection

Video posts SHALL be identified by a declared set of recognized video extensions supplied per adapter, not by a single hardcoded extension check. A post whose media extension is in its adapter's recognized video set SHALL be marked as video. (Verified 2026-10-01)

#### Scenario: Recognized video extension

- **WHEN** a post's media extension is listed in the active adapter's recognized video extensions
- **THEN** the post SHALL be marked as a video

#### Scenario: Extension outside the recognized set

- **WHEN** a post's media extension is not in the active adapter's recognized video extensions
- **THEN** the post SHALL NOT be marked as a video

#### Scenario: Video detection follows the active source

- **WHEN** the active source changes
- **THEN** video detection SHALL use the newly active adapter's recognized extension set

#### Scenario: Each adapter's recognized set reflects what its source actually serves

- **WHEN** an adapter declares its recognized video extensions
- **THEN** the set SHALL reflect the extensions that source actually serves, because the two sources do not overlap: one serves MP4 and GIF with no WebM mirror on any host, and the other serves WebM and MP4 (Verified 2026-10-01)

#### Scenario: Media extension is derived from a field the source actually has

- **WHEN** a post's media extension is determined
- **THEN** it SHALL be derived from e621's dedicated `file.ext` field, falling back to the `file.url` path only if absent. (Rule34 is the board with no extension field — it derives from `image`. Verified 2026-10-01)

#### Scenario: A format absent from a source is not treated as expected

- **WHEN** a source serves no posts in a video format at all
- **THEN** the adapter SHALL NOT assume a mirror or alternate in that format exists for any post

### Requirement: Video Duration Normalization

Video duration SHALL be normalized from the source's own declared duration when it provides one, and SHALL fall back to client-side probing only when that value is absent. (Verified 2026-10-01)

#### Scenario: A declared duration is preferred over probing

- **WHEN** a source declares a video's duration
- **THEN** the canonical representation SHALL use that value and SHALL NOT probe the media, because probing costs a request per video

#### Scenario: A fractional duration is preserved

- **WHEN** a source reports a duration in fractional seconds
- **THEN** the canonical value SHALL preserve the fractional part and SHALL NOT truncate it to whole seconds, because the source's durations are fractional and truncation would corrupt short videos (Verified 2026-10-01)

#### Scenario: An explicitly null duration triggers probing rather than being read as zero

- **WHEN** a source reports a video's duration as null
- **THEN** the system SHALL treat the duration as unknown and fall back to client-side probing, and SHALL NOT read the null as a zero-second video (Verified 2026-10-01)

#### Scenario: Probing is the sole duration source where no duration field exists

- **WHEN** a source exposes no duration field of any kind
- **THEN** client-side probing SHALL be the only way to obtain a duration for its videos, because the source's coarse duration tags are frequently absent and cannot substitute for a measured duration
