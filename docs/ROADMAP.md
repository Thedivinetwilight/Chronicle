# Roadmap

V0.1 is the local, honest core. Everything below is ordered by the project's
priority rule: data integrity & privacy → correctness → core UX → performance
→ maintainability → extras.

## V0.2 — depth of record

- Attachments stored in OPFS/IndexedDB blobs, referenced by evidence entries
  with checksums; included in exports as a sidecar folder.
- Evidence management UI: attach a measurement, a link or a file to move a
  claim up the ladder — with the ladder's rules enforced in the UI.
- Weekly review surface: a digest generated locally from your own records
  (no model required), with explicit "nothing inferred" provenance.

## V0.3 — sync (design, not yet code)

Sync is deliberately a *protocol* decision, not a vendor decision.

1. **Transport-agnostic change log.** Every write already produces
   `(record, rev, updated_at)`; V0.3 adds a per-device `clock` (Hybrid Logical
   Clock) so concurrent edits order deterministically without a server clock.
2. **End-to-end encryption at rest on the server.** The archive is the unit of
   sync: clients exchange encrypted snapshots plus an encrypted change log;
   the server stores blobs only and can never read records. Key material
   lives in the platform keystore (WebCrypto `subtle` + OS keychain in native
   shells), never in the app bundle.
3. **Conflict policy**: field-level last-writer-wins by HLC for metadata;
   body/text conflicts produce a *revision pair* the user merges explicitly —
   Chronicle never silently discards a person's words.
4. **Adapters**: (a) self-hosted REST/WebDAV folder, (b) static object storage
   (S3-compatible) with client-side encryption, (c) optional managed relay.
   All three speak the same snapshot + log format, so switching is a settings
   change.
5. **Offline-first remains**: sync failures queue locally; the app is fully
   functional with sync off forever.

## V0.4 — shells

- Capacitor (Android first, matching the owner's device) reusing this codebase;
  Tauri for desktop later. One native wrapper at a time, evaluated after real
  usage — see DECISIONS/0010.

## Explicitly not planned

- Accounts, social features, dashboards, streaks, analytics of any kind.
- Server-side AI. Models are consulted on-device-initiated, opt-in, and only
  for structure suggestions.
