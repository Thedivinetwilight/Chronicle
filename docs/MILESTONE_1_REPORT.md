# Milestone 1 report — the private life archive

**Branch:** `arena/2470f197-chronicle` · **Not merged, not published.**
**Verification:** `npm run verify` green — typecheck, **433 tests / 19 files**,
72 contrast pairings, production build. No real browser was available in this
environment; see §6 for exactly what that does and does not establish.

The loop this milestone builds: *capture an experience → keep it in your own
archive → connect it to the rest of your life → share only if you decide to.*

---

## 1. Product and UX changes

The app now leads with the archive rather than with projects.

| Surface | What it is | Status |
| --- | --- | --- |
| **Today** (`/`) | Calm landing: greeting, one-box fast capture, today's own words, recent experiences, shortcuts into chapters/paths/trips | working |
| **Life map** (`/map`) | The signature view, built only from real persisted records, with a full outline equivalent | working |
| **Journal** (`/journal`, `/journal/new`, `/journal/:id`) | V0.1 journal, now with a routed full editor | working |
| **Chapters** (`/chapters`, `/chapters/:id`) | Named eras; optional dates *or* a date hint; archive; delete keeps experiences | working |
| **Paths** (`/paths`, `/paths/:id`) | Goals/hopes/plans; four respectful states; never infers completion | working |
| **Trips** (`/trips`, `/trips/:id`) | Dates, linked places, private travel details masked by default | working (photos/tickets planned) |
| **Places & people** (`/places`) | Name-only records; no coordinates, no profiles | working |
| **Collections** (`/collections`, `/collections/:id`) | Hand-curated albums | working |
| **Share preview** (`/share-preview`) | Local projection with sensitive content stripped; **no publish control** | working, by design |
| **Roadmap** (`/roadmap`) | In-app honest list of what is not built | working |

**Navigation.** Three labelled groups (archive loop → gathering → elsewhere) in
one place in `AppShell.tsx`. Phones get five tabs plus the always-present
capture action and a real "More" dialog — everything reachable at 320 px, no
truncated menus, no dead icons.

**Visual language.** Extends the V0.1 paper-and-ink system rather than replacing
it: a second, warmer palette for the map, seven node kinds with distinct
silhouettes, always-visible labels, `paint-order: stroke` so labels stay legible
over edges.

**Copy.** Real product copy throughout — no lorem ipsum, no invented activity.
Empty states say what the area is for and that leaving it empty is fine. Path
copy says "The plan moved somewhere else. That is part of the story, not a
failure." No streaks, scores, ranks or "you're behind" language anywhere.

## 2. Data model and migrations

**Additive only** (ADR 0012). Database v2 adds seven tables — `chapters`,
`paths`, `places`, `people`, `trips`, `collections`, `links` — and changes no
existing table, index or row. An Experience *is* a `JournalEntry`: two optional
fields (`links`, `visibility`) are filled at read time when absent, so V0.1
records stay valid without a rewrite. The migration stamp is explicit
(`meta.schema:migrated_to = 2`) and the V0.1 upgrade test asserts old rows are
byte-identical afterwards.

`RecordKind` widened 4 → 12 so tombstones, restore and purge sweep cover life
records. Export gains `chronicle.life?` (written only when non-empty); the
importer accepts life records under `records` or a sibling `life` block and
validates every record before writing.

Full detail: `docs/DATA_MODEL.md` §V0.2.

## 3. Map behaviour and node types

**Node kinds (7):** chapter (diamond), experience (circle), path (circle +
ring), place (pin), person (circle + head/shoulders), trip (circle + cross),
collection (square). Kind is encoded by shape *and* a contrasted colour pair
*and* an always-rendered text label — never colour alone.

**Layout.** Pure domain code (`domain/lifeMap/layout.ts`, 24 unit tests): a
deterministic radial tree, centre → kind ring → nodes. No force simulation, so
the map is identical between reloads and reproducible in tests. Undated records
go to an explicitly labelled undated cluster instead of being given an invented
position in time.

**Interaction.** Drag/wheel/two-finger pan; ctrl-⌘-wheel and pinch zoom; arrow
keys, `+`/`-`/`0`, Escape; zoom/fit/reset buttons ≥ 44 px; fits content on first
measure and on resize but stops once the user moves the view; honours
`prefers-reduced-motion` and the app setting.

**Detail and sources.** Selecting a node opens a panel with date (or "Not
recorded"), chapter membership, privacy, and an action that opens the real
record. Verified end to end: outline → node → detail → open experience → the
record page (`archiveLoop.test.tsx`).

**Suggestions.** A candidate link is stored as `status: 'suggested'`; only
confirmed links are ever drawn. The review panel shows the reason and persists
nothing until the user presses *Add connection*. Rejections tombstone the pair so
it is not re-proposed.

**Filters.** Chapter, kind and free-text search; the map and the outline share
one filtered node set, so switching views never changes what you are looking at.

## 4. Privacy and sharing — what is actually implemented

Implemented:

- Every life record is created `visibility: 'private'`; a missing or unreadable
  visibility resolves to private.
- Unfiled/missing links read as "nowhere", never as a granted relationship.
- `buildSharePreview` runs entirely locally, takes records by value, mutates
  nothing, and hard-codes `published: false` / `localOnly: true`.
- Private records are excluded unless the user deliberately opts in *for the
  preview only* (the switch says so).
- Booking references, PNRs, ticket numbers and coordinate pairs are stripped
  from projected text, and each removal is reported in the item's omissions.
- **A private place's name is withheld from a trip preview** — fixed during this
  milestone, because a place name is itself private information.
- Travel details live in `sensitive_notes`, masked on screen until revealed, and
  never enter a preview.
- No accounts, no sync, no telemetry, no logging of journal text. AI is opt-in
  and never in the save path.

Not implemented, and not pretended otherwise: publishing, circles, public
posts, audience controls, reshare, unshare links, profiles, year in review,
resurfacing, voice, photos, sync. The share screen carries a standing warning
that sharing is not implemented and explains why there is no publish button.

## 5. Files and areas changed

New screens: `features/{home,lifemap,chapters,paths,trips,collections,places,share,roadmap}`.
New domain: `domain/lifeMap/{layout,suggestions}.ts`, `domain/share/preview.ts`.
New data: seven-table schema v2, ~40 port methods, `lifeMapSource()`,
`setEntryRelations`, tombstone-aware link handling.
New UI: 18 icon glyphs, `Field` label binding, states/panels/notes/preview
styles, ~700 lines of map CSS, `--map-*` tokens in both themes.
Docs: `DATA_MODEL`, `ARCHITECTURE`, `DESIGN_SYSTEM`, `TESTING`, `ROADMAP`,
`PRODUCT_SPECIFICATION`, plus ADRs 0012–0014.

## 6. Verification and results

| Check | Result |
| --- | --- |
| `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`) | clean |
| `vitest run` | **433 passed / 19 files** |
| `npm run contrast` | **72/72 pairings pass WCAG 2.1** (text 4.5, UI 3) |
| `npm run build` (incl. PWA) | clean, 20 precached entries |
| Route smoke (`routes.test.tsx`) | 15 destinations render an `h1`, log no console error; unknown path redirects home |
| Dev server | all 11 routes return 200 and the app boots |

Bugs found and fixed by this testing:

1. **Chapters silently vanished.** `orderBy('start_date')` skips rows whose
   index key is `null`, so every date-less chapter was saved but never listed.
   Fixed; the regression test fails if `orderBy` returns.
2. **Every form control was unnamed.** `Field` rendered a label with no
   `htmlFor` unless a caller passed one — none did. Fixed by injecting the id
   and hint description.
3. **A private place leaked into trip previews.** Fixed and covered.
4. **`/journal/new` was linked but unrouted**, so the map's empty-state buttons
   did nothing. Now a real page.

**What this does not establish.** There is no Chromium, Firefox or WebKit in
this environment and `cdn.playwright.dev` is unreachable, so **no test here is
evidence of visual layout, touch gestures, pinch zoom, service-worker behaviour,
PWA installability or real-device performance.** jsdom verifies structure, state
and persistence only. Do not read a green build as release readiness.

## 7. Known gaps and risks

- **No real-browser pass** (above). Highest-priority outstanding verification.
- **No UI tests for the canvas's pointer maths** — pan/pinch/zoom handlers are
  reasoned about, not exercised; only hit testing and layout are unit-tested.
- **Photos, year in review, resurfacing, voice, sync, publishing** are planned
  and appear only as labelled roadmap items.
- **Filing is single-valued in the editor** (`chapter_ids[0]`, `path_ids[0]`):
  the model supports many, the UI picks one. Deliberate for this milestone.
- **Trip ↔ experience linking is a name-match reading aid**, clearly labelled as
  such; it is not a stored relationship.
- **Bundle grew** with the new screens; the initial chunk is within the existing
  budget but the margin is thinner than V0.1's.
- **The archive is still local-only**, so "private" is enforced by the absence
  of a network path — true today, and something that must be re-proved the day a
  sync transport is added.

## 8. Recommended next milestone

**V0.2.1 — prove it in a real browser, then add photographs.**

1. Playwright on a device matrix (Android Chrome first, matching the owner's
   phone), with axe checks on every screen, real touch/pinch gestures on the
   map, and offline/service-worker verification.
2. Photos and attachments with checksummed blobs in IndexedDB, EXIF/GPS
   stripping on import, and an explicit exclusion rule for share previews.
3. Only then, a place/people linking UI with the same approval step chapters use.

Publishing stays out until there is a server whose privacy model has been
designed and reviewed — the current build's honesty about not having one is a
feature, not a placeholder to rush past.
