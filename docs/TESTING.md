# Testing — Chronicle V0.1

`npm run verify` = `typecheck` + `test` + `contrast` + `build`.

## 1. Suite overview (338 tests, 14 files)

| Area | File | Covers |
| --- | --- | --- |
| Time & timezone | `domain/time.test.ts` | UTC canonicalisation, DST-safe day math, local noon, formatters, formatter caching |
| Ids | `domain/ids.test.ts` | uniqueness (20 k), monotonicity, determinism, validation |
| Text | `domain/text.test.ts` | normalisation, tags, similarity, highlighting, snippets |
| Markdown | `domain/markdown.test.ts` | block/inline rendering, XSS escaping, URL allowlist, nested lists |
| Search scoring | `domain/search.test.ts` | tokenisation, query parsing, weights, AND semantics, phrases, grouping |
| Validation | `domain/validation.test.ts` | per-record parsing, repairs vs rejections, extras preservation |
| Export | `domain/export/export.test.ts` | archive envelope, checksum + tamper detection, Markdown bundle |
| Import | `domain/import/import.test.ts` | malformed files, checksum-before-repair, merge/replace planning, round trips |
| Capture units | `domain/capture/{temporal,understanding}.test.ts` | date parsing incl. DST and timezones, association, intent, tasks, milestones, tags, titles |
| Capture acceptance | `domain/capture/acceptance.test.ts` | **the 15 scenarios of spec §28.15**, end to end through commit |
| Persistence | `data/dexieStore.test.ts` | CRUD, revisions, tombstones + purge sweep, search index lifecycle, timeline, capture commits, settings, portability, stats, write-transaction watchdog abort + atomic rollback |
| UI smoke | `src/app.test.tsx` | boot, blocked-storage state, capture dialog save + failure, journal list, search results |
| Capture save regression | `src/features/capture/captureFlow.test.tsx` | the Android-hang bug class (ADR 0011): quick + review saves, storage failure visible with text kept and busy cleared, zero network I/O with AI off, unreachable AI falls back locally, double-tap saves once, persistence across journal reopen and simulated reload |

Run: `npm test` (Vitest, jsdom, `fake-indexeddb` for real IndexedDB semantics).

## 2. What the acceptance tests assert (spec §28.15)

1. Basic journal: entry created, created_at automatic, original verbatim, no
   forced project.
2. Project progress: associated with the named project; completed vs remaining
   separated; no completion or verification claimed.
3. Future task: due date = tomorrow in the active timezone, distinct from
   created_at; vague intentions get no date.
4. Historical event: occurred_at ≠ today with week precision; created_at stays
   at capture time; milestone offered as a claim.
5. Ambiguous project: saved unlinked, nothing invented, not misread as a
   correction.
6. Multiple records: test + failure + follow-up task in one message; no
   successful outcome invented.
7. Correction: "belongs to VERONICA instead" updates the previous entry, no new
   record; task suppression keeps the task recoverable.
8. Offline: local provider never calls fetch; a failing write reports failure
   and keeps the text.
9. Invalid AI output: malformed payloads are rejected with reasons and the
   local result stands; timeouts fall back with a notice; models cannot raise
   evidence.
10. Repeated submission: identical capture id → duplicate detected, one record.
11. Date ambiguity: "last Friday" resolves to the most recent Friday and says
    so; unresolvable text produces no date.
12. Verified achievement: hedged claims stay claims; benchmark evidence is
    suggested, not assumed.
13. Privacy: personal reflections are private by default and never transmitted
    when AI sending is off.
14. Long multiline input: every line preserved, bounded title, input survives
    processing failure.
15. Export: archive contains original text, ids, timestamps and relationships.

## 3. Mechanical checks

- `npm run contrast`: 48 foreground/background pairings from tokens.css must
  meet WCAG 2.1 (4.5 text, 3.0 UI). Fails the build otherwise.
- `npm run build`: rolldown/vite production build; initial JS gzip total is
  reported per chunk. Budget: **≤ 250 KiB** gzipped initial JavaScript.
  Current: ~180 KiB (index 66 + react 82 + storage 32 + runtime 0.4). The
  capture engine is bundled statically since ADR 0011 so saving never waits
  on a runtime fetch.

## 4. Real-browser verification (`scripts/visual/harness.mjs`)

A headless-Chromium harness exercises the built app (see
`scripts/visual/README.md`). On the V0.1 refinement run it produced:

- 60 screenshots: 8 routes + capture compose/review, at 390×844, 360×740,
  834×1112, 1440×900 and 1680×1000, in light and dark themes.
- Layout/touch audit on every screen: **0** horizontal-overflow cases, **0**
  clipped elements, **0** touch targets below the tier minimums (44 px
  primary / 32 px compact secondary on coarse pointers).
- 12 interaction checks, all passing: capture → review → save → visible in
  journal; undo (soft delete) from the toast; visible keyboard focus ring;
  Settings theme switch; search term highlighting; project delete impact
  preview; and the app shell rendering with the network cut (service worker).
- Zero page or console errors across all runs.

Screenshots are verification artefacts kept outside Git; re-run the harness
to regenerate them on any machine with a browser.

## 4b. Field diagnostics for capture

`localStorage['chronicle:debug'] = 'capture'` enables a stage tracer in the
capture dialog: stage names and elapsed milliseconds (`save:start`,
`capture-context:done`, `analyze:done(local|remote)`, `commit:start/done`,
error names) printed via `console.debug`. It never logs capture text, API
keys, or record contents. Added with the ADR 0011 fix so a stuck save on a
real device can be pinpointed from a remote debug session.

## 5. Known gaps (honest list)

- Browser verification ran in headless Chromium inside a Linux sandbox whose
  only installed UI font family is Inter (installed locally for stable
  rendering). Real devices (Android/iOS/desktop) apply their system font via
  the documented stack and have **not** been tested directly.
- PWA *install* prompts and standalone launch are verified by manifest/service
  worker inspection and offline rendering, not by an install flow on a phone.
- The AI HTTP provider is tested with injected fetch stubs, not a live model.
