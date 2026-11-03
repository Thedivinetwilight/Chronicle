# 0012 — The life archive is an additive layer over the V0.1 record core

**Status:** accepted · **Date:** 2026-11-03 · **Context:** V0.2 milestone

Chronicle had to grow from "a record of projects, journal, experiments" into a
personal life archive — experiences, chapters, paths, places, trips,
collections — without rewriting the storage or domain layer for aesthetic
reasons, and without endangering archives that already exist on people's
devices.

**Decision:** the life archive is a *layer*, not a rewrite.

1. **An Experience is a `JournalEntry`.** No second entry type, no parallel
   table, no data copy. V0.2 adds two optional fields (`links`, `visibility`)
   and fills them at read time when absent, so V0.1 rows need no migration
   work and remain valid forever.
2. **Seven new tables, zero changed ones.** Database `version(2)` adds
   `chapters`, `paths`, `places`, `people`, `trips`, `collections`, `links`.
   The upgrade function touches nothing but a `meta` stamp, and the V0.1
   upgrade test asserts an old archive's rows are byte-identical afterwards.
3. **Relationships are explicit.** The user files experiences into chapters and
   paths; the general graph is stored in `links` with `status`
   suggested/confirmed/rejected. Nothing is inferred, nothing auto-confirms,
   and only confirmed links are drawn.
4. **Privacy is the default value, not a mode.** Every life record starts
   `visibility: 'private'`; a missing or unreadable visibility resolves to
   private. Sharing is a projection computed locally, and this build publishes
   nothing because it has nowhere to publish to.

**Consequences:** the archive layer can be removed without touching V0.1 data;
the map is a derived view that can always be rebuilt from canonical records;
and the cost of the feature is new tables rather than risky upgrades.
