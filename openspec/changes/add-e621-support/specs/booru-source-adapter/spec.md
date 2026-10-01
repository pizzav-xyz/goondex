## Purpose

Defines the contract that every booru source implements, the registry that tracks available sources, and the capability matrix each source declares so the application can adapt its behavior without embedding knowledge of any specific board.

## ADDED Requirements

### Requirement: Source Adapter Contract

The system SHALL define a single adapter contract that every source implements, and all application logic SHALL depend only on that contract rather than on any source's hostnames, endpoints, or field names.

Each adapter SHALL declare a stable source identifier, a human-readable label, and a capability descriptor.

#### Scenario: Application logic is source-agnostic

- **WHEN** the application performs a search, tag completion, or post-detail fetch
- **THEN** it SHALL invoke the active source's adapter and SHALL NOT reference any source-specific hostname, endpoint path, or response field

#### Scenario: Adding a third source requires no changes to shared code

- **WHEN** a new adapter implementing the contract is registered
- **THEN** search, tag completion, and post-detail flows SHALL function against it with no modification to shared application code

### Requirement: Source Registry and Selection

The system SHALL maintain a registry of available sources and SHALL allow the user to select the active source. The system SHALL persist the selection and SHALL restore it on load.

The registry SHALL contain at least the Rule34 source and the e621 source.

#### Scenario: Selecting a source

- **WHEN** the user selects a different source
- **THEN** subsequent searches, tag completion, and detail fetches SHALL use the newly selected source

#### Scenario: Selection persists across reloads

- **WHEN** the user selects a source and then reloads the application
- **THEN** the previously selected source SHALL be active on load

#### Scenario: First-run default

- **WHEN** no source has been selected previously
- **THEN** the system SHALL activate the Rule34 source as the default

### Requirement: Declared Capability Matrix

Each adapter SHALL declare a capability descriptor covering, at minimum: rating filter support, native date filter support, ordering support with the ordered field set, tag completion support, maximum page size, authentication mechanism, permitted media hosts, and the `videoExtensions` array from which video support is derived (a non-empty array means video is supported; there is no separate video boolean flag).

The application SHALL read capabilities from the active adapter and SHALL NOT hardcode capability assumptions about a specific board.

#### Scenario: Reading capabilities

- **WHEN** the application needs to know whether the active source supports a feature
- **THEN** it SHALL read that from the active adapter's capability descriptor

#### Scenario: Maximum page size is enforced per source

- **WHEN** a search requests more results than the active source's declared maximum page size
- **THEN** the request SHALL be brought within that source's declared maximum before it is sent

### Requirement: Page Size Limits Are Enforced Per Source With Source-Specific Failure Modes

A page size beyond a source's declared maximum SHALL NOT be sent upstream. The two sources SHALL fail differently on an over-limit page size, and the adapter SHALL account for each failure mode. (Verified 2026-10-01)

#### Scenario: Rule34 silently clamps and the adapter clamps client-side

- **WHEN** a page size above Rule34's maximum of 1000 is requested
- **THEN** the adapter SHALL clamp the requested page size to 1000 client-side, because Rule34 answers an over-limit `limit` with HTTP 200 and a silently truncated result set carrying no error and no truncation signal

#### Scenario: e621 rejects with 410 Gone and the adapter never sends an over-limit value

- **WHEN** a page size above e621's maximum of 320 is requested
- **THEN** the adapter SHALL reduce it to 320 before sending, because e621 answers an over-limit `limit` with HTTP 410 Gone and a JSON error body instead of clamping (Verified 2026-10-01, e621ng config/danbooru_default_config.rb:704-706 and application_controller.rb:151-152)

#### Scenario: Limit is always sent explicitly

- **WHEN** the adapter issues a paginated request to either source
- **THEN** it SHALL always send an explicit `limit` parameter, because e621's server-side default page size is 75 and would silently narrow the result set (Verified 2026-10-01)

#### Scenario: A 410 from e621 is not treated as a generic failure

- **WHEN** e621 responds with HTTP 410 for an over-limit page size
- **THEN** the system SHALL surface the page-size condition rather than an unexplained request failure

### Requirement: Authentication Mechanism Per Source

Each adapter SHALL declare its source's authentication mechanism and SHALL detect an authentication failure by that source's actual failure signal. A source SHALL NOT be treated as authenticated merely because a key is present. (Verified 2026-10-01)

#### Scenario: Rule34 anonymous request fails with a body type, not a status

- **WHEN** a request to Rule34 is issued without credentials
- **THEN** the system SHALL detect the failure from the response body being a bare JSON string rather than an array, because Rule34 answers an anonymous request with HTTP 200 and a message string instead of posts (Verified 2026-10-01)

#### Scenario: Rule34 invalid keys are not rejected

- **WHEN** a request to Rule34 carries an incorrect or empty key
- **THEN** the system SHALL NOT treat the key's presence as validation that it works, because Rule34 returns full data for a bad or empty key and only total absence fails

#### Scenario: Empty Rule34 result set is a zero-byte body, not an empty array

- **WHEN** Rule34 returns no matching posts
- **THEN** the system SHALL handle a zero-byte body as an empty result set and SHALL NOT attempt an unguarded JSON parse of it, because an unguarded parse of a zero-byte body throws (Verified 2026-10-01)

#### Scenario: e621 anonymous reads are supported

- **WHEN** a request to e621 is issued without credentials
- **THEN** the system SHALL perform the read without credentials rather than treating anonymity as a failure, because e621 supports anonymous reads for posts, tags, and detail

#### Scenario: e621 authenticates with a single header mechanism

- **WHEN** the system authenticates to e621
- **THEN** it SHALL send an HTTP Basic authorization header and SHALL NOT implement a `login`+`api_key` query-parameter fallback, because the proxy always sets headers so the fallback's documented use case never occurs, and two auth paths for one personal client is a duplicated fallback (Verified 2026-10-01)

### Requirement: Rate Limit Enforcement Per Source

Each adapter SHALL declare its own rate limit spacing and the system SHALL enforce it independently per source. Exceeding a source's declared rate limit SHALL be handled as that source's declared failure response rather than a generic error. (Verified 2026-10-01)

#### Scenario: Rule34 rate limiting

- **WHEN** requests are issued to the Rule34 source
- **THEN** they SHALL be spaced at no less than 800 milliseconds apart, because the observed Cloudflare rejection cliff sits near 1.25 requests per second and the current 500 millisecond client and proxy spacings are too aggressive

#### Scenario: e621 rate limiting

- **WHEN** requests are issued to the e621 source
- **THEN** they SHALL be serialized at no more than one request per second and SHALL NEVER be issued in parallel, because e621's documented limit is 2 requests per second and its Cloudflare load shedder rejects bursts regardless of the server-side bucket

#### Scenario: HTTP 429 and HTTP 503 are treated identically as rate limiting

- **WHEN** either source responds with HTTP 429 or HTTP 503
- **THEN** the system SHALL treat both statuses as the same rate-limit condition and SHALL NOT treat HTTP 503 as a generic or server-error condition, because e621's own code reserves HTTP 503 for a downed database while its documentation names both statuses for throttling (Verified 2026-10-01)

#### Scenario: Rate limit bodies are never parsed as JSON

- **WHEN** a rate-limit response arrives
- **THEN** the system SHALL NOT attempt to parse its body as JSON, because Rule34 answers throttling with an empty body and no `Retry-After` header and e621's Cloudflare shedder answers with an HTML body

#### Scenario: Retry backoff is owned by the client

- **WHEN** a rate-limit rejection is received
- **THEN** the system SHALL apply its own backoff timer for that source rather than relying on a `Retry-After` header, because Rule34 sends none and e621's Cloudflare shedder's header is not a contract

#### Scenario: Rate limit response handling

- **WHEN** either source responds with a rate-limit status
- **THEN** the system SHALL surface the condition to the user as a rate-limit condition distinct from a generic request failure

### Requirement: Per-Source Request Routing

The system SHALL route each request to the active source's upstream endpoint. Upstream hosts, endpoint paths, and query parameter names SHALL be defined per adapter and SHALL NOT be shared across sources.

The system SHALL keep its own proxy in the request path for every source, and SHALL NOT bypass the proxy merely because a source's endpoints would answer a cross-origin request directly. (Verified 2026-10-01)

#### Scenario: Cross-origin capability does not remove the proxy

- **WHEN** a source's media and API endpoints would permit a direct cross-origin request
- **THEN** the system SHALL still route the request through its own proxy, because the proxy carries responsibilities that are not about CORS: date-tag rewriting, the server-side request forgery boundary, and per-source rate limiting

#### Scenario: A source without cross-origin headers keeps the proxy as its only path

- **WHEN** a source's media endpoints serve no cross-origin headers at all
- **THEN** the proxy SHALL be required for those media to be usable at all, which Rule34's media hosts currently are

### Requirement: Honest Client Identification

The system SHALL send a descriptive, non-impersonated client identifier with every outbound API request. Each adapter SHALL declare its own identifier because the two sources enforce different rules. Omitting the client identifier on a source that requires it SHALL be treated as an error, not silently tolerated. (Verified 2026-10-01)

#### Scenario: Source requiring a client identifier

- **WHEN** a request is issued to a source that rejects requests lacking a client identifier
- **THEN** the system SHALL include a descriptive client identifier on that request, because e621 rejects a request with no `User-Agent` at all with HTTP 403

#### Scenario: No browser impersonation

- **WHEN** any outbound request is constructed
- **THEN** its client identifier SHALL NOT be a browser user agent that the target source's guidelines forbid impersonating, and e621's documentation states verbatim that impersonating a browser user agent gets the client blocked

#### Scenario: Client identifier is declared per source

- **WHEN** an outbound request is prepared for a given source
- **THEN** the identifier SHALL be that source adapter's declared identifier, because the sources differ and a default programming-language identifier is commonly blocked on e621

#### Scenario: Transport is not impersonated for e621

- **WHEN** a request is issued to e621
- **THEN** the request SHALL use plain TLS rather than browser-impersonating transport, because the proxy currently impersonates Chrome on every request and that impersonation is the behavior e621's guidelines forbid

#### Scenario: No query-parameter workaround is relied upon

- **WHEN** a request to e621 is rejected for a missing or unacceptable client identifier
- **THEN** the system SHALL NOT retry with a `_client` query parameter, because that parameter is not implemented server-side and does not lift the rejection

#### Scenario: Missing identifier surfaces as an error

- **WHEN** a request fails because a required client identifier was absent
- **THEN** the system SHALL report the failure rather than retrying silently without the identifier

### Requirement: Media Host Allowlist Per Source

The system SHALL validate outbound media requests against the active adapter's declared permitted media hosts. Requests to hosts outside that list SHALL be rejected.

Validation SHALL match host boundaries exactly and SHALL NOT accept a host that merely contains a permitted domain as a suffix. Each adapter SHALL declare every host its source actually serves media from, including secondary hosts that appear in only a fraction of responses. (Verified 2026-10-01)

#### Scenario: Permitted host accepted

- **WHEN** a media request targets a host declared by the active adapter
- **THEN** the request SHALL be permitted

#### Scenario: Non-permitted host rejected

- **WHEN** a media request targets a host absent from the active adapter's declared list
- **THEN** the request SHALL be rejected

#### Scenario: Suffix-confusion host rejected

- **WHEN** a media request targets a host that merely ends with a permitted domain's characters but is a different registrable domain
- **THEN** the request SHALL be rejected, because the current proxy test is a bare substring suffix check that a host such as a prefixed lookalike domain passes

#### Scenario: A secondary media host is declared

- **WHEN** a source serves media from more than one host
- **THEN** the adapter SHALL declare each of them, including hosts that appear on only a small fraction of responses

#### Scenario: A media URL's host differs from its sibling URL's host

- **WHEN** a post's full media URL and its preview URL are served from different declared hosts
- **THEN** each SHALL be permitted independently, because a source's video media host is not the same host as its preview and sample host
