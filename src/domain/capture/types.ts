/**
 * Types for the conversational capture engine (§28).
 *
 * The engine is a pipeline that turns one natural-language paragraph into a
 * `CaptureProposal`: a small, reviewable set of record operations. Nothing is
 * written to storage until the proposal is committed, and every proposal keeps
 * the user's original text verbatim.
 */

import type { EntryInput, MilestoneInput, TaskInput } from '../factories';
import type {
  DatePrecision,
  DateSource,
  EntryType,
  EvidenceLevel,
  IsoDate,
  IsoDateTime,
  JournalEntry,
  Milestone,
  Project,
  Task,
  TimeZoneId
} from '../types';

export type CaptureMode = 'quick' | 'review' | 'autonomous';

export const CAPTURE_MODES: readonly CaptureMode[] = ['quick', 'review', 'autonomous'];

/** A project the text appears to be about. */
export interface ProjectMatch {
  project_id: string;
  name: string;
  /** The exact phrase that produced the match. */
  phrase: string;
  confidence: number;
}

export interface Measurement {
  /** Verbatim fragment, e.g. "Design B used 4.2 W". */
  text: string;
  value?: number;
  unit?: string;
  subject?: string;
  /** True when the text explicitly says the measurement is missing. */
  missing?: boolean;
}

export type ClarificationReason =
  | 'date'
  | 'project'
  | 'duplicate'
  | 'verification'
  | 'scope'
  | 'correction';

export interface Clarification {
  id: string;
  reason: ClarificationReason;
  question: string;
  /** Short answer options; empty means a free-form answer is expected. */
  options: { label: string; value: string }[];
}

/** Everything Chronicle understood (or deliberately did not assume). */
export interface Understanding {
  title?: string;
  summary?: string;
  type: EntryType;
  type_confidence: number;
  project: ProjectMatch | null;
  project_candidates: ProjectMatch[];
  tags: string[];
  occurred_at: IsoDateTime;
  occurred_precision: DatePrecision;
  occurred_source: DateSource;
  temporal_phrase?: string;
  temporal_confidence: number;
  temporal_ambiguity?: string;
  /** True when the text reads as personal rather than technical. */
  is_personal: boolean;
  /** True when the claim is tentative ("probably", "seems", "I think"). */
  hedged: boolean;
  tentative_phrases: string[];
  /**
   * Never above what the text supports. "It works now" → `implemented` or
   * `tested` at most; only explicit verification language reaches `verified`,
   * and even then it stays a *claim* until evidence is attached.
   */
  evidence_level: EvidenceLevel;
  completed: string[];
  problems: string[];
  discoveries: string[];
  decisions: string[];
  measurements: Measurement[];
  reflections: string[];
  durations: { phrase: string; minutes: number }[];
  questions: Clarification[];
  /** Honest notices surfaced in the review panel. */
  notes: string[];
}

/** A change to an existing record, produced by an interactive correction. */
export interface RecordUpdate {
  target_kind: 'entries' | 'tasks' | 'milestones' | 'projects';
  target_id: string;
  /** Human-readable name so the review panel can show what will change. */
  target_label: string;
  explanation: string;
  changes: {
    project_id?: string | null;
    occurred_at?: IsoDateTime;
    occurred_precision?: DatePrecision;
    occurred_source?: DateSource;
    date?: IsoDate;
    due_on?: IsoDate | null;
    title?: string;
    tags?: string[];
    type?: EntryType;
    status?: Task['status'] | Milestone['status'] | Project['status'];
    private?: boolean;
  };
}

export interface ProposedEntry {
  key: string;
  kind: 'entry';
  include: boolean;
  confidence: number;
  reason?: string;
  entry: EntryInput & { title: string; body: string };
}

export interface ProposedTask {
  key: string;
  kind: 'task';
  include: boolean;
  confidence: number;
  reason?: string;
  /** Existing task id when a near-duplicate was found (never auto-created). */
  duplicate_of?: string;
  duplicate_title?: string;
  task: TaskInput;
}

export interface ProposedMilestone {
  key: string;
  kind: 'milestone';
  include: boolean;
  confidence: number;
  reason?: string;
  duplicate_of?: string;
  duplicate_title?: string;
  milestone: MilestoneInput;
}

export interface ProposedUpdate {
  key: string;
  kind: 'update';
  include: boolean;
  confidence: number;
  reason?: string;
  update: RecordUpdate;
}

export type ProposedRecord = ProposedEntry | ProposedTask | ProposedMilestone | ProposedUpdate;

export interface ProposalIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

/** A reviewable unit of work. Committing it is atomic and idempotent. */
export interface CaptureProposal {
  /** Idempotency key: derived from the input + submission time (§28.13). */
  capture_id: string;
  /** Verbatim user input. Never modified by the engine. */
  input: string;
  created_at: IsoDateTime;
  mode: CaptureMode;
  timezone: TimeZoneId;
  analyzer: 'local' | 'remote';
  provider?: string;
  model?: string;
  understanding: Understanding;
  records: ProposedRecord[];
  /** True when the user must confirm before anything is written. */
  requires_review: boolean;
  issues: ProposalIssue[];
}

export interface CaptureContext {
  now: Date;
  timezone: TimeZoneId;
  mode: CaptureMode;
  /** Targeted context only — never the whole archive (§28.14). */
  projects: Project[];
  recentEntries: JournalEntry[];
  openTasks: Task[];
  recentMilestones: Milestone[];
  existingTags: string[];
  /** Project the user was last looking at, if any. */
  activeProjectId?: string | null;
  /** The most recent commit, so corrections can find their target (§28.8). */
  lastCommit?: LastCommit | null;
}

export interface LastCommit {
  capture_id: string;
  committed_at: IsoDateTime;
  input: string;
  entryIds: string[];
  taskIds: string[];
  milestoneIds: string[];
  updatedIds: string[];
}

export interface CommitResult {
  ok: boolean;
  capture_id: string;
  /** True when this capture_id had already been committed (retry). */
  duplicate: boolean;
  created: { entries: string[]; tasks: string[]; milestones: string[] };
  updated: { kind: string; id: string; label: string }[];
  skipped: { key: string; reason: string }[];
  errors: { key: string; message: string }[];
  committed_at: IsoDateTime;
}
