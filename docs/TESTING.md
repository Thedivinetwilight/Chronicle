# Testing — Chronicle V0.3

`npm run verify` = `typecheck` + `test` + `contrast` + `build`.

## 1. Suite overview (473 tests, 24 files)

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
| Life persistence | `data/lifeStore.test.ts` | schema migration keeps V0.1 rows intact; chapters/paths/trips/collections CRUD; filing in both directions; a chapter with no dates stays listed after a save (regression, see §5); chapter delete keeps experiences; deleted targets cannot be filed into; suggestion stored as a suggestion and refused as confirmed; pair de-duplication both ways; self-links and dangling targets rejected; link removal on target delete |
| Map domain | `domain/lifeMap/layout.test.ts` | real records only, node kinds and shapes, undated nodes labelled, deleted records omitted, filtering by chapter/person/kind, hit testing, fit-to-content bounds, label length |
| Share projection | `domain/share/preview.test.ts` | private items excluded unless opted in, narrowest-audience rule, booking reference/PNR/coordinate stripping, omissions reported, `published:false` and `localOnly:true`, no mutation of the archive |
| Archive round trip (life) | `domain/import/import.test.ts`, `domain/export/export.test.ts` | life records exported only when present, accepted under `records` or a sibling `life` block, validated before write |
| Archive loop (UI) | `src/features/archiveLoop.test.tsx` | Today quick capture persists privately and rejects empty drafts; repeat taps save once; `/journal/new` stores an unknown date honestly and lands on the record; a Today draft survives into the full editor; chapter create survives a reload; chapter delete leaves experiences untouched; the map shows an honest empty state then the real node via the outline; the share preview states that nothing is published and has no publish control |
| Artwork | `src/ui/art/art.test.ts` | 13 contracts: a record's plate is deterministic; different records differ in motif or wash; renaming shifts the plate; every kind yields non-empty `M…` paths with no `NaN`/`Infinity`/`undefined`; every stroke starts on the 120×84 plate (**an absolute-start check only — relative `a`/`c`/`l` offsets cannot be bounds-checked**); every `SECTION_MARKS` value resolves; `Mark` is `aria-hidden` with no `<title>` unless given one; every mark uses the 24×24 grid; one stroke weight, no `<image>`, `<filter>` or gradient; a cover declares `aspect-ratio: 120 / 84` so `slice` never crops and the wash never letterboxes; records of one kind get visibly different plates; 60 draws spread over most of the 18 motif/wash combinations instead of collapsing onto a few; no destination reuses a glyph another already claims |
| Map styling | `src/features/lifemap/mapStyles.test.ts` | every `lifemap__*` class used in the canvas has a CSS rule; every node kind names a fill token rather than inheriting SVG's black default |
| Routes | `src/routes.test.tsx` | every destination renders an `h1`, logs no console error, and an unknown path redirects home |
| Date honesty | `src/ui/format.test.tsx`, `src/ui/when.test.tsx` | `precisionNote` never calls a `day` or `unknown` date approximate and returns `null` for `unknown` so it cannot double up with the components; `WhenItHappened` / `WhenExactly` replace the timestamp with a phrase for unknown dates and keep the caption callers pass; a source scan fails if any page slices `occurred_at` to ten characters again |
| Empty states | `src/features/emptyStates.test.tsx` | an empty section offers no duplicate create action; the compact row keeps the space between its title and note; every borrowed `mark` is a mark the set can draw; Search uses a mark no section owns (it has no section mark of its own, and taking the Life map's compass would repeat the two-destinations-one-glyph defect) |

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

- `npm run contrast`: 106 foreground/background pairings from tokens.css must
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

## 4d. The light-mode map failure (V0.3)

The most serious defect of this stage was invisible in the design's own default
theme, and it is worth recording as a class of bug rather than a one-off.

`.lifemap__ring`, `.lifemap__ring`'s siblings, `.lifemap__shape-detail`,
`.lifemap__shape-ring` and `.lifemap__uncertain` were **used in the JSX but never
styled**. SVG defaults to `fill: black`. On the near-black dark canvas that is
invisible; on the warm paper canvas it drew a solid **black disc over the entire
map**. The four node kinds that render a bare `<circle>` (experience, path,
person, trip) had the same problem, and there it also broke dark mode — every
experience was an invisible ring, not a disc.

Three lessons:

1. **A CSS class name is not a style.** The map's styling is verified by
   `mapStyles.test.ts`, which reads the JSX for every `lifemap__*` class and
   fails if the stylesheet has no rule for it.
2. **A dark-mode-only review cannot pass a two-theme design.** Every audit run
   now covers dark and light at both widths, and the map is inspected as an
   image, not just measured.
3. **Defaults are a colour choice.** Anything that draws a shape names its fill.

`src/features/lifemap/mapStyles.test.ts` fails on all five classes above if the
rules are removed (verified by reverting the fix).

## 5. Known gaps (honest list)

- Browser verification ran in headless Chromium inside a Linux sandbox whose
  only installed UI font family is Inter (installed locally for stable
  rendering). Real devices (Android/iOS/desktop) apply their system font via
  the documented stack and have **not** been tested directly.
- PWA *install* prompts and standalone launch are verified by manifest/service
  worker inspection and offline rendering, not by an install flow on a phone.
- The AI HTTP provider is tested with injected fetch stubs, not a live model.
  It is unreachable from the UI in V0.3 (see §4c) and kept only as tested
  plumbing for an optional later release.

## 4c. Capture makes no network calls (V0.3)

AI is out of scope for this release. The capture engine always runs the local,
rule-based analyzer; there is no provider setting in the UI. `provider.ts`, the
strict remote-response validation, and the `ai` session plumbing in
`types.ts` / `dexieStore.ts` / `src/state/aiSession` are **kept and still
unit-tested** so optional AI can be re-attached later without a migration — but
nothing in the UI reaches them. `captureFlow.test.tsx` asserts the fetch spy is
never called during a save.

The default-mode labels are Quick / Review / **Silent** (stored value
`autonomous`, unchanged, so no data migration). "Autonomous" implied an agent
deciding; the engine is a parser on this device, and the new label says what the
user actually experiences.

## 5. V0.2 additions and the bugs they were written against

Three defects were found by writing UI tests against the real provider, and all
three now have regression coverage:

1. **Chapters vanished after saving.** `listChapters` used
   `db.chapters.orderBy('start_date')`. Dexie skips rows whose index key is
   `null`, so every chapter without a start date was stored but never listed —
   the user would create an era and watch it disappear. Fixed by `toArray()` +
   explicit sort; `lifeStore.test.ts` ("lists a chapter whose dates are
   unknown") fails if `orderBy` returns.
2. **Form labels were not associated with their controls.** `Field` rendered a
   `<label>` with no `htmlFor` unless a caller remembered to pass one — no
   caller did — so every text input in the app was unnamed for screen readers
   while looking correct. `Field` now injects the id and the hint's
   `aria-describedby` into its single control child.
3. **Two "Save" buttons on Today.** The page composer and the capture dialog
   both render a primary Save. The UI is correct (they are in different
   regions) but the tests had to scope themselves with `within(dialog)`; the
   shell keeps a single accessible name per region.

### What these tests deliberately do not claim

- **The unit suite proves structure, state and persistence — not layout.** jsdom
  has no layout engine, so nothing in `npm run test` is evidence of visual
  quality, real touch gestures, pinch zoom, service-worker behaviour or PWA
  installability.
- **Contrast is verified by `npm run contrast`** (106 token pairings, WCAG 2.1
  text 4.5:1 and UI 3:1), not by eye.
- **No physical device has been tested.** The real-browser checks below run
  Chromium with desktop-class emulation at 390×844, which exercises layout and
  tap-target sizing but not iOS Safari, Android Chrome, real touch input or
  virtual-keyboard behaviour.
- **No third-party accessibility audit has run.** Roles, names, focus order and
  `aria-*` state are asserted structurally and exercised by keyboard; no
  axe/WAVE pass and no screen-reader session has been done.

## Real-browser verification (opt-in)

Two scripts in `scripts/browser/` drive a real Chromium. They are **not part of
`npm run verify`** because they need a browser binary on the machine:

```bash
npm install --no-save playwright-core @sparticuz/chromium
npm run preview                     # serve on :4173
node scripts/browser/audit.mjs dark d        # 15 routes, 1440×950, dark
node scripts/browser/audit.mjs light d       # same routes, light
node scripts/browser/audit.mjs dark mobile   # 15 routes, 390×844, dark
node scripts/browser/audit.mjs light mobile  # same routes, light
node scripts/browser/flows.mjs               # 20 interactive checks
```

Screenshots go to `/tmp/audit/{theme}-{d|m}-{name}.png`. **That path is local
and untracked** — the reviewed stills that ship with the docs are the JPEGs in
`docs/screenshots/`, re-captured deliberately, not by this script. `audit.mjs`
takes no route filter and regenerates the whole set each run.

`audit.mjs` seeds a plausible archive into IndexedDB, then reports each route's
horizontal overflow (`scrollWidth` vs `innerWidth`), `h1`, and writes a
screenshot to `/tmp/audit/`. `flows.mjs` exercises capture, reload persistence,
editing, search (including its empty state), map node selection by pointer and by
keyboard, the outline alternative, share-preview privacy defaults, reduced motion,
200 % text scaling, and an artwork section: every cover plate is `aria-hidden`,
every plate is paired with a real record name, a plate is stable across a
reload, and primary navigation carries the drawn marks. Because a fresh profile
has no records and therefore no plates, the artwork section seeds a chapter
through the create dialog first. It exits non-zero on any failure.

`audit.mjs` also records `clipped=` and `collisions=` for every `/map` render:
it measures each label and annotation box against the canvas and against every
other box. This exists because the page-level overflow check said nothing useful
about a view whose layout is computed rather than flowed.

Current results: **15/15 routes render without horizontal overflow in all four
theme × viewport combinations** (60 renders), **zero clipped labels and zero
collisions on every map render**, and **22/22 interactive flows pass with zero
console or page errors**. Details are in
[docs/V0_3_UI_REDESIGN_REPORT.md](V0_3_UI_REDESIGN_REPORT.md).

### A width sweep, because two widths are not a sweep

The map's label defects were invisible at 1440×950 and at 390×844 — the only two
sizes the harness used — and appeared at 820, 900 and 1400. A geometry check run
at two sizes proves those two sizes; it does not prove the range between them.
When a layout is computed rather than flowed, sweep the widths.

### A gap these scripts cannot see

`audit.mjs` samples `document.documentElement.scrollWidth`. That check missed a
real bug: the mobile tab bar declared six grid columns for seven children, so
"More" wrapped onto a second grid row *inside a fixed-height, `position: fixed`
bar* — rendered outside the viewport and untappable, while `scrollWidth` stayed
exactly equal to `innerWidth`. Overflow checks do not cover fixed-position
overflow. `src/app.test.tsx` now asserts the tab bar's child count and labels,
which is what actually would have caught it.
