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

/** The set of record collections that make up a Chronicle archive. */
export interface ChronicleRecords {
  projects: Project[];
  entries: JournalEntry[];
  milestones: Milestone[];
  tasks: Task[];
  revisions: Revision[];
}

export type RecordKind = keyof ChronicleRecords;

export const RECORD_KINDS: readonly RecordKind[] = [
  'projects',
  'entries',
  'milestones',
  'tasks',
  'revisions'
];
