/**
 * Record factories.
 *
 * Every record is created through these functions so that defaults,
 * identifiers and timestamps are consistent no matter whether the record came
 * from a form, the conversational capture engine, an import or a test.
 */

import { createIdFactory } from './ids';
import { nowIso, resolveTimeZone, todayIso, zonedTimeToUtc } from './time';
import type {
  CaptureSource,
  DatePrecision,
  DateSource,
  DerivedFields,
  EvidenceLevel,
  EvidenceRef,
  EvidenceRefKind,
  IsoDate,
  IsoDateTime,
  JournalEntry,
  Milestone,
  Project,
  RecordMeta,
  Revision,
  Task,
  TimeZoneId,
  VerificationStatus
} from './types';

/** Ambient context for record creation; injectable so tests are deterministic. */
export interface RecordContext {
  now?: () => IsoDateTime;
  timezone?: TimeZoneId;
  newId?: () => string;
}

const sharedIdFactory = createIdFactory();

export function resolveContext(context: RecordContext = {}): {
  nowIso: () => IsoDateTime;
  timezone: TimeZoneId;
  newId: () => string;
} {
  return {
    nowIso: context.now ?? nowIso,
    timezone: resolveTimeZone(context.timezone),
    newId: context.newId ?? sharedIdFactory
  };
}

export function newMeta(context: RecordContext = {}): RecordMeta {
  const { nowIso: now, newId } = resolveContext(context);
  const stamp = now();
  return { id: newId(), created_at: stamp, updated_at: stamp, rev: 1 };
}

export function newEvidenceRef(
  kind: EvidenceRefKind,
  fields: Partial<Omit<EvidenceRef, 'id' | 'kind' | 'created_at'>> = {},
  context: RecordContext = {}
): EvidenceRef {
  const { nowIso: now, newId } = resolveContext(context);
  return {
    id: newId(),
    kind,
    verification: fields.verification ?? 'claimed',
    created_at: now(),
    ...(fields.location !== undefined ? { location: fields.location } : {}),
    ...(fields.description !== undefined ? { description: fields.description } : {}),
    ...(fields.checksum !== undefined ? { checksum: fields.checksum } : {})
  };
}

/* ------------------------------------------------------------------ *
 * Project
 * ------------------------------------------------------------------ */

export type ProjectInput = Partial<
  Pick<
    Project,
    | 'name'
    | 'summary'
    | 'objectives'
    | 'status'
    | 'stage'
    | 'started_on'
    | 'target_date'
    | 'tags'
    | 'aliases'
    | 'linked_project_ids'
    | 'privacy'
    | 'domain'
  >
> & { source?: CaptureSource; id?: string };

export function createProject(input: ProjectInput, context: RecordContext = {}): Project {
  const meta = newMeta(context);
  return {
    ...meta,
    ...(input.id ? { id: input.id } : {}),
    name: (input.name ?? 'Untitled project').trim(),
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.objectives !== undefined ? { objectives: input.objectives } : {}),
    status: input.status ?? 'idea',
    stage: input.stage ?? 'concept',
    // Never invent a start date: "started today" would be a fabricated fact.
    started_on: input.started_on ?? null,
    target_date: input.target_date ?? null,
    tags: input.tags ?? [],
    aliases: input.aliases ?? [],
    linked_project_ids: input.linked_project_ids ?? [],
    privacy: input.privacy ?? 'private',
    ...(input.domain !== undefined ? { domain: input.domain } : {}),
    source: input.source ?? { kind: 'manual' }
  };
}

/* ------------------------------------------------------------------ *
 * Journal entry
 * ------------------------------------------------------------------ */

export type EntryInput = Partial<
  Pick<
    JournalEntry,
    | 'title'
    | 'body'
    | 'summary'
    | 'type'
    | 'occurred_at'
    | 'occurred_precision'
    | 'occurred_source'
    | 'project_id'
    | 'tags'
    | 'evidence_level'
    | 'evidence'
    | 'related_entry_ids'
    | 'milestone_id'
    | 'private'
    | 'timezone'
    | 'pinned'
  >
> & { source?: CaptureSource; derived?: DerivedFields; created_at?: IsoDateTime; id?: string };

export function createEntry(input: EntryInput, context: RecordContext = {}): JournalEntry {
  const { timezone } = resolveContext(context);
  const meta = newMeta(context);
  const occurredAt = input.occurred_at ?? meta.created_at;
  const entryTimezone = input.timezone ?? timezone;
  return {
    ...meta,
    ...(input.id ? { id: input.id } : {}),
    ...(input.created_at ? { created_at: input.created_at } : {}),
    title: input.title ?? '',
    body: input.body ?? '',
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    type: input.type ?? 'note',
    occurred_at: occurredAt,
    occurred_precision: input.occurred_precision ?? 'exact',
    occurred_source: input.occurred_source ?? 'capture_time',
    project_id: input.project_id ?? null,
    tags: input.tags ?? [],
    evidence_level: input.evidence_level ?? 'concept',
    evidence: input.evidence ?? [],
    related_entry_ids: input.related_entry_ids ?? [],
    milestone_id: input.milestone_id ?? null,
    private: input.private ?? false,
    timezone: entryTimezone,
    pinned: input.pinned ?? false,
    source: input.source ?? { kind: 'manual' },
    ...(input.derived ? { derived: input.derived } : {})
  };
}

/* ------------------------------------------------------------------ *
 * Milestone
 * ------------------------------------------------------------------ */

export type MilestoneInput = Partial<
  Pick<
    Milestone,
    | 'title'
    | 'description'
    | 'date'
    | 'date_precision'
    | 'project_id'
    | 'status'
    | 'verification'
    | 'evidence'
    | 'entry_ids'
    | 'tags'
  >
> & { source?: CaptureSource; derived?: DerivedFields; id?: string };

export function createMilestone(input: MilestoneInput, context: RecordContext = {}): Milestone {
  const { timezone } = resolveContext(context);
  const meta = newMeta(context);
  const date = input.date ?? todayIso(timezone);
  return {
    ...meta,
    ...(input.id ? { id: input.id } : {}),
    title: input.title ?? 'Untitled milestone',
    ...(input.description !== undefined ? { description: input.description } : {}),
    date,
    date_precision: input.date_precision ?? 'day',
    project_id: input.project_id ?? null,
    status: input.status ?? 'planned',
    verification: input.verification ?? 'claimed',
    evidence: input.evidence ?? [],
    entry_ids: input.entry_ids ?? [],
    tags: input.tags ?? [],
    source: input.source ?? { kind: 'manual' }
  };
}

/* ------------------------------------------------------------------ *
 * Task
 * ------------------------------------------------------------------ */

export type TaskInput = Partial<
  Pick<
    Task,
    | 'title'
    | 'description'
    | 'project_id'
    | 'status'
    | 'priority'
    | 'due_on'
    | 'due_precision'
    | 'completed_at'
    | 'tags'
    | 'source_entry_id'
  >
> & { source?: CaptureSource; derived?: DerivedFields; id?: string };

export function createTask(input: TaskInput, context: RecordContext = {}): Task {
  const meta = newMeta(context);
  return {
    ...meta,
    ...(input.id ? { id: input.id } : {}),
    title: input.title ?? 'Untitled task',
    ...(input.description !== undefined ? { description: input.description } : {}),
    project_id: input.project_id ?? null,
    status: input.status ?? 'todo',
    priority: input.priority ?? 'normal',
    due_on: input.due_on ?? null,
    due_precision: input.due_precision ?? (input.due_on ? 'day' : 'unknown'),
    completed_at: input.completed_at ?? null,
    tags: input.tags ?? [],
    source_entry_id: input.source_entry_id ?? null,
    source: input.source ?? { kind: 'manual' },
    ...(input.derived ? { derived: input.derived } : {})
  };
}

/* ------------------------------------------------------------------ *
 * Revision
 * ------------------------------------------------------------------ */

export function createRevision(
  entry: Pick<JournalEntry, 'id' | 'title' | 'body' | 'summary'>,
  savedBy: Revision['saved_by'],
  reason: string | undefined,
  context: RecordContext = {}
): Revision {
  return {
    ...newMeta(context),
    entry_id: entry.id,
    title: entry.title,
    body: entry.body,
    ...(entry.summary !== undefined ? { summary: entry.summary } : {}),
    ...(reason ? { reason } : {}),
    saved_by: savedBy
  };
}

/**
 * Convert a local calendar date + wall-clock time into a UTC instant, keeping
 * the precision the user actually stated.
 */
export function localDateTimeToIso(
  date: IsoDate,
  time: string | null | undefined,
  timezone: TimeZoneId
): { instant: IsoDateTime; precision: DatePrecision; source: DateSource } {
  if (!time) {
    return { instant: zonedTimeToUtc(date, 12, 0, timezone), precision: 'day', source: 'user' };
  }
  const parts = time.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const hour = Number.isFinite(h) ? h : 12;
  const minute = Number.isFinite(m) ? m : 0;
  return {
    instant: zonedTimeToUtc(date, hour, minute, timezone),
    precision: 'exact',
    source: 'user'
  };
}

export const EVIDENCE_ORDER: readonly EvidenceLevel[] = [
  'concept',
  'researched',
  'designed',
  'implemented',
  'tested',
  'verified',
  'deployed'
];

export function evidenceRank(level: EvidenceLevel): number {
  return Math.max(0, EVIDENCE_ORDER.indexOf(level));
}

/**
 * Evidence may only move *up* with an explicit decision; moving down is always
 * allowed (a correction that reduces a claim is a safe operation).
 */
export function canAdvanceEvidence(
  current: EvidenceLevel,
  proposed: EvidenceLevel
): { allowed: boolean; requiresEvidence: boolean } {
  const from = evidenceRank(current);
  const to = evidenceRank(proposed);
  if (to <= from) return { allowed: true, requiresEvidence: false };
  // Jumping to `verified` or `deployed` always needs supporting evidence.
  return { allowed: true, requiresEvidence: proposed === 'verified' || proposed === 'deployed' };
}

export const VERIFICATION_ORDER: readonly VerificationStatus[] = [
  'claimed',
  'supported',
  'verified',
  'disputed'
];

/** Precision-aware date label source used by the timeline. */
export function precisionFromSource(source: DateSource, precision: DatePrecision): DatePrecision {
  if (source === 'capture_time') return 'exact';
  return precision;
}
