Global rules for YOU working in this repo. These are **hard rules, not suggestions** — they cannot be skipped, watered down, or reasoned around "just this once." If a rule seems to conflict with a specific task, stop and ask rather than silently ignoring it.

## 1. Simplicity over cleverness
- Write **one clear, correct implementation** per problem. Do not write multiple fallback paths "just in case."
- If a fallback exists that only fires when the primary path is broken, that fallback is dead code. Delete it. Fix the root cause instead.
- On failure: fail fast and loud (raise / log clearly). Never silently catch-and-continue to fake success.
- **Reusing a library is the simple choice.** Do not shave a dependency to make a diff look smaller — 3 lines of hand-rolled parsing/date/retry/HTTP logic is complexity, and a longer dependency list is explicitly preferred (see Rule 3). "Simple" means nothing left to reinvent.
- **The complexity to eliminate is speculative, not physical.** These are the real offenders — delete them, keep everything else:
  - abstractions, interfaces, or wrappers with no second caller
  - config values, flags, or parameters for a case nobody has asked for
  - error handling for states the type system or a caller already prevents
  - indirection that only exists to avoid touching a second file
  - "flexible" helpers that handle 3 shapes when only 1 is used
- **Simplicity is not the same as smallness.** A short file of indirection is worse than a long file of straight-line code — but a file past the Rule 7 ceiling must still be split. Split along a real concern boundary, never to hit a number.
- Simplicity ranks **below** Rules 2, 3, 4, and 5 — never simplify by merging files, dropping a library, skipping verification, or mocking instead of running for real.

## 2. File structure
- **No monofiles.** Code must be split into multiple files by logical concern (e.g. models, routes, utils, config kept separate).
- A single file holding "the whole app" is never acceptable, and no file may exceed the Rule 7 line ceiling — split by logical concern (models, routes, utils, config kept separate).
- **No duplicated logic across files.** If the same logic appears more than once, extract it into a shared module and import it. Copy-pasted blocks are a bug, not a shortcut.

## 3. Libraries over hand-rolled code
- Do not hand-roll logic (parsing, HTTP, retries, scraping, auth, date handling, etc.) when a battle-tested, actively maintained library exists. A larger dependency list is fine and preferred over reinventing solved problems.
- **Never pick a library from memory/training data alone.** Actively web search for current options before choosing one — a library that was standard a year or two ago may now be outdated, unmaintained, or superseded. Verify the library is still actively maintained before adding it.

## 4. Never assume — verify first
- Before writing any code against an API, library, or web page, the agent MUST verify it first. This applies always, not only when something "seems" unfamiliar.
- Verification means, as applicable:
  - **Web search** for current docs, changelogs, and known issues.
  - **`git clone` and read the actual source** of the library/tool in question to confirm real function signatures, schemas, and behavior — do not trust remembered APIs.
  - **Real browser inspection with zendriver** for any web page/site being scraped or integrated with — inspect the live DOM/network requests, don't guess selectors or endpoints.
- If verification is skipped and code is written from assumption, that is a rule violation and the work must be redone.

## 5. Testing — real, not mocked
- Every change requires **unit tests**.
- In addition, you must **actually run the real program/service as a real running instance** and exercise it with **real web requests** — no mocking network calls, external services, or dependencies to fake a passing test.
- A change is not "done" until it has been verified running for real, not just passing mocked tests.

## 6. Commit often
- Commit frequently to avoid lost work. Granularity is the agent's judgment call, but uncommitted work should never pile up into one large, unreviewable change.

## 7. File size limit
- No source file may exceed **300 lines**, counted as raw `wc -l`. Comments and blank lines count; do not exclude, reformat, or compress lines to fit.
- For `.vue` files, count the `<script>` and `<template>` blocks only. `<style>` blocks do not count.
- This applies to every file — production, test, or data. There is no exemption category, and none may be added.
- Over 300 means split the file along a real logical seam. Moving code into a data-shaped or test-shaped file to dodge the limit is a violation, not a fix.

---

**Summary for the agent:** simple > clever, split files (300-line ceiling, Rule 7), don't repeat yourself, use maintained libraries (found via live search, not memory), verify everything against real sources/browsers before coding, test against real running instances with real requests, and commit often.
