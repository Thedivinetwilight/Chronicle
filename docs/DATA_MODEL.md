# Data model — Chronicle V0.2

Database: IndexedDB, name `chronicle`, version 2 (Dexie). Schema in
`src/data/db.ts`. V0.1 tables are unchanged; V0.2 adds seven life-archive
tables (see below). Every record carries `RecordMeta`:

```ts
{ id, created_at, updated_at, rev, deleted_at?, extras? }
```

- `id`: 26-char Crockford-base32 ULID-like, time-sortable, collision-safe.
- `created_at` / `updated_at`: UTC ISO-8601 with `Z`.
- `rev`: monotonic per record; every write bumps it.
- `deleted_at`: tombstone marker (soft delete).
- `extras`: unknown fields preserved on import, never dropped.

## Tables & indexes

| Table | Indexes (Dexie) |
| --- | --- |
| `projects` | id, name, status, stage, created_at, updated_at, deleted_at, *tags |
| `entries` | id, occurred_at, created_at, updated_at, project_id, type, deleted_at, *tags, milestone_id |
| `milestones` | id, date, project_id, status, verification, deleted_at, *tags |
| `tasks` | id, due_on, status, priority, project_id, deleted_at, updated_at, source_entry_id, *tags |
| `revisions` | id, entry_id, created_at |
| `searchIndex` | id, kind, record_id, project_id, *tokens, updated_at |
| `meta` | key (settings, capture:last, schema:migrated_to) |
| `chapters` | id, name, status, start_date, end_date, deleted_at, updated_at |
| `paths` | id, title, state, start_date, desired_date, deleted_at, updated_at, *tags |
| `places` | id, name, kind, deleted_at, updated_at |
| `people` | id, name, deleted_at, updated_at |
| `trips` | id, name, start_date, end_date, deleted_at, updated_at |
| `collections` | id, name, deleted_at, updated_at |
| `links` | id, from_kind, from_id, to_kind, to_id, status, deleted_at, updated_at |

## Records

### JournalEntry
`title`, `body` (never rewritten by the engine), `summary?`, `type`
(note|reflection|progress|research|decision|experiment|failure|discovery|milestone),
`occurred_at` + `occurred_precision` (exact|hour|day|week|month|year) +
`occurred_source` (user|text|capture_time|imported|default), `project_id?`,
`tags[]`, `evidence_level` (concept→researched→designed→implemented→tested→
verified→deployed), `evidence[]` (kind, location, verification, checksum…),
`related_entry_ids[]`, `milestone_id?`, `private`, `timezone?`, `pinned`,
`source` (kind + `original_input` + `capture_id` + analyzer), `derived`
(flags for engine-suggested fields).

### Project
`name`, `summary?`, `objectives?`, `status` (idea…archived), `stage`
(evidence level of the work), `started_on?`, `target_date?`, `tags[]`,
`aliases[]`, `linked_project_ids[]`, `privacy` (private|shareable), `domain?`.

### Task
`title`, `description?`, `project_id?`, `status` (todo|doing|blocked|done|dropped),
`priority`, `due_on` (nullable — never defaulted), `due_precision`,
`completed_at?`, `tags[]`, `source_entry_id?`.

### Milestone
`title`, `description?`, `date` + `date_precision`, `project_id?`, `status`
(planned|achieved|missed|dropped), `verification` (claimed|supported|verified|
disputed), `evidence[]`, `entry_ids[]`, `tags[]`.

### Revision
Immutable snapshot of an entry's previous `title`/`summary`/`body` with
`saved_by` (user|capture|import) and optional `reason`. Created only when
content actually changed; pruned to the most recent 25.

## Integrity rules (enforced in code)

1. **Evidence ladder never auto-advances.** Upgrades require an explicit user
   action; `verified`/`deployed` require ≥ 1 evidence reference (validation
   downgrades otherwise). Downgrades are always allowed.
2. **Soft delete everywhere.** Deleting archives the record (`deleted_at`),
   removes its search row's visibility, and keeps references intact so a
   restore repairs every link. `purgeDeleted()` removes tombstones *and*
   sweeps dangling references (task.source_entry_id, entry.milestone_id,
   related ids, project links) plus orphan revisions.
3. **Project deletion is a choice**: unlink children (default) or archive them
   with the project; both report an impact preview first.
4. **Imports validate before writing**: format/version checks, checksum
   verified against the file *as written* (before any repair), per-record
   parsing with repair-and-warn semantics, > 50 % invalid rejects the file,
   duplicate ids keep the first, and merge planning is id/rev-aware (newer
   local wins; `replace` requires an explicit backup acknowledgement).
5. **Idempotent capture**: record ids derive from the capture id, so a
   resubmitted message cannot duplicate records.

## Settings (`meta` table)

`schema_version`, `theme`, `capture_mode`, `timezone` (`device` or IANA),
`reduce_motion`, `sidebar_pinned`, `ai {enabled, provider, endpoint, model,
allow_private, disclosure_acknowledged_at}`, `onboarded`, `app_version`.
An API key is **never** part of settings or storage.

---

## V0.2 — the life archive

V0.2 adds an archive layer on top of the V0.1 project/journal core. It is
**purely additive**: no V0.1 table, index or row changes, and a V0.1 archive
opens directly. The migration is still explicit (`schema:migrated_to = 2`) so
it is visible and testable rather than implied by Dexie's defaults.

### The central record: Experience

An Experience *is* a `JournalEntry`. There is no parallel type: the journal
entry already holds the words, the date and its precision, the private flag and
the provenance. V0.2 adds two optional fields to it:

```ts
links?: {
  chapter_ids: string[];
  path_ids: string[];
}
visibility?: 'private' | 'circles' | 'public';
```

Absent `links` means "filed nowhere" and absent `visibility` means **private**;
the archive layer never upgrades either because a field was missing
(`parseEntry` fills both at read time). That is what keeps old records
readable without rewriting them during a migration.

An Experience is valid with its text alone: no date, no place, no people, no
photos. Every other field is optional by design.

### Life records

All seven share `RecordMeta` and therefore the same guarantees: stable ULIDs,
`rev` bumps, tombstones, `extras` preserved on import.

| Record | Meaning | Notable fields |
| --- | --- | --- |
| `Chapter` | a user-named era | `name`, `description?`, `start_date`/`end_date` (nullable), `date_precision`, `date_hint?`, `accent` (5 curated accents), `status` open/archived, `visibility` |
| `Path` | a goal, hope, plan or interest | `title`, `description?`, `start_date?`, `desired_date?`, `state` active/paused/completed/changed, `state_note?`, `tags[]`, `visibility` |
| `Place` | a location the user typed | `name`, `kind` (city/region/country/venue/route/other), `region?`, `notes?` — **no coordinates are collected** |
| `Person` | someone the user chooses to record | `name`, `relationship?`, `notes?`, `visibility` |
| `Trip` | several places and dates together | `name`, `description?`, `start_date?`/`end_date?`, `date_precision`, `place_ids[]`, `sensitive_notes?`, `visibility` |
| `Collection` | a hand-curated album | `name`, `description?`, `entry_ids[]`, `visibility` |
| `MemoryLink` | an approved relationship | `from_kind`/`from_id`, `to_kind`/`to_id`, `status` suggested/confirmed/rejected, `origin` user/suggested, `confidence?`, `label?` |

`RecordKind` was widened from 4 to 12 entries so tombstones, search and
restore cover life records as first-class kinds.

### Relationship rules

1. **Two mechanisms, on purpose.** Filing (`entry.links.chapter_ids` /
   `path_ids`) is set by the user in the editor and is the relationship the
   editor and chapter/path pages read. `MemoryLink` is the general graph
   (any kind ↔ any kind) used by the map and suggestions. Filing also writes a
   confirmed link, so both views agree; nothing is derived by guessing.
2. **Only confirmed links are drawn.** `buildLifeMap` filters
   `status === 'confirmed'`; a suggestion exists only as a card in the review
   panel until the user adds it. Rejected suggestions are tombstoned, not
   deleted, so re-suggesting the same pair cannot nag.
3. **De-duplicated by pair**, regardless of direction, before insert.
4. **Self-links and dangling targets are refused** at write time.
5. **Deleting a target tombstones the links that point at it**, so the map
   cannot draw an edge to a record that no longer exists.
6. **Changed and paused paths are recorded states, not failures.** Nothing
   infers completion: `completed` is only ever set by the user.

### Deletion semantics

Chapters, paths, trips and collections are tombstoned. Deleting one:

- removes the *filing*, never the experiences;
- tombstones the memory links that referenced it;
- is reversible until the deleted bin is emptied.

The copy in each confirm dialog says this in the user's terms ("its
experiences stay exactly as they are — they simply stop being filed here"),
because a chapter delete that sounds like it deletes memories would be a lie.

### Share projection (not publication)

`domain/share/preview.ts` builds a `SharePreview` **locally**:

- items are copied by value; the archive is never mutated;
- `visibility: 'private'` items are excluded unless `includePrivate` is
  explicitly passed (the UI defaults it to off and labels it as a preview-only
  switch);
- booking references, PNRs, ticket numbers and coordinate pairs are stripped
  from shared text, and every removal is reported in `item.omitted` so the user
  sees what changed;
- the audience is the *narrowest* visibility among the selected items;
- `published: false` and `localOnly: true` are hard-coded, because this build
  has no server to publish to.

### Archive format

`ChronicleArchive.life?` holds the seven life-record arrays. It is written only
when non-empty, so a V0.1 export stays byte-comparable. The importer accepts
life records either under `records` (flat, kind-tagged) or under a sibling
`life` block, validates each record before writing, and refuses the file if
more than half the records are invalid.
