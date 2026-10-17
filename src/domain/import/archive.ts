/**
 * Import: parse, validate, plan, apply (§17 items 3–5, §16).
 *
 * Safety rules:
 * - The file is only ever `JSON.parse`d. No imported value is evaluated, and
 *   rendered Markdown/HTML from imported text still goes through the escaping
 *   renderer.
 * - Every record is validated individually; malformed records are reported with
 *   their position and skipped rather than corrupting the archive.
 * - A merge never overwrites a *newer* local record with an *older* incoming
 *   one, and never deletes anything.
 * - A replace is only performed after the caller has produced a backup: the plan
 *   sets `requires_backup` and `applyImport` refuses to clear the database
 *   without an explicit acknowledgement.
 */

import {
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  countRecords,
  emptyRecords,
  sortRecords,
  totalRecords,
  verifyArchive,
  type ChronicleArchive
} from '../export/archive';
import { parseEntry, parseMilestone, parseProject, parseRevision, parseTask, type Issue } from '../validation';
import { RECORD_KINDS, type ChronicleRecords, type RecordKind } from '../types';
import type { JournalEntry, Milestone, Project, Revision, Task } from '../types';

export type ImportStrategy = 'merge' | 'replace';

export interface RecordTypeMap {
  projects: Project;
  entries: JournalEntry;
  milestones: Milestone;
  tasks: Task;
  revisions: Revision;
}

export interface ParsedArchive {
  archive: ChronicleArchive | null;
  records: ChronicleRecords;
  warnings: Issue[];
  detectedFormatVersion: number;
}

export type ParseArchiveResult =
  | { ok: true; value: ParsedArchive }
  | { ok: false; errors: string[]; warnings: Issue[] };

const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Parse and validate archive text. Never throws. */
export async function parseArchiveText(text: string): Promise<ParseArchiveResult> {
  const warnings: Issue[] = [];
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, errors: ['The file is empty.'], warnings };
  }
  if (text.length > MAX_FILE_BYTES) {
    return {
      ok: false,
      errors: [`The file is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB and was not read.`],
      warnings
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      errors: [`This is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`],
      warnings
    };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['The JSON root must be an object.'], warnings };
  }

  const root = raw as Record<string, unknown>;
  const isEnvelope = root.format !== undefined || root.records !== undefined;
  const envelope = isEnvelope ? root : null;
  const recordsSource = (isEnvelope ? (root.records ?? root) : root) as Record<string, unknown>;

  if (envelope) {
    const format = envelope.format;
    if (format !== undefined && format !== ARCHIVE_FORMAT) {
      return {
        ok: false,
        errors: [`This file is a "${String(format)}" document, not a ${ARCHIVE_FORMAT} archive.`],
        warnings
      };
    }
    const version = Number(envelope.format_version ?? ARCHIVE_FORMAT_VERSION);
    if (!Number.isFinite(version) || version < 1) {
      return { ok: false, errors: ['The archive has no readable format_version.'], warnings };
    }
    if (version > ARCHIVE_FORMAT_VERSION) {
      return {
        ok: false,
        errors: [
          `This archive was written by a newer Chronicle (format version ${version}); this build understands version ${ARCHIVE_FORMAT_VERSION}.`
        ],
        warnings
      };
    }
    if (version < ARCHIVE_FORMAT_VERSION) {
      warnings.push({ path: 'format_version', message: `Older archive (v${version}); records were migrated to v${ARCHIVE_FORMAT_VERSION}.` });
    }
  } else {
    warnings.push({
      path: '',
      message: 'The file has no Chronicle envelope; it was read as a bare record collection.'
    });
  }

  for (const kind of RECORD_KINDS) {
    const value = recordsSource[kind];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      return { ok: false, errors: [`"${kind}" must be a list of records.`], warnings };
    }
  }

  // Integrity is verified against the file exactly as it was written, *before*
  // any record is parsed, repaired or skipped. A checksum can therefore never
  // be "earned" by discarding the parts this build could not read.
  if (envelope && envelope.integrity !== undefined) {
    const rawArchive = { ...envelope, records: recordsSource } as unknown as ChronicleArchive;
    const verified = await verifyArchive(rawArchive);
    if (!verified.ok) {
      return { ok: false, errors: [verified.reason ?? 'Integrity check failed.'], warnings };
    }
  }

  const now = new Date().toISOString();
  const records = emptyRecords();
  const errors: string[] = [];
  let rejected = 0;
  let total = 0;

  const collect = <K extends RecordKind>(
    kind: K,
    parser: (raw: unknown, path: string, now: string) => { ok: boolean; value: RecordTypeMap[K] | null; errors: Issue[]; warnings: Issue[] }
  ): void => {
    const list = recordsSource[kind];
    if (!Array.isArray(list)) return;
    list.forEach((item, index) => {
      total += 1;
      const result = parser(item, `${kind}[${index}]`, now);
      for (const warning of result.warnings) {
        warnings.push({ path: `${kind}[${index}]${warning.path ? `.${warning.path}` : ''}`, message: warning.message });
      }
      if (!result.ok || !result.value) {
        rejected += 1;
        if (errors.length < 12) {
          errors.push(`${kind}[${index}]: ${result.errors.map((issue) => issue.message).join('; ') || 'invalid record'}`);
        }
        return;
      }
      (records[kind] as RecordTypeMap[K][]).push(result.value);
    });
  };

  collect('projects', parseProject as never);
  collect('entries', parseEntry as never);
  collect('milestones', parseMilestone as never);
  collect('tasks', parseTask as never);
  collect('revisions', parseRevision as never);

  if (total === 0) {
    return { ok: false, errors: ['The file contains no Chronicle records.'], warnings };
  }
  if (rejected > 0) {
    const ratio = rejected / total;
    if (ratio > 0.5) {
      return {
        ok: false,
        errors: [
          `${rejected} of ${total} records are invalid, so the file was rejected.`,
          ...errors
        ],
        warnings
      };
    }
    warnings.push({ path: 'records', message: `${rejected} invalid record(s) were skipped; ${total - rejected} were accepted.` });
  }
  if (errors.length > 0) {
    warnings.push({ path: 'records', message: errors.slice(0, 5).join(' | ') });
  }

  const archive: ChronicleArchive | null = envelope
    ? {
        format: ARCHIVE_FORMAT,
        format_version: Number(envelope.format_version ?? ARCHIVE_FORMAT_VERSION),
        app_version: String(envelope.app_version ?? 'unknown'),
        schema_version: Number(envelope.schema_version ?? ARCHIVE_FORMAT_VERSION),
        exported_at: String(envelope.exported_at ?? now),
        timezone: String(envelope.timezone ?? 'UTC'),
        include_deleted: Boolean(envelope.include_deleted),
        counts: countRecords(records),
        records,
        integrity: (envelope.integrity as ChronicleArchive['integrity']) ?? {
          algorithm: 'fnv1a',
          checksum: '',
          record_count: totalRecords(records)
        }
      }
    : null;

  // Duplicate ids inside one file indicate a corrupt export: keep the first.
  for (const kind of RECORD_KINDS) {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const record of records[kind] as { id: string }[]) {
      if (seen.has(record.id)) duplicates.push(record.id);
      seen.add(record.id);
    }
    if (duplicates.length === 0) continue;
    warnings.push({
      path: kind,
      message: `${duplicates.length} duplicated id(s) in the file; the first copy was kept.`
    });
    const deduped = new Map<string, unknown>();
    for (const record of records[kind] as { id: string }[]) {
      if (!deduped.has(record.id)) deduped.set(record.id, record);
    }
    (records as unknown as Record<string, unknown[]>)[kind] = [...deduped.values()];
    if (archive) {
      // `integrity` keeps describing the file as written; `counts` describes
      // what was actually accepted.
      archive.records = records;
      archive.counts = countRecords(records);
    }
  }

  return {
    ok: true,
    value: {
      archive,
      records: sortRecords(records),
      warnings,
      detectedFormatVersion: archive?.format_version ?? ARCHIVE_FORMAT_VERSION
    }
  };
}

/* ------------------------------------------------------------------ *
 * Planning
 * ------------------------------------------------------------------ */

export interface Conflict {
  kind: RecordKind;
  id: string;
  label: string;
  reason: string;
  localRev: number;
  incomingRev: number;
  resolution: 'keep-local' | 'use-incoming' | 'create' | 'restore';
}

export interface ImportPlan {
  strategy: ImportStrategy;
  create: ChronicleRecords;
  update: ChronicleRecords;
  conflicts: Conflict[];
  warnings: string[];
  errors: string[];
  requiresBackup: boolean;
  /** Records that will disappear in a replace (shown to the user first). */
  replacedLocally: number;
  summary: string;
}

function label(kind: RecordKind, record: { title?: string; name?: string; id: string }): string {
  if (kind === 'projects') return (record as Project).name || record.id;
  if (kind === 'entries') return (record as JournalEntry).title || record.id;
  if (kind === 'tasks') return (record as Task).title || record.id;
  if (kind === 'milestones') return (record as Milestone).title || record.id;
  return record.id;
}

/**
 * Decide, record by record, what an import would do — without touching storage.
 * The plan is what the confirmation dialog shows.
 */
export function planImport(
  parsed: ParsedArchive,
  current: ChronicleRecords,
  strategy: ImportStrategy
): ImportPlan {
  const warnings: string[] = parsed.warnings.map((warning) => `${warning.path || 'archive'}: ${warning.message}`);
  const errors: string[] = [];
  const conflicts: Conflict[] = [];
  const create = emptyRecords();
  const update = emptyRecords();

  if (strategy === 'replace') {
    const replaced = totalRecords(current);
    return {
      strategy,
      create: parsed.records,
      update: emptyRecords(),
      conflicts: [],
      warnings: [
        ...warnings,
        `Replace will remove ${replaced} existing record(s) from this device and write ${totalRecords(parsed.records)} from the file.`
      ],
      errors,
      requiresBackup: true,
      replacedLocally: replaced,
      summary: `Replace ${replaced} local record(s) with ${totalRecords(parsed.records)} from the archive.`
    };
  }

  const knownProjectIds = new Set<string>([
    ...current.projects.map((project) => project.id),
    ...parsed.records.projects.map((project) => project.id)
  ]);
  const knownEntryIds = new Set<string>([
    ...current.entries.map((entry) => entry.id),
    ...parsed.records.entries.map((entry) => entry.id)
  ]);
  const knownTaskIds = new Set<string>([
    ...current.tasks.map((task) => task.id),
    ...parsed.records.tasks.map((task) => task.id)
  ]);
  const knownMilestoneIds = new Set<string>([
    ...current.milestones.map((milestone) => milestone.id),
    ...parsed.records.milestones.map((milestone) => milestone.id)
  ]);

  const mergeKind = <K extends RecordKind>(
    kind: K,
    incoming: readonly RecordTypeMap[K][],
    local: readonly RecordTypeMap[K][]
  ): void => {
    const localById = new Map(local.map((record) => [record.id, record]));
    for (const record of incoming) {
      const repaired = repairReferences(kind, record, {
        knownProjectIds,
        knownEntryIds,
        knownTaskIds,
        knownMilestoneIds,
        warnings
      });
      const existing = localById.get(record.id);
      if (!existing) {
        (create[kind] as RecordTypeMap[K][]).push(repaired);
        conflicts.push({
          kind,
          id: record.id,
          label: label(kind, record),
          reason: 'Not present locally.',
          localRev: 0,
          incomingRev: record.rev,
          resolution: 'create'
        });
        continue;
      }
      const localNewer =
        existing.rev > repaired.rev ||
        (existing.rev === repaired.rev && existing.updated_at >= repaired.updated_at);
      if (localNewer && !(existing.deleted_at && !repaired.deleted_at)) {
        conflicts.push({
          kind,
          id: record.id,
          label: label(kind, record),
          reason: 'The local copy is the same age or newer, so it was kept.',
          localRev: existing.rev,
          incomingRev: repaired.rev,
          resolution: 'keep-local'
        });
        continue;
      }
      conflicts.push({
        kind,
        id: record.id,
        label: label(kind, record),
        reason: existing.deleted_at && !repaired.deleted_at ? 'Restores a locally deleted record.' : 'The incoming copy is newer.',
        localRev: existing.rev,
        incomingRev: repaired.rev,
        resolution: existing.deleted_at && !repaired.deleted_at ? 'restore' : 'use-incoming'
      });
      (update[kind] as RecordTypeMap[K][]).push(repaired);
    }
  };

  for (const kind of RECORD_KINDS) {
    mergeKind(kind, parsed.records[kind] as RecordTypeMap[typeof kind][], current[kind] as RecordTypeMap[typeof kind][]);
  }

  const createdCount = totalRecords(create);
  const updatedCount = totalRecords(update);
  const kept = conflicts.filter((conflict) => conflict.resolution === 'keep-local').length;

  return {
    strategy,
    create,
    update,
    conflicts,
    warnings,
    errors,
    requiresBackup: updatedCount > 0,
    replacedLocally: 0,
    summary: `Add ${createdCount} record(s), update ${updatedCount}, keep ${kept} local copy/copies that are newer.`
  };
}

interface ReferenceContext {
  knownProjectIds: ReadonlySet<string>;
  knownEntryIds: ReadonlySet<string>;
  knownTaskIds: ReadonlySet<string>;
  knownMilestoneIds: ReadonlySet<string>;
  warnings: string[];
}

/** Drop references that point at records that do not exist (§10). */
function repairReferences<K extends RecordKind>(
  kind: K,
  record: RecordTypeMap[K],
  context: ReferenceContext
): RecordTypeMap[K] {
  const warn = (message: string): void => {
    context.warnings.push(`${label(kind, record)}: ${message}`);
  };

  if (kind === 'entries') {
    const entry = { ...(record as JournalEntry) };
    if (entry.project_id && !context.knownProjectIds.has(entry.project_id)) {
      warn(`project reference ${entry.project_id} does not exist; the link was removed.`);
      entry.project_id = null;
    }
    if (entry.milestone_id && !context.knownMilestoneIds.has(entry.milestone_id)) entry.milestone_id = null;
    const related = entry.related_entry_ids.filter((id) => context.knownEntryIds.has(id));
    if (related.length !== entry.related_entry_ids.length) {
      warn(`${entry.related_entry_ids.length - related.length} related-entry link(s) pointed at missing records and were removed.`);
      entry.related_entry_ids = related;
    }
    return entry as RecordTypeMap[K];
  }

  if (kind === 'milestones') {
    const milestone = { ...(record as Milestone) };
    if (milestone.project_id && !context.knownProjectIds.has(milestone.project_id)) {
      warn('project reference does not exist; the link was removed.');
      milestone.project_id = null;
    }
    const entries = milestone.entry_ids.filter((id) => context.knownEntryIds.has(id));
    if (entries.length !== milestone.entry_ids.length) milestone.entry_ids = entries;
    return milestone as RecordTypeMap[K];
  }

  if (kind === 'tasks') {
    const task = { ...(record as Task) };
    if (task.project_id && !context.knownProjectIds.has(task.project_id)) {
      warn('project reference does not exist; the link was removed.');
      task.project_id = null;
    }
    if (task.source_entry_id && !context.knownEntryIds.has(task.source_entry_id)) task.source_entry_id = null;
    return task as RecordTypeMap[K];
  }

  if (kind === 'projects') {
    const project = { ...(record as Project) };
    const linked = project.linked_project_ids.filter((id) => context.knownProjectIds.has(id));
    if (linked.length !== project.linked_project_ids.length) {
      warn(`${project.linked_project_ids.length - linked.length} linked project(s) were missing and removed.`);
      project.linked_project_ids = linked;
    }
    return project as RecordTypeMap[K];
  }

  if (kind === 'revisions') {
    const revision = { ...(record as Revision) };
    if (!context.knownEntryIds.has(revision.entry_id)) {
      warn('the entry this revision belongs to is missing; the revision was kept as an orphan.');
    }
    return revision as RecordTypeMap[K];
  }

  return record;
}

/* ------------------------------------------------------------------ *
 * Applying
 * ------------------------------------------------------------------ */

/** Storage port used by the importer; implemented by the Dexie store. */
export interface ArchiveWriter {
  transaction<T>(work: () => Promise<T>): Promise<T>;
  upsert<K extends RecordKind>(kind: K, record: RecordTypeMap[K]): Promise<void>;
  /** Remove every record. Only used by an acknowledged `replace` import. */
  clearAll(): Promise<void>;
}

export interface ImportReport {
  ok: boolean;
  strategy: ImportStrategy;
  created: Record<RecordKind, number>;
  updated: Record<RecordKind, number>;
  cleared: number;
  errors: string[];
  warnings: string[];
  startedAt: string;
  finishedAt: string;
  summary: string;
}

export interface ApplyOptions {
  /** Must be true for a `replace` import; the caller is responsible for the backup. */
  backupAcknowledged?: boolean;
}

export async function applyImport(
  plan: ImportPlan,
  writer: ArchiveWriter,
  options: ApplyOptions = {}
): Promise<ImportReport> {
  const startedAt = new Date().toISOString();
  const created = countRecords(emptyRecords());
  const updated = countRecords(emptyRecords());
  const errors: string[] = [];
  let cleared = 0;

  if (plan.errors.length > 0) {
    return {
      ok: false,
      strategy: plan.strategy,
      created,
      updated,
      cleared,
      errors: plan.errors,
      warnings: plan.warnings,
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: 'Import aborted before writing: the plan reported errors.'
    };
  }

  if (plan.strategy === 'replace' && !options.backupAcknowledged) {
    return {
      ok: false,
      strategy: plan.strategy,
      created,
      updated,
      cleared,
      errors: ['A replace import requires an acknowledged backup of the current data.'],
      warnings: plan.warnings,
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: 'Nothing was written: no backup acknowledgement.'
    };
  }

  try {
    await writer.transaction(async () => {
      if (plan.strategy === 'replace') {
        await writer.clearAll();
        cleared = plan.replacedLocally;
        for (const kind of RECORD_KINDS) {
          for (const record of plan.create[kind] as RecordTypeMap[typeof kind][]) {
            await writer.upsert(kind, record);
            created[kind] += 1;
          }
        }
        return;
      }
      for (const kind of RECORD_KINDS) {
        for (const record of plan.create[kind] as RecordTypeMap[typeof kind][]) {
          await writer.upsert(kind, record);
          created[kind] += 1;
        }
        for (const record of plan.update[kind] as RecordTypeMap[typeof kind][]) {
          await writer.upsert(kind, record);
          updated[kind] += 1;
        }
      }
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const totalCreated = Object.values(created).reduce((sum, value) => sum + value, 0);
  const totalUpdated = Object.values(updated).reduce((sum, value) => sum + value, 0);

  return {
    ok: errors.length === 0,
    strategy: plan.strategy,
    created,
    updated,
    cleared,
    errors,
    warnings: plan.warnings,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary:
      errors.length > 0
        ? `Import failed: ${errors[0]}`
        : plan.strategy === 'replace'
          ? `Replaced the archive: ${totalCreated} record(s) written, ${cleared} removed.`
          : `Merged: ${totalCreated} record(s) added, ${totalUpdated} updated.`
  };
}
