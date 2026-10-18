# Architecture decision records

Short, dated records of choices that shaped Chronicle. Status reflects V0.1.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-local-first-indexeddb.md) | Local-first storage on IndexedDB behind a port | accepted |
| [0002](0002-capture-heuristics-with-review.md) | On-device capture heuristics with mandatory review on uncertainty | accepted |
| [0003](0003-ai-opt-in-provider-port.md) | AI as an opt-in provider behind a port, never in the loop by default | accepted |
| [0004](0004-evidence-ladder.md) | Evidence ladder that never auto-advances | accepted |
| [0005](0005-time-utc-plus-timezone.md) | UTC canonical instants plus per-record timezone and precision | accepted |
| [0006](0006-soft-delete-and-purge.md) | Tombstones for deletes, explicit purge with reference sweep | accepted |
| [0007](0007-derived-search-index.md) | Search over a derived index table, not raw scans | accepted |
| [0008](0008-no-dependency-defaults.md) | Hand-rolled Markdown, validation and icons instead of dependencies | accepted |
| [0009](0009-bundle-budget.md) | 250 KiB gzip initial-JS budget with lazy capture engine | accepted (lazy capture engine superseded by 0011) |
| [0010](0010-pwa-before-native.md) | PWA first; at most one native wrapper, later | accepted |
| [0011](0011-capture-engine-bundled-write-watchdog.md) | Capture engine ships in the main bundle; write transactions get a liveness watchdog | accepted |
