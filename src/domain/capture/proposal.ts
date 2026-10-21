/**
 * Proposal validation and commit (§28.2 steps 6–8, §28.13).
 *
 * `CaptureWriter` is the port the domain uses to reach storage. The Dexie
 * implementation lives in `src/data/captureWriter.ts`; tests use an in-memory
 * one. Keeping the port here means the capture engine has no idea that
 * IndexedDB exists.
 */

import { createEntry, createMilestone, createTask, type RecordContext } from '../factories';
import { diceSimilarity, normalizeWhitespace, truncate } from '../text';
import { isValidIsoDate, isValidIsoDateTime, nowIso } from '../time';
import type {
  EvidenceLevel,
  IsoDateTime,
  JournalEntry,
  Milestone,
  Project,
  Task
} from '../types';
import type {
  CaptureContext,
  CaptureProposal,
  CommitResult,
  LastCommit,
  ProposedRecord,
  RecordUpdate
} from './types';

/** Minimal storage port required to commit a proposal. */
export interface CaptureWriter {
  /** Run work as one atomic unit; implementations map this to a transaction. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
  getEntry(id: string): Promise<JournalEntry | null>;
  getTask(id: string): Promise<Task | null>;
  getMilestone(id: string): Promise<Milestone | null>;
  getProject(id: string): Promise<Project | null>;
  putEntry(entry: JournalEntry): Promise<void>;
  putTask(task: Task): Promise<void>;
  putMilestone(milestone: Milestone): Promise<void>;
  putProject(project: Project): Promise<void>;
}

export interface ValidationReport {
  errors: string[];
  warnings: string[];
  /** Records that validation had to repair in place. */
  repaired: string[];
}

/**
 * Validate a proposal against the current archive.
 *
 * The proposal is mutated *only* to make it safe (dropping a dangling
 * reference, downgrading an unsupported verification claim). Useful information
 * is never discarded because part of a message could not be classified.
 */
export function validateProposal(proposal: CaptureProposal, context: CaptureContext): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const repaired: string[] = [];
  const projectIds = new Set(context.projects.filter((project) => !project.deleted_at).map((project) => project.id));
  const entryIds = new Set(context.recentEntries.map((entry) => entry.id));
  const createdNow = proposal.created_at;

  for (const record of proposal.records) {
    if (!record.include) continue;

    if (record.kind === 'entry') {
      const entry = record.entry;
      if (!entry.body?.trim() && !entry.title?.trim()) {
        errors.push('The journal entry has no content.');
        record.include = false;
        continue;
      }
      if (!isValidIsoDateTime(entry.occurred_at ?? '')) {
        errors.push('The journal entry had an invalid event timestamp; the capture time was used.');
        entry.occurred_at = createdNow;
        entry.occurred_precision = 'exact';
        entry.occurred_source = 'capture_time';
        repaired.push(record.key);
      }
      if (entry.project_id && !projectIds.has(entry.project_id)) {
        warnings.push(`Project reference "${truncate(entry.project_id, 12)}" does not exist; the link was removed.`);
        entry.project_id = null;
        repaired.push(record.key);
      }
      const occurredMs = Date.parse(entry.occurred_at ?? createdNow);
      const createdMs = Date.parse(createdNow);
      if (occurredMs - createdMs > 24 * 3_600_000) {
        warnings.push('The event date is more than a day in the future; it was kept but is flagged.');
      }
      // Unsupported verification claims are downgraded, never left standing.
      if (entry.evidence_level === 'verified' && (entry.evidence?.length ?? 0) === 0) {
        warnings.push('"Verified" requires evidence; the level was lowered to "tested".');
        entry.evidence_level = 'tested';
        repaired.push(record.key);
      }
      if (entry.evidence_level === 'deployed' && !/deploy|release|shipped|production/i.test(entry.body ?? '')) {
        warnings.push('"Deployed" was not supported by the text; the level was lowered to "tested".');
        entry.evidence_level = 'tested';
        repaired.push(record.key);
      }
      // Near-duplicate of a recent entry: surface it, do not merge it (§28.13).
      const twin = context.recentEntries.find(
        (existing) =>
          !existing.deleted_at &&
          diceSimilarity(normalizeWhitespace(existing.body), normalizeWhitespace(entry.body ?? '')) > 0.93
      );
      if (twin) {
        warnings.push(`Very similar to "${truncate(twin.title || twin.body, 40)}" recorded earlier. Both will be kept.`);
      }
      entryIds.add(entry.id ?? '');
    }

    if (record.kind === 'task') {
      const task = record.task;
      if (!task.title?.trim()) {
        errors.push('A proposed task had no title and was skipped.');
        record.include = false;
        continue;
      }
      if (task.project_id && !projectIds.has(task.project_id)) {
        warnings.push('A task referenced an unknown project; the link was removed.');
        task.project_id = null;
        repaired.push(record.key);
      }
      if (task.due_on && !isValidIsoDate(task.due_on)) {
        warnings.push('A task had an invalid due date; it was cleared.');
        task.due_on = null;
        task.due_precision = 'unknown';
        repaired.push(record.key);
      }
      if (task.source_entry_id && !entryIds.has(task.source_entry_id)) {
        warnings.push('A task referenced an entry that is not part of this capture; the link was removed.');
        task.source_entry_id = null;
        repaired.push(record.key);
      }
      const duplicate = context.openTasks.find(
        (existing) =>
          !existing.deleted_at &&
          existing.status !== 'done' &&
          diceSimilarity(existing.title, task.title ?? '') > 0.86 &&
          (existing.project_id ?? null) === (task.project_id ?? null)
      );
      if (duplicate) {
        warnings.push(`Task "${truncate(task.title ?? '', 40)}" already exists; it was not created again.`);
        record.include = false;
        record.duplicate_of = duplicate.id;
      }
    }

    if (record.kind === 'milestone') {
      const milestone = record.milestone;
      if (!milestone.title?.trim()) {
        errors.push('A proposed milestone had no title and was skipped.');
        record.include = false;
        continue;
      }
      if (milestone.project_id && !projectIds.has(milestone.project_id)) {
        warnings.push('A milestone referenced an unknown project; the link was removed.');
        milestone.project_id = null;
        repaired.push(record.key);
      }
      if (milestone.date && !isValidIsoDate(milestone.date)) {
        warnings.push('A milestone had an invalid date; it was skipped.');
        record.include = false;
        continue;
      }
      // A milestone can never arrive pre-verified.
      if (milestone.verification === 'verified' && (milestone.evidence?.length ?? 0) === 0) {
        warnings.push('A milestone cannot be verified without evidence; it stays a claim.');
        milestone.verification = 'claimed';
        repaired.push(record.key);
      }
      const duplicate = context.recentMilestones.find(
        (existing) =>
          !existing.deleted_at &&
          diceSimilarity(existing.title, milestone.title ?? '') > 0.86 &&
          (existing.project_id ?? null) === (milestone.project_id ?? null)
      );
      if (duplicate) {
        warnings.push(`Milestone "${truncate(milestone.title ?? '', 40)}" already exists; it was not created again.`);
        record.include = false;
        record.duplicate_of = duplicate.id;
      }
    }

    if (record.kind === 'update') {
      const update = record.update;
      if (update.target_kind === 'entries' && !entryIds.has(update.target_id)) {
        // The target may still exist in storage; only flag when clearly unknown.
        const known = context.recentEntries.some((entry) => entry.id === update.target_id);
        if (!known && context.lastCommit?.entryIds.includes(update.target_id) !== true) {
          warnings.push(`The record to update ("${truncate(update.target_id, 12)}") was not found in the recent context.`);
        }
      }
      if (Object.keys(update.changes).length === 0) {
        warnings.push('A correction had no applicable change and was skipped.');
        record.include = false;
      }
    }
  }

  if (proposal.records.length === 0) errors.push('The proposal contains no records.');

  return { errors, warnings, repaired: [...new Set(repaired)] };
}

/* ------------------------------------------------------------------ *
 * Commit
 * ------------------------------------------------------------------ */

export interface CommitOptions {
  context: RecordContext;
  /** Called with the resulting commit so the UI can offer undo/corrections. */
  onCommitted?: (commit: LastCommit) => void;
}

/**
 * Write an approved proposal to storage.
 *
 * Idempotency: record ids are derived from `capture_id`, so committing the same
 * proposal twice creates the records once and reports `duplicate: true`.
 */
export async function commitProposal(
  proposal: CaptureProposal,
  writer: CaptureWriter,
  options: CommitOptions
): Promise<CommitResult> {
  const committedAt: IsoDateTime = options.context.now?.() ?? nowIso();
  const result: CommitResult = {
    ok: false,
    capture_id: proposal.capture_id,
    duplicate: false,
    created: { entries: [], tasks: [], milestones: [] },
    updated: [],
    skipped: [],
    errors: [],
    committed_at: committedAt
  };

  await writer.transaction(async () => {
    for (const record of proposal.records) {
      if (!record.include) {
        result.skipped.push({ key: record.key, reason: record.reason ?? 'Excluded from this capture.' });
        continue;
      }
      try {
        if (record.kind === 'entry') {
          const id = record.entry.id;
          if (id && (await writer.getEntry(id))) {
            result.duplicate = true;
            result.skipped.push({ key: record.key, reason: 'Already recorded (retry of the same capture).' });
            result.created.entries.push(id);
            continue;
          }
          const entry = createEntry(
            {
              ...record.entry,
              source: {
                kind: record.entry.source?.kind ?? 'capture',
                ...(record.entry.source?.original_input !== undefined
                  ? { original_input: record.entry.source.original_input }
                  : {}),
                ...(record.entry.source?.analyzer ? { analyzer: record.entry.source.analyzer } : {}),
                ...(record.entry.source?.model ? { model: record.entry.source.model } : {}),
                ...(record.entry.source?.provider ? { provider: record.entry.source.provider } : {}),
                capture_id: proposal.capture_id,
                captured_at: committedAt
              }
            },
            { ...options.context, ...(id ? { newId: () => id } : {}) }
          );
          await writer.putEntry(entry);
          result.created.entries.push(entry.id);
        }

        if (record.kind === 'task') {
          const id = record.task.id;
          if (id && (await writer.getTask(id))) {
            result.duplicate = true;
            result.skipped.push({ key: record.key, reason: 'Task already created by this capture.' });
            continue;
          }
          const task = createTask(record.task, { ...options.context, ...(id ? { newId: () => id } : {}) });
          await writer.putTask(task);
          result.created.tasks.push(task.id);
        }

        if (record.kind === 'milestone') {
          const id = record.milestone.id;
          if (id && (await writer.getMilestone(id))) {
            result.duplicate = true;
            result.skipped.push({ key: record.key, reason: 'Milestone already created by this capture.' });
            continue;
          }
          const milestone = createMilestone(record.milestone, { ...options.context, ...(id ? { newId: () => id } : {}) });
          // Link the milestone back to the entry created in the same commit.
          if (milestone.entry_ids.length === 0 && result.created.entries[0]) {
            milestone.entry_ids = [result.created.entries[0]];
          }
          await writer.putMilestone(milestone);
          result.created.milestones.push(milestone.id);
        }

        if (record.kind === 'update') {
          const applied = await applyUpdate(record.update, writer, committedAt);
          if (applied) result.updated.push(applied);
          else result.skipped.push({ key: record.key, reason: 'The target record no longer exists.' });
        }
      } catch (error) {
        result.errors.push({
          key: record.key,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });

  result.ok = result.errors.length === 0 && result.created.entries.length + result.created.tasks.length + result.created.milestones.length + result.updated.length > 0;

  if (result.ok || result.duplicate) {
    const commit: LastCommit = {
      capture_id: proposal.capture_id,
      committed_at: committedAt,
      input: proposal.input,
      entryIds: result.created.entries,
      taskIds: result.created.tasks,
      milestoneIds: result.created.milestones,
      updatedIds: result.updated.map((item) => item.id)
    };
    options.onCommitted?.(commit);
  }

  return result;
}

/** Apply a correction to an existing record, preserving everything else. */
export async function applyUpdate(
  update: RecordUpdate,
  writer: CaptureWriter,
  committedAt: IsoDateTime
): Promise<{ kind: string; id: string; label: string } | null> {
  const changes = update.changes;

  if (update.target_kind === 'entries') {
    const existing = await writer.getEntry(update.target_id);
    if (!existing) return null;
    const next: JournalEntry = { ...existing };
    if (changes.project_id !== undefined) next.project_id = changes.project_id;
    if (changes.occurred_at !== undefined && isValidIsoDateTime(changes.occurred_at)) {
      next.occurred_at = changes.occurred_at;
      next.occurred_precision = changes.occurred_precision ?? next.occurred_precision;
      next.occurred_source = changes.occurred_source ?? 'user';
    }
    if (changes.title !== undefined) next.title = changes.title;
    if (changes.type !== undefined) next.type = changes.type;
    if (changes.tags !== undefined) next.tags = changes.tags;
    if (changes.private !== undefined) next.private = changes.private;
    next.updated_at = committedAt;
    next.rev = existing.rev + 1;
    // Provenance: the original words and the correction are both preserved.
    next.source = { ...next.source, kind: next.source.kind };
    next.derived = { ...next.derived, ...(changes.project_id !== undefined ? { project: true } : {}) };
    await writer.putEntry(next);
    return { kind: 'entries', id: next.id, label: update.target_label };
  }

  if (update.target_kind === 'tasks') {
    const existing = await writer.getTask(update.target_id);
    if (!existing) return null;
    const next: Task = { ...existing };
    if (changes.project_id !== undefined) next.project_id = changes.project_id;
    if (changes.title !== undefined) next.title = changes.title;
    if (changes.due_on !== undefined) {
      next.due_on = changes.due_on;
      next.due_precision = changes.due_on ? 'day' : 'unknown';
    }
    if (changes.status !== undefined) {
      const status = changes.status as Task['status'];
      if (['todo', 'doing', 'blocked', 'done', 'dropped'].includes(status)) {
        next.status = status;
        next.completed_at = status === 'done' ? committedAt : null;
      }
    }
    if (changes.tags !== undefined) next.tags = changes.tags;
    next.updated_at = committedAt;
    next.rev = existing.rev + 1;
    await writer.putTask(next);
    return { kind: 'tasks', id: next.id, label: update.target_label };
  }

  if (update.target_kind === 'milestones') {
    const existing = await writer.getMilestone(update.target_id);
    if (!existing) return null;
    const next: Milestone = { ...existing };
    if (changes.project_id !== undefined) next.project_id = changes.project_id;
    if (changes.title !== undefined) next.title = changes.title;
    if (changes.date !== undefined && isValidIsoDate(changes.date)) next.date = changes.date;
    if (changes.status !== undefined) {
      const status = changes.status as Milestone['status'];
      if (['planned', 'achieved', 'missed', 'dropped'].includes(status)) next.status = status;
    }
    next.updated_at = committedAt;
    next.rev = existing.rev + 1;
    await writer.putMilestone(next);
    return { kind: 'milestones', id: next.id, label: update.target_label };
  }

  const existing = await writer.getProject(update.target_id);
  if (!existing) return null;
  const next: Project = { ...existing };
  if (changes.title !== undefined) next.name = changes.title;
  if (changes.status !== undefined) {
    const status = changes.status as Project['status'];
    if (
      ['idea', 'research', 'planning', 'development', 'prototyping', 'testing', 'operational', 'paused', 'archived'].includes(status)
    ) {
      next.status = status;
    }
  }
  if (changes.tags !== undefined) next.tags = changes.tags;
  next.updated_at = committedAt;
  next.rev = existing.rev + 1;
  await writer.putProject(next);
  return { kind: 'projects', id: next.id, label: update.target_label };
}

/** Human-readable summary of a commit, used by the toast and the review panel. */
export function describeCommit(result: CommitResult): string {
  const parts: string[] = [];
  const entries = result.created.entries.length;
  const tasks = result.created.tasks.length;
  const milestones = result.created.milestones.length;
  if (entries > 0) parts.push(`${entries === 1 ? 'entry' : `${entries} entries`} saved`);
  if (tasks > 0) parts.push(`${tasks === 1 ? 'task' : `${tasks} tasks`} created`);
  if (milestones > 0) parts.push(`${milestones === 1 ? 'milestone' : `${milestones} milestones`} proposed`);
  if (result.updated.length > 0) parts.push(`${result.updated.length} record(s) updated`);
  if (parts.length === 0) {
    return result.duplicate ? 'That capture was already saved.' : 'Nothing was saved.';
  }
  return parts.join(', ');
}

/** Records the engine will propose, for the review panel's summary line. */
export function summarizeProposal(proposal: CaptureProposal): string {
  const included = proposal.records.filter((record) => record.include);
  const kinds = included.map((record) => record.kind);
  const counts: Record<string, number> = {};
  for (const kind of kinds) counts[kind] = (counts[kind] ?? 0) + 1;
  const bits = Object.entries(counts).map(([kind, count]) => `${count} ${kind}${count > 1 ? 's' : ''}`);
  const extra: ProposedRecord[] = included.filter((record) => record.kind !== 'entry');
  return bits.length > 0 ? bits.join(', ') : extra.length > 0 ? 'no records' : 'nothing to save';
}

/** Evidence level labels, kept next to commit logic for honest messaging. */
export const EVIDENCE_EXPLANATION: Record<EvidenceLevel, string> = {
  concept: 'An idea; nothing has been built or measured.',
  researched: 'Background reading or investigation happened.',
  designed: 'A design or plan exists.',
  implemented: 'Code or hardware exists; it has not been tested.',
  tested: 'It was exercised or measured at least once.',
  verified: 'Results were checked against evidence.',
  deployed: 'It is in real use.'
};
