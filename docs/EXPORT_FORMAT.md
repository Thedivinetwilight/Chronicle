# Export & import formats

## 1. JSON archive (`chronicle.archive`)

A single UTF-8 JSON file. Version 1. Produced by `domain/export/archive.ts`,
parsed by `domain/import/archive.ts`.

```jsonc
{
  "format": "chronicle.archive",
  "format_version": 1,
  "app_version": "0.1.0",
  "schema_version": 1,
  "exported_at": "2026-10-17T09:30:00.000Z",
  "timezone": "Asia/Kolkata",          // the exporter's display zone, informational
  "include_deleted": false,
  "counts": { "projects": 1, "entries": 4, "milestones": 1, "tasks": 2, "revisions": 3 },
  "records": {
    "projects": [ /* Project */ ],
    "entries":  [ /* JournalEntry, incl. source.original_input */ ],
    "milestones": [ /* Milestone */ ],
    "tasks": [ /* Task */ ],
    "revisions": [ /* Revision */ ]
  },
  "integrity": {
    "algorithm": "sha256",             // or "fnv1a" when WebCrypto is unavailable
    "checksum": "…",                   // over canonicalJson(records)
    "record_count": 8
  }
}
```

Rules:

- Records are sorted by id; `canonicalJson` sorts object keys so the checksum
  is stable across exporters and key order.
- `source.original_input` (the verbatim capture text) and `derived` flags
  travel with entries — provenance survives round trips.
- Tombstoned records are included only when `include_deleted` is true.
- Unknown fields inside records are preserved in `extras`, so archives written
  by a newer Chronicle do not lose data when imported by an older one.

### Import behaviour

1. Size cap (64 MB), JSON parse, format and `format_version` checks (newer
   versions are refused with an explanation, older ones migrate with a note).
2. Integrity is verified **before** any record is parsed or repaired.
3. Each record is validated; invalid records are skipped with warnings unless
   they exceed 50 % of the file, in which case the file is refused.
4. Duplicate ids inside one file keep the first copy (warned).
5. Planning: `merge` compares id + rev per record (newer local wins; locally
   deleted records are restored when the incoming rev is higher); dangling
   references are repaired to null with a warning. `replace` requires
   `backupAcknowledged` and reports how many local records it will remove.
6. Applying a plan runs in one transaction and rebuilds the search index.

## 2. Markdown bundle

`chronicle/README.md` (index + counts), `chronicle/journal.md` (entries grouped
by month, each with front matter, metadata line, body, and — when the entry
came from capture — the verbatim original text as a quoted block),
`chronicle/milestones.md`, `chronicle/tasks.md`, and
`chronicle/projects/<slug>.md` dossiers (status table, objectives, milestones,
open tasks, journal list).

Entry files carry YAML front matter with id, kind, type, dates, precision and
source, project, tags, evidence level and privacy, so the Markdown remains
machine-readable. Private entries are excluded unless explicitly requested.

The Markdown renderer used for display (`domain/markdown.ts`) is escape-first:
raw HTML is escaped, only an allowlisted subset renders, and only `http(s)`,
`mailto` and relative URLs become links.

## 3. What is *not* exported

The derived search index, settings' session key (which is never stored), and
anything the user has not written. Exports are a copy of your record, not of
the application.
