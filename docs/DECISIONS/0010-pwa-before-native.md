# 0010 — PWA first; at most one native wrapper, later

**Status:** accepted · **Date:** 2026-10-17 · **Context:** V0.1


The owner uses Android and may develop on Windows; installability and offline
support are required now, native APIs are not.

**Decision:** ship a PWA (manifest, service worker, install prompts). Evaluate
Capacitor for Android only after real usage; never introduce two wrappers in
one milestone.

**Consequences:** one codebase today; a clear, sequenced path to shells.

