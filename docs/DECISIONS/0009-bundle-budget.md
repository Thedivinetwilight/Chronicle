# 0009 — 250 KiB gzip initial-JS budget with lazy capture engine

**Status:** accepted · **Date:** 2026-10-17 · **Context:** V0.1


The app must feel instant on mid-range Android phones over poor networks.

**Decision:** provisional budget of 250 KiB gzipped initial JavaScript,
measured by the production build (recorded in TESTING.md); code-split the
capture engine and provider so first paint never pays for them.

**Consequences:** current initial JS ≈ 158 KiB gzip; the budget is a target we
measure, not a claim.

