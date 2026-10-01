## Context

See `proposal.md` — Why.

The current state that shapes this design:

- **Everything is single-source.** `src/api/client.ts` builds Rule34 URLs inline; `proxy.py` hardcodes `https://api.rule34.xxx` in three places; `src/config.ts` hardcodes Rule34's limits; `Post` in `types/post.ts` mirrors Rule34's field names.
- **Two rate limiters already stack.** A 500 ms serial queue in `client.ts` and a 500 ms global `_rate_wait()` in `proxy.py`. The README documents one.
- **`proxy.py` uses `curl_cffi impersonate="chrome"` for every request.** e621's guidelines explicitly forbid browser impersonation, and require a non-empty `User-Agent` (verified: omitting it returns 403).
- **e621 permits direct cross-origin GET.** Rule34 does not. So e621 requests could bypass the proxy entirely — but see Decision 4.
- **`DateResolver` already reverse-engineers a date→id threshold** by sampling two pages 10,000 posts apart. It exists *because* Rule34 lacks a date operator. e621 has a native `date:` tag and does not need it.
- **Watchlist is keyed by bare `number`.** Rule34 and e621 ids are independent spaces, so bare ids collide across sources.
- **`proxy.py` is single-threaded** (`HTTPServer`), so its global rate limiter serializes all traffic including video.
- **Pre-existing type errors exist** in `vite.config.ts` and `vitest.config.ts` (missing `@types/node`, duplicate-Vite plugin type conflict) — but only when those files are checked directly, since `tsconfig.json` excludes them and `vue-tsc --noEmit` exits 0. `durationFilter.ts` and `useLightbox.ts` are clean; the previously suspected expression-level defects there do not exist. These are out of scope but will be encountered while working in these files.

## Goals / Non-Goals

**Goals:**

- One adapter contract; zero board-specific knowledge in shared code.
- Rule34 behavior unchanged when Rule34 is active — this is a refactor, not a rewrite.
- e621 works for search, tag completion, post detail, ratings, date filtering, watchlist, and video buffering where the source permits.
- Normalize the six verified shape differences so downstream code never branches on source.
- Preserve existing user data (watchlist, theme, settings) with no migration prompts.
- Report unappliable filters honestly instead of silently returning unfiltered results.

**Non-Goals:**

- **Uploads, voting, favouriting, comments, pools, notes.** e621's API offers all of these; none are in scope. Read-only client.
- **Multi-board aggregate search.** One active source at a time. A source selector, not a federation.
- **User accounts / auth UI.** Credentials come from env as they do today (`R34_*` for Rule34; new `E621_LOGIN` / `E621_API_KEY` for e621, anonymous reads otherwise).
- **Fixing the pre-existing type errors** listed above, except the build-config ones in task 8.7: the vitest config is extended by this change's new tests, so its type conflict blocks adapter work and is carved out of this non-goal.
- **Making the `duration:` filter or video probing source-aware beyond what's specified.** Duration filtering stays client-side.
- **Rewriting the rate limiter into a shared scheduler.** Decision 4 keeps the existing shape — deliberately: two stacked limiters (client queue + proxy) is a known redundancy, and unifying them across a TypeScript/Python boundary is a larger change than this one. The plan does not pretend the shape is ideal; it rewrites both halves' intervals (task 4.5) while keeping the two-layer ownership, and names the resulting "effective interval is the max" coupling explicitly rather than leaving it implicit.

## Decisions

### 1. Adapter contract as a discriminated union, not a god interface

**Decision:** Define `SourceAdapter` with the union of everything any source might need, and require each adapter to declare its capabilities so callers never invoke an unsupported method.

**Alternative considered:** One thin `BaseAdapter` with optional methods (`autocomplete?`). Rejected — optional methods push `if (adapter.autocomplete)` checks into every call site, which is the branching we're trying to eliminate. A discriminated union on `capabilities` makes illegal states unrepresentable.

**Consequence:** a source that lacks a capability still satisfies the contract; the UI reads `capabilities` once instead of probing for methods.

### 2. Canonical `Post` is an internal shape; adapters own the wire types

**Decision:** `Post` becomes the single internal representation (normalized tags array, Unix-seconds timestamp, canonical rating, resolved media URLs, `source` id). Each adapter declares its own wire-format TypeScript interface and is solely responsible for mapping wire → canonical.

**Alternative considered:** A loose `{ [k: string]: any }` passthrough. Rejected — it just relocates the `if (source === ...)` branching into rendering code.

**Mapping table** (verified against live responses):

| Canonical | Rule34 wire | e621 wire |
|---|---|---|
| `id` | `id` | `id` |
| `tags` | `tags` (space-delimited string) → split; contains undecoded HTML entities, decoded on split | `tags` (object of 9 category arrays: `general, artist, contributor, copyright, character, species, invalid, meta, lore`) → flatten |
| `timestamp` | `change` (integer Unix seconds) — **last-modified, not creation. `created_at` does not exist; Rule34 exposes no creation timestamp at all** | `created_at` (ISO 8601, **server-local offset** e.g. `-04:00`, not `+00:00`) → parse offset-aware; `updated_at` likewise |
| `rating` | `rating` — vocabulary is **`explicit` / `questionable` only** (one anomalous capitalized `"Explicit"` record exists) | `rating` (`s` / `q` / `e`) → map to canonical |
| `fileUrl` | `file_url` (video posts resolve to `api-cdn-mp4.rule34.xxx`, previews/samples to `api-cdn.rule34.xxx`) | `file.url` (nullable on pending/deleted posts) |
| `previewUrl` | `preview_url` | `preview.url` (nullable) |
| `sampleUrl` | `sample_url` (populated even when `sample=false`, which is not a "no sample" signal) | `sample.url` — **key always present, value `null` when absent, even under `has:true` when the file is gone** |
| `fileExt` | derived from **`image`** (basename *with* extension) via splitext. **`file_ext` does not exist** | `file.ext` |
| `sourceUrl` | `source` — a name **string**, and **empty string on ~16% of posts** (nullable) | `sources` (array of strings, may be `[]`) → join; no singular `source` field exists |
| `score` | `score` — a **single combined int**; no `upscore`/`downscore` | `score.total` (`score` is exactly `{up, down, total}`; `down` can be negative) |
| `uploader` | `owner` — a name **string**, the only uploader signal; no `creator_id`/`creator_name` | `uploader_id` / `uploader_name` (no `creator_*`) |
| `flags` | no equivalent; `is_pending`/`is_favorited` do not exist | `flags` — 6 booleans (`pending`, `flagged`, `note_locked`, `status_locked`, `rating_locked`, `deleted`). No top-level `status`/`is_pending` |
| `duration` | **no duration field of any kind**; only coarse duration *tags* (`longer_than_30_seconds`, often absent) → always probed client-side | top-level `duration`, a **float** in seconds (`0.999983`, `674.377143` — parse as float, never int), **`null`** on non-video (not 0, not absent) → prefer it, probe only when `null` |
| pagination param | **`pid`** (0-based page index). **`page=` breaks the query** (HTTP 200, 0-byte body) | `page` (hard-capped at 750; `page=a<id>` / `page=b<id>` cursors for bulk) |
| ordering | **`sort=` is entirely ignored** (every value returns the same set; no `seed` works) → dropped by the normaliser with a notice | `order:` single token, underscore suffix: `order:id_desc`, `order:score_asc` |

**Gotchas encoded in the adapters** (all **Verified 2026-10-01**):

- **e621 `sample` null-guard rule.** `sample.url` is *always present as a key* and is `null` when there is no sample — even when `has: true` and the file has been deleted or is pending. The mapping must therefore guard on the **truthiness of `url`**, never on key presence. `sample.width`/`height` are populated even when `has: false` (they mirror the file's dimensions), so they are **not** a has-sample signal either.
- **e621 legacy JSON shape is the default.** We keep the wrapped form (`{"posts":[...]}` for search, `{"post":{...}}` for detail via `GET /posts/<id>.json`) and **never send `v2=true`**, which reshapes `tags` into a flat array in basic mode and moves fields under `files`/`stats`. Pinning this is deliberate: the alternative is a silent contract change. Note `/post/<id>.json` (singular) is 404, and detail data can differ from the index entry (score, favourites, `updated_at`).
- **e621 media alternates.** `sample`/`preview` also carry `alt` (a webp URL, nullable) and `sample.alternates` (video `original`/`variants` in webm+mp4, and `samples` at 480p/720p). A webm post usually exposes an **mp4 alternate** and vice versa — **prefer the mp4 alternate**. No `sample_100`/legacy thumbnail fields exist.
- **e621 video codecs.** Both `webm` and `mp4` serve (live sample ≈ 27 `mp4` / 13 `webm`, 0 swf observed), with the other codec usually available as an alternate; `duration` is the preferred signal over probing.
- **Rule34's timestamp is not a creation time.** Anything that displays or sorts by "post date" on Rule34 is displaying `change` (last-modified), because that is the only timestamp the API exposes. This is a documented limitation, not something the adapter can repair.
- **Rule34's rating vocabulary is two values wide.** `general`/`sensitive`/`neutral` do not exist on Rule34, so the canonical → Rule34 mapping has exactly two legal outputs.

### 3. Rating filtering moves from a request parameter into the query string, with a per-board vocabulary

**Decision:** Delete the `rating=` request parameter entirely. Append a `rating:` search term, spelled per board: **long forms only for Rule34** (`rating:explicit`, `rating:questionable`), **short forms only for e621** (`rating:s`, `rating:q`, `rating:e`).

**Rationale (Verified 2026-10-01):**

- **Rule34's `rating=` is a complete no-op, not merely undocumented.** `tags=solo&rating=explicit`, `rating=safe`, and `rating=bogusvalue` all return byte-identical ID sets to sending no parameter — and `rating=safe` returns *explicit* posts, so the current client is not merely unfiltered, it is actively misleading. Rating filtering on Rule34 works **only** through the long-form `rating:` tags; the short forms, `safe`, `neutral`, and `general` all return zero.
- **e621 has no `rating=` parameter at all** for post search (it exists only on the Upload model) and ignores it, returning mixed ratings. Filtering is `rating:`-tag-only, and the server takes the **first character only**, downcased, requiring `{s,q,e}` (`e621ng app/logical/tag_query.rb:1454`).

**Client-side validation is required, because both boards fail open.** e621 silently *drops* an unrecognized rating term, which means the query runs unfiltered and the user sees a larger result set with no error. So the canonical input accepts **only the long forms** (`rating:safe` / `rating:questionable` / `rating:explicit`; `rating:e`-style input is rejected as unrecognized), validation happens client-side, and only then does the normaliser emit the target board's spelling. An unrecognized rating is an explicit error, never a silently unfiltered grid.

**`rating:safe` on Rule34 passes through verbatim and matches nothing — deliberately.** That is the *correct* answer: Rule34 exposes no safe posts (its vocabulary is `explicit` + `questionable`, 931/69 of 1000). Translating it into something else would be fabricating results.

**Alternative considered:** Keep the parameter and add `rating:` tags. Rejected — leaves a silent-failure path in the code, and this repo's `AGENTS.md` rule 1 forbids fallbacks that mask a broken primary path. Keeping it would also preserve a parameter that provably does nothing on the board it was written for.

**Known behavior change:** Rule34 users' result sets *will* change, because the filter they thought was applied never was. That is a bug fix, but it is visible, so it is called out in the proposal's Impact section and belongs in release notes.

**Note:** ratings are **metatags, not tag rows** — `tags.json?search[name]=rating:e` returns `[]`, so autocomplete must never offer them.

### 4. Keep the Python proxy for both sources, but give each source its own transport policy

**Decision:** Do **not** bypass the proxy for e621 despite its permissive CORS. Route both sources through it, with per-source transport config:

| | Rule34 | e621 |
|---|---|---|
| TLS | `curl_cffi impersonate="chrome"` (unchanged) | plain `curl_cffi`, **no impersonation** |
| `User-Agent` | omitted (current behavior) | **required**, descriptive, non-browser, e.g. `trawl-comb/0.1 (personal client)` |
| Rate-limit status | **429** (Cloudflare), empty body, **no `Retry-After`** | **429** (Cloudflare, `Retry-After: 2`, **HTML body**) and **503** — treated **identically** |
| Min spacing | **≥ 800 ms** per request | **≤ 1 req/s, serialized, never parallel** |
| Retry | own backoff timer (no server hint to follow) | own backoff timer, honouring `Retry-After` when present |
| Page size | `limit` clamped client-side to **1000** (silently clamped at HTTP 200 with no truncation signal) | `limit` **always sent explicitly** (default is 75); over **320** returns **HTTP 410 Gone** |
| Pagination | **`pid=`** (0-based). `page=` returns HTTP 200 + **0-byte body** | `page` (capped at 750; `page=a<id>`/`page=b<id>` cursors for bulk) |
| Media allowlist | `api-cdn.rule34.xxx` **+ `api-cdn-mp4.rule34.xxx`** (video `file_url`/`sample_url`) | `static1.e621.net` **+ `static1.e926.net`** (server-side second host) |
| Date resolution | active (rate-sampled) | not needed (native `date:`) |

**Rationale for not bypassing:** the proxy does three jobs that would otherwise leak into the browser — the date→id rewrite, the media allowlist (an SSRF control), and rate limiting. Moving e621 direct would mean reimplementing all three in TypeScript and losing the SSRF boundary. e621's CORS being fully open (`access-control-allow-origin: *`, preflight included) is a reason the proxy *could* be bypassed, not a reason it should be: the proxy also provides the date rewrite and the SSRF boundary. One code path, two policies.

**Why per-source spacing, and why the current 500 ms is wrong (Verified 2026-10-01):** Rule34's 429 cliff sits at ≈ 1.25 req/s, measured at 60×0.75 s clean and 150-parallel → 140×429. The current **500 ms client queue and 500 ms global `_rate_wait()` are both too aggressive** and must become per-source spacing of **≥ 800 ms** for Rule34. e621's docs say 2 req/s but name both 429 and 503; the practical rule is **≤ 1 req/s, serialized, never parallel**, because 429 comes from Cloudflare's load-shedder (concurrency-based, not a documented quota) and the Rails `APIThrottled` bucket only applies to logged-in non-GET requests. Anonymous GETs are not throttled by Rails at all, which is exactly why the *Cloudflare* layer is the one to respect.

**429 and 503 are the same thing to this client.** In e621's code 503 means database-down only, so it carries no distinct operational meaning here; treating them differently would mean either retrying a genuine outage or giving up on a throttle. Both are classified as rate-limited and handled by one backoff path. **The 429 body is HTML, so error paths must never blindly `JSON.parse` a response that failed** — and Rule34's 429 has no `Retry-After` at all, so the backoff timer is ours, not the server's.

**Rule34 zero results and auth failures are both non-obvious (Verified 2026-10-01).** Zero results arrive as **HTTP 200 with a 0-byte body** (never `[]`), so `json.loads()` on it throws and the client must treat an empty body as an empty result set. And auth can only be detected by **body type**: an anonymous request returns HTTP 200 with a bare JSON *string* (`"Missing authentication. …"`), while a request with a **bad or empty key returns full data** identical to a valid one. So the client distinguishes success from failure by whether the body is an `Array` or a `string`, never by status code — and no `hasAuth()`-style pre-flight check can validate a key.

**Why per-source UA matters:** e621's own docs (`e621.net/help/api`) say *"A non-empty User-Agent header is required for all requests"*, *"Do not impersonate a browser user agent, as this will get you blocked"*, and *"default user agents for programming languages and libraries are usually blocked."* Omitting the header returns **403**, and `python-requests`' default UA also returns 403. The 403 originates from **Cloudflare** and is a **denylist of library-default tokens**, not enforcement of descriptive UAs — `x` and `test` return 200 today, as does a full Chrome UA. We send the honest descriptive UA regardless, because the docs require it and the denylist can change without notice. Scope note: the docs pages are read as documentation and quoted verbatim; nothing is scraped from them and no selectors, endpoints, or DOM structure are derived from any page, so no browser-DOM inspection applies to this integration — the verified surface is the JSON API over HTTP.

**The `_client` query parameter is not a workaround — it was tested and it fails.** It is **not implemented server-side** and does **not** bypass the 403. That documented trick exists for browsers, which cannot set `User-Agent` from JS; `proxy.py` is a real HTTP client and sets the header directly, so the mechanism is a header, not a query param.

### 5. SSRF allowlist: per-source, exact-boundary matching

**Decision:** Replace `hostname.endswith('rule34.xxx')` with a per-source allowlist using boundary-correct matching: `host === domain || host.endsWith('.' + domain)`.

**Rationale:** the current check accepts `evilrule34.xxx` (no dot boundary) — a real SSRF bypass, already flagged in `UNIFIED_AUDIT_REPORT.md` item C1 as fixed but actually only half-fixed. Making the allowlist per-source also removes a hardcoded Rule34 hostname from shared code.

### 6. Date filtering: native where available, rate-sampled only where necessary

**Decision:** e621 passes `date:` straight through as a search term. `DateResolver` stays **Rule34-only** and is not generalized.

**Rationale:** the initial assumption that e621 lacked date support was wrong. It was based on a test that couldn't discriminate: every newest post is from today, so `date:week`, `date:month`, and `date:year` all correctly include it — indistinguishable from the tag being ignored. Constraining to a known ~99-day-old id window shows `date:week`/`date:month` correctly returning 0 and `date:year` returning 8.

So the correct shape is the opposite of what was first planned: e621 needs no rate-sampling, and generalizing `DateResolver` to e621 would add two upstream requests per cold calibration to solve a problem that does not exist there. `DateResolver` remains Rule34's mechanism, unchanged, with the fallback chain collapsed (below).

**The e621 `date:` grammar is validated, not forwarded blindly (Verified 2026-10-01, from `e621ng app/logical/parse_value.rb:28-43, 210-242` plus live confirmation).** The operator is far broader than "a date":

- **7 units** — `second`, `minute`, `hour`, `day`, `week`, `month`, `year` — with abbreviations `s`, `mi`, `h`, `d`, `w`, `mo`, `y`. **Singular and plural are both valid** and byte-identical in result (`date:30day` ≡ `date:30days`).
- **A bare number means DAYS** (`date:30` = 30 days ago). Relative forms emit a **lower bound** (`>= now-N`); a bare absolute date is a single-day exact match.
- Suffixes `_<unit>_ago` and `ago`; keywords `today`, `yesterday`, `decade`, plus `yesterweek` / `yestermonth` / `yesteryear` (with counts). Absolute dates (`date:2024-01-01`, also `april/27/2012`). Comparisons `>`, `<`, `>=`, `<=`. Inclusive `..` ranges (`a..b`, open `..b`, `a..`). Comma lists capped at 320. `date:` filters `created_at`. Invalid input → **HTTP 422**.

**Two traps drive the validation rules:**

1. **Never emit a bare year.** `date:2024` means *2024 days ago*, which lands on a single-day slice around 2021 — not the year 2024. Any year intent must use the absolute form `date:2024-01-01`. A year-granularity filter is exactly the case where this misfires silently and plausibly.
2. **`date:` does not accept bare `hour`/`minute`/`second`.** Those units require a number; only `day`/`week`/`month`/`year` work bare (= 1 unit ago).

So the normaliser validates a `date:` term against this grammar before forwarding and reports a violation rather than letting e621 answer 422 — or, worse, letting a malformed term quietly widen the result set.

**`date:` is consumed on Rule34, never sent upstream.** Rule34 has **no date or time operator at all**: `date:week/month/year/2024/>…`, `created_at:>`, `change:>`, and `age:` **all return zero results** — an unknown qualified tag *zeroes* the result set rather than being ignored or erroring (Verified 2026-10-01). So on Rule34 the term is routed into the `DateResolver` threshold path, and the failure symptom of an unresolvable date is an **empty grid**, not "too many results".

**Plurals: accepted, then canonicalised (decision).** `DATE_TAG_RE` in `proxy.py` currently matches **singular units only** (`day|week|month|year`, optional digits), so `date:30days` falls through as an ordinary tag and Rule34 zeroes it (Verified 2026-10-01, line 20). The **normaliser canonicalises plural units to the documented singular form before sending**, and the proxy's regex is widened to **accept both** so hand-typed queries are not silently broken by a client-side convention. Canonicalising in the normaliser keeps one spelling on the wire; accepting both in the proxy keeps the proxy honest about what users can type.

**Deep pagination is required on Rule34 (Verified 2026-10-01).** Because the Rule34 date filter is a *rate-estimated id threshold* rather than a server-side predicate, honoring a date filter means requesting a page index `pid` that corresponds to the threshold id — potentially thousands of pages deep — and Rule34 answers deep `pid` values. Repeated identical calls return the same page, so the walk is deterministic. Any implementation that tries to express a date filter as a single narrow query will not find the posts; it has to page to the threshold. The known ceiling is e621's `page` cap of 750, which is why the bulk cursor form `page=a<id>` / `page=b<id>` exists there.

**Also fixed here — the fallback chain, whose actual defect is worse than a bare `except`.** The chain `resolve → calibrate → resolve` is real, and it is not "bare `except: pass`" — the `except` *does* log. The real defect is that on failure the **date tag is stripped and the search proceeds unfiltered with no notice**: the threshold stays `None`, so the cleaned tags are sent anyway (`proxy.py` lines 208-211). A logged exception that quietly returns unfiltered results is worse than a crash, because the user gets a plausible-looking grid. This is collapsed into one `threshold_for(days) -> int | None` that owns rate-estimation internally, **returns `None` when it cannot produce a threshold, and reports that failure** so the caller tells the user instead of issuing a broad search.

**Multiple date terms.** `extract_date_tags` currently takes `matches[-1]` — last-wins, silently discarding the rest (line 48). Per the spec, the **narrowest constraint wins** and the user is told. (The collapse target is a scalar `threshold_for(days)`; no list-shaped parameter survives it.)

### 7. Watchlist keyed by `{source, id}`, migrated in place

**Decision:** `WatchedEntry` becomes `{source: SourceId, id: number, at: number}`. On load, entries lacking `source` are attributed to the default source. Same localStorage key (`r34_watched`).

**Alternative considered:** namespaced storage keys per source (`r34_watched:rule34`). Rejected — multiplies migration paths and loses the "one watchlist, many boards" model the user actually wants.

**Note:** `watchedIds` is currently a manually-synced `ref<Set<number>>` mirroring `watched` — a desync hazard. It becomes a `computed` keyed by `source:id`.

### 8. Cache keys include the source id

**Decision:** `searchCache` and `autocompleteCache` keys are prefixed with the source id.

**Rationale:** the current search key is the serialized param string; two sources with identical params would collide and return the wrong board's posts. Prefixing is one line and removes a whole class of cross-source contamination.

### 9. Video detection is a per-adapter extension set

**Decision:** Each adapter declares `videoExtensions`, and may expose a per-post codec preference.

| | videoExtensions | Notes (Verified 2026-10-01) |
|---|---|---|
| Rule34 | **`['mp4','gif']`** | 600-post `tags=video` sample: **985 mp4 / 14 gif / 1 jpeg / 0 webm / 0 swf**. **No webm mirror exists on any host.** No duration field of any kind — only coarse duration *tags* (`longer_than_30_seconds`, often absent) — so client-side probing is **mandatory** here, not a fallback |
| e621 | **`['webm','mp4']`**, and **`gif` treated as video-capable** | live sample ≈ **73% mp4 / 27% webm**, 0 swf observed (swf remains legal per `FILE_TYPE` but is legacy). A webm post **usually exposes an `mp4` alternate** and vice versa under `sample.alternates` → **prefer the `mp4` alternate** for playback. Top-level float `duration` is preferred over probing, and probed only when it is `null` |

**The previous draft claimed `['webm','mp4']` for Rule34. That was wrong** — Rule34 has no webm at all, and including it would have marked webm posts (of which there are none) as playable while missing that `gif` is a real, common video format there. Corrected per the 600-post sample above.

**Alternative considered:** read the file extension and treat anything non-image as video. Rejected — no signal to distinguish `mp4` from a genuinely unknown future format.

### 10. Pagination `hasMore` computed from raw (unfiltered) count

**Decision:** `apiHasMore` compares `rawPosts.length` against `(page+1) * PAGE_SIZE`, not the duration-filtered `allPosts.length`.

**Rationale:** the current filtered comparison can conclude "no more pages" while the API has plenty, silently ending infinite scroll when a duration filter is active. Pre-existing bug, surfaced here because source-aware pagination makes the bug easier to hit.

### 11. Rename is metadata-only

**Decision:** Rename `package.json` `name`, README, and git repo. **Leave `r34_*` localStorage keys alone** and add a code comment recording that the prefix is intentionally historical.

**Rationale:** the user scoped this explicitly. A key migration would risk silent watchlist loss for zero user-visible benefit — the prefix is internal. Name decided: `trawl-comb` (2026-10-01).

**Honest consequence:** after the rename, `r34_watched` won't match the project name. That's a deliberate, documented tradeoff, not an oversight.

### 12. One shared, pure search normaliser; both adapters call it and neither reimplements it

**Decision:** Add a single pure function in `src/sources/queryNormalizer.ts`:

```
normalizeQuery(canonicalQuery: string, target: SourceId)
  -> { query: string; dropped: Array<{ term: string; reason: string }> }
```

Both adapters call it. The translation logic is **never duplicated per adapter** — two copies of a rating-translation table would drift, and drift there is invisible (it produces a plausible but wrong result set, because both boards fail open). The function is pure and side-effect free, so the whole translation matrix is unit-testable without a network or a mock.

**Canonical operators** — the only ones translated; **everything else passes through verbatim**:

| Canonical term | → Rule34 | → e621 |
|---|---|---|
| `rating:explicit` | `rating:explicit` | `rating:e` |
| `rating:questionable` | `rating:questionable` | `rating:q` |
| `rating:safe` | `rating:safe` (verbatim; **matches nothing, which is correct** — Rule34 has no safe posts) | `rating:s` |
| `sort:id` | **dropped** + notice | `order:id_desc` |
| `sort:id:asc` | **dropped** + notice | `order:id_asc` |
| `sort:id:desc` | **dropped** + notice | `order:id_desc` |
| `sort:score` | **dropped** + notice | `order:score` (bare = desc) |
| `sort:score:asc` | **dropped** + notice | `order:score_asc` |
| `sort:score:desc` | **dropped** + notice | `order:score` (bare = desc) |
| `sort:date` | **dropped** + notice | `order:created_desc` |
| `sort:date:asc` | **dropped** + notice | `order:created_asc` |
| `sort:date:desc` | **dropped** + notice | `order:created_desc` (bare = desc) |
| `date:<…>` | **consumed** into the `DateResolver` threshold path; never sent upstream | passed through **verbatim after grammar validation** (Decision 6) |
| `duration:<…>` | **consumed** client-side; never sent upstream | **consumed** client-side; never sent upstream |
| any other `prefix:value` | **pass through verbatim** | **pass through verbatim** |
| bare tag, `-exclusion` | pass through (both verified working) | pass through |
| `~` OR-groups | pass through (e621-only; documented as such) | pass through |

**Ordering translation rules.** Direction is **always explicit** in the emitted e621 token *except* where bare already means descending (`order:score`, `order:created_desc`) — because on e621 `order:` is a **single token with an underscore suffix** (`order:id desc` with a space returns 0 silently, the colon form is invalid) and **bare `order:id` means ASCENDING**, the opposite of every other field. That inversion is precisely why the mapping is table-driven and test-covered rather than computed. Note also that e621's `fav_count` / `file_size` / `date` sort fields are **silent no-ops** and the code's real field is `order:comment` (the cheatsheet's `order:comment_count` is stale) — so the canonical `sort:` field set is restricted to `{id, score, date}`.

**Why Rule34 drops `sort:` instead of translating it.** `sort=` is **entirely ignored** — `id`, `id:asc`, `change`, `score`, `random`, and `all` all return identical sets, `sort=random` does not randomize, and no `seed` parameter has any effect (Verified 2026-10-01). The order is always newest-id-first. Translating would be a no-op that *looks* honoured, so the term is dropped and the user is told: *"Ordering is not supported on Rule34; results are newest first. The sort term was not sent."*

**Why unknown operators pass through instead of being stripped.** e621's operator set is large and useful (`score:`, `type:`, `pool:`, `favcount:`, `approver:`, `fav:`, …) and stripping unrecognized terms would break power-user queries. The documented consequence is honest rather than hidden: an e621-only operator sent to Rule34 matches nothing, because Rule34 **zeroes** unknown qualified tags. The normaliser does **not** strip them — a closed API's operator inventory cannot be verified, and a promise that a term was "cleaned up" would be unverifiable. Users get the empty result and, for `sort:*` on Rule34, an explicit notice.

**`dropped[]` feeds the honest-reporting UI.** Every dropped term is surfaced with its reason; nothing is ever silently discarded. In v1 the only producer of drops is `sort:*` on Rule34.

**Native `order:` input is not canonical.** It passes through verbatim — it works on e621 and zeroes on Rule34, which is documented rather than intercepted. The canonical user-facing syntax is `sort:`; `order:` remains accepted for compatibility with what users can already type.

**Required tests.** The full translation matrix: 2 boards × (rating × 3, sort × 6, date passthrough × N, duration consumed, unknown-op passthrough, e621-only-op → Rule34 passthrough), plus bare-tag and exclusion passthrough. Two named regression cases are called out because they encode the two traps above: **`sort:score` → `order:score`** (bare means desc) and **`sort:id:asc` → `order:id_asc`** (bare `order:id` would silently reverse it).

## Risks / Trade-offs

**Rating filter changes existing results** → If Rule34 was ignoring `rating=`, users see different (correct) results after upgrade. Called out in the proposal. Mitigation: none needed — the current behavior is the bug; but it must be in release notes, not discovered silently.

**Watchlist migration loses data if malformed** → Migration is a pure shape transform on load; unparseable entries are dropped exactly as today. Mitigation: spec requires idempotency and that a parse failure must not leave the store in a state that loses previously persisted entries on the next write — currently `catch { return [] }` combined with the deep watcher means a corrupt read followed by any write wipes the store. Fix: only overwrite storage when the parse succeeds.

**Rate-limit errors carry bodies that will break a JSON parser** → e621's 429 comes from Cloudflare's load shedder with **`Retry-After: 2` and an HTML body**; Rule34's 429 has an **empty body and no `Retry-After` at all**. A blanket `response.json()` in the error path throws on the e621 HTML and returns nothing usable on Rule34, and the naive retry loop either gives up (no header to read) or hammers the server. Mitigation: error handling branches on status before touching the body, **429 and 503 are classified identically as rate-limited**, and the backoff timer is ours. Auto-retry is deliberately not a fixed-delay loop — retrying without spacing makes throttling worse.

**Rating filters fail open on both boards, silently** → On e621 an unrecognized `rating:` term is **dropped by the server**, so the query runs *unfiltered* and the user sees a larger result set with no error. On Rule34 the vocabulary is only `explicit`/`questionable`, so a short-form term returns **zero** results — the opposite failure, equally silent. This is the single most dangerous class of bug in this change because it produces a plausible-looking grid either way. Mitigation: the normaliser emits **only** each board's canonical spelling (long forms for Rule34, short for e621), canonical input is **validated client-side** and an unrecognized rating is an explicit error, and the e621 first-character parsing rule (`{s,q,e}` only) is encoded in a test. Never a fallback path that retries a different spelling.

**A bare number in a `date:` term means days, not years** → `date:2024` is *2024 days ago* (a single-day slice around 2021), not the year 2024, and `date:` does not accept bare `hour`/`minute`/`second` at all. A user typing a year gets a confidently wrong result set with a 200 response. Mitigation: the normaliser **validates against the documented grammar before forwarding** and rejects invalid input rather than passing garbage upstream, the UI's date presets emit forms that are unambiguous by construction, and the bare-year case is a named test.

**Rule34 returns HTTP 200 with a 0-byte body for zero results** → A `json.loads()` on it throws, so "no matches" surfaces as a parse crash rather than an empty grid, and the same happens for a nonexistent tag. Symmetrically, an anonymous Rule34 request returns HTTP 200 with a bare JSON **string** rather than an array — and a request with a *bad* key returns **full data**, so neither status code nor a pre-flight `hasAuth()` check can detect failure. Mitigation: an empty body is treated as an empty result set, and success is determined by **body type** (`Array` vs `string`) rather than status. A key cannot be validated client-side, by construction, so the UI does not pretend otherwise.

**e621's `v2=true` would silently reshape the whole response** → In v2 mode `tags` becomes a **flat array** in basic mode and fields move under `files`/`stats`, so enabling it would break the mapping table in Decision 2 with no error — the response is still 200 and still an array. Mitigation: the legacy wrapped shape is **pinned explicitly** and `v2=true` is never sent, with a test asserting the wrapped `{"posts":[…]}` / `{"post":{…}}` shape. Related trap in the same area: `sample.url` is **always present as a key** and `null` when absent — even under `has:true` for a deleted or pending file — so guarding on key presence yields a null URL rendered as a broken image. Guards are on **truthiness**, never presence, and `sample.width`/`height` are not used as a has-sample signal since they are populated even when `has:false`.

**Date-rate estimation is linear and drifts** → Sampling one point 10,000 posts back captures whatever hour-of-day it landed in; posting volume is bursty and the estimate is cached 1 h. This is pre-existing behavior. Mitigation: unchanged, but now it also affects e621, so the honest-reporting path matters more. Long-term fix is multiple samples — out of scope.

**Two adapters means two places for a board bug** → Inherent to supporting two sources. Mitigation: shared normalization means a bug is likely in the shared layer (one fix) or the adapter (localized).

**e621's ToS limits use to personal, non-commercial** → §4 grants non-commercial use only; §6 permits bots solely per the API guidelines. Mitigation: this client stays within bounds as a personal tool. Any commercialization would need legal review — noted, not solved here.

**Single-threaded proxy now serves two sources** → One board's slow request head-of-line blocks the other. Mitigation: none in scope; the global rate limiter already serialized everything. Flagged as a known ceiling.

**CSP must allow the e621 CDN** → `index.html` CSP `img-src`/`media-src` currently only allow `*.rule34.xxx`. Mitigation: keep the list explicit in `index.html` and add a test that fails if any registry permitted-host is missing from it — no build-time generator for a four-host list.

## Migration Plan

1. **Additive first.** Add `src/sources/` with the contract, canonical types, and the Rule34 adapter. Wire the registry with Rule34 as the only entry. Nothing user-visible changes.
2. **Search normaliser.** Add `src/sources/queryNormalizer.ts` with the pure `normalizeQuery` and its full translation-matrix tests, wired into the Rule34 adapter. This lands **after** the adapter foundation (so it has a caller and a `SourceId` type to target) and **before** the e621 adapter (so the second adapter inherits the shared table instead of creating a parallel one). At this point it fixes the Rule34 `rating=` no-op, drops `sort:` with a notice, and routes `date:` into the existing threshold path.
3. **Repoint `client.ts`.** Replace inline URL building with adapter dispatch. Caches gain source-prefixed keys; both cache keys change shape, so stale entries simply miss — no cleanup needed.
4. **Watchlist migration.** Change `WatchedEntry` shape + migration-on-load + `computed` watchedIds. Verify with a test that a legacy `{id, at}` payload round-trips and that a corrupt payload does not overwrite storage.
5. **Proxy per-source routing.** Split routing by source, add the per-source transport policy (per-source spacing, per-source UA, no impersonation for e621) and the corrected per-source allowlist including `api-cdn-mp4.rule34.xxx`, `static1.e621.net`, and `static1.e926.net`. Rule34 path must behave identically apart from the corrected spacing.
6. **Add the e621 adapter** and expose the source selector (default still Rule34).
7. **Date resolver work** + collapse the fallback chain into a single reporting `threshold_for(days) -> int | None`. Includes widening `DATE_TAG_RE` to accept singular **and plural** units (with the normaliser canonicalising plurals to the documented form on the wire), switching multiple-date-term resolution to narrowest-wins with a notice, and adding the e621 `date:` **grammar validation** from Decision 6 so a bare year or a bare `hour`/`minute`/`second` is rejected instead of forwarded.
8. **Correctness fixes:** `hasMore` from raw count, `pid=` pagination with client-side `limit` clamping to 1000 (and 410 handling on e621), explicit CSP list + registry-coverage test, `safeMode` removed with its UI.
9. **Rename last**, once the codebase is source-agnostic — so the rename touches only identifiers.

**Commit cadence:** one reviewable commit per numbered step above, in order. Never carry uncommitted work across a step boundary, and never pile the change into a single unreviewable commit.

**Rollback:** every step is additive or behind the adapter boundary. Reverting to the pre-change client while keeping the new `src/sources/` is inert. The one step needing care is the watchlist shape — if it must be rolled back, the old reader must still accept `{source, id, at}`, so migration is forward-only and non-destructive (it never deletes the original key).

## Rule Conflicts (AGENTS.md)

Two places in this plan resolve a genuine rule conflict silently. They are named here so the resolution is a decision, not drift:

- **Rule 1 vs. Rule 3 on the `date:` grammar validator.** Validating e621's `date:` grammar client-side is hand-rolled date parsing, which Rule 3 discourages — but no maintained library is known to cover e621's proprietary server-side grammar (7 units, singular/plural, `ago` suffixes, `yester*` ranges, comparisons, `..` ranges), and if one is found during implementation it is preferred per Rule 3. Resolution: hand-roll, scoped to validation-only (never date arithmetic), with the grammar documented once in task 7.6 and implemented once in the normaliser.
- **Rule 1 vs. Rule 5 on the `DateResolver` drift.** The rate-linear estimator has a documented drift defect (one sample, hour-of-day bias) that Rule 1 would fix and Rule 5 would test into correctness — but it is pre-existing, Rule34-only, and out of scope. Resolution: keep with honest-reporting on failure; the multi-sample fix is explicitly deferred, not silently dropped.

## Open Questions

1. ~~Final project name~~ — **decided: `trawl-comb` (2026-10-01).**
2. ~~Should e621 date filtering be enabled?~~ — **resolved**: e621 supports `date:` natively, so it is enabled with no rate-sampling and no extra requests. The term is grammar-validated before forwarding, plurals are canonicalised, and bare years are never emitted.
3. ~~Can the proxy skip User-Agent handling for e621 via `_client`?~~ — **resolved (2026-10-01): no.** Tested; the parameter is not implemented server-side and does not bypass the 403. An honest descriptive `User-Agent` is the mechanism (Decision 4).
4. ~~Should e621 bypass the proxy, since its CORS is fully open?~~ — **resolved (2026-10-01): no.** The proxy also provides the date rewrite, the SSRF allowlist, and per-source rate limiting. Open CORS is a permission, not a reason to give up the boundary.

## Library Choices (Rule 3: Libraries over hand-rolled code)

All choices verified against live npm/PyPI registries, GitHub commit history, and runtime behavior on 2026-10-01.

### TypeScript (browser)

| Need | Pick | Version | Maintenance Signal | Rationale |
|---|---|---|---|---|
| **Rate limiting with spacing** | **p-queue** | 9.3.3 | last commit 2026-07-22, 4.3k★, **43M/wk** | Only lib that actually enforces ≥800ms inter-request spacing (Rule34) and ≤1 req/s serialized (e621). `p-limit` 7.x removed spacing support in v6; Bottleneck last commit 2020. |
| **Date parsing (ISO offset-aware)** | **date-fns** | 4.4.0 | last commit 2026-09-22, 36.6k★, 118M/wk | Verified correct `parseISO` handling of `-04:00`/`-05:00` offsets. Temporal is Stage 4 but Safari lacks native; `temporal-polyfill` is 1.2MB. |
| **HTML entity decode** | **he** | 1.2.0 | last commit 2018, **49.7M/wk** | Mature/done — no changes needed. Byte-identical output to `html-entities` on all test cases (named, decimal, hex, astral, double-encoded). Non-strict mode passes unknown entities safely for untrusted Rule34 tags. |
| **Schema validation** | **zod** | 4.6.5 | last commit 2026-09-30, 44k★, **360M/wk** | `z.iso.datetime({offset:true})` matches e621 `created_at` exactly. v4 `z.enum` for rating vocabulary. |

**Rejected with evidence:**
- **Bottleneck** — last commit 2020-07-21, effectively unmaintained
- **p-limit** — cannot enforce inter-request spacing (only concurrency); removed `intervalDuration`/`minInterval` in v6 breaking change
- **temporal-polyfill** / `@js-temporal/polyfill` — 1.2MB / "Alpha" status; Safari lacks native Temporal
- **html-entities** — equally correct but richer API; `he` is simpler with 50M/wk proving stability

### Python (proxy)

| Need | Verdict |
|---|---|
| **HTTP client** | **Keep `curl_cffi`** (0.16.3 stable, 2026-09-02; 0.16.4b1 beta 2026-09-20). Actively maintained (commit 2026-10-01). Does both transports: `impersonate="chrome"` for Rule34; plain TLS + custom UA for e621. |
| **Retry/backoff** | **Skip**. `curl_cffi`'s `retry=` only catches transport exceptions (`RequestException`), NOT HTTP 429/410/503. Retry-After handling, HTML error bodies, 410 classification, per-source spacing — all must be your code regardless. |
| **Rate limiting** | **stdlib only**. 10-line `SourcePacer` with `time.monotonic()` + per-source dict verified working for ≥800ms / ≤1 req/s. Single-threaded `HTTPServer` serializes handlers; no lock needed. No library earns its place for fixed-minimum-spacing. |
| **SSRF redirect boundary** | **Use `allow_redirects="safe"`** (added v0.15, security advisory). Libcurl-level redirect-protocol validation (`CurlFollow.SAFE == 4`) — stronger than post-hoc hostname string check. Empirically blocks `127.0.0.1` redirects. |

**Rejected with evidence:**
- **httpx** — 22 months without stable release (0.28.1 Dec 2024); forked over it (`httpxyz` 0.42.1, `niquests` 3.21.2). Adds second HTTP stack where one suffices (no TLS impersonation for Rule34).
- **tenacity** / **python-backoff** — exception-driven decorators; 429/410 arrive as successful responses, not exceptions. `curl_cffi` already handles transport retries.
- **pyrate-limiter** — brings SQLite/Redis/async/multiprocess backends for multi-process coordination you don't have; defaults to `time.sleep` anyway.

### e621 Client Libraries

**No library handles your e621 specifics well enough to depend on.** The gap is real and documented:

| Your requirement | Best existing coverage |
|---|---|
| 320 cap / 410 Gone | ❌ nothing (doc comments only in `e621` npm) |
| `page=a/b` cursors (cap 750) | ❌ nothing, anywhere |
| 9-key tags object | ✅ `DonovanDMC/E621` (generated from e621 OpenAPI spec) |
| Legacy `{posts:[...]}` unwrap | ✅ `DonovanDMC/E621` (`wrapPost`/`wrapPosts` branch) |
| `v2=true` pinning | **Inverse reality**: v2=true returns **bare array**, legacy is **wrapped** `{posts:[...]}` |
| Tag-query grammar | ✅ `penggrin12/aioe621` (`REGEX_TOKENIZE` — MIT, port it) |
| Date grammar (`date:`) | ❌ nothing — port from `e621ng` Ruby server |
| Rating metatag (`s/q/e`, silent drop) | ❌ nothing — must validate client-side |

**Recommended approach (per proposal tasks):**
1. Copy `LegacyPost.yml` + `posts/index.yaml` + `tags/index.yaml` from `DonovanDMC/E621OpenAPI` into repo as TS type source of truth
2. Port `aioe621`'s `REGEX_TOKENIZE` to proxy for tag-query building (MIT, attribute)
3. Hand-roll exactly four things no library does:
   - `limit: Math.min(limit, 320)` at adapter boundary + explicit 410 → retry-at-320 branch
   - `page` as `'a' \| 'b' \| number` type (libs use `number` only, blocking cursors)
   - `duration: number \| null` (legacy: top-level; v2: `files.meta.duration`)
   - `tags.json` → accept bare array, tolerate `{"tags":[...]}` defensively

**Source of truth repos cloned for reference:**
- `DonovanDMC/E621` (SHA `a9d4177`) — npm `e621` v3.4.1, OpenAPI-generated, authoritative types
- `DonovanDMC/E621OpenAPI` (SHA `1fcdc22`) — modular OpenAPI 3.1 YAML, declares legacy vs v2 union
- `e621ng/e621ng` (SHA `9ecbb7e`) — **the server itself**, ground truth for `date:` grammar, rating metatag, pagination caps
- `penggrin12/aioe621` (SHA `87879a`) — Python async client, hard-pins v2, has `REGEX_TOKENIZE` grammar
- `avoonix/material-e621` (SHA `75b10f8`) — Vue/TS client, hand-rolled cursors, Basic auth pattern
- `re621/re621.Legacy` (SHA `9e6188f`) — 119★ userscript, real pagination + metatag list
