/**
 * Validation and normalisation for untrusted record data.
 *
 * Used in three places:
 * 1. **Import** — a user-supplied archive must be validated before anything is
 *    written to the database (§16, §17).
 * 2. **Remote capture output** — model responses are treated as hostile input
 *    and must survive the same checks (§28.12).
 * 3. **Storage writes** — a final guard so a programming error cannot persist
 *    a record that breaks the schema.
 *
 * Design notes:
 * - Unknown fields are preserved in `extras` rather than dropped, so importing
 *   an archive written by a newer version of Chronicle does not silently lose
 *   data.
 * - Problems are reported as `errors` (record rejected) or `warnings`
 *   (record repaired). Callers decide what to do with warnings.
 * - No third-party schema library: the rules are small, the bundle is not.
 */

import { createId, isValidId } from './ids';
import { isValidIsoDate, isValidIsoDateTime, isValidTimeZone } from './time';
import { normalizeTags } from './text';
import {
  DATE_PRECISIONS,
  LINK_ORIGINS,
  MEMORY_LINK_STATUSES,
  MEMORY_NODE_KINDS,
  PATH_TARGET_KINDS,
  VISIBILITIES,
  DATE_SOURCES,
  ENTRY_TYPES,
  EVIDENCE_LEVELS,
  EVIDENCE_REF_KINDS,
  MILESTONE_STATUSES,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  VERIFICATION_STATUSES
} from './types';
import type {
  CaptureSource,
  Chapter,
  Collection,
  DatePrecision,
  DateSource,
  DerivedFields,
  EntryType,
  EvidenceLevel,
  EvidenceRef,
  EvidenceRefKind,
  IsoDate,
  IsoDateTime,
  JournalEntry,
  MemoryLink,
  Milestone,
  MilestoneStatus,
  Path,
  PathTarget,
  Person,
  Place,
  Project,
  ProjectStatus,
  RecordMeta,
  Revision,
  Task,
  TaskPriority,
  TaskStatus,
  Trip,
  VerificationStatus,
  Visibility
} from './types';

export interface Issue {
  path: string;
  message: string;
}

export interface ParseResult<T> {
  ok: boolean;
  value: T | null;
  errors: Issue[];
  warnings: Issue[];
}

/** Values this build of Chronicle understands; used for archive compatibility. */
export const SCHEMA_VERSION = 1;
export const ARCHIVE_FORMAT = 'chronicle.archive';

export function ok<T>(value: T, warnings: Issue[] = []): ParseResult<T> {
  return { ok: true, value, errors: [], warnings };
}

export function fail<T>(errors: Issue[], warnings: Issue[] = []): ParseResult<T> {
  return { ok: false, value: null, errors, warnings };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ *
 * Primitive coercion helpers
 * ------------------------------------------------------------------ */

function join(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key);
}

function asString(
  raw: unknown,
  path: string,
  errors: Issue[],
  warnings: Issue[],
  fallback: string,
  required = false
): string {
  if (typeof raw === 'string') return raw;
  if (raw === undefined || raw === null) {
    if (required) errors.push({ path, message: 'required string is missing' });
    return fallback;
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    warnings.push({ path, message: `coerced ${typeof raw} to string` });
    return String(raw);
  }
  errors.push({ path, message: `expected a string, received ${describe(raw)}` });
  return fallback;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

function asOptionalString(raw: unknown, path: string, errors: Issue[], warnings: Issue[]): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    warnings.push({ path, message: `coerced ${typeof raw} to string` });
    return String(raw);
  }
  errors.push({ path, message: `expected a string, received ${describe(raw)}` });
  return undefined;
}

function asBoolean(raw: unknown, fallback: boolean, path: string, warnings: Issue[]): boolean {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === 1) return true;
  if (raw === 'false' || raw === 0) return false;
  warnings.push({ path, message: `expected a boolean, using ${fallback}` });
  return fallback;
}

function asEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
  path: string,
  warnings: Issue[]
): T {
  if (typeof raw !== 'string') {
    if (raw !== undefined && raw !== null) {
      warnings.push({ path, message: `expected one of ${allowed.join(', ')}, using "${fallback}"` });
    }
    return fallback;
  }
  const normalized = raw.trim().toLowerCase() as T;
  if (allowed.includes(normalized)) return normalized;
  warnings.push({ path, message: `unknown value "${raw}", using "${fallback}"` });
  return fallback;
}

function asStringArray(raw: unknown, path: string, errors: Issue[], warnings: Issue[]): string[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw === 'string') {
    warnings.push({ path, message: 'coerced a single string to a list' });
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }
  if (!Array.isArray(raw)) {
    errors.push({ path, message: `expected a list, received ${describe(raw)}` });
    return [];
  }
  const out: string[] = [];
  raw.forEach((item, index) => {
    if (typeof item === 'string') out.push(item);
    else warnings.push({ path: join(path, index), message: `skipped non-string item (${describe(item)})` });
  });
  return out;
}

function asIsoDateTime(
  raw: unknown,
  path: string,
  errors: Issue[],
  warnings: Issue[],
  fallback: IsoDateTime
): IsoDateTime {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    warnings.push({ path, message: 'coerced epoch milliseconds to an ISO timestamp' });
    return new Date(raw).toISOString();
  }
  if (typeof raw !== 'string') {
    errors.push({ path, message: `expected an ISO timestamp, received ${describe(raw)}` });
    return fallback;
  }
  if (isValidIsoDateTime(raw)) return new Date(raw).toISOString();
  // Tolerate a naive local timestamp only if it parses; flag it.
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    warnings.push({ path, message: 'timestamp had no timezone designator; interpreted as UTC' });
    return parsed.toISOString();
  }
  errors.push({ path, message: `"${String(raw).slice(0, 40)}" is not a valid timestamp` });
  return fallback;
}

function asIsoDate(
  raw: unknown,
  path: string,
  errors: Issue[],
  warnings: Issue[],
  fallback: IsoDate | null
): IsoDate | null {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string') {
    errors.push({ path, message: `expected a YYYY-MM-DD date, received ${describe(raw)}` });
    return fallback;
  }
  if (isValidIsoDate(raw)) return raw;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const iso = parsed.toISOString().slice(0, 10);
    warnings.push({ path, message: `normalised "${raw}" to ${iso}` });
    return iso;
  }
  errors.push({ path, message: `"${String(raw).slice(0, 40)}" is not a valid date` });
  return fallback;
}

function asInteger(
  raw: unknown,
  path: string,
  warnings: Issue[],
  fallback: number,
  min = 0
): number {
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    if (raw !== undefined && raw !== null) {
      warnings.push({ path, message: `expected a number, using ${fallback}` });
    }
    return fallback;
  }
  const rounded = Math.trunc(value);
  if (rounded < min) {
    warnings.push({ path, message: `value below minimum ${min}; clamped` });
    return min;
  }
  return rounded;
}

/* ------------------------------------------------------------------ *
 * Shared structures
 * ------------------------------------------------------------------ */

const KNOWN_META_KEYS = ['id', 'created_at', 'updated_at', 'rev', 'deleted_at'];

function asMeta(
  raw: Record<string, unknown>,
  path: string,
  errors: Issue[],
  warnings: Issue[],
  now: IsoDateTime
): RecordMeta {
  // An identifier is required for safe merging, but a record without one is
  // still worth keeping: assign a fresh id and say so, rather than discarding
  // the user's content. A foreign id is preserved verbatim so round-trips stay
  // stable even when it is not a Chronicle id.
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : raw.id === undefined || raw.id === null ? '' : String(raw.id);
  const finalId = rawId.length > 0 ? rawId : createId();
  if (rawId.length === 0) {
    warnings.push({ path: join(path, 'id'), message: 'no identifier; assigned a new Chronicle id' });
  } else if (!isValidId(finalId)) {
    warnings.push({ path: join(path, 'id'), message: 'identifier is not a Chronicle id but was preserved' });
  }
  const created = asIsoDateTime(raw.created_at, join(path, 'created_at'), errors, warnings, now);
  const updated = asIsoDateTime(raw.updated_at, join(path, 'updated_at'), errors, warnings, created);
  const meta: RecordMeta = {
    id: finalId,
    created_at: created,
    updated_at: updated < created ? created : updated,
    rev: asInteger(raw.rev, join(path, 'rev'), warnings, 1, 1)
  };
  const deleted = asOptionalString(raw.deleted_at, join(path, 'deleted_at'), errors, warnings);
  if (deleted && isValidIsoDateTime(deleted)) meta.deleted_at = deleted;
  return meta;
}

function asEvidenceRefs(raw: unknown, path: string, errors: Issue[], warnings: Issue[], now: IsoDateTime): EvidenceRef[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push({ path, message: `expected a list of evidence references, received ${describe(raw)}` });
    return [];
  }
  const out: EvidenceRef[] = [];
  raw.forEach((item, index) => {
    const itemPath = join(path, index);
    if (!isPlainObject(item)) {
      warnings.push({ path: itemPath, message: `skipped non-object evidence (${describe(item)})` });
      return;
    }
    const kind = asEnum<EvidenceRefKind>(item.kind, EVIDENCE_REF_KINDS, 'note', join(itemPath, 'kind'), warnings);
    const id = asString(item.id, join(itemPath, 'id'), errors, warnings, '');
    out.push({
      id: isValidId(id) ? id : createId(),
      kind,
      verification: asEnum<VerificationStatus>(
        item.verification,
        VERIFICATION_STATUSES,
        'claimed',
        join(itemPath, 'verification'),
        warnings
      ),
      created_at: asIsoDateTime(item.created_at, join(itemPath, 'created_at'), errors, warnings, now),
      ...(asOptionalString(item.location, join(itemPath, 'location'), errors, warnings) !== undefined
        ? { location: asOptionalString(item.location, join(itemPath, 'location'), errors, warnings) }
        : {}),
      ...(asOptionalString(item.description, join(itemPath, 'description'), errors, warnings) !== undefined
        ? { description: asOptionalString(item.description, join(itemPath, 'description'), errors, warnings) }
        : {}),
      ...(asOptionalString(item.checksum, join(itemPath, 'checksum'), errors, warnings) !== undefined
        ? { checksum: asOptionalString(item.checksum, join(itemPath, 'checksum'), errors, warnings) }
        : {})
    });
  });
  return out;
}

function asCaptureSource(raw: unknown, path: string, warnings: Issue[]): CaptureSource {
  if (!isPlainObject(raw)) return { kind: 'import' };
  const kind = raw.kind;
  const sourceKind: CaptureSource['kind'] =
    kind === 'manual' || kind === 'capture' || kind === 'import' || kind === 'seed' ? kind : 'import';
  const source: CaptureSource = { kind: sourceKind };
  const original = asOptionalString(raw.original_input, join(path, 'original_input'), [], warnings);
  if (original) source.original_input = original;
  if (raw.analyzer === 'local' || raw.analyzer === 'remote') source.analyzer = raw.analyzer;
  const provider = asOptionalString(raw.provider, join(path, 'provider'), [], warnings);
  if (provider) source.provider = provider;
  const model = asOptionalString(raw.model, join(path, 'model'), [], warnings);
  if (model) source.model = model;
  const captureId = asOptionalString(raw.capture_id, join(path, 'capture_id'), [], warnings);
  if (captureId) source.capture_id = captureId;
  return source;
}

function asDerived(raw: unknown): DerivedFields | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: DerivedFields = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') {
      (out as Record<string, boolean>)[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function collectExtras(raw: Record<string, unknown>, known: readonly string[]): Record<string, unknown> | undefined {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!known.includes(key)) extras[key] = value;
  }
  return Object.keys(extras).length > 0 ? extras : undefined;
}

/* ------------------------------------------------------------------ *
 * Entity parsers
 * ------------------------------------------------------------------ */

const PROJECT_KEYS = [
  ...KNOWN_META_KEYS,
  'name',
  'summary',
  'objectives',
  'status',
  'stage',
  'started_on',
  'target_date',
  'tags',
  'aliases',
  'linked_project_ids',
  'privacy',
  'domain',
  'source',
  'archived'
];

export function parseProject(raw: unknown, path = 'project', now: IsoDateTime = new Date().toISOString()): ParseResult<Project> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isPlainObject(raw)) {
    return fail<Project>([{ path, message: `expected an object, received ${describe(raw)}` }]);
  }
  const meta = asMeta(raw, path, errors, warnings, now);
  const name = asString(raw.name, join(path, 'name'), errors, warnings, '', true).trim();
  if (!name) errors.push({ path: join(path, 'name'), message: 'a project requires a non-empty name' });
  if (errors.length > 0) return fail<Project>(errors, warnings);

  const summary = asOptionalString(raw.summary, join(path, 'summary'), errors, warnings);
  const objectives = asOptionalString(raw.objectives, join(path, 'objectives'), errors, warnings);
  const domain = asOptionalString(raw.domain, join(path, 'domain'), errors, warnings);
  const status = asEnum<ProjectStatus>(raw.status, PROJECT_STATUSES, 'idea', join(path, 'status'), warnings);
  const archived = asBoolean(raw.archived, status === 'archived', join(path, 'archived'), warnings);
  const startedOn = asIsoDate(raw.started_on, join(path, 'started_on'), errors, warnings, null);
  const targetDate = asIsoDate(raw.target_date, join(path, 'target_date'), errors, warnings, null);
  const extras = collectExtras(raw, PROJECT_KEYS);
  if (extras) warnings.push({ path, message: `preserved ${Object.keys(extras).length} unknown field(s)` });

  const project: Project = {
    ...meta,
    name,
    status: archived && status !== 'archived' ? 'archived' : status,
    stage: asEnum<EvidenceLevel>(raw.stage, EVIDENCE_LEVELS, 'concept', join(path, 'stage'), warnings),
    started_on: startedOn,
    target_date: targetDate,
    tags: normalizeTags(asStringArray(raw.tags, join(path, 'tags'), errors, warnings)),
    aliases: asStringArray(raw.aliases, join(path, 'aliases'), errors, warnings).slice(0, 12),
    linked_project_ids: asStringArray(raw.linked_project_ids, join(path, 'linked_project_ids'), errors, warnings),
    privacy: asEnum<'private' | 'shareable'>(raw.privacy, ['private', 'shareable'], 'private', join(path, 'privacy'), warnings),
    source: asCaptureSource(raw.source, join(path, 'source'), warnings),
    ...(summary !== undefined ? { summary } : {}),
    ...(objectives !== undefined ? { objectives } : {}),
    ...(domain !== undefined ? { domain } : {}),
    ...(extras ? { extras } : {})
  };

  return errors.length > 0 ? fail<Project>(errors, warnings) : ok<Project>(project, warnings);
}

/**
 * Chapter/path membership on an experience. Absent means "no memberships",
 * which is exactly what a V0.1 entry has. Malformed entries are repaired to
 * empty lists with a warning rather than rejecting the user's words.
 */
function asExperienceLinks(raw: unknown, path: string, errors: Issue[], warnings: Issue[]) {
  if (raw === undefined || raw === null) return undefined;
  if (!isPlainObject(raw)) {
    warnings.push({ path, message: 'expected chapter/path links; treated as unfiled' });
    return undefined;
  }
  return {
    chapter_ids: unique(asStringArray(raw.chapter_ids, join(path, 'chapter_ids'), errors, warnings)),
    path_ids: unique(asStringArray(raw.path_ids, join(path, 'path_ids'), errors, warnings))
  };
}

const ENTRY_KEYS = [
  ...KNOWN_META_KEYS,
  'title',
  'body',
  'summary',
  'type',
  'occurred_at',
  'occurred_precision',
  'occurred_source',
  'project_id',
  'tags',
  'evidence_level',
  'evidence',
  'related_entry_ids',
  'milestone_id',
  'private',
  'timezone',
  'pinned',
  'source',
  'derived',
  'links',
  'visibility'
];

export function parseEntry(raw: unknown, path = 'entry', now: IsoDateTime = new Date().toISOString()): ParseResult<JournalEntry> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isPlainObject(raw)) {
    return fail<JournalEntry>([{ path, message: `expected an object, received ${describe(raw)}` }]);
  }
  const meta = asMeta(raw, path, errors, warnings, now);
  const body = asString(raw.body, join(path, 'body'), errors, warnings, '');
  const title = asString(raw.title, join(path, 'title'), errors, warnings, '').trim();
  if (!body && !title) {
    errors.push({ path, message: 'an entry requires a title or a body' });
  }
  if (errors.length > 0) return fail<JournalEntry>(errors, warnings);

  const summary = asOptionalString(raw.summary, join(path, 'summary'), errors, warnings);
  const timezoneRaw = asOptionalString(raw.timezone, join(path, 'timezone'), errors, warnings);
  // An unknown timezone is dropped rather than kept: presenting a fabricated
  // zone would misstate when something happened.
  const timezone = timezoneRaw && isValidTimeZone(timezoneRaw) ? timezoneRaw : undefined;
  const projectId = asOptionalString(raw.project_id, join(path, 'project_id'), errors, warnings);
  const milestoneId = asOptionalString(raw.milestone_id, join(path, 'milestone_id'), errors, warnings);
  const occurredAt = asIsoDateTime(raw.occurred_at, join(path, 'occurred_at'), errors, warnings, meta.created_at);
  const derived = asDerived(raw.derived);
  const extras = collectExtras(raw, ENTRY_KEYS);
  if (extras) warnings.push({ path, message: `preserved ${Object.keys(extras).length} unknown field(s)` });

  const entry: JournalEntry = {
    ...meta,
    title,
    body,
    ...(summary !== undefined ? { summary } : {}),
    type: asEnum<EntryType>(raw.type, ENTRY_TYPES, 'note', join(path, 'type'), warnings),
    occurred_at: occurredAt,
    occurred_precision: asEnum<DatePrecision>(
      raw.occurred_precision,
      DATE_PRECISIONS,
      'exact',
      join(path, 'occurred_precision'),
      warnings
    ),
    occurred_source: asEnum<DateSource>(
      raw.occurred_source,
      DATE_SOURCES,
      'capture_time',
      join(path, 'occurred_source'),
      warnings
    ),
    project_id: projectId ?? null,
    tags: normalizeTags(asStringArray(raw.tags, join(path, 'tags'), errors, warnings)),
    evidence_level: asEnum<EvidenceLevel>(
      raw.evidence_level,
      EVIDENCE_LEVELS,
      'concept',
      join(path, 'evidence_level'),
      warnings
    ),
    evidence: asEvidenceRefs(raw.evidence, join(path, 'evidence'), errors, warnings, now),
    related_entry_ids: asStringArray(raw.related_entry_ids, join(path, 'related_entry_ids'), errors, warnings),
    milestone_id: milestoneId ?? null,
    private: asBoolean(raw.private, false, join(path, 'private'), warnings),
    pinned: asBoolean(raw.pinned, false, join(path, 'pinned'), warnings),
    links: asExperienceLinks(raw.links, join(path, 'links'), errors, warnings),
    visibility: asVisibility(raw.visibility, join(path, 'visibility'), warnings),
    ...(timezone ? { timezone } : {}),
    source: asCaptureSource(raw.source, join(path, 'source'), warnings),
    ...(derived ? { derived } : {}),
    ...(extras ? { extras } : {})
  };

  return errors.length > 0 ? fail<JournalEntry>(errors, warnings) : ok<JournalEntry>(entry, warnings);
}

const MILESTONE_KEYS = [
  ...KNOWN_META_KEYS,
  'title',
  'description',
  'date',
  'date_precision',
  'project_id',
  'status',
  'verification',
  'evidence',
  'entry_ids',
  'tags',
  'source',
  'derived'
];

export function parseMilestone(raw: unknown, path = 'milestone', now: IsoDateTime = new Date().toISOString()): ParseResult<Milestone> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isPlainObject(raw)) {
    return fail<Milestone>([{ path, message: `expected an object, received ${describe(raw)}` }]);
  }
  const meta = asMeta(raw, path, errors, warnings, now);
  const title = asString(raw.title, join(path, 'title'), errors, warnings, '', true).trim();
  if (!title) errors.push({ path: join(path, 'title'), message: 'a milestone requires a title' });
  if (errors.length > 0) return fail<Milestone>(errors, warnings);

  const description = asOptionalString(raw.description, join(path, 'description'), errors, warnings);
  const projectId = asOptionalString(raw.project_id, join(path, 'project_id'), errors, warnings);
  const date = asIsoDate(raw.date, join(path, 'date'), errors, warnings, meta.created_at.slice(0, 10));
  const status = asEnum<MilestoneStatus>(raw.status, MILESTONE_STATUSES, 'planned', join(path, 'status'), warnings);
  const verification = asEnum<VerificationStatus>(
    raw.verification,
    VERIFICATION_STATUSES,
    'claimed',
    join(path, 'verification'),
    warnings
  );
  const derived = asDerived(raw.derived);
  const extras = collectExtras(raw, MILESTONE_KEYS);

  const milestone: Milestone = {
    ...meta,
    title,
    ...(description !== undefined ? { description } : {}),
    date: date ?? meta.created_at.slice(0, 10),
    date_precision: asEnum<DatePrecision>(
      raw.date_precision,
      DATE_PRECISIONS,
      'day',
      join(path, 'date_precision'),
      warnings
    ),
    project_id: projectId ?? null,
    status,
    verification,
    evidence: asEvidenceRefs(raw.evidence, join(path, 'evidence'), errors, warnings, now),
    entry_ids: asStringArray(raw.entry_ids, join(path, 'entry_ids'), errors, warnings),
    tags: normalizeTags(asStringArray(raw.tags, join(path, 'tags'), errors, warnings)),
    source: asCaptureSource(raw.source, join(path, 'source'), warnings),
    ...(derived ? { derived } : {}),
    ...(extras ? { extras } : {})
  };

  return errors.length > 0 ? fail<Milestone>(errors, warnings) : ok<Milestone>(milestone, warnings);
}

const TASK_KEYS = [
  ...KNOWN_META_KEYS,
  'title',
  'description',
  'project_id',
  'status',
  'priority',
  'due_on',
  'due_precision',
  'completed_at',
  'tags',
  'source_entry_id',
  'source',
  'derived'
];

export function parseTask(raw: unknown, path = 'task', now: IsoDateTime = new Date().toISOString()): ParseResult<Task> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isPlainObject(raw)) return fail<Task>([{ path, message: `expected an object, received ${describe(raw)}` }]);
  const meta = asMeta(raw, path, errors, warnings, now);
  const title = asString(raw.title, join(path, 'title'), errors, warnings, '', true).trim();
  if (!title) errors.push({ path: join(path, 'title'), message: 'a task requires a title' });
  if (errors.length > 0) return fail<Task>(errors, warnings);

  const description = asOptionalString(raw.description, join(path, 'description'), errors, warnings);
  const projectId = asOptionalString(raw.project_id, join(path, 'project_id'), errors, warnings);
  const sourceEntryId = asOptionalString(raw.source_entry_id, join(path, 'source_entry_id'), errors, warnings);
  const dueOn = asIsoDate(raw.due_on, join(path, 'due_on'), errors, warnings, null);
  const status = asEnum<TaskStatus>(raw.status, TASK_STATUSES, 'todo', join(path, 'status'), warnings);
  const derived = asDerived(raw.derived);
  const extras = collectExtras(raw, TASK_KEYS);
  const completedAt = asOptionalString(raw.completed_at, join(path, 'completed_at'), errors, warnings);

  const task: Task = {
    ...meta,
    title,
    ...(description !== undefined ? { description } : {}),
    project_id: projectId ?? null,
    status,
    priority: asEnum<TaskPriority>(raw.priority, TASK_PRIORITIES, 'normal', join(path, 'priority'), warnings),
    due_on: dueOn,
    due_precision: asEnum<DatePrecision>(
      raw.due_precision,
      DATE_PRECISIONS,
      dueOn ? 'day' : 'unknown',
      join(path, 'due_precision'),
      warnings
    ),
    completed_at: completedAt && isValidIsoDateTime(completedAt) ? completedAt : null,
    tags: normalizeTags(asStringArray(raw.tags, join(path, 'tags'), errors, warnings)),
    source_entry_id: sourceEntryId ?? null,
    source: asCaptureSource(raw.source, join(path, 'source'), warnings),
    ...(derived ? { derived } : {}),
    ...(extras ? { extras } : {})
  };

  if (task.status === 'done' && !task.completed_at) task.completed_at = meta.updated_at;

  return errors.length > 0 ? fail<Task>(errors, warnings) : ok<Task>(task, warnings);
}

export function parseRevision(raw: unknown, path = 'revision', now: IsoDateTime = new Date().toISOString()): ParseResult<Revision> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isPlainObject(raw)) return fail<Revision>([{ path, message: `expected an object, received ${describe(raw)}` }]);
  const meta = asMeta(raw, path, errors, warnings, now);
  const entryId = asString(raw.entry_id, join(path, 'entry_id'), errors, warnings, '', true).trim();
  if (!entryId) errors.push({ path: join(path, 'entry_id'), message: 'a revision requires entry_id' });
  if (errors.length > 0) return fail<Revision>(errors, warnings);

  const summary = asOptionalString(raw.summary, join(path, 'summary'), errors, warnings);
  const reason = asOptionalString(raw.reason, join(path, 'reason'), errors, warnings);
  const savedBy = raw.saved_by;

  const revision: Revision = {
    ...meta,
    entry_id: entryId,
    title: asString(raw.title, join(path, 'title'), errors, warnings, ''),
    body: asString(raw.body, join(path, 'body'), errors, warnings, ''),
    ...(summary !== undefined ? { summary } : {}),
    ...(reason !== undefined ? { reason } : {}),
    saved_by: savedBy === 'capture' || savedBy === 'import' ? savedBy : 'user'
  };
  return errors.length > 0 ? fail<Revision>(errors, warnings) : ok<Revision>(revision, warnings);
}

/* ------------------------------------------------------------------ *
 * Lightweight shape checks used on every write
 * ------------------------------------------------------------------ */

export function isProjectLike(value: unknown): value is Project {
  return isPlainObject(value) && typeof value.name === 'string' && typeof value.id === 'string';
}

export function isEntryLike(value: unknown): value is JournalEntry {
  return isPlainObject(value) && typeof value.body === 'string' && typeof value.id === 'string';
}

/** Guard used by repositories before persisting. Throws on programmer error. */
export function assertPersistable<T extends RecordMeta>(record: T, kind: string): T {
  if (!record || typeof record !== 'object') throw new Error(`${kind}: record must be an object`);
  if (typeof record.id !== 'string' || record.id.length === 0) throw new Error(`${kind}: missing id`);
  if (!isValidIsoDateTime(record.created_at)) throw new Error(`${kind}: invalid created_at`);
  if (!isValidIsoDateTime(record.updated_at)) throw new Error(`${kind}: invalid updated_at`);
  if (typeof record.rev !== 'number' || record.rev < 1) throw new Error(`${kind}: invalid rev`);
  return record;
}

/* ===========================================================================
   Life archive records (V0.2)
   ---------------------------------------------------------------------------
   Same contract as the parsers above: unknown fields are preserved in
   `extras`, repairable problems are warnings, unreadable records are rejected,
   and nothing that the user did not provide is invented. A parse failure never
   means "this was private" — every parser defaults `visibility` to `'private'`
   when the value is missing or unrecognised.
   =========================================================================== */

const VISIBILITY_ALLOWED: readonly Visibility[] = VISIBILITIES;
const CHAPTER_ACCENTS = ['ink', 'moss', 'clay', 'plum', 'sand'] as const;
const PLACE_KINDS = ['city', 'region', 'country', 'venue', 'landmark', 'other'] as const;
const PATH_STATES = ['active', 'paused', 'completed', 'changed'] as const;
const LINK_STATUSES = MEMORY_LINK_STATUSES;
const LINK_ORIGINS_ALLOWED = LINK_ORIGINS;
const NODE_KINDS = MEMORY_NODE_KINDS;
const PATH_TARGETS = PATH_TARGET_KINDS;

/**
 * Visibility is the one field that must never be repaired *upwards*. An
 * unrecognised value becomes `private`, never `public`.
 */
function asVisibility(raw: unknown, path: string, warnings: Issue[]): Visibility {
  if (raw === undefined || raw === null) return 'private';
  if (typeof raw === 'string' && (VISIBILITY_ALLOWED as readonly string[]).includes(raw)) {
    return raw as Visibility;
  }
  warnings.push({ path, message: 'unrecognised visibility; treated as private' });
  return 'private';
}

/** ISO date that is genuinely optional (missing means "not known"). */
function asOptionalIsoDate(raw: unknown, path: string, errors: Issue[], warnings: Issue[]): IsoDate | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = asIsoDate(raw, path, errors, warnings, null);
  return value ?? null;
}

function asPrecision(raw: unknown, path: string, warnings: Issue[], fallback: DatePrecision): DatePrecision {
  return asEnum<DatePrecision>(raw, DATE_PRECISIONS, fallback, path, warnings);
}

function asLifeSource(raw: unknown, warnings: Issue[]): { kind: 'manual' | 'import'; capture_id?: string } {
  if (!isPlainObject(raw)) return { kind: 'import' };
  const kind = raw.kind === 'manual' ? 'manual' : 'import';
  const captureId = typeof raw.capture_id === 'string' ? raw.capture_id : undefined;
  if (raw.kind !== undefined && raw.kind !== 'manual' && raw.kind !== 'import') {
    warnings.push({ path: 'source.kind', message: `unknown source kind ${String(raw.kind)}; recorded as import` });
  }
  return { kind, ...(captureId ? { capture_id: captureId } : {}) };
}

const CHAPTER_KEYS = [
  ...KNOWN_META_KEYS,
  'name',
  'description',
  'start_date',
  'end_date',
  'date_precision',
  'date_hint',
  'accent',
  'status',
  'visibility',
  'source'
];

export function parseChapter(raw: unknown, path = 'chapter', now: IsoDateTime = new Date().toISOString()): ParseResult<Chapter> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isPlainObject(raw)) return fail<Chapter>([{ path, message: `expected an object, received ${describe(raw)}` }]);
  const meta = asMeta(raw, path, errors, warnings, now);
  const name = asString(raw.name, join(path, 'name'), errors, warnings, '', true).trim();
  if (!name) errors.push({ path: join(path, 'name'), message: 'a chapter requires a non-empty name' });
  if (errors.length > 0) return fail<Chapter>(errors, warnings);

  const description = asOptionalString(raw.description, join(path, 'description'), errors, warnings);
  const dateHint = asOptionalString(raw.date_hint, join(path, 'date_hint'), errors, warnings);
  const extras = collectExtras(raw, CHAPTER_KEYS);
  if (extras) warnings.push({ path, message: `preserved ${Object.keys(extras).length} unknown field(s)` });

  const chapter: Chapter = {
    ...meta,
    name,
    ...(description !== undefined ? { description } : {}),
    start_date: asOptionalIsoDate(raw.start_date, join(path, 'start_date'), errors, warnings),
    end_date: asOptionalIsoDate(raw.end_date, join(path, 'end_date'), errors, warnings),
    date_precision: asPrecision(raw.date_precision, join(path, 'date_precision'), warnings, 'unknown'),
    ...(dateHint ? { date_hint: dateHint } : {}),
    accent: asEnum(raw.accent, CHAPTER_ACCENTS, 'ink', join(path, 'accent'), warnings),
    status: asEnum(raw.status, ['open', 'archived'] as const, 'open', join(path, 'status'), warnings),
    visibility: asVisibility(raw.visibility, join(path, 'visibility'), warnings),
    source: asLifeSource(raw.source, warnings),
    ...(extras ? { extras } : {})
  };
  if (chapter.start_date && chapter.end_date && chapter.end_date < chapter.start_date) {
    warnings.push({ path, message: 'the chapter ends before it starts; both dates were kept as written' });
  }
  return ok<Chapter>(chapter, warnings);
}

const PATH_KEYS = [
  ...KNOWN_META_KEYS,
  'title',
  'description',
  'start_date',
  'desired_date',
  'state',
  'state_note',
  'tags',
  'targets',
  'visibility',
  'source'
];

export function parsePath(raw: unknown, path = 'path', now: IsoDateTime = new Date().toISOString()): ParseResult<Path> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isPlainObject(raw)) return fail<Path>([{ path, message: `expected an object, received ${describe(raw)}` }]);
  const meta = asMeta(raw, path, errors, warnings, now);
  const title = asString(raw.title, join(path, 'title'), errors, warnings, '', true).trim();
  if (!title) errors.push({ path: join(path, 'title'), message: 'a path requires a non-empty title' });
  if (errors.length > 0) return fail<Path>(errors, warnings);

  const description = asOptionalString(raw.description, join(path, 'description'), errors, warnings);
  const stateNote = asOptionalString(raw.state_note, join(path, 'state_note'), errors, warnings);
  const targets: PathTarget[] = [];
  if (raw.targets !== undefined && raw.targets !== null) {
    if (!Array.isArray(raw.targets)) {
      warnings.push({ path: join(path, 'targets'), message: 'expected a list of links; ignored' });
    } else {
      raw.targets.forEach((item, index) => {
        const itemPath = join(join(path, 'targets'), index);
        if (!isPlainObject(item)) {
          warnings.push({ path: itemPath, message: 'skipped a malformed path link' });
          return;
        }
        const kind = asEnum(item.kind, PATH_TARGETS, 'interest', join(itemPath, 'kind'), warnings);
        const ref = asString(item.ref, join(itemPath, 'ref'), errors, warnings, '');
        const label = asOptionalString(item.label, join(itemPath, 'label'), errors, warnings);
        if (!ref && !label) {
          warnings.push({ path: itemPath, message: 'skipped a path link with no reference or label' });
          return;
        }
        targets.push({ kind, ref, ...(label ? { label } : {}) });
      });
    }
  }

  const extras = collectExtras(raw, PATH_KEYS);
  if (extras) warnings.push({ path, message: `preserved ${Object.keys(extras).length} unknown field(s)` });

  const record: Path = {
    ...meta,
    title,
    ...(description !== undefined ? { description } : {}),
    start_date: asOptionalIsoDate(raw.start_date, join(path, 'start_date'), errors, warnings),
    desired_date: asOptionalIsoDate(raw.desired_date, join(path, 'desired_date'), errors, warnings),
    state: asEnum(raw.state, PATH_STATES, 'active', join(path, 'state'), warnings),
    ...(stateNote ? { state_note: stateNote } : {}),
    tags: normalizeTags(asStringArray(raw.tags, join(path, 'tags'), errors, warnings)),
    targets,
    visibility: asVisibility(raw.visibility, join(path, 'visibility'), warnings),
    source: asLifeSource(raw.source, warnings),
    ...(extras ? { extras } : {})
  };
  return ok<Path>(record, warnings);
}

const PLACE_KEYS = [...KNOWN_META_KEYS, 'name', 'region', 'kind', 'notes', 'domain', 'visibility', 'source'];

export function parsePlace(raw: unknown, path = 'place', now: IsoDateTime = new Date().toISOString()): ParseResult<Place> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isPlainObject(raw)) return fail<Place>([{ path, message: `expected an object, received ${describe(raw)}` }]);
  const meta = asMeta(raw, path, errors, warnings, now);
  const name = asString(raw.name, join(path, 'name'), errors, warnings, '', true).trim();
  if (!name) errors.push({ path: join(path, 'name'), message: 'a place requires a non-empty name' });
  if (errors.length > 0) return fail<Place>(errors, warnings);
  const region = asOptionalString(raw.region, join(path, 'region'), errors, warnings);
  const notes = asOptionalString(raw.notes, join(path, 'notes'), errors, warnings);
  const domain = asOptionalString(raw.domain, join(path, 'domain'), errors, warnings);
  const extras = collectExtras(raw, PLACE_KEYS);
  if (extras) warnings.push({ path, message: `preserved ${Object.keys(extras).length} unknown field(s)` });
  return ok<Place>(
    {
      ...meta,
      name,
      ...(region ? { region } : {}),
      kind: asEnum(raw.kind, PLACE_KINDS, 'other', join(path, 'kind'), warnings),
      ...(notes ? { notes } : {}),
      ...(domain ? { domain } : {}),
      visibility: asVisibility(raw.visibility, join(path, 'visibility'), warnings),
      source: asLifeSource(raw.source, warnings),
      ...(extras ? { extras } : {})
    },
    warnings
  );
}

const PERSON_KEYS = [...KNOWN_META_KEYS, 'name', 'relationship', 'notes', 'sensitive', 'visibility', 'source'];

export function parsePerson(raw: unknown, path = 'person', now: IsoDateTime = new Date().toISOString()): ParseResult<Person> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isPlainObject(raw)) return fail<Person>([{ path, message: `expected an object, received ${describe(raw)}` }]);
  const meta = asMeta(raw, path, errors, warnings, now);
  const name = asString(raw.name, join(path, 'name'), errors, warnings, '', true).trim();
  if (!name) errors.push({ path: join(path, 'name'), message: 'a person requires a non-empty name' });
  if (errors.length > 0) return fail<Person>(errors, warnings);
  const relationship = asOptionalString(raw.relationship, join(path, 'relationship'), errors, warnings);
  const notes = asOptionalString(raw.notes, join(path, 'notes'), errors, warnings);
  const extras = collectExtras(raw, PERSON_KEYS);
  if (extras) warnings.push({ path, message: `preserved ${Object.keys(extras).length} unknown field(s)` });
  const sensitive = asBoolean(raw.sensitive, false, join(path, 'sensitive'), warnings);
  return ok<Person>(
    {
      ...meta,
      name,
      ...(relationship ? { relationship } : {}),
      ...(notes ? { notes } : {}),
      ...(sensitive ? { sensitive } : {}),
      visibility: asVisibility(raw.visibility, join(path, 'visibility'), warnings),
      source: asLifeSource(raw.source, warnings),
      ...(extras ? { extras } : {})
    },
    warnings
  );
}

const TRIP_KEYS = [
  ...KNOWN_META_KEYS,
  'name',
  'description',
  'start_date',
  'end_date',
  'date_precision',
  'date_hint',
  'place_ids',
  'sensitive_notes',
  'visibility',
  'source'
];

export function parseTrip(raw: unknown, path = 'trip', now: IsoDateTime = new Date().toISOString()): ParseResult<Trip> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isPlainObject(raw)) return fail<Trip>([{ path, message: `expected an object, received ${describe(raw)}` }]);
  const meta = asMeta(raw, path, errors, warnings, now);
  const name = asString(raw.name, join(path, 'name'), errors, warnings, '', true).trim();
  if (!name) errors.push({ path: join(path, 'name'), message: 'a trip requires a non-empty name' });
  if (errors.length > 0) return fail<Trip>(errors, warnings);
  const description = asOptionalString(raw.description, join(path, 'description'), errors, warnings);
  const dateHint = asOptionalString(raw.date_hint, join(path, 'date_hint'), errors, warnings);
  const sensitiveNotes = asOptionalString(raw.sensitive_notes, join(path, 'sensitive_notes'), errors, warnings);
  const extras = collectExtras(raw, TRIP_KEYS);
  if (extras) warnings.push({ path, message: `preserved ${Object.keys(extras).length} unknown field(s)` });
  return ok<Trip>(
    {
      ...meta,
      name,
      ...(description !== undefined ? { description } : {}),
      start_date: asOptionalIsoDate(raw.start_date, join(path, 'start_date'), errors, warnings),
      end_date: asOptionalIsoDate(raw.end_date, join(path, 'end_date'), errors, warnings),
      date_precision: asPrecision(raw.date_precision, join(path, 'date_precision'), warnings, 'unknown'),
      ...(dateHint ? { date_hint: dateHint } : {}),
      place_ids: unique(asStringArray(raw.place_ids, join(path, 'place_ids'), errors, warnings)),
      ...(sensitiveNotes ? { sensitive_notes: sensitiveNotes } : {}),
      visibility: asVisibility(raw.visibility, join(path, 'visibility'), warnings),
      source: asLifeSource(raw.source, warnings),
      ...(extras ? { extras } : {})
    },
    warnings
  );
}

const COLLECTION_KEYS = [...KNOWN_META_KEYS, 'name', 'description', 'entry_ids', 'visibility', 'source'];

export function parseCollection(raw: unknown, path = 'collection', now: IsoDateTime = new Date().toISOString()): ParseResult<Collection> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isPlainObject(raw)) return fail<Collection>([{ path, message: `expected an object, received ${describe(raw)}` }]);
  const meta = asMeta(raw, path, errors, warnings, now);
  const name = asString(raw.name, join(path, 'name'), errors, warnings, '', true).trim();
  if (!name) errors.push({ path: join(path, 'name'), message: 'a collection requires a non-empty name' });
  if (errors.length > 0) return fail<Collection>(errors, warnings);
  const description = asOptionalString(raw.description, join(path, 'description'), errors, warnings);
  const extras = collectExtras(raw, COLLECTION_KEYS);
  if (extras) warnings.push({ path, message: `preserved ${Object.keys(extras).length} unknown field(s)` });
  return ok<Collection>(
    {
      ...meta,
      name,
      ...(description !== undefined ? { description } : {}),
      entry_ids: unique(asStringArray(raw.entry_ids, join(path, 'entry_ids'), errors, warnings)),
      visibility: asVisibility(raw.visibility, join(path, 'visibility'), warnings),
      source: asLifeSource(raw.source, warnings),
      ...(extras ? { extras } : {})
    },
    warnings
  );
}

const LINK_KEYS = [
  ...KNOWN_META_KEYS,
  'from_kind',
  'from_id',
  'to_kind',
  'to_id',
  'status',
  'origin',
  'role',
  'rationale'
];

export function parseMemoryLink(raw: unknown, path = 'link', now: IsoDateTime = new Date().toISOString()): ParseResult<MemoryLink> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!isPlainObject(raw)) return fail<MemoryLink>([{ path, message: `expected an object, received ${describe(raw)}` }]);
  const meta = asMeta(raw, path, errors, warnings, now);
  const fromId = asString(raw.from_id, join(path, 'from_id'), errors, warnings, '', true).trim();
  const toId = asString(raw.to_id, join(path, 'to_id'), errors, warnings, '', true).trim();
  if (!fromId) errors.push({ path: join(path, 'from_id'), message: 'a link requires a source record' });
  if (!toId) errors.push({ path: join(path, 'to_id'), message: 'a link requires a target record' });
  if (fromId && toId && fromId === toId) errors.push({ path, message: 'a link may not point at itself' });
  if (errors.length > 0) return fail<MemoryLink>(errors, warnings);

  const origin = asEnum(raw.origin, LINK_ORIGINS_ALLOWED, 'user', join(path, 'origin'), warnings);
  const requested = asEnum(raw.status, LINK_STATUSES, origin === 'suggested' ? 'suggested' : 'confirmed', join(path, 'status'), warnings);
  // A suggestion can never be imported as already-approved unless it says so;
  // an imported *confirmed* link is treated as user-approved data (the user
  // exported it from their own archive), but its origin stays honest.
  const status = origin === 'suggested' && requested === 'confirmed' ? 'suggested' : requested;
  const rationale = asOptionalString(raw.rationale, join(path, 'rationale'), errors, warnings);
  const extras = collectExtras(raw, LINK_KEYS);
  if (extras) warnings.push({ path, message: `preserved ${Object.keys(extras).length} unknown field(s)` });

  return ok<MemoryLink>(
    {
      ...meta,
      from_kind: asEnum(raw.from_kind, NODE_KINDS, 'entry', join(path, 'from_kind'), warnings),
      from_id: fromId,
      to_kind: asEnum(raw.to_kind, NODE_KINDS, 'entry', join(path, 'to_kind'), warnings),
      to_id: toId,
      status,
      origin,
      role: asOptionalString(raw.role, join(path, 'role'), errors, warnings) ?? 'related to',
      ...(rationale ? { rationale } : {}),
      ...(extras ? { extras } : {})
    },
    warnings
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
