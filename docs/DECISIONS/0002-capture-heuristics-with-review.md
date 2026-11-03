# 0002 — On-device capture heuristics with mandatory review on uncertainty

**Status:** accepted · **Date:** 2026-10-17 · **Context:** V0.1


Capture must work offline and privately, and must not invent facts. A model
is not required for dates, projects or tasks: those are pattern problems with
confidence scores.

**Decision:** implement a deterministic, tested heuristic pipeline; attach a
confidence to every derived value; anything below the confident threshold is
surfaced for review (or asked about) rather than applied silently; proposals
are validated before any write.

**Consequences:** behaviour is explainable and testable (15 acceptance
scenarios); the cost is a rule set that needs tuning, which the review UI
makes visible.

