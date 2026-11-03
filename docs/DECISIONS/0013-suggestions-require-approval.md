# 0013 — Suggestions are labelled, stored as suggestions, and require approval

**Status:** accepted · **Date:** 2026-11-03

**Context:** The life map's value comes from connections, and some connections
can be noticed mechanically — two experiences that share a place name, a trip
whose dates overlap a chapter. The brief forbids inventing relationships and
requires that user facts stay distinguishable from suggestions.

**Decision:**

1. A suggested connection is stored as a `MemoryLink` with
   `status: 'suggested'` and `origin: 'suggested'`. It is **never** written as
   `confirmed` — the store rejects a suggested link submitted as confirmed.
2. Suggestions are rendered only in a review panel, each with the reason it was
   proposed ("both mention Kyoto"), and are persisted **only** when the user
   presses *Add connection*. Rejections tombstone the pair so it is not
   re-proposed.
3. The map, the journal, the chapter page and the export all read confirmed
   links only. A suggestion can therefore never leak into a record, a share
   preview or an export as though it were the user's own statement.
4. No suggestion is generated about *feelings* or *relationships between
   people*. The generator looks at identifiers the user already typed
   (place names, shared dates, explicit ids) and nothing else.

**Consequences:** a suggestion costs a user decision before it changes the
archive; the map never shows a connection the user did not approve; and the
same rule applies to any future AI-assisted suggestion, which must land in the
same review queue.
