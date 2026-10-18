# 0011 — Capture engine ships in the main bundle; write transactions get a liveness watchdog

**Status:** accepted · **Date:** 2026-10-18 · **Context:** production bug (Android Chrome)

Saving a capture hung forever on a real Android device: persistent spinner,
open dialog, no error, nothing written. Instrumented browser runs reproduced
the exact symptom by letting the one runtime network fetch inside the save
path — the lazily imported `analyzer` chunk — stall without ever responding:
`await import()` has no timeout and produces no rejection when the request
hangs, so the dialog's error handler is unreachable and its busy state never
clears. Every local IndexedDB/service-worker/offline permutation of the flow
settles correctly; the defect is that a *core* feature's availability was
tied to a runtime fetch with no liveness guard.

**Decision:**

1. `analyzer.ts` and `provider.ts` are statically imported into the main
   bundle. The save path performs **zero** network fetches in the default
   local configuration. Initial JS grows from ≈158 KiB to ≈180 KiB gzip —
   still 28 % under the 250 KiB budget (0009); route-level code splitting is
   unaffected. This partially supersedes 0009's "lazy capture engine".
2. Every user-triggered capture action carries a re-entrancy guard, so
   repeat taps while a save is in flight are ignored (capture ids remain the
   idempotency backstop).
3. The capture write transaction gets a 30 s liveness watchdog that calls
   `tx.abort()` and rejects the scope. Aborting is atomic — IndexedDB rolls
   the whole transaction back — so the watchdog can never produce a partial
   commit, and idempotency keys make a retry after an abort
   duplicate-proof. The UI maps the resulting `AbortError` to a visible,
   actionable message. No timeout anywhere *ignores* an outstanding DB
   result; the only timeout in the path forces a rollback.
4. An opt-in stage tracer (`localStorage['chronicle:debug'] = 'capture'`)
   logs stage names and timings to the console for field diagnosis. It never
   logs capture text, keys, or record contents.

**Consequences:** first paint carries ~22 KiB more gzip, paid once and then
served from the service-worker precache; saving can no longer depend on
chunk delivery at all. Any future wedged-storage scenario resolves within
30 s into a visible failure with the user's text intact, instead of an
infinite spinner. Regression coverage: `captureFlow.test.tsx` (6 UI-level
scenarios) and the watchdog test in `dexieStore.test.ts`.
