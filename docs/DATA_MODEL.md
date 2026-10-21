# Data model — Chronicle V0.1

Database: IndexedDB, name `chronicle`, version 1 (Dexie). Schema in
`src/data/db.ts`. Every record carries `RecordMeta`:

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
| `meta` | key (settings, capture:last) |

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
