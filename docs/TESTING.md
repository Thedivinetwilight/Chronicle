# Testing — Chronicle V0.1

`npm run verify` = `typecheck` + `test` + `contrast` + `build`.

## 1. Suite overview (331 tests, 13 files)

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
| Persistence | `data/dexieStore.test.ts` | CRUD, revisions, tombstones + purge sweep, search index lifecycle, timeline, capture commits, settings, portability, stats |
| UI smoke | `src/app.test.tsx` | boot, blocked-storage state, capture dialog save + failure, journal list, search results |

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
  Current: ~158 KiB (index 44 + react 82 + storage 32 + runtime 0.4); the
  capture engine (~19 KiB) loads lazily on first capture.

## 4. Known gaps (honest list)

- No real-browser E2E: the sandbox has no Chromium/Playwright, so PWA install,
  service-worker offline behaviour and touch interactions are verified by
  build inspection and `curl` against `vite preview`, not by a browser.
- Visual regressions are not screenshot-tested; contrast and tokens are.
- The AI HTTP provider is tested with injected fetch stubs, not a live model.
