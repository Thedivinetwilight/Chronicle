# Product specification — Chronicle V0.1

Status: **implemented** unless marked otherwise. Every statement here maps to
code in `src/` and, in most cases, to a test in `src/**/*.test.ts(x)`.

## 1. Purpose

Chronicle records a person's engineering and personal journey as a durable,
private archive. It optimises for *capture friction* (one sentence is enough),
*honesty* (claims are never upgraded on your behalf) and *longevity* (open
formats, reversible edits, offline operation).

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
