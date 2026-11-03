# 0001 — Local-first storage on IndexedDB behind a port

**Status:** accepted · **Date:** 2026-10-17 · **Context:** V0.1


Chronicle's value is a durable private record; a server dependency would add
failure modes, accounts and trust requirements for no V0.1 benefit.
IndexedDB is available in every target browser and survives offline use.

**Decision:** persist in IndexedDB (Dexie) and isolate it behind the
`ChronicleStore` interface. UI and domain code never import Dexie.

**Consequences:** a future SQLite/server backend is an implementation swap;
tests run against fake-indexeddb unchanged; storage failure is a first-class
UI state because `init()` reports instead of throwing.

