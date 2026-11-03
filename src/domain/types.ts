/**
 * Chronicle domain model.
 *
 * This module is pure TypeScript: no React, no IndexedDB, no browser APIs.
 * Everything here can be unit tested in isolation and reused by a future
 * native (SQLite) or server-side implementation.
 *
 * Conventions
 * -----------
 * - Every timestamp is an ISO-8601 string in UTC (`IsoDateTime`).
 * - Calendar dates that have no meaningful time component are `IsoDate`
 *   (`YYYY-MM-DD`) and are always interpreted in the user's timezone.
 * - Every persisted record carries `RecordMeta` so that exports, imports and a
 *   future sync protocol can reason about identity, ordering and deletion.
 * - Field names are snake_case on the wire (exports, storage) and in code, to
 *   keep the JSON archive stable and predictable.
 */

/** ISO-8601 UTC instant, e.g. `2026-10-17T09:24:00.000Z`. */
export type IsoDateTime = string;

/** Local calendar date, e.g. `2026-10-17`. */
export type IsoDate = string;

/** IANA timezone identifier, e.g. `Asia/Kolkata`, or `UTC`. */
export type TimeZoneId = string;

/**
 * Where a project sits in its lifecycle. These describe *activity*, not
 * success: `operational` does not claim the project is finished or proven.
 */
export const PROJECT_STATUSES = [
  'idea',
  'research',
  'planning',
  'development',
  'prototyping',
  'testing',
  'operational',
  'paused',
  'archived'
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Statuses that mean "this project is not currently being worked on". */
export const INACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = [
  'paused',
  'archived',
  'idea'
];

/**
 * The evidence ladder from §15 of the product brief. A record may only move up
 * this ladder through an explicit user decision or attached evidence — never
 * automatically because files changed or because text sounded confident.
 */
export const EVIDENCE_LEVELS = [
  'concept',
  'researched',
  'designed',
  'implemented',
  'tested',
  'verified',
  'deployed'
] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/** How sure Chronicle is that a claim is backed by something real. */
export const VERIFICATION_STATUSES = [
  'claimed',
  'supported',
  'verified',
  'disputed'
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Journal entry kinds. `note` is the low-friction default. */
export const ENTRY_TYPES = [
  'note',
  'reflection',
  'progress',
  'research',
  'decision',
  'experiment',
  'failure',
  'discovery',
  'milestone'
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done', 'dropped'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const MILESTONE_STATUSES = ['planned', 'achieved', 'missed', 'dropped'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/**
 * How precisely `occurred_at` / `date` is known. A historical entry resolved
 * only to "last week" must not be presented as an exact moment.
 */
export const DATE_PRECISIONS = ['exact', 'day', 'week', 'month', 'year', 'unknown'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

/** Where a date value came from. Provenance matters for honest history. */
export const DATE_SOURCES = ['user', 'text', 'capture_time', 'imported', 'default'] as const;
export type DateSource = (typeof DATE_SOURCES)[number];

/** Bookkeeping present on every persisted record (sync-ready by design). */
export interface RecordMeta {
  /** Stable, sortable, globally unique identifier (see `domain/ids.ts`). */
  id: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  /** Monotonic revision counter; bumped on every substantive change. */
  rev: number;
  /** Soft-delete tombstone. `null`/absent means the record is live. */
  deleted_at?: IsoDateTime | null;
  /**
   * Fields this build does not understand, preserved verbatim so that
   * importing an archive written by a newer Chronicle never loses data.
   */
  extras?: Record<string, unknown>;
}

export const EVIDENCE_REF_KINDS = [
  'url',
  'path',
  'note',
  'measurement',
  'command',
  'document'
] as const;
export type EvidenceRefKind = (typeof EVIDENCE_REF_KINDS)[number];

/**
 * A pointer at something that supports a claim. Evidence references are kept
 * separate from record bodies so that "what was observed" can be audited
 * without re-reading prose.
 */
export interface EvidenceRef {
  id: string;
  kind: EvidenceRefKind;
  /** URL, filesystem path, command line, or a short free-text pointer. */
  location?: string;
  description?: string;
  /** Optional checksum (e.g. sha256) of the referenced artefact. */
  checksum?: string;
  verification: VerificationStatus;
  created_at: IsoDateTime;
}

/** How a record entered Chronicle. Preserved forever for provenance. */
export interface CaptureSource {
  kind: 'manual' | 'capture' | 'import' | 'seed';
  /** The user's verbatim natural-language input, when captured conversationally. */
  original_input?: string;
  /** Which analyzer produced the derived fields. */
  analyzer?: 'local' | 'remote';
  provider?: string;
  model?: string;
  /** Idempotency key for the capture operation (see §28.13). */
  capture_id?: string;
  captured_at?: IsoDateTime;
}

/**
 * Which fields were produced by Chronicle rather than typed by the user.
 * Used by the UI to mark derived content and by the capture engine to decide
 * what a correction is allowed to change.
 */
export type DerivedFields = Partial<
  Record<
    'title' | 'summary' | 'tags' | 'type' | 'project' | 'occurred_at' | 'evidence_level' | 'tasks' | 'milestone',
    boolean
  >
>;

export interface Project extends RecordMeta {
  name: string;
  /** One-or-two sentence description. Optional — a project needs only a name. */
  summary?: string;
  /** What the project is trying to achieve. Free text / markdown. */
  objectives?: string;
  status: ProjectStatus;
  /** Highest evidence level the owner has explicitly claimed for the project. */
  stage: EvidenceLevel;
  started_on?: IsoDate | null;
  target_date?: IsoDate | null;
  tags: string[];
  /** Alternative names used by the capture engine to resolve references. */
  aliases: string[];
  /** Explicit, user-created links to other projects. */
  linked_project_ids: string[];
  /** `private` records are never offered to an external AI provider. */
  privacy: 'private' | 'shareable';
  /**
   * Audience for this record (V0.2). Absent on V0.1 records, which are read as
   * `'private'`. `privacy` above keeps its original, narrower meaning: whether
   * an external AI provider may ever see the project.
   */
  visibility?: Visibility;
  /** Optional colour-free grouping label used by the capture engine + filters. */
  domain?: string;
  source: CaptureSource;
}

export interface JournalEntry extends RecordMeta {
  /** Optional but usually useful; capture proposes one, users can clear it. */
  title: string;
  /**
   * The user's own words. Markdown subset. Never rewritten by Chronicle:
   * derived summaries live in `summary`, never here.
   */
  body: string;
  summary?: string;
  type: EntryType;
  /** When the documented event actually happened (≠ created_at). */
  occurred_at: IsoDateTime;
  occurred_precision: DatePrecision;
  occurred_source: DateSource;
  project_id?: string | null;
  tags: string[];
  /** Explicit evidence claim for this entry; defaults to `concept`. */
  evidence_level: EvidenceLevel;
  evidence: EvidenceRef[];
  /** Manually or automatically curated links to related entries. */
  related_entry_ids: string[];
  milestone_id?: string | null;
  /**
   * Chapter and path memberships (V0.2). Absent on V0.1 records, which read as
   * empty. Stored on the experience because an experience belongs to at most a
   * few chapters and paths; *suggested* links between arbitrary records live in
   * `MemoryLink` instead and never appear here until approved.
   */
  links?: ExperienceLinks;
  /**
   * Audience for this experience. Absent on V0.1 records, which are read as
   * `'private'`. The legacy `private` boolean keeps its original meaning
   * (excluded from AI context and from shared exports) and is kept in sync with
   * visibility for older code paths.
   */
  visibility?: Visibility;
  private: boolean;
  timezone?: TimeZoneId;
  pinned?: boolean;
  source: CaptureSource;
  derived?: DerivedFields;
}

export interface Milestone extends RecordMeta {
  title: string;
  description?: string;
  /** Calendar date of the milestone (planned or achieved). */
  date: IsoDate;
  date_precision: DatePrecision;
  project_id?: string | null;
  status: MilestoneStatus;
  /**
   * `planned` milestones are goals; `achieved` ones are claims that still carry
   * a separate `verification` value so "it worked once" is never presented as
   * "it is proven".
   */
  verification: VerificationStatus;
  evidence: EvidenceRef[];
  entry_ids: string[];
  tags: string[];
  source: CaptureSource;
  derived?: DerivedFields;
}

export interface Task extends RecordMeta {
  title: string;
  description?: string;
  project_id?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  /** `null` means "no date was stated" — never silently defaulted to today. */
  due_on?: IsoDate | null;
  due_precision: DatePrecision;
  completed_at?: IsoDateTime | null;
  tags: string[];
  /** Entry that produced this task, when it came from conversational capture. */
  source_entry_id?: string | null;
  source: CaptureSource;
  derived?: DerivedFields;
}

/**
 * An immutable snapshot of an entry's editable content, taken when the content
 * actually changes. Lets Chronicle correct history without pretending the
 * earlier understanding never existed (§15).
 */
export interface Revision extends RecordMeta {
  entry_id: string;
  title: string;
  body: string;
  summary?: string;
  reason?: string;
  saved_by: 'user' | 'capture' | 'import';
  /** Size guard: revisions are capped per entry (see `data/revisions.ts`). */
}

/** Application settings, persisted in the `meta` table. */
export interface AiSettings {
  /** Off by default. Enabling it must be an explicit, disclosed choice. */
  enabled: boolean;
  provider: 'none' | 'http';
  endpoint: string;
  model: string;
  /** Never send entries marked private, even when AI is enabled. */
  allow_private: boolean;
  /** ISO timestamp of when the user acknowledged the disclosure. */
  disclosure_acknowledged_at: IsoDateTime | null;
}

export interface AppSettings {
  schema_version: number;
  theme: 'system' | 'light' | 'dark';
  capture_mode: 'quick' | 'review' | 'autonomous';
  /** `device` follows the platform; otherwise an explicit IANA identifier. */
  timezone: TimeZoneId | 'device';
  /** Reduce animated transitions (also honours the OS preference). */
  reduce_motion: boolean;
  /** Show the desktop sidebar persistently. */
  sidebar_pinned: boolean;
  ai: AiSettings;
  onboarded: boolean;
  app_version: string;
}

/** The V0.1 record collections. */
export interface ChronicleRecords {
  projects: Project[];
  entries: JournalEntry[];
  milestones: Milestone[];
  tasks: Task[];
  revisions: Revision[];
}

/**
 * The life-archive collections added in V0.2.
 *
 * Declared before `RecordKind` so that a single kind union (and therefore one
 * import/export/delete pipeline) covers every record the archive can hold.
 */
/** The set of record collections that make up a complete Chronicle archive. */
export interface ChronicleLifeRecords extends ChronicleRecords, LifeRecords {}

export type RecordKind = keyof ChronicleLifeRecords;

export const RECORD_KINDS: readonly RecordKind[] = [
  'projects',
  'entries',
  'milestones',
  'tasks',
  'revisions',
  'chapters',
  'paths',
  'places',
  'people',
  'trips',
  'collections',
  'links'
];

/** The life-archive subset, in display order. */
export const LIFE_RECORD_KINDS = [
  'chapters',
  'paths',
  'places',
  'people',
  'trips',
  'collections',
  'links'
] as const satisfies readonly RecordKind[];

export type LifeRecordKind = (typeof LIFE_RECORD_KINDS)[number];

/** True for a kind added in V0.2; lets old records export byte-identically. */
export function isLifeRecordKind(kind: RecordKind): kind is LifeRecordKind {
  return (LIFE_RECORD_KINDS as readonly string[]).includes(kind);
}

/* ===========================================================================
   Life archive (V0.2) — chapters, paths, places, people, trips, collections
   ---------------------------------------------------------------------------
   Every record below follows the same conventions as the V0.1 records above:
   stable ULID ids, `RecordMeta`, UTC timestamps, snake_case fields, an `extras`
   bag for forward compatibility, and a `visibility` value that is *private* by
   default.

   Three rules are encoded in the types rather than in prose:

   1. **Nothing optional is required to be known.** A place needs a name; a
      chapter needs a name; every other field may be missing and the record is
      still valid.
   2. **Uncertainty is a value, not a gap.** `*_precision` fields carry how well
      a date is known, and `date_hint` carries a user-approved phrase such as
      "summer 2019" for eras whose exact dates are not known.
   3. **Suggestions are not records.** `MemoryLink.status` starts at
      `'suggested'`; only an explicit user approval turns a proposed connection
      into part of the archive. There is no code path that promotes a
      suggestion implicitly.
   =========================================================================== */

/**
 * Who a record is visible to.
 *
 * V0.2 implements `'private'` end to end and treats `'circles'` / `'public'`
 * as *declared future intent*: they can be stored on a record, but no code
 * path produces a public projection yet, and the UI says so in words. Nothing
 * in this build publishes, uploads or shares anything.
 */
export const VISIBILITIES = ['private', 'circles', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Visibility values this build can actually honour for shared output. */
export const IMPLEMENTED_VISIBILITIES: readonly Visibility[] = ['private'];

/** Where a link between two records came from. */
export const LINK_ORIGINS = ['user', 'suggested'] as const;
export type LinkOrigin = (typeof LINK_ORIGINS)[number];

/**
 * A link's lifecycle. A link is only part of the archive when approved:
 * - `suggested` — proposed by Chronicle, shown in a separate list, never drawn
 *   as a real connection on the Life Map and never included in exports of the
 *   archive's connections.
 * - `confirmed` — approved by the user (the default for links a person makes).
 * - `rejected` — the user declined the suggestion. Kept so Chronicle does not
 *   re-suggest the same link on every visit.
 */
export const MEMORY_LINK_STATUSES = ['suggested', 'confirmed', 'rejected'] as const;
export type MemoryLinkStatus = (typeof MEMORY_LINK_STATUSES)[number];

/** The record kinds a memory link may point from or to. */
export const MEMORY_NODE_KINDS = [
  'entry',
  'chapter',
  'path',
  'place',
  'person',
  'trip',
  'collection'
] as const;
export type MemoryNodeKind = (typeof MEMORY_NODE_KINDS)[number];

/** The kinds of thing a path can point at. */
export const PATH_TARGET_KINDS = ['entry', 'chapter', 'milestone', 'project', 'interest'] as const;
export type PathTargetKind = (typeof PATH_TARGET_KINDS)[number];

export const PROJECT_LINK_KINDS = ['project', 'interest'] as const;
export type ProjectLinkKind = (typeof PROJECT_LINK_KINDS)[number];

/** How a place was associated with a memory. Provenance for locations. */
export const PLACE_SOURCES = ['user', 'import'] as const;
export type PlaceSource = (typeof PLACE_SOURCES)[number];

/**
 * A single place the user has written down.
 *
 * Deliberately *not* a geocoded location: V0.2 stores no coordinates and calls
 * no maps service. `region` is free text ("Tamil Nadu", "Kyoto") and `kind`
 * describes what sort of place it is in the user's own terms. A person's home
 * is not a special value here — the UI never infers or displays one.
 */
export interface Place extends RecordMeta {
  name: string;
  /** Region, city or country as the user wrote it. Optional. */
  region?: string;
  kind: 'city' | 'region' | 'country' | 'venue' | 'landmark' | 'other';
  /** One sentence the user wrote about the place. Optional. */
  notes?: string;
  /** Colour-free grouping label, mirrored by `domain` on projects. */
  domain?: string;
  /** Kept for parity with every other record; places are never shared alone. */
  visibility: Visibility;
  source: { kind: 'manual' | 'import'; capture_id?: string };
}

/** Someone the user shared an experience with, as the user named them. */
export interface Person extends RecordMeta {
  name: string;
  /** How the user knows them ("college friend"). Optional, user-authored. */
  relationship?: string;
  notes?: string;
  /** Recorded only when the user asks to remember it; used for sensitive-flagging. */
  sensitive?: boolean;
  visibility: Visibility;
  source: { kind: 'manual' | 'import'; capture_id?: string };
}

/** A trip groups places, dates and (optionally) confirmation details. */
export interface Trip extends RecordMeta {
  name: string;
  description?: string;
  start_date?: IsoDate | null;
  end_date?: IsoDate | null;
  date_precision: DatePrecision;
  /** Free-text span for trips whose dates are known only roughly. */
  date_hint?: string;
  place_ids: string[];
  /**
   * Confirmation numbers and booking references. Sensitive by default:
   * excluded from every share preview, never rendered in lists, never logged,
   * and only shown behind an explicit "show" control on the trip page.
   */
  sensitive_notes?: string;
  visibility: Visibility;
  source: { kind: 'manual' | 'import'; capture_id?: string };
}

/** A user-named era. Deleting a chapter never deletes its experiences. */
export interface Chapter extends RecordMeta {
  name: string;
  description?: string;
  start_date?: IsoDate | null;
  end_date?: IsoDate | null;
  date_precision: DatePrecision;
  /** A user-approved phrase such as "First year of college". */
  date_hint?: string;
  /** Visual treatment key; the map and cards map this to token colours. */
  accent: 'ink' | 'moss' | 'clay' | 'plum' | 'sand';
  /** Archived chapters stay in the archive but are not offered for new links. */
  status: 'open' | 'archived';
  visibility: Visibility;
  source: { kind: 'manual' | 'import'; capture_id?: string };
}

/** A goal, hope, plan or ongoing interest the user wants to remember. */
export interface Path extends RecordMeta {
  title: string;
  description?: string;
  start_date?: IsoDate | null;
  desired_date?: IsoDate | null;
  /**
   * `changed` is a respectful outcome, not a failure: the plan moved on. Chronicle
   * never infers a state change from dates or entry text.
   */
  state: 'active' | 'paused' | 'completed' | 'changed';
  /** Optional one-line note shown alongside a paused/completed/changed state. */
  state_note?: string;
  tags: string[];
  targets: PathTarget[];
  visibility: Visibility;
  source: { kind: 'manual' | 'import'; capture_id?: string };
}

export interface PathTarget {
  kind: PathTargetKind;
  /** Id of an entry, chapter, milestone, project, or a free-text interest label. */
  ref: string;
  /** For `interest`, a label the user wrote ("woodworking"). */
  label?: string;
}

/** A trip-like grouping of experiences that the user chose to curate. */
export interface Collection extends RecordMeta {
  name: string;
  description?: string;
  entry_ids: string[];
  visibility: Visibility;
  source: { kind: 'manual' | 'import'; capture_id?: string };
}

/**
 * An explicit connection between two records, or a proposed one.
 *
 * Identity rule: a link is undirected in meaning but stored directed
 * (`from` → `to`) with the origin record as `from`, so "this entry is part of
 * that chapter" reads correctly. Duplicate detection compares the unordered
 * pair.
 */
export interface MemoryLink extends RecordMeta {
  from_kind: MemoryNodeKind;
  from_id: string;
  to_kind: MemoryNodeKind;
  to_id: string;
  status: MemoryLinkStatus;
  origin: LinkOrigin;
  /** How the link is described to the user ("part of", "with", "about"). */
  role: string;
  /** Why the suggestion was made; shown verbatim in the review list. */
  rationale?: string;
}

/** A record that can take part in a memory link. */
export type MemoryRecord = JournalEntry | Chapter | Path | Place | Person | Trip | Collection;

export interface LifeRecords {
  chapters: Chapter[];
  paths: Path[];
  places: Place[];
  people: Person[];
  trips: Trip[];
  collections: Collection[];
  links: MemoryLink[];
}

/**
 * Chapters, paths and links joined on to a stored experience by the archive
 * layer. Kept on the entry record so that capture, editing and the Life Map all
 * read one consistent view.
 */
export interface ExperienceLinks {
  chapter_ids: string[];
  path_ids: string[];
}

