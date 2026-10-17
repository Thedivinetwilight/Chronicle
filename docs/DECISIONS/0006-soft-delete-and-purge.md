# 0006 — Tombstones for deletes, explicit purge with reference sweep

**Status:** accepted · **Date:** 2026-10-17 · **Context:** V0.1


Accidental loss of years of journal is the worst failure mode available.

**Decision:** deletes set `deleted_at` and keep references intact so restore
repairs every link; `purgeDeleted()` is explicit and, in the same
transaction, removes tombstones, orphan revisions and sweeps dangling
references; project deletion previews impact and defaults to unlink.

**Consequences:** recovery is real, not ceremonial; merge-based sync (V0.3)
gets deletion semantics for free.

