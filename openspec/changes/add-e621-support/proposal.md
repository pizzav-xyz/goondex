## Why

The client is architecturally single-source: `api/client.ts`, `proxy.py`, `src/config.ts`, and the `Post` type all hardcode Rule34's API shape and hostnames. e621 is a second Danbooru-style upstream with a *materially different* contract — verified live against production, e621's official docs, and the e621ng server source, not assumed — so bolting it on as another `if (source === 'e621')` branch would multiply the branching that already made `proxy.py` and `SearchView.vue` hard to reason about. The rename is folded in because "rule34-client" stops being true the moment a second board exists, and doing it later means a second breaking pass over the same identifiers.

The verification pass also turned up a **live user-facing bug on Rule34 today**: the `rating=` query parameter is a complete no-op, and `rating=safe` returns explicit posts. Users have been searching unfiltered — and actively misled — with no error anywhere. This change fixes that as a side effect of getting the contracts right.

## What Changes

### Source abstraction (core)

- Introduce a **source adapter contract** — each upstream implements it; the app depends only on the contract, never on a board's URL or field names.
- Add a **source registry** with a user-visible source selector. Rule34 becomes the default and remains behaviorally identical when it is the active source.
- Move all board-specific knowledge out of shared code and into per-source modules: **endpoints, auth, rate limit, page-size cap, rating vocabulary, media hosts, tag namespaces, capability set.**
- Add a **shared search normaliser** (`src/sources/queryNormalizer.ts`, capability `search-normalizer`): one pure function that rewrites a canonical query into board syntax and reports every term it could not carry over, so neither adapter invents its own translation.

### Per-source capability differences (verified against live APIs, e621 docs, and server source, 2026-10-01)

These are not assumptions. Every row below was confirmed by request/response against production, cross-checked against e621's official API page and the `e621ng@9ecbb7e` server source. All claims marked **Verified 2026-10-01**.

| Concern | Rule34 (current) | e621 (verified) |
|---|---|---|
| Auth | `api_key` + `user_id` query params; **only total absence fails** (a bad key returns full data), and anonymous requests return a bare JSON **string**, not an array | HTTP Basic **preferred**; `login` + `api_key` a documented working alternative; anonymous reads fully supported |
| Rate limit | Cloudflare **429** (not 503), empty body, **no `Retry-After`**; cliff ≈ 1.25 req/s | **429 and 503 treated identically** as rate-limited (429 = Cloudflare, `Retry-After: 2`, **HTML body**); docs say 2 req/s; **practical rule ≤ 1 req/s, serialized, never parallel** |
| Page-size cap | **1000**, silently clamped at HTTP 200 (limit=2000/5000 return the same 1000 posts byte-identically) — clamp client-side | **320**, over-limit returns **HTTP 410 Gone** with a JSON error; default page size is 75, so `limit` must always be sent explicitly |
| `tags` field | always a space-separated **string** (1000/1000) → split; contains undecoded HTML entities | object of **9** category arrays: `general, artist, contributor, copyright, character, species, invalid, meta, lore` (key is `meta`, not `metatag`; `contributor` is real) |
| Timestamps | `change` = integer Unix seconds = **last-modified, not creation**. `created_at` does not exist; Rule34 exposes **no creation timestamp at all** | `created_at` + `updated_at` ISO8601 **with a server-local offset** (e.g. `2026-10-01T13:44:40.176-04:00`); the docs' `+00:00` is wrong — parse offset-aware |
| Rating filter | `rating=` is a **complete no-op**; filtering works **only** via the `rating:explicit` / `rating:questionable` **long-form** tags. Vocabulary is those two values only | `rating=` **does not exist**; filtering only via `rating:` tag, whose server logic reads the **first character** — short forms `s`/`q`/`e` are canonical, long forms work only by accident, anything else is silently dropped (**fails open**) |
| Date filter | **none** — no date/time operator exists at all; any `date:` variant zeroes the result set (rate-sampled id threshold instead) | **native `date:`**, 7 units, singular + plural, abbreviations, relative and absolute forms, `..` ranges; a bare number means **days** |
| Ordering | `sort=` is **entirely ignored** (every value returns the same set, always newest-id-first; no `seed` param works) | `order:` is a **single token with an underscore suffix** (`order:id_desc`); space form silently returns 0; bare `order:id` means **ascending** |
| Autocomplete | `/autocomplete.php?q=` — unauthenticated, array of 10 `{label, value}` with a **parenthesized count in `label`**, but served as **`content-type: text/html`**; docs call it "Not an official endpoint" | `tags.json?search[name_matches]=` with `*` wildcards only (`search[prefix]`, `search[name_prefix]`, `search[starts_with]` do **not** exist); returns a **bare array on success but `{"tags":[]}` on zero results** |
| Video formats | **mp4 + gif** (985 / 14 of a 600-post `tags=video` sample; **no webm on any host**); no duration field of any kind, only coarse duration *tags* | **webm + mp4** (~73% / ~27%; 0 swf observed live); posts usually expose the **other codec as an alternate** |
| Media host | **two** hosts: `api-cdn.rule34.xxx` (previews/samples) and `api-cdn-mp4.rule34.xxx` (`file_url`/`sample_url` for video posts); `Access-Control-Allow-Origin` absent → proxy required | `static1.e621.net` (single CDN, 7,640/7,640) plus a second server-side host `static1.e926.net` to allowlist; CORS fully open, but requests still route through the proxy |
| Cross-origin GET | blocked (proxy required) | **allowed** (simple requests) |

- **Rating filtering moves to the `rating:` tag for both sources, with per-board vocabularies and no silent failure.** See the rating section below.
- **Tags normalize to a canonical form** so tag-click-to-search works across sources: a flat tag array internally, from a space-separated string on Rule34 and a 9-key category object on e621.
- **Timestamps normalize to Unix seconds** internally, so `DateResolver` and any date logic has one input format — while remembering that on Rule34 that value is a *last-modified* time, not a creation time.
- **Canonical search syntax is `sort:` and long-form `rating:`**, translated per board by the shared normaliser. Everything else passes through verbatim, which preserves e621 power-user syntax (`score:`, `type:`, `pool:`, `favcount:`) at the cost of unknown operators zeroing a Rule34 search — documented, not papered over.

### Rating filtering: two different vocabularies, and both fail open if you guess wrong

Rating is the sharpest example of why a shared normaliser exists: both boards use a `rating:` **tag**, but neither accepts the other board's spelling, and **both fail open rather than erroring**.

- **Rule34 vocabulary is `explicit` and `questionable` only** (931 / 69 of 1000 posts). There is no `safe`, `general`, `sensitive`, or `neutral` on Rule34. One anomalous capitalized `"Explicit"` record exists. **Verified 2026-10-01**, 3000+ posts.
- **Rule34 accepts only the long forms.** `rating:explicit` and `rating:questionable` filter perfectly; `rating:s`, `rating:e`, `rating:q`, `rating:safe`, `rating:neutral`, and `rating:general` all return **zero** results. **Verified 2026-10-01.**
- **e621 canonical spellings are the short forms `rating:s`, `rating:q`, `rating:e`.** The server's tag-query logic takes the **first character only**, downcased, and requires it to be in `{s,q,e}` (`e621ng app/logical/tag_query.rb:1454`). So `rating:safe` / `rating:questionable` / `rating:explicit` work **by accident**, and anything else — e.g. `rating:zzz` — is **silently dropped, returning unfiltered results** (`fails open`). **Verified 2026-10-01** from source and live.
- **The adapter therefore emits each board's canonical spelling and nothing else**: long forms for Rule34, short forms for e621, always. The user-facing canonical syntax accepts only long forms and validates client-side before sending, because a mistyped rating that fails open returns an unfiltered grid with no error.
- **Ratings are metatags, not tag rows.** `tags.json?search[name]=rating:e` returns `[]`; autocomplete will never offer them.

### Date filtering — native on e621, absent on Rule34 (the reverse of the assumption)

Rule34's search API has no date operator, so `proxy.py` reverse-engineers a date→id threshold by sampling post rate (`DateResolver`). e621 **has** a native `date:` operator, so it needs no such hack. **Verified 2026-10-01.**

**e621's `date:` grammar is broad, and two forms are traps.** Confirmed both against the server parser (`e621ng app/logical/parse_value.rb:28-43, 210-242`) and live:

- 7 units: `second`/`minute`/`hour`/`day`/`week`/`month`/`year`; **singular and plural are both valid** and byte-identical in result (`date:30day` ≡ `date:30days`).
- Abbreviations `s`/`mi`/`h`/`d`/`w`/`mo`/`y`; `_<unit>_ago` and `ago` suffixes; keywords `today`/`yesterday`/`decade` and `yesterweek`/`yestermonth`/`yesteryear` (with counts).
- **A bare number means DAYS** (`date:30` = 30 days ago). Relative forms emit a **lower bound** (`>= now-N`); a bare absolute date is a single-day exact match. Comparisons `>`/`<`/`>=`/`<=` and inclusive `..` ranges (`a..b`, `..b`, `a..`) are supported; comma lists are capped at 320. Invalid input returns **HTTP 422**.
- **Trap 1 — never emit a bare year.** `date:2024` means *2024 days ago*, not the year 2024. The intended reading (`date:2024-01-01`) is what an absolute form must use.
- **Trap 2 — `date:` does not accept bare `hour`/`minute`/`second`.** Those units require a number.
- On Rule34, by contrast, **no date or time operator exists at all**: `date:week/month/year/2024/>…`, `created_at:>`, `change:>`, and `age:` **all return zero results** — an unknown qualified tag *zeroes* the result set rather than being ignored or erroring. So a Rule34 date filter's failure symptom is an **empty grid**, not "too many results", and the date term is never sent upstream at all.

Verified on e621 by isolating an older id window, because a naive test is misleading: every newest post falls inside week *and* month *and* year, so `date:week` and `date:year` return identical results on a fresh search — indistinguishable from the tag being ignored. Constraining to posts before a known ~99-day-old id discriminates properly:

```
id:<6499999 (no date)    -> n=8   (newest 2026-06-24)
id:<6499999 date:week    -> n=0            <- correctly excluded
id:<6499999 date:month   -> n=0            <- correctly excluded
id:<6499999 date:year    -> n=8            <- correctly included
```

- Date filtering is modeled as a **per-source capability**: validated native pass-through for e621, rate-estimated threshold for Rule34.
- `DateResolver` stays Rule34-only. It is **not** ported to e621 — there is nothing to solve there.
- Where a source cannot honor a date filter, the UI says so rather than silently returning unfiltered results. That path now also covers the proxy's own calibration failure (see Correctness fixes).
- Because a `date:` term is *consumed* on Rule34 and *forwarded* on e621, the normaliser must know which board it is targeting. Rule34 deep pagination (below) is the reason this matters.

### Transport honesty (blocking constraint)

e621's API guidelines state plainly: *"Do not impersonate a browser user agent, as this will get you blocked"* and *"A non-empty User-Agent header is required for all requests."* `proxy.py` currently sends `curl_cffi impersonate="chrome"` for every request. **Verified 2026-10-01** against `e621.net/help/api`.

- The proxy must send an **honest, descriptive `User-Agent`** per source instead of impersonating Chrome, e.g. `trawl-comb/0.1 (personal client)`. Omitting `User-Agent` returns **403**, so this is mandatory, not stylistic. **Verified 2026-10-01.**
- **The `_client` query parameter is not a usable escape hatch.** It is **not implemented server-side** and does **not** bypass the 403 — tested and it fails. Browsers cannot set `User-Agent` from JS, which is what that workaround was for; the proxy is a real HTTP client and sets the header directly. **Verified 2026-10-01.**
- The 403 comes from **Cloudflare**, and it is a **denylist** of library-default tokens, not enforcement of descriptive UAs: `x`/`test` return 200 today and a full Chrome UA also returns 200 today. We send the descriptive UA anyway because the docs say to and because the denylist can change. **Verified 2026-10-01.**
- **`curl_cffi` TLS impersonation is not used for e621.** The existing Rule34 path keeps it; e621 gets plain TLS.
- **Per-source spacing replaces the single global 500 ms.** Rule34's 429 cliff is ≈ 1.25 req/s and its responses carry **no `Retry-After`**, so the retry loop needs its **own backoff timer**; the proxy must use **≥ 800 ms** for Rule34 (the current 500 ms client *and* 500 ms proxy values are both too aggressive). e621 gets **≤ 1 req/s, serialized, never parallel**. **Verified 2026-10-01.**
- **429 and 503 are treated identically as rate-limited, on both boards, with a dedicated backoff.** e621's 429 body is **HTML**, not JSON, so a blind `JSON.parse` of an error body throws; and 503 means database-down only in code, so it cannot be used as a health signal. **Verified 2026-10-01.**
- **Both boards' zero-result responses must be handled explicitly.** Rule34 returns **HTTP 200 with a 0-byte body** for zero results — `json.loads()` on it throws. **Verified 2026-10-01.**
- **Auth failure on Rule34 is detectable only by body type.** An anonymous request returns HTTP 200 with a bare JSON **string** (`"Missing authentication. Go to api.rule34.xxx for more information"`), while a request with a *bad* key returns full data. So the client distinguishes failure by **body type (string vs Array), never by status code**, and no `hasAuth()`-style key check can validate a key. **Verified 2026-10-01.**
- The existing SSRF allowlist (`endswith('rule34.xxx')`) is **split per source** and its dot-boundary bug fixed — `evilrule34.xxx` currently passes.

### Correctness fixes surfaced by this work

- **Watchlist namespacing.** Rule34 and e621 ids are independent numbering spaces; id `1000` exists on both. The watchlist is keyed by bare `number` today, so switching boards would mark unrelated posts as watched. Entries become `{source, id}`.
- **Pagination `hasMore`** is computed from the *filtered* post count, so a duration filter can stop infinite scroll while more pages exist.
- **Rule34's page size is silently clamped at 1000** with no error and no truncation signal, so the adapter clamps client-side; e621 instead returns **410 Gone** above 320. Two opposite failure modes, two different client behaviors. **Verified 2026-10-01.**
- **Rule34's pagination parameter is `pid=`, not `page=`.** Sending `page=` returns HTTP 200 with a **0-byte body**, which looks like an empty result rather than an error. **Verified 2026-10-01.**
- **Rule34's `sort=` is ignored entirely**, so the adapter drops ordering terms on that board and *tells the user* rather than pretending the sort applied. **Verified 2026-10-01.**
- **The proxy's date-fallback chain defect is worse than "bare `except: pass`".** The chain `resolve → calibrate → resolve` is real and does log on failure, but on failure the **date tag is stripped and the search proceeds unfiltered with no notice** — the threshold stays `None` and the cleaned tags are sent anyway. That is a silent wrong answer, not a swallowed exception. It is collapsed into a single `threshold_for(days) -> int | None` that **reports** failure so the UI can say so. **Verified 2026-10-01** (`proxy.py` lines 200-211).
- **The proxy's `DATE_TAG_RE` accepts singular units only**, so `date:30days` falls through as an ordinary tag and Rule34 zeroes it. Plurals are accepted, and the normaliser canonicalises them to the documented form before sending. **Verified 2026-10-01** (line 20).
- **`safeMode` is dead state** — persisted, toggled, and displayed (button variant/color, settings switch), but no behavioral consumer reads it, and the settings label "Filter explicit results" is false. Decided: **remove it and its UI** (wiring it into the rating filter would be a new feature nobody asked for).
- **Duration filtering excludes images**, since posts without a known duration fail the condition check. Documented as a behavior decision, not left implicit.
- **Duration probe supersession, video-buffer lifetime, and duplicated UI lists.** A slow duration probe must not rewrite results from a newer query; the video buffer is cleared on new search rather than only on unmount; the tripled watched-mode / theme-mode lists and the duplicated dev-TTL persistence blocks are consolidated into single sources. Small, verified defects in files this change already touches.
- **Autocomplete failures are surfaced, not swallowed.** The `catch { return [] }` chain turns every network error into an empty dropdown indistinguishable from "no matches"; failures are reported distinctly from zero suggestions.
- **CSP loopback exception is dev-only.** The unconditional `connect-src http://127.0.0.1:*` would ship in production builds; it is scoped to development.

### Rename

Rename the project to reflect that it is no longer Rule34-specific, scoped to **metadata and code identifiers only**: `package.json` name, README, git repository name. The `r34_*` `localStorage` keys are **deliberately left unchanged** so existing users keep their watchlist, theme, and settings — a key migration is not worth the data-loss risk. A code comment will record that the prefix is intentionally historical.

**Decided name: `trawl-comb`** (decided 2026-10-01). Verified npm-unclaimed; no literal "booru" — the subject is implied, not spelled out. Runners-up kept for reference: `barbel-sift`, `rove-sift`, `pupil-loupe`, `flit-drift`.

- **No `localStorage` key migration.** `r34_*` keys persist by design.
- **Not BREAKING** for users: watchlist data and settings are preserved. Only the package/repository name changes.

## Capabilities

### New Capabilities

- `booru-source-adapter` — the adapter contract, source registry and selection, per-source configuration, and the capability matrix each source declares.
- `post-normalization` — a canonical `Post` shape produced from board-specific responses: tags, timestamps, ratings, media URLs, and video detection.
- `search-normalizer` — the shared, pure query translation layer: one `normalizeQuery` function that converts canonical search terms into each board's syntax and returns every term it could not carry over, with a reason, so no term is ever silently discarded. Single implementation in `src/sources/queryNormalizer.ts`, called by both adapters.
- `tag-completion` — per-source tag autocompletion, reconciling Rule34's `autocomplete.php` (HTML-mime JSON, parenthesized counts in labels) with e621's `tags.json?search[name_matches]=` (bare array vs `{"tags":[]}`, wildcards only, no `prefix` equivalent).
- `capability-aware-ui` — the UI adapting to the active source's capabilities: rating filter availability and spellings, date-filter support, video buffering eligibility, sort-control availability, and honest messaging when a requested filter or sort term cannot be honored.
- `watchlist-scoped-by-source` — watchlist entries keyed by `{source, id}` so identically-numbered posts on different boards are distinct, with migration from the current bare-id format.
- `date-filter-portability` — date-filter behavior across sources: validated native pass-through, rate-sampling fallback, and the declared-unsupported path.

### Modified Capabilities

None. `openspec/specs/` is currently empty, so every capability above is new.

## Impact

**New:** `src/sources/` (contract, registry, `rule34/`, `e621/` adapters), `src/sources/types.ts` (canonical `Post`, `SourceCapabilities`), **`src/sources/queryNormalizer.ts`** (the shared search normaliser — pure `normalizeQuery`, both adapters call it, never duplicated), and the spec delta **`openspec/changes/add-e621-support/specs/search-normalizer/spec.md`**.

**Heavily modified:** `src/api/client.ts` (becomes a thin dispatcher over adapters; the `rating=` param becomes a `rating:` tag; Rule34 requests switch to `pid=`, clamp `limit` to 1000, and detect auth failure by body type), `src/types/post.ts` (normalized fields, source tag), `src/views/SearchView.vue` (source-aware pagination, `hasMore` fix, dropped-term notices), `src/stores/watched.ts` (`{source,id}` keys + migration), `src/composables/useLightbox.ts` (post detail via adapter), `proxy.py` (per-source routing, transport, spacing, UA, allowlist; date-tag plural acceptance and a single reporting `threshold_for`), `src/config.ts` (per-source config blocks).

**Modified:** `SearchBar.vue` (source-aware autocomplete + per-board rating chips + `sort:` syntax), `SettingsPanel.vue` (source selector), `AppShell.vue`, `Lightbox.vue` (source-scoped watchlist checks), `ImageCard.vue` (broken-image fallback + retry), `index.html` (explicit CSP `img-src`/`media-src` list covering `static1.e621.net`, `static1.e926.net`, and `api-cdn-mp4.rule34.xxx` — kept as an explicit list, with a test enforcing registry coverage, rather than a build-time generator), `README.md`, `package.json`.

**Unaffected:** `useVideoBuffer`/`useVideoDuration` internals, `useTheme`, `cache.ts`, routing (still a single-view SPA).

**Risks:** the `rating=` → `rating:` change alters results for existing Rule34 users — that parameter was a confirmed no-op, so this is a bug fix, but it is a visible behavior change and belongs in release notes. Watchlist migration must be lossless. e621's ToS grants only personal, non-commercial use (§4) and permits bots solely per its API guidelines (§6), so this client stays within bounds only while non-commercial.

## Open Questions

1. ~~Final project name~~ — **decided: `trawl-comb` (2026-10-01).**
2. ~~e621 video support~~ — **resolved (2026-10-01): e621 serves both `webm` and `mp4`** (live sample ≈ 27 `mp4` / 13 `webm`), and posts usually expose the other codec under `file.alternates`, so the adapter prefers the `mp4` alternate. e621 posts also carry a top-level float `duration` (which may be `null`, not absent), so the adapter prefers it and falls back to client-side probing only when it is null. Rule34 has **no** duration field of any kind, so it always probes — its canonical video set is `['mp4','gif']` and there is **no webm** on any host.
3. ~~Date filtering on e621~~ — **resolved**: e621 has a native `date:` operator with a broad grammar, so no rate-sampling is needed there and `DateResolver` remains Rule34-only. The grammar is validated before forwarding, plural forms are canonicalised, and bare years are never emitted.
4. ~~Ordering on Rule34~~ — **resolved (2026-10-01): not possible.** `sort=` is ignored on every value and the order is always newest-id-first, so ordering terms are dropped on Rule34 and surfaced to the user as a notice.
5. ~~Rule34 media hosts~~ — **resolved (2026-10-01): two hosts**, `api-cdn.rule34.xxx` and `api-cdn-mp4.rule34.xxx`, and both go in the CSP. e621 needs `static1.e621.net` **and** the server-side `static1.e926.net`; both are included in the allowlist.
6. ~~Does e621's `_client` parameter bypass the User-Agent requirement?~~ — **resolved (2026-10-01): no.** Tested and it fails; the parameter is not implemented server-side. An honest descriptive `User-Agent` is the mechanism.
7. ~~Is `rating:safe` portable to Rule34?~~ — **resolved (2026-10-01): it is passed through verbatim and correctly matches nothing**, because Rule34 exposes no safe posts. A safe filter on a board with no safe content *is* the empty result set; inventing a translation would be a lie.
