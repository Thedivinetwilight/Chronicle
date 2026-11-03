# 0007 — Search over a derived index table, not raw scans

**Status:** accepted · **Date:** 2026-10-17 · **Context:** V0.1


Full-text search over record bodies would couple ranking to domain records
and pollute exports.

**Decision:** maintain `searchIndex` rows (tokens multiEntry + title +
project + date) on write; rebuild on demand; rank in memory with field
weights; date filters exclude undated records instead of guessing.

**Consequences:** exports stay clean; a corrupt index is recoverable; ranking
can evolve without touching the data model.

