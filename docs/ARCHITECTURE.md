# Architecture — Chronicle V0.1

## 1. Layers

```
src/
  domain/        pure TypeScript: types, time, text, markdown, validation,
                 search scoring, export/import, and the capture engine
  data/          persistence: Dexie schema (db.ts), the ChronicleStore port
                 (store.ts), and its IndexedDB implementation (dexieStore.ts)
  state/         React context + live-query hooks over the store
  ui/            design-system primitives (icons, controls, dialogs, states)
  features/      screens: layout, home, capture, projects, journal, timeline,
                 search, settings, milestones
  styles/        tokens.css + global.css
```

Dependencies point one way: features → state → data → domain. `domain/` has no
imports from React, Dexie or the browser; it is unit-testable in isolation and
is where every rule about *meaning* lives.

## 2. The storage port

`ChronicleStore` (data/store.ts) is an interface: CRUD per record kind,
revisions, tags, timeline, search, capture context/commit, settings,
portability and housekeeping. `DexieChronicleStore` implements it over
IndexedDB. Nothing above the port imports Dexie. That boundary is what makes a
future SQLite (native shell) or server-backed implementation a swap, not a
rewrite — and it lets the UI tests run against fake-indexeddb unchanged.

Design notes:

- `init()` never throws. It returns false with a human-readable
  `storageError` when IndexedDB is unavailable (private mode, blocked
  permissions), and the UI shows a blocked state instead of pretending.
- Writes that touch several tables run in one Dexie transaction; every
  transaction lists **all** tables it reads or writes (including `projects`,
  because indexing resolves project names).
- Reads for lists use bounded scans (`SCAN_LIMIT`) plus in-memory filtering:
  V0.1 archives are personal in size, and correctness beats index cleverness.

## 3. Derived search index

Search does not scan records at query time. A separate `searchIndex` table
holds one row per record (`kind:record_id`) with token multi-entry index,
title, project, date. Rows are written on create/update, marked on delete,
and rebuilt by `rebuildSearchIndex()`. Keeping it derived means:

- exports stay clean (the index is never part of an archive),
- a corrupted index is recoverable, and
- ranking can use field weights without touching domain records.

Queries: prefix match on tokens (AND across terms), then in-memory scoring
with field weights (title exact 120 → body 3), phrase and `#tag` bonuses,
recency boost, and matched-project boosting. Date filters exclude records
that have no meaningful date rather than guessing.

## 4. Capture pipeline

`analyzer.ts` orchestrates: temporal → projects → intent → signals → tasks →
milestones → tags → title/summary → proposal. It is **pure**: it returns a
`CaptureProposal`; writing happens only through `commitProposal` against a
`CaptureWriter` (implemented by the store inside one transaction).

`provider.ts` defines the AI boundary: `CaptureProvider` with `localProvider`
(default, always available) and an HTTP provider built from user settings plus
a session-only key. Remote output is validated field by field against the
local proposal; merge rules can add suggestions but never rewrite user text,
never raise evidence above the local reading, and force review.

Corrections reuse the same pipeline with a `lastCommit` session reference, so
"That entry belongs to X" produces an *update* record, not a new entry.

## 5. Time

All instants are stored as UTC ISO-8601 with an explicit designator. Each
record carries the timezone it was captured in; day-coarse values store a
local date plus precision and are placed at **local noon** of the viewing
timezone for display so they never slip a day. No timezone is hardcoded
anywhere; `device` follows the platform and falls back to UTC only when the
platform reports nothing usable.

## 6. Offline & install

`vite-plugin-pwa` generates a Workbox service worker (precache + cache-first
same-origin runtime caching, navigate fallback to `index.html`). The capture
engine (`analyzer`/`provider`) ships inside the main bundle on purpose: the
save path must never depend on a runtime network fetch (ADR 0011 — a stalled
lazy-chunk request once froze saving with no error). Routes stay code-split,
and the initial JS remains ~28 % under the 250 KiB gzip budget.

## 7. What is deliberately absent

No state library (React context + `useLiveQuery` suffice), no CSS framework,
no icon font, no Markdown library (the renderer is escape-first and 200
lines), no schema library (validation is explicit and repair-oriented), no
router data loaders. Each absence is recorded in `docs/DECISIONS/`.
