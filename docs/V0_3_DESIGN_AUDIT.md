# V0.3 design audit — findings before changes

Written before any edit, so the decisions below can be checked against what was
actually there. Branch `arena/2470f197-chronicle`, HEAD `aefb3fc`, tree clean.

## 1. State found

- 22 routes, all rendering, verified in Chromium at 1440×950 and 390×844 in both
  themes with no horizontal overflow (V0.2 report).
- 442 tests across 19 files; `npm run verify` green.
- Token layer (`src/styles/tokens.css`) and component layer
  (`src/styles/global.css`) were rewritten in V0.2, so the colour system is
  sound. **The gap this brief asks about is not colour.** It is: no bespoke
  artwork of any kind, no copy discipline, a generic icon set, and a capture
  surface that is a bare textarea.

## 2. Conflicts with the brief — reported before changing behaviour

### 2a. AI UI exists and is wired to real behaviour

`Settings` renders an "AI assistance (opt-in)" section
(`src/features/settings/SettingsPage.tsx:186`). `CaptureDialog` reads
`settings.ai.enabled` / `.provider` and calls `selectProvider(...)` — a real
remote HTTP provider (`src/domain/capture/provider.ts`), with endpoint, model,
and an "allow private records in AI context" switch. When enabled, capture shows
an "AI assistance is on" note.

The brief says: *"AI connection and AI-powered features are explicitly out of
scope for this release. Do not add chatbot screens, AI-generated summaries,
automatic memory analysis, or AI suggestion controls."*

This is a direct conflict, and it is not a rendering question, so it is reported
rather than silently resolved.

**Decision, and why.** I am removing the AI **interface** — the Settings section
and the capture-time "AI assistance is on" note — because the brief rules out
"AI suggestion controls" in this release. I am **not** deleting the provider
module, the `ai` settings field, or the session-key holder. Reasons:

1. The brief also says *"Keep the architecture open to adding optional AI
   assistance in a later update."* The provider, its strict
   validation/fallback rules and its local-only default are exactly that
   architecture; deleting them would be the opposite of the instruction.
2. `ai.enabled` remains persisted, so an existing archive that had AI switched
   on does not silently lose a stored preference. It simply has no UI until a
   later release brings one back.
3. Capture now always runs the **local** analyzer, which is deterministic, works
   offline, and never leaves the device. This is a behaviour change for anyone
   who had explicitly opted into the remote provider. It reverts to the app's
   documented default (local-only) and is called out here, in the report, and in
   `docs/TESTING.md`.

Two tests reference `setAiSessionKey`; they assert capture still works when a
session key exists. They keep passing, because the key is now simply unused.

### 2b. Repeated privacy copy — 21 statements

"Private to you", "Nothing here is shared", "stays on this device", "never sent
anywhere", "on this device" appear 21 times across feature screens. The brief
asks to *"delete duplicate explanations, repeated privacy statements"* while
*"keep safety, privacy, and destructive-action wording clear even when
simplifying copy."*

**Decision.** Keep privacy where it changes a decision (the share preview, the
private/master switch inside a record editor, and one deliberately placed
statement of the app-level guarantee on Settings). Remove it where it merely
repeats — the badge on Today, the per-page subtitle on Search and the map, the
capture hint, the empty-state tail. No privacy *behaviour* changes.

### 2c. Copy volume generally

Longest on-screen strings are 60–120 characters of guidance, several of them
explaining rather than helping. "Saves privately, instantly. Add a date, chapter
or path later if you want." is four ideas in one hint. Empty states narrate
("Write one thing above: something that happened, something you noticed,
something you want to remember.").

**Decision.** Rewrite to short, decision-helping copy. Nothing gets vaguer about
destruction or privacy.

## 3. The real design gap

Nothing in the repo does what this brief is actually about. There is **no
artwork**: no illustrations, no covers, no map marks, no paper texture. The icon
set is 18 generic stroke glyphs. `Chapters`, `Paths`, `Collections` and `Trips`
are rows of text. The Life Map is a competent node graph, not an *"illustrated
constellation"*.

So the work is: build one bespoke, coherent illustration system; give chapters,
paths, collections and trips real cover treatments; make the map feel authored;
and let that art carry the product's character while the interface stays quiet.

## 4. Things that must not break

- Every route and its direct access; keyboard reachability of every destination.
- Capture: all V0.1/V0.2 fields (title, body, type, project, date, tags,
  privacy, pinned, chapter, path, unknown-date), draft preserved on failure,
  no repeat submission, success only after persistence.
- Life Map: node selection, keyboard activation, outline alternative, no
  invented relationships, reduced motion.
- Privacy: private records excluded from share preview by default; no publishing
  control; sensitive trip/booking data kept out of previews.
- Offline capture and IndexedDB persistence; no new network calls.
- No new social publishing, cloud storage, or AI in this release.
