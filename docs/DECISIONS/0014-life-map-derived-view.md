# 0014 — The life map is a derived, self-contained SVG view, not a canvas or a library

**Status:** accepted · **Date:** 2026-11-03

**Context:** The Life Map is the milestone's centrepiece: a skill-tree-like
exploration of real records, readable on a phone, keyboard operable, and never
allowed to fabricate content.

**Decision:**

1. **Layout is pure domain code** (`domain/lifeMap/layout.ts`): it takes
   canonical records and returns nodes with positions, edges and per-kind
   shapes. It has no React, no DOM and no storage access, so it is unit-tested
   directly (24 tests) and the map can always be rebuilt from the archive.
2. **SVG, not canvas.** Nodes and labels are real elements: they can be
   focused, named, selected and read by assistive technology, and they survive
   text scaling. Canvas would have made the accessible version a separate
   implementation that drifts.
3. **No map library.** A force layout animates unpredictably, ignores reading
   order and adds ~100 KiB. A deterministic radial tree (centre → kind ring →
   nodes) is calmer, reproducible between reloads, and testable.
4. **An outline is always available.** The list view renders the same filtered
   node set as the map, so the spatial view is never the only route to a record.
5. **Kind is encoded three ways** — shape, an `--map-*` colour pair that passes
   contrast, and an always-visible text label — so meaning is never carried by
   colour alone.
6. **Uncertainty is drawn, not hidden.** A node with no date is placed in the
   undated cluster and labelled as such rather than being given an invented
   date to make the layout tidy.

**Consequences:** the map carries no content of its own; deleting a record
removes its node on the next render; and a future richer map can reuse the same
domain layout with a different renderer.
