# Product specification — Chronicle V0.2

Status: **implemented** unless marked **(planned)**. Every unimplemented
statement is labelled, and nothing in the UI presents a planned feature as a
working control. Every implemented statement maps to code in `src/` and, in
most cases, to a test in `src/**/*.test.ts(x)`.

## 1. Purpose

Chronicle is a private life archive with optional, deliberate sharing. The loop
it is built around:

> capture an experience → keep it in your own archive → connect it to the rest
> of your life → share it only if you decide to.

The archive must be valuable with zero posting. Private journaling is a
first-class product, not a privacy setting.

It optimises for *capture friction* (one sentence is enough), *honesty*
(dates, people, places, emotions and relationships are never invented; claims
are never upgraded on your behalf; suggestions are labelled and need approval),
*ownership* (export, backup, restore and delete are real, understandable
operations) and *longevity* (open formats, reversible edits, offline
operation).

Reflective, never competitive: no scores, streaks, ranks, leaderboards or
"you're behind" framing anywhere.

## 2. Personas & jobs-to-be-done

- **The builder** — "I need to write down what happened before I forget, and
  find it in three months."
- **The reflector** — "Some entries are personal; they must never leak into
  work contexts or AI prompts."
- **The archivist** — "If this app dies, my record must survive as plain
  files."

## 3. Screens

### Home (`/`)
A composer ("What happened?"), tasks due within seven days with one-tap
completion, activity since yesterday, and project chips. No metrics, no
streaks, no charts.

### Projects (`/projects`, `/projects/:id`)
List with active/archived scope. A project page shows summary and objectives,
milestones (with verification status), open tasks, and its journal. Creating
and editing cover name, summary, objectives, status, evidence stage, tags,
aliases, privacy and dates. Deletion asks what should happen to child records
(unlink by default) and archives rather than erases.

### Journal (`/journal`, `/journal/:id`)
Filterable list (project, type, tag). An entry page renders Markdown, shows
provenance (captured vs written, original verbatim text), evidence level and
references, tasks derived from the entry, and a restorable edit history.

### Timeline (`/timeline`)
Unified, newest-first stream of entries, milestones, tasks (due or completed)
and project creations, grouped by local day with sticky day headers. Filters:
kind and project. Cursor pagination ("Load earlier").

### Search (`/search`)
Debounced local full-text search. Results grouped by kind with origin labels
("Journal · JARVIS"), snippets with matched terms highlighted, `#tag` filters
and kind filters. Empty, no-results and searching states are distinct.

### Settings (`/settings`)
Theme (system/light/dark), reduce motion, sidebar pin, default capture mode,
timezone, the opt-in AI disclosure, export/import, search-index rebuild, the
deleted-records bin with restore and purge, and about/install notes.

## 4. Capture engine (§28)

Input → **understanding** → **proposal** → **validation** → **commit**.

1. *Temporal* — explicit dates win; relative phrases ("3 days ago", "last
   Friday") resolve against the local date with a confidence; anything below
   the confident threshold is applied **and surfaced**, never silently. A past
   reference never becomes "today". Event date and commitment (due) date are
   separated: "tested yesterday, fix tomorrow" yields both.
2. *Project association* — exact names, punctuation-free forms, aliases and
   (weakly) acronyms; negation ("not for JARVIS") excludes; personal writing
   suppresses weak matches; a close race between two projects attaches nothing.
3. *Intent & evidence* — entry type from weighted cues; hedged language
   ("probably") demotes the evidence level; "verified" requires verification
   language **and** a measurement.
4. *Tasks* — extracted from commitment clauses with the due date taken from
   the commitment's own clause only; open-ended intentions get no date; a
   near-duplicate of an open task is offered, not created.
5. *Milestones* — detected for firsts/launches/completions; plans and wishes
   are refused; every created milestone is `verification: "claimed"`.
6. *Corrections* — a follow-up sentence ("That entry belongs to VERONICA
   instead.", "Don't create a separate task for this.") updates the previous
   capture instead of creating a new record; unresolvable corrections ask.
7. *Modes* — quick (save when confident), review (always confirm), autonomous
   (save without asking; opt-in). Idempotency: resubmitting the same message
   within the same minute never duplicates records.
8. *AI* — off by default. When enabled with an endpoint and a session key, a
   remote model may suggest structure; its output is validated field by field,
   can never rewrite your text, can never raise evidence above the local
   reading, and a failure or timeout falls back to on-device capture with a
   notice. Private records are excluded unless explicitly allowed.

## 5. Non-functional requirements

- **Offline core**: after first load, every feature above works with no
  network (service worker precache + local storage).
- **Bundle budget**: ≤ 250 KiB gzipped initial JavaScript (measured in CI by
  `npm run build`; see TESTING.md for the current number).
- **Accessibility**: keyboard operable, visible focus, ≥ 44 px touch targets on
  coarse pointers, WCAG AA contrast verified mechanically, reduced-motion
  honoured, landmarks and labels throughout.
- **Privacy**: no telemetry, no cookies, no third-party requests; AI keys live
  in memory for one session only.
- **Honesty**: empty, loading, error and blocked-storage states are all
  designed; a failed save keeps your text and says it failed.

## 6. Out of scope for V0.1

Sync between devices, attachments, rich-text editing, sharing, native shells,
and any server component. See ROADMAP.md.

## 7. V0.2 — the archive loop

### 7.1 Areas and their status

| Area | Status | Notes |
| --- | --- | --- |
| **Today** | implemented | Greeting, fast private capture, today's own words, recent experiences, chapter/path/trip shortcuts. No metrics. The day recap is *assembled from the user's records only* and says so. |
| **Capture** | implemented (text) | Quick path saves in one step; review path shows and lets you correct proposed metadata; failures keep the text and clear the busy state; repeat taps save once; nothing reports success before IndexedDB confirms. **Photos (planned)**, **voice (planned)**. |
| **Journal & timeline** | implemented | Search, filters, detail, edit, revisions, jump to map. |
| **Life Map** | implemented (MVP) | Real records only, seven node kinds, pan/zoom/pinch/keyboard, outline alternative, detail panel with source records, suggestions review queue. |
| **Chapters** | implemented | Name, description, optional dates *or* a date hint, accent, archive, tombstone delete that keeps experiences. |
| **Paths** | implemented | Title, description, start/hoped-for dates, four respectful states, state note, linked experiences. Never infers completion. |
| **Trips** | implemented (partial) | Name, dates, linked places, private details field hidden by default, experiences found by mentioning the trip's places. **Tickets/photos/recaps (planned)**. |
| **Collections** | implemented | Hand-curated albums; nothing added automatically. |
| **Sharing & profile** | **preview only** | A local projection with sensitive content stripped, exclusions listed, and no publish control. Accounts, circles, public posts, audience and reshare controls are **planned**. |
| **Roadmap** | implemented | In-app, honest list of what is not built and what it would require. |
| **Year in review** | **planned** | Not built; no recap is generated. |
| **Memory resurfacing** | **planned** | Not built; when built it must ship with hide controls for topics, people, places and dates, and no notifications. |
| **Voice capture** | **planned** | Nothing records audio in this build. |

### 7.2 The privacy model as implemented

1. Every life record is created with `visibility: 'private'`.
2. A missing or unreadable visibility resolves to private when read.
3. There is no network path for archive content in this build: no accounts, no
   sync, no telemetry, no AI call unless the user configures one with a key
   that is never stored.
4. The share preview runs locally, excludes private items unless explicitly
   included *for the preview only*, strips booking references/PNRs/coordinates,
   reports each omission, and hard-codes `published: false`.
5. Travel details (confirmation numbers, booking references) live in a single
   `sensitive_notes` field, masked on screen until revealed, never included in a
   preview.
6. Places store names the user typed. Chronicle does not collect coordinates,
   does not geolocate and cannot draw an exact home location.

### 7.3 Truthfulness rules in the UI

- Unknown dates are stored as unknown (`occurred_precision: 'unknown'`) rather
  than defaulted to today, and the editor offers "I don't know when this
  happened" explicitly.
- The map draws an "undated" cluster instead of inventing a position in time.
- Path states are the user's own words, with copy that treats paused and changed
  as legitimate: *"The plan moved somewhere else. That is part of the story, not
  a failure."*
- Trip membership is shown as *"found by matching the place names you recorded
  against your own text"* — described as a reading aid, not a link Chronicle
  created.
- Deleting a chapter, path or collection says plainly that the experiences are
  kept.
