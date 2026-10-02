# Audit Starter — Generic

Copy and paste this into a new session.

**Before using:** Replace `<PROJECT_DIR>` with your project's root directory, `<PROJECT_NAME>` with your project name, and fill in the module list in Agent 4 if you want module-level checks. All other sections are language-agnostic.

---

## Prompt

Launch **4 parallel background subagents** to audit `<PROJECT_DIR>/`. Each produces a written report. Do NOT let any agent modify code — audit only.

### Core principle (every agent must enforce this)

**1 clean approach beats 5 fallbacks.** Any function that uses multiple fallback strategies (try A, fallback to B, fallback to C...) is a red flag. The audit must flag every instance and recommend the single clean path that replaces the chain. This is the #1 thing to find.

---

### Agent 1 — Code Simplifier (`category: deep`)
Sweep every file in `<PROJECT_DIR>/` for overcomplicated code. Flag functions over ~40 lines, nested conditionals >3 deep, duplicated logic across modules, and any code that can be replaced with a stdlib call. **Specifically look for fallback chains** — functions with multiple try/except, if/elif/else fallback paths, or "try strategy A, if that fails try B" patterns. For each fallback chain found, state the single clean approach that replaces it. **Check file organization** — flag files over ~150 lines that contain multiple unrelated concerns (e.g. an auth module that also handles CLI parsing). Recommend how to split monoliths into focused modules. Include `file:line` for each finding. Output a numbered list grouped by severity (critical → trivial).

### Agent 2 — Dependency & Library Audit (`category: deep`)
First, read every source file in `<PROJECT_DIR>/` plus dependency manifests (`requirements.txt`, `pyproject.toml`, `package.json`, `Cargo.toml`, `go.mod`, `Gemfile`, `build.gradle`, or whatever is relevant to this project). Map every import to its usage.

**Step 1: Dependency Manifest Deep-Dive**
For each declared dependency, collect:
- Exact version (or semver range) currently pinned
- Latest stable version available
- Whether the pin is too loose (`^`, `~`, `*`) or too strict (exact pin without reason)
- Any known CVEs or security advisories (search `[package] CVE`, check GitHub security advisories, check OSV.dev)
- License type and compatibility with the project's license
- Transitive dependency count and tree depth (use the package registry's dependency graph)
- Whether the dependency is actively maintained (commit frequency, release cadence, open/closed issue ratio)
- Whether the dependency is deprecated or has a recommended successor

**Step 2: Hand-Rolled Code → Library Mapping**
Identify every piece of hand-rolled code that a maintained library could replace. For each:
- Name the specific capability (e.g., "JWT validation", "CSV parsing with type coercion", "retry with exponential backoff")
- Search for production-quality libraries using multiple query angles:
  - `"[capability] library" [language]`
  - `"[capability] vs [popular alternative]"`
  - `"best [capability] library [year]"` (to find recent comparisons)
  - `"[language] [capability] crate/package"` (language-specific registries)
  - Reddit/HN discussions: `site:reddit.com [capability] library`
  - Benchmark comparisons: `"[capability] benchmark" [language]`
- For each candidate, use `webfetch` on the registry page to verify: version, last release date, weekly downloads, license, dependencies
- Score each candidate on: popularity (downloads/stars), maintenance health, license compatibility, API ergonomics, migration effort (easy/medium/hard)

**Step 3: Unused & Missing Dependency Check**
- Run a static analysis pass: list every import/require/use statement in source files
- Cross-reference against the manifest: flag imports without declared dependencies, and declared dependencies without imports
- Check for "implicit" dependencies (libraries that are only used in tests, scripts, or optional features)

**Step 4: License Compatibility Matrix**
For every dependency, determine:
- License type (MIT, Apache-2.0, GPL, BSD, etc.)
- Whether it is copyleft and imposes source-distribution requirements
- Compatibility with the project's license and with each other (no license conflicts in the dependency tree)
- Any dual-licensing or AGPL concerns

Output a comprehensive markdown table with library name, what it replaces, version status, CVE risk, license, maintenance health, and replacement recommendation with migration effort.

### Agent 3 — TODO & Dead Work Audit (`category: quick`)
Scan every source file in `<PROJECT_DIR>/` for `TODO`, `FIXME`, `HACK`, `XXX`, `TEMP`, and `PLACEHOLDER` comments. For each: file, line, the comment text, and whether the item appears still unresolved. Also check for dead/unreachable code paths, commented-out blocks >5 lines, unused imports, and **dead fallback branches** (else/except paths that can never execute). Output a numbered list grouped by file.

### Agent 4 — Completeness & Security Audit (`category: deep`)
Check each module in `<PROJECT_DIR>/` (replace with actual module/file list for your project, or leave generic for auto-discovery):
1. Does each module have complete, runnable code or is any of it stubbed/incomplete?
2. Are there imports or calls to functions that don't exist?
3. Are there hardcoded values (URLs, secrets, timeouts) that should be configurable?
4. Are there security concerns (credentials in logs, insecure defaults, missing error handling)?
5. Do dependency declarations match what the code actually imports?
Output a checklist with ✅/⚠️/❌ per item with `file:line` evidence.

---

After all 4 agents complete, merge their findings into one **Unified Audit Report**:

1. **Summary table** — Agent | Findings count | Critical count
2. **Deduplicated findings** — merge overlapping issues, keep the most detailed version
3. **Priority ranking** — sort all findings by impact: security > runtime breaks > code quality > style
4. **Fallback chain inventory** — for every multi-path code found, a table: Location | Current paths (N) | Recommended single clean path | Lines saved
5. **Action plan** — ordered list of what to fix first, with agent + finding # cross-references
6. **Pass/Fail** — Does this codebase ship? YES with caveats or NO with blockers.

Output the full report as markdown.
