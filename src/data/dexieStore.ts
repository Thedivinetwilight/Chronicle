/**
 * IndexedDB implementation of `ChronicleStore`.
 *
 * Responsibilities:
 * - Persist domain records and keep the derived search index in step.
 * - Enforce the rules the domain defines (tombstones, revision snapshots,
 *   reference repair, idempotent capture commits).
 * - Report storage failures instead of pretending a write succeeded.
 */

import Dexie, { type Table } from 'dexie';
import {
  createChapter as buildChapter,
  createCollection as buildCollection,
  createEntry as buildEntry,
  createMemoryLink as buildMemoryLink,
  createMilestone as buildMilestone,
  createProject as buildProject,
  createPath as buildPath,
  createPerson as buildPerson,
  createPlace as buildPlace,
  createRevision,
  createTask as buildTask,
  createTrip as buildTrip,
  type ChapterInput,
  type CollectionInput,
  type EntryInput,
  type MemoryLinkInput,
  type MilestoneInput,
  type PathInput,
  type PersonInput,
  type PlaceInput,
  type ProjectInput,
  type TaskInput,
  type TripInput
} from '../domain/factories';
import { buildArchive, APP_VERSION, type ChronicleArchive } from '../domain/export/archive';
import { archiveToMarkdownFiles, type MarkdownFile } from '../domain/export/markdown';
import {
  applyImport,
  parseArchiveText,
  planImport,
  type ArchiveWriter,
  type ImportPlan,
  type ImportReport,
  type ImportStrategy,
  type ParsedArchive,
  type RecordTypeMap
} from '../domain/import/archive';
import {
  commitProposal,
  type CaptureWriter
} from '../domain/capture/proposal';
import type {
  CaptureContext,
  CaptureProposal,
  CommitResult,
  LastCommit
} from '../domain/capture/types';
import {
  documentTokens,
  parseQuery,
  scoreDocument,
  toDocument,
  toHit,
  type SearchableRecord,
  type SearchDocument,
  type SearchHit
} from '../domain/search';
import { normalizeTag, normalizeTags } from '../domain/text';
import {
  compareIsoDesc,
  isValidIsoDateTime,
  isValidTimeZone,
  localDateIso,
  nowIso,
  zonedTimeToUtc,
  resolveTimeZone,
  todayIso
} from '../domain/time';
import {
  RECORD_KINDS,
  type AppSettings,
  type Chapter,
  type Collection,
  type MemoryLink,
  type MemoryLinkStatus,
  type Path,
  type ChronicleLifeRecords,
  type RecordMeta,
  type Person,
  type Place,
  type Trip,
  type EntryType,
  type IsoDate,
  type IsoDateTime,
  type JournalEntry,
  type Milestone,
  type Project,
  type RecordKind,
  type Revision,
  type Task
} from '../domain/types';
import { openDatabase, type ChronicleDatabase, type SearchIndexRow } from './db';
import type {
  ArchiveStats,
  ChapterFilter,
  ChronicleStore,
  LifeFilter,
  LifeMapSource,
  LinkFilter,
  PathFilter,
  DeletedRecordSummary,
  DeleteProjectOptions,
  DeletionImpact,
  EntryFilter,
  MilestoneFilter,
  ParseArchiveResultAlias,
  ProjectFilter,
  SearchQuery,
  TagCount,
  TimelineEvent,
  TimelineFilter,
  TimelineKind,
  TaskFilter
} from './store';

const SETTINGS_KEY = 'settings';
const LAST_COMMIT_KEY = 'capture:last';

/** Cap on how much data a single query pulls before it is filtered in memory. */
const SCAN_LIMIT = 2000;
const SEARCH_CANDIDATE_LIMIT = 400;

/**
 * A capture write transaction that is still running after this long is
 * considered wedged and gets aborted (atomically — see captureWriter).
 * 30s is far beyond any real commit on this schema; it exists so the UI can
 * never hang forever on a storage layer that stopped responding.
 */
let writeTxWatchdogMs = 30_000;

/**
 * Test-only knob: shrink the watchdog horizon so the abort-and-rollback path
 * can be exercised deterministically with real timers.
 */
export function setWriteTxWatchdogMsForTests(ms: number): void {
  writeTxWatchdogMs = ms;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schema_version: 1,
  theme: 'system',
  capture_mode: 'quick',
  timezone: 'device',
  reduce_motion: false,
  sidebar_pinned: true,
  ai: {
    enabled: false,
    provider: 'none',
    endpoint: '',
    model: '',
    allow_private: false,
    disclosure_acknowledged_at: null
  },
  onboarded: false,
  app_version: APP_VERSION
};

export class DexieChronicleStore implements ChronicleStore {
  readonly backend = 'indexeddb' as const;
  storageError: string | null = null;

  private db: ChronicleDatabase | null = null;
  private settingsCache: AppSettings | null = null;
  private timezoneCache: string = 'UTC';

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  async init(): Promise<boolean> {
    if (this.db && this.db.isOpen()) return true;
    const result = await openDatabase();
    if (!result.ok) {
      this.storageError = result.error;
      return false;
    }
    this.db = result.db;
    this.settingsCache = await this.loadSettings();
    this.timezoneCache = resolveTimeZone(this.settingsCache.timezone);
    // Best-effort: ask the browser to keep our data under storage pressure.
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
        await navigator.storage.persist();
      }
    } catch {
      /* ignore: persistence is a hint, not a requirement */
    }
    return true;
  }

  private require(): ChronicleDatabase {
    if (!this.db) throw new Error('Chronicle storage is not open. Call init() first.');
    return this.db;
  }

  private async metaGet<T>(key: string): Promise<T | null> {
    const row = await this.require().meta.get(key);
    return row ? (row.value as T) : null;
  }

  private async metaSet(key: string, value: unknown): Promise<void> {
    await this.require().meta.put({ key, value, updated_at: nowIso() });
  }

  /* ---------------------------------------------------------------- *
   * Settings
   * ---------------------------------------------------------------- */

  private async loadSettings(): Promise<AppSettings> {
    const stored = await this.metaGet<Partial<AppSettings>>(SETTINGS_KEY);
    return normalizeSettings(stored);
  }

  async getSettings(): Promise<AppSettings> {
    if (!this.settingsCache) this.settingsCache = await this.loadSettings();
    return this.settingsCache;
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const next: AppSettings = {
      ...current,
      ...patch,
      ai: { ...current.ai, ...(patch.ai ?? {}) }
    };
    // Values are normalised on the way in, so an impossible theme or capture
    // mode can never be persisted by a buggy caller or a tampered import.
    const normalized = normalizeSettings(next);
    await this.metaSet(SETTINGS_KEY, normalized);
    this.settingsCache = normalized;
    this.timezoneCache = resolveTimeZone(normalized.timezone);
    return normalized;
  }

  private timezone(): string {
    return this.timezoneCache;
  }

  /* ---------------------------------------------------------------- *
   * Search index maintenance
   * ---------------------------------------------------------------- */

  private async indexRecord(kind: SearchIndexRow['kind'], record: SearchableRecord): Promise<void> {
    const db = this.require();
    const projectName = await this.projectNameFor(record);
    const document = toDocument(kind, record, projectName);
    if (!document) return;
    const row: SearchIndexRow = {
      id: `${kind}:${record.id}`,
      kind,
      record_id: record.id,
      tokens: documentTokens(document),
      title: document.title,
      project_id: document.projectId,
      occurred_at: document.date,
      updated_at: (record as { updated_at: string }).updated_at,
      deleted_at: record.deleted_at ?? null
    };
    await db.searchIndex.put(row);
  }

  private async projectNameFor(record: { project_id?: string | null; id: string }): Promise<string | null> {
    const db = this.require();
    if ('name' in record) return null; // the record is a project
    const projectId = (record as { project_id?: string | null }).project_id;
    if (!projectId) return null;
    const project = await db.projects.get(projectId);
    return project?.name ?? null;
  }

  async rebuildSearchIndex(): Promise<number> {
    const db = this.require();
    const [projects, entries, milestones, tasks] = await Promise.all([
      db.projects.toArray(),
      db.entries.toArray(),
      db.milestones.toArray(),
      db.tasks.toArray()
    ]);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const rows: SearchIndexRow[] = [];
    const push = (kind: SearchIndexRow['kind'], record: SearchableRecord): void => {
      if (record.deleted_at) return;
      const name =
        kind === 'projects'
          ? null
          : projectNames.get((record as { project_id?: string | null }).project_id ?? '') ?? null;
      const document = toDocument(kind, record, name);
      if (!document) return;
      rows.push({
        id: `${kind}:${record.id}`,
        kind,
        record_id: record.id,
        tokens: documentTokens(document),
        title: document.title,
        project_id: document.projectId,
        occurred_at: document.date,
        updated_at: (record as { updated_at: string }).updated_at
      });
    };
    projects.forEach((project) => push('projects', project));
    entries.forEach((entry) => push('entries', entry));
    milestones.forEach((milestone) => push('milestones', milestone));
    tasks.forEach((task) => push('tasks', task));

    await db.transaction('rw', db.searchIndex, async () => {
      await db.searchIndex.clear();
      await db.searchIndex.bulkPut(rows);
    });
    return rows.length;
  }

  /* ---------------------------------------------------------------- *
   * Projects
   * ---------------------------------------------------------------- */

  async listProjects(filter: ProjectFilter = {}): Promise<Project[]> {
    const db = this.require();
    let collection = db.projects.orderBy('updated_at').reverse();
    // The scan limit and the page size are different things: filtering happens
    // after the scan, so paging must happen after the filtering.
    let projects = await collection.limit(SCAN_LIMIT).toArray();
    if (!filter.includeDeleted) projects = projects.filter((project) => !project.deleted_at);
    if (filter.includeArchived === false) {
      projects = projects.filter((project) => project.status !== 'archived' && !project.deleted_at);
    }
    if (filter.statuses && filter.statuses.length > 0) {
      projects = projects.filter((project) => filter.statuses?.includes(project.status));
    }
    if (filter.tags && filter.tags.length > 0) {
      const wanted = filter.tags.map(normalizeTag);
      projects = projects.filter((project) => wanted.every((tag) => project.tags.includes(tag)));
    }
    if (filter.search && filter.search.trim()) {
      const needle = filter.search.trim().toLowerCase();
      projects = projects.filter(
        (project) =>
          project.name.toLowerCase().includes(needle) ||
          (project.summary ?? '').toLowerCase().includes(needle) ||
          project.aliases.some((alias) => alias.toLowerCase().includes(needle))
      );
    }
    return projects.slice(0, filter.limit ?? SCAN_LIMIT);
  }

  async getProject(id: string): Promise<Project | null> {
    return (await this.require().projects.get(id)) ?? null;
  }

  async createProject(input: ProjectInput): Promise<Project> {
    const db = this.require();
    const project = buildProject(
      { ...input, tags: normalizeTags(input.tags), aliases: normalizeTags(input.aliases).length > 0 ? (input.aliases ?? []) : (input.aliases ?? []) },
      { timezone: this.timezone() }
    );
    if (!project.name.trim()) throw new Error('A project needs a name.');
    await db.transaction('rw', db.projects, db.searchIndex, async () => {
      await db.projects.add(project);
      await this.indexRecord('projects', project);
    });
    return project;
  }

  async updateProject(id: string, changes: Partial<Project>): Promise<Project> {
    const db = this.require();
    const existing = await db.projects.get(id);
    if (!existing) throw new Error('That project no longer exists.');
    const next: Project = {
      ...existing,
      ...changes,
      id: existing.id,
      created_at: existing.created_at,
      tags: changes.tags ? normalizeTags(changes.tags) : existing.tags,
      updated_at: nowIso(),
      rev: existing.rev + 1
    };
    clearTombstone(next);
    await db.transaction('rw', db.projects, db.searchIndex, db.entries, db.milestones, db.tasks, async () => {
      await db.projects.put(next);
      await this.indexRecord('projects', next);
      if (changes.deleted_at === null || changes.deleted_at === undefined) return;
      // Restoring or deleting changes visibility of children in search.
      const children = await this.projectChildren(id);
      for (const child of children) await this.reindexChild(child);
    });
    return next;
  }

  async projectImpact(id: string): Promise<DeletionImpact> {
    const children = await this.projectChildren(id);
    return {
      entries: children.filter((child) => child.kind === 'entries').length,
      tasks: children.filter((child) => child.kind === 'tasks').length,
      milestones: children.filter((child) => child.kind === 'milestones').length
    };
  }

  private async projectChildren(
    id: string
  ): Promise<{ kind: 'entries' | 'tasks' | 'milestones'; record: JournalEntry | Task | Milestone }[]> {
    const db = this.require();
    const [entries, tasks, milestones] = await Promise.all([
      db.entries.where('project_id').equals(id).toArray(),
      db.tasks.where('project_id').equals(id).toArray(),
      db.milestones.where('project_id').equals(id).toArray()
    ]);
    return [
      ...entries.map((record) => ({ kind: 'entries' as const, record })),
      ...tasks.map((record) => ({ kind: 'tasks' as const, record })),
      ...milestones.map((record) => ({ kind: 'milestones' as const, record }))
    ];
  }

  private async reindexChild(child: { kind: 'entries' | 'tasks' | 'milestones'; record: JournalEntry | Task | Milestone }): Promise<void> {
    await this.indexRecord(child.kind, child.record);
  }

  /**
   * Delete a project. Deleting never cascades silently: the caller chooses
   * whether linked records keep their history (unlink) or are deleted too.
   */
  async deleteProject(
    id: string,
    options: DeleteProjectOptions = { children: 'unlink' }
  ): Promise<{ project: Project; impact: DeletionImpact }> {
    const db = this.require();
    const existing = await db.projects.get(id);
    if (!existing) throw new Error('That project no longer exists.');
    const stamp = nowIso();
    const children = await this.projectChildren(id);
    const impact: DeletionImpact = {
      entries: children.filter((child) => child.kind === 'entries').length,
      tasks: children.filter((child) => child.kind === 'tasks').length,
      milestones: children.filter((child) => child.kind === 'milestones').length
    };
    const tombstone: Project = { ...existing, deleted_at: stamp, updated_at: stamp, rev: existing.rev + 1, status: 'archived' };

    await db.transaction('rw', [db.projects, db.entries, db.tasks, db.milestones, db.searchIndex], async () => {
      await db.projects.put(tombstone);
      await this.indexRecord('projects', tombstone);
      for (const child of children) {
        if (options.children === 'delete') {
          const deleted = { ...child.record, deleted_at: stamp, updated_at: stamp, rev: child.record.rev + 1 };
          if (child.kind === 'entries') await db.entries.put(deleted as JournalEntry);
          if (child.kind === 'tasks') await db.tasks.put(deleted as Task);
          if (child.kind === 'milestones') await db.milestones.put(deleted as Milestone);
          await this.indexRecord(child.kind, deleted as JournalEntry & Task & Milestone);
        } else {
          const unlinked = { ...child.record, project_id: null, updated_at: stamp, rev: child.record.rev + 1 };
          if (child.kind === 'entries') await db.entries.put(unlinked as JournalEntry);
          if (child.kind === 'tasks') await db.tasks.put(unlinked as Task);
          if (child.kind === 'milestones') await db.milestones.put(unlinked as Milestone);
          await this.indexRecord(child.kind, unlinked as JournalEntry & Task & Milestone);
        }
      }
      // Other projects that linked to this one lose a dangling reference.
      const linked = await db.projects.filter((project) => project.linked_project_ids.includes(id)).toArray();
      for (const project of linked) {
        await db.projects.put({
          ...project,
          linked_project_ids: project.linked_project_ids.filter((other) => other !== id),
          updated_at: stamp,
          rev: project.rev + 1
        });
      }
    });

    return { project: tombstone, impact };
  }

  async restoreProject(id: string): Promise<Project> {
    return this.updateProject(id, { deleted_at: null, status: 'idea' });
  }

  /* ---------------------------------------------------------------- *
   * Journal entries
   * ---------------------------------------------------------------- */

  async listEntries(filter: EntryFilter = {}): Promise<JournalEntry[]> {
    const db = this.require();
    const order = filter.order ?? 'desc';
    let entries: JournalEntry[];

    if (filter.projectId) {
      entries = await db.entries.where('project_id').equals(filter.projectId).toArray();
    } else {
      entries = await db.entries.orderBy('occurred_at').limit(SCAN_LIMIT).toArray();
    }

    if (!filter.includeDeleted) entries = entries.filter((entry) => !entry.deleted_at);
    if (filter.includePrivate === false) entries = entries.filter((entry) => !entry.private);
    if (filter.types && filter.types.length > 0) {
      entries = entries.filter((entry) => filter.types?.includes(entry.type));
    }
    if (filter.tags && filter.tags.length > 0) {
      const wanted = filter.tags.map(normalizeTag);
      entries = entries.filter((entry) => wanted.every((tag) => entry.tags.includes(tag)));
    }
    const tz = this.timezone();
    if (filter.from) entries = entries.filter((entry) => localDateIso(entry.occurred_at, tz) >= filter.from!);
    if (filter.to) entries = entries.filter((entry) => localDateIso(entry.occurred_at, tz) <= filter.to!);

    entries.sort((a, b) => (order === 'desc' ? compareIsoDesc(a.occurred_at, b.occurred_at) : -compareIsoDesc(a.occurred_at, b.occurred_at)));

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return entries.slice(offset, offset + limit);
  }

  async getEntry(id: string): Promise<JournalEntry | null> {
    return (await this.require().entries.get(id)) ?? null;
  }

  async createEntry(input: EntryInput): Promise<JournalEntry> {
    const db = this.require();
    const entry = buildEntry(
      { ...input, tags: normalizeTags(input.tags) },
      { timezone: this.timezone() }
    );
    if (!entry.body.trim() && !entry.title.trim()) throw new Error('An entry needs a title or some text.');
    if (entry.project_id) await this.assertProjectExists(entry.project_id);
    await db.transaction('rw', db.entries, db.revisions, db.searchIndex, db.projects, async () => {
      await db.entries.add(entry);
      await this.indexRecord('entries', entry);
    });
    return entry;
  }

  private async assertProjectExists(projectId: string): Promise<void> {
    const project = await this.require().projects.get(projectId);
    if (!project) throw new Error('The selected project does not exist.');
    if (project.deleted_at) throw new Error('The selected project has been deleted.');
  }

  async updateEntry(id: string, changes: Partial<JournalEntry>, reason?: string): Promise<JournalEntry> {
    const db = this.require();
    const existing = await db.entries.get(id);
    if (!existing) throw new Error('That entry no longer exists.');
    if (changes.project_id) await this.assertProjectExists(changes.project_id);

    const contentChanged =
      (changes.body !== undefined && changes.body !== existing.body) ||
      (changes.title !== undefined && changes.title !== existing.title) ||
      (changes.summary !== undefined && changes.summary !== existing.summary);

    const next: JournalEntry = {
      ...existing,
      ...changes,
      id: existing.id,
      created_at: existing.created_at,
      tags: changes.tags ? normalizeTags(changes.tags) : existing.tags,
      updated_at: nowIso(),
      rev: existing.rev + 1
    };
    clearTombstone(next);

    await db.transaction('rw', db.entries, db.revisions, db.searchIndex, db.projects, async () => {
      // Snapshot the *previous* content so a correction never erases history.
      if (contentChanged) {
        const snapshot = createRevision(existing, 'user', reason, { timezone: this.timezone() });
        await db.revisions.add(snapshot);
        await this.pruneRevisions(id);
      }
      await db.entries.put(next);
      await this.indexRecord('entries', next);
    });
    return next;
  }

  /** Keep the most recent revisions; the archive must not grow without bound. */
  private async pruneRevisions(entryId: string, keep = 25): Promise<void> {
    const db = this.require();
    const revisions = await db.revisions.where('entry_id').equals(entryId).sortBy('created_at');
    if (revisions.length <= keep) return;
    const stale = revisions.slice(0, revisions.length - keep).map((revision) => revision.id);
    await db.revisions.bulkDelete(stale);
  }

  async deleteEntry(id: string): Promise<JournalEntry> {
    const db = this.require();
    const existing = await db.entries.get(id);
    if (!existing) throw new Error('That entry no longer exists.');
    const stamp = nowIso();
    const tombstone: JournalEntry = { ...existing, deleted_at: stamp, updated_at: stamp, rev: existing.rev + 1 };
    // Deletion is reversible: references from tasks and milestones are left in
    // place so that restoring the entry repairs every link. `purgeDeleted()`
    // removes the references only once the record is really gone.
    await db.transaction('rw', db.entries, db.searchIndex, db.projects, async () => {
      await db.entries.put(tombstone);
      await this.indexRecord('entries', tombstone);
    });
    return tombstone;
  }

  async restoreEntry(id: string): Promise<JournalEntry> {
    return this.updateEntry(id, { deleted_at: null });
  }

  /* ---------------------------------------------------------------- *
   * Milestones
   * ---------------------------------------------------------------- */

  async listMilestones(filter: MilestoneFilter = {}): Promise<Milestone[]> {
    const db = this.require();
    let milestones = filter.projectId
      ? await db.milestones.where('project_id').equals(filter.projectId).toArray()
      : await db.milestones.orderBy('date').reverse().limit(SCAN_LIMIT).toArray();
    if (!filter.includeDeleted) milestones = milestones.filter((milestone) => !milestone.deleted_at);
    if (filter.statuses && filter.statuses.length > 0) {
      milestones = milestones.filter((milestone) => filter.statuses?.includes(milestone.status));
    }
    if (filter.from) milestones = milestones.filter((milestone) => milestone.date >= filter.from!);
    if (filter.to) milestones = milestones.filter((milestone) => milestone.date <= filter.to!);
    return milestones.sort((a, b) => b.date.localeCompare(a.date)).slice(0, filter.limit ?? 200);
  }

  async getMilestone(id: string): Promise<Milestone | null> {
    return (await this.require().milestones.get(id)) ?? null;
  }

  async createMilestone(input: MilestoneInput): Promise<Milestone> {
    const db = this.require();
    const milestone = buildMilestone({ ...input, tags: normalizeTags(input.tags) }, { timezone: this.timezone() });
    if (!milestone.title.trim()) throw new Error('A milestone needs a title.');
    if (milestone.project_id) await this.assertProjectExists(milestone.project_id);
    await db.transaction('rw', db.milestones, db.searchIndex, db.projects, async () => {
      await db.milestones.add(milestone);
      await this.indexRecord('milestones', milestone);
    });
    return milestone;
  }

  async updateMilestone(id: string, changes: Partial<Milestone>): Promise<Milestone> {
    const db = this.require();
    const existing = await db.milestones.get(id);
    if (!existing) throw new Error('That milestone no longer exists.');
    if (changes.project_id) await this.assertProjectExists(changes.project_id);
    const next: Milestone = {
      ...existing,
      ...changes,
      id: existing.id,
      created_at: existing.created_at,
      tags: changes.tags ? normalizeTags(changes.tags) : existing.tags,
      updated_at: nowIso(),
      rev: existing.rev + 1
    };
    clearTombstone(next);
    await db.transaction('rw', db.milestones, db.searchIndex, db.projects, async () => {
      await db.milestones.put(next);
      await this.indexRecord('milestones', next);
    });
    return next;
  }

  async deleteMilestone(id: string): Promise<Milestone> {
    const db = this.require();
    const existing = await db.milestones.get(id);
    if (!existing) throw new Error('That milestone no longer exists.');
    const stamp = nowIso();
    const tombstone: Milestone = { ...existing, deleted_at: stamp, updated_at: stamp, rev: existing.rev + 1 };
    // As with entries: keep the reference until the record is purged.
    await db.transaction('rw', db.milestones, db.searchIndex, db.projects, async () => {
      await db.milestones.put(tombstone);
      await this.indexRecord('milestones', tombstone);
    });
    return tombstone;
  }

  async restoreMilestone(id: string): Promise<Milestone> {
    return this.updateMilestone(id, { deleted_at: null });
  }

  /* ---------------------------------------------------------------- *
   * Tasks
   * ---------------------------------------------------------------- */

  async listTasks(filter: TaskFilter = {}): Promise<Task[]> {
    const db = this.require();
    let tasks = filter.projectId
      ? await db.tasks.where('project_id').equals(filter.projectId).toArray()
      : await db.tasks.orderBy('updated_at').reverse().limit(SCAN_LIMIT).toArray();
    if (!filter.includeDeleted) tasks = tasks.filter((task) => !task.deleted_at);
    if (filter.statuses && filter.statuses.length > 0) {
      tasks = tasks.filter((task) => filter.statuses?.includes(task.status));
    }
    if (filter.dueBefore) tasks = tasks.filter((task) => task.due_on != null && task.due_on <= filter.dueBefore!);
    return tasks.slice(0, filter.limit ?? 300);
  }

  async getTask(id: string): Promise<Task | null> {
    return (await this.require().tasks.get(id)) ?? null;
  }

  async createTask(input: TaskInput): Promise<Task> {
    const db = this.require();
    const task = buildTask({ ...input, tags: normalizeTags(input.tags) }, { timezone: this.timezone() });
    if (!task.title.trim()) throw new Error('A task needs a title.');
    if (task.project_id) await this.assertProjectExists(task.project_id);
    await db.transaction('rw', db.tasks, db.searchIndex, db.projects, async () => {
      await db.tasks.add(task);
      await this.indexRecord('tasks', task);
    });
    return task;
  }

  async updateTask(id: string, changes: Partial<Task>): Promise<Task> {
    const db = this.require();
    const existing = await db.tasks.get(id);
    if (!existing) throw new Error('That task no longer exists.');
    if (changes.project_id) await this.assertProjectExists(changes.project_id);
    const next: Task = {
      ...existing,
      ...changes,
      id: existing.id,
      created_at: existing.created_at,
      tags: changes.tags ? normalizeTags(changes.tags) : existing.tags,
      updated_at: nowIso(),
      rev: existing.rev + 1
    };
    clearTombstone(next);
    if (changes.status === 'done' && !next.completed_at) next.completed_at = nowIso();
    if (changes.status && changes.status !== 'done') next.completed_at = null;
    await db.transaction('rw', db.tasks, db.searchIndex, db.projects, async () => {
      await db.tasks.put(next);
      await this.indexRecord('tasks', next);
    });
    return next;
  }

  async deleteTask(id: string): Promise<Task> {
    const db = this.require();
    const existing = await db.tasks.get(id);
    if (!existing) throw new Error('That task no longer exists.');
    const stamp = nowIso();
    const tombstone: Task = { ...existing, deleted_at: stamp, updated_at: stamp, rev: existing.rev + 1 };
    await db.transaction('rw', db.tasks, db.searchIndex, db.projects, async () => {
      await db.tasks.put(tombstone);
      await this.indexRecord('tasks', tombstone);
    });
    return tombstone;
  }

  async restoreTask(id: string): Promise<Task> {
    return this.updateTask(id, { deleted_at: null });
  }

  /* ---------------------------------------------------------------- *
   * Revisions
   * ---------------------------------------------------------------- */

  async listRevisions(entryId: string): Promise<Revision[]> {
    const revisions = await this.require().revisions.where('entry_id').equals(entryId).toArray();
    return revisions.sort((a, b) => compareIsoDesc(a.created_at, b.created_at));
  }

  async restoreRevision(revisionId: string): Promise<JournalEntry> {
    const db = this.require();
    const revision = await db.revisions.get(revisionId);
    if (!revision) throw new Error('That revision no longer exists.');
    const entry = await db.entries.get(revision.entry_id);
    if (!entry) throw new Error('The entry this revision belongs to no longer exists.');
    return this.updateEntry(entry.id, {
      title: revision.title,
      body: revision.body,
      ...(revision.summary !== undefined ? { summary: revision.summary } : {})
    }, `Restored revision from ${revision.created_at}`);
  }

  /* ---------------------------------------------------------------- *
   * Tags
   * ---------------------------------------------------------------- */

  async listTags(): Promise<TagCount[]> {
    const db = this.require();
    const [projects, entries, milestones, tasks] = await Promise.all([
      db.projects.filter((record) => !record.deleted_at).toArray(),
      db.entries.filter((record) => !record.deleted_at).toArray(),
      db.milestones.filter((record) => !record.deleted_at).toArray(),
      db.tasks.filter((record) => !record.deleted_at).toArray()
    ]);
    const counts = new Map<string, number>();
    for (const record of [...projects, ...entries, ...milestones, ...tasks]) {
      for (const tag of record.tags) {
        const normalized = normalizeTag(tag);
        if (!normalized) continue;
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /** Rename a tag across every record. Returns the number of records changed. */
  async renameTag(from: string, to: string): Promise<number> {
    const db = this.require();
    const source = normalizeTag(from);
    const target = normalizeTag(to);
    if (!source || !target) throw new Error('Both tag names must be non-empty.');
    let changed = 0;
    await db.transaction('rw', [db.projects, db.entries, db.milestones, db.tasks, db.paths, db.searchIndex], async () => {
      const apply = async <T extends { id: string; tags: string[]; updated_at: string; rev: number }>(
        table: { toArray(): Promise<T[]>; put(record: T): Promise<unknown> },
        kind: SearchIndexRow['kind']
      ): Promise<void> => {
        const records = await table.toArray();
        for (const record of records) {
          if (!record.tags.includes(source)) continue;
          const next = { ...record, tags: normalizeTags(record.tags.map((tag) => (tag === source ? target : tag))) };
          await table.put(next);
          await this.indexRecord(kind, next as unknown as Project & JournalEntry & Milestone & Task);
          changed += 1;
        }
      };
      await apply(db.projects, 'projects');
      await apply(db.entries, 'entries');
      await apply(db.milestones, 'milestones');
      await apply(db.tasks, 'tasks');
      // Paths carry tags but are not part of the full-text index (they have no
      // narrative body), so they are renamed without a re-index.
      const paths = await db.paths.filter((record) => !record.deleted_at).toArray();
      for (const path of paths) {
        if (!path.tags.includes(source)) continue;
        await db.paths.put(
          touch({ ...path, tags: normalizeTags(path.tags.map((tag) => (tag === source ? target : tag))) })
        );
        changed += 1;
      }
    });
    return changed;
  }

  /* ---------------------------------------------------------------- *
   * Timeline
   * ---------------------------------------------------------------- */

  async timeline(filter: TimelineFilter = {}): Promise<TimelineEvent[]> {
    const db = this.require();
    const tz = this.timezone();
    const limit = filter.limit ?? 60;
    const kinds = filter.kinds ?? (['entry', 'milestone', 'task', 'project'] as TimelineKind[]);
    const wantedTags = (filter.tags ?? []).map(normalizeTag);
    const projectNames = new Map((await db.projects.toArray()).map((project) => [project.id, project.name]));

    const fromBound = filter.from ? `${filter.from}T00:00:00.000Z` : null;
    const toBound = filter.to ? `${filter.to}T23:59:59.999Z` : null;

    const events: TimelineEvent[] = [];

    const inRange = (instant: IsoDateTime): boolean => {
      if (fromBound && instant < fromBound) return false;
      if (toBound && instant > toBound) return false;
      if (filter.before && instant >= filter.before) return false;
      return true;
    };
    const matchesProject = (projectId: string | null | undefined): boolean =>
      !filter.projectIds || filter.projectIds.length === 0 || (projectId != null && filter.projectIds.includes(projectId));
    const matchesTags = (tags: string[]): boolean => wantedTags.every((tag) => tags.includes(tag));

    if (kinds.includes('entry')) {
      let entries = await db.entries.orderBy('occurred_at').reverse().limit(SCAN_LIMIT).toArray();
      if (!filter.includeDeleted) entries = entries.filter((entry) => !entry.deleted_at);
      if (filter.types && filter.types.length > 0) entries = entries.filter((entry) => filter.types?.includes(entry.type));
      for (const entry of entries) {
        if (!inRange(entry.occurred_at)) continue;
        if (!matchesProject(entry.project_id)) continue;
        if (!matchesTags(entry.tags)) continue;
        if (filter.milestonesOnly && entry.type !== 'milestone' && !entry.milestone_id) continue;
        events.push({
          id: `entry:${entry.id}`,
          kind: 'entry',
          record_id: entry.id,
          occurred_at: entry.occurred_at,
          date: localDateIso(entry.occurred_at, tz),
          title: entry.title || firstLine(entry.body),
          ...(entry.summary ? { subtitle: entry.summary } : {}),
          project_id: entry.project_id ?? null,
          project_name: entry.project_id ? projectNames.get(entry.project_id) : undefined,
          tags: entry.tags,
          type: entry.type,
          evidence_level: entry.evidence_level,
          private: entry.private,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
          edited: wasEdited(entry),
          path: `/journal/${entry.id}`
        });
      }
    }

    if (kinds.includes('milestone')) {
      let milestones = await db.milestones.orderBy('date').reverse().limit(SCAN_LIMIT).toArray();
      if (!filter.includeDeleted) milestones = milestones.filter((milestone) => !milestone.deleted_at);
      for (const milestone of milestones) {
        const instant = zonedTimeToUtc(milestone.date, 12, 0, tz);
        if (!inRange(instant)) continue;
        if (!matchesProject(milestone.project_id)) continue;
        if (!matchesTags(milestone.tags)) continue;
        events.push({
          id: `milestone:${milestone.id}`,
          kind: 'milestone',
          record_id: milestone.id,
          occurred_at: instant,
          date: milestone.date,
          title: milestone.title,
          ...(milestone.description ? { subtitle: milestone.description } : {}),
          project_id: milestone.project_id ?? null,
          project_name: milestone.project_id ? projectNames.get(milestone.project_id) : undefined,
          tags: milestone.tags,
          type: milestone.status,
          private: false,
          created_at: milestone.created_at,
          updated_at: milestone.updated_at,
          edited: wasEdited(milestone),
          path: milestone.project_id ? `/projects/${milestone.project_id}` : `/timeline?milestone=${milestone.id}`
        });
      }
    }

    if (kinds.includes('task')) {
      let tasks = await db.tasks.orderBy('updated_at').reverse().limit(SCAN_LIMIT).toArray();
      if (!filter.includeDeleted) tasks = tasks.filter((task) => !task.deleted_at);
      for (const task of tasks) {
        // Tasks appear on the timeline when they are due or when they were closed.
        const instant = task.completed_at ?? (task.due_on ? zonedTimeToUtc(task.due_on, 12, 0, tz) : null);
        if (!instant) continue;
        if (!inRange(instant)) continue;
        if (!matchesProject(task.project_id)) continue;
        if (!matchesTags(task.tags)) continue;
        if (filter.milestonesOnly) continue;
        events.push({
          id: `task:${task.id}`,
          kind: 'task',
          record_id: task.id,
          occurred_at: instant,
          date: localDateIso(instant, tz),
          title: task.title,
          ...(task.description ? { subtitle: task.description } : {}),
          project_id: task.project_id ?? null,
          project_name: task.project_id ? projectNames.get(task.project_id) : undefined,
          tags: task.tags,
          type: task.status,
          private: false,
          created_at: task.created_at,
          updated_at: task.updated_at,
          edited: wasEdited(task),
          path: task.project_id ? `/projects/${task.project_id}` : `/journal?task=${task.id}`
        });
      }
    }

    if (kinds.includes('project')) {
      let projects = await db.projects.orderBy('created_at').reverse().limit(SCAN_LIMIT).toArray();
      if (!filter.includeDeleted) projects = projects.filter((project) => !project.deleted_at);
      for (const project of projects) {
        const started = project.started_on ? zonedTimeToUtc(project.started_on, 12, 0, tz) : project.created_at;
        if (!inRange(started)) continue;
        if (filter.projectIds && filter.projectIds.length > 0 && !filter.projectIds.includes(project.id)) continue;
        if (!matchesTags(project.tags)) continue;
        if (filter.milestonesOnly) continue;
        events.push({
          id: `project:${project.id}`,
          kind: 'project',
          record_id: project.id,
          occurred_at: started,
          date: localDateIso(started, tz),
          title: `Project started — ${project.name}`,
          ...(project.summary ? { subtitle: project.summary } : {}),
          project_id: project.id,
          project_name: project.name,
          tags: project.tags,
          type: project.status,
          private: project.privacy === 'private',
          created_at: project.created_at,
          updated_at: project.updated_at,
          edited: false,
          path: `/projects/${project.id}`
        });
      }
    }

    events.sort((a, b) => compareIsoDesc(a.occurred_at, b.occurred_at) || a.id.localeCompare(b.id));
    return events.slice(0, limit);
  }

  /* ---------------------------------------------------------------- *
   * Search
   * ---------------------------------------------------------------- */

  async search(query: SearchQuery): Promise<SearchHit[]> {
    const db = this.require();
    const parsed = parseQuery(query.text);
    // A tag-only query ("#debugging") is a real query: the tags are indexed as
    // tokens, so they can drive candidate lookup and scoring on their own.
    const inlineTags = [...parsed.tags, ...(query.tags ?? []).map(normalizeTag)];
    if (parsed.empty && inlineTags.length === 0) return [];
    const effective =
      parsed.tokens.length > 0
        ? parsed
        : { ...parsed, tokens: inlineTags.slice(0, 6), empty: false, phrase: false };
    const tz = this.timezone();
    const today = todayIso(tz);
    const limit = query.limit ?? 40;
    const kinds = query.kinds ?? ['projects', 'entries', 'milestones', 'tasks'];

    // 1. Candidate retrieval from the multiEntry token index (prefix match).
    const rowsByKey = new Map<string, SearchIndexRow>();
    for (const token of effective.tokens.slice(0, 6)) {
      const rows = await db.searchIndex
        .where('tokens')
        .startsWith(token)
        .limit(SEARCH_CANDIDATE_LIMIT)
        .toArray();
      for (const row of rows) {
        if (!rowsByKey.has(row.id)) rowsByKey.set(row.id, row);
      }
    }
    if (effective.tokens.length === 0) return [];

    const wanted = effective.tokens.map((token) => token.toLowerCase());
    const rows = [...rowsByKey.values()].filter((row) => kinds.includes(row.kind));
    if (rows.length === 0) return [];

    // 2. Fetch the real records for the candidates.
    const byKind: { projects: string[]; entries: string[]; milestones: string[]; tasks: string[] } = {
      projects: [],
      entries: [],
      milestones: [],
      tasks: []
    };
    for (const row of rows) byKind[row.kind].push(row.record_id);
    const [projects, entries, milestones, tasks] = await Promise.all([
      byKind.projects.length > 0 ? db.projects.bulkGet(byKind.projects) : Promise.resolve([]),
      byKind.entries.length > 0 ? db.entries.bulkGet(byKind.entries) : Promise.resolve([]),
      byKind.milestones.length > 0 ? db.milestones.bulkGet(byKind.milestones) : Promise.resolve([]),
      byKind.tasks.length > 0 ? db.tasks.bulkGet(byKind.tasks) : Promise.resolve([])
    ]);
    const projectNames = new Map(projects.filter(Boolean).map((project) => [project!.id, project!.name]));
    const allProjects = await db.projects.toArray();
    for (const project of allProjects) projectNames.set(project.id, project.name);

    // 3. Score in memory with field weights + recency.
    const documents: SearchDocument[] = [];
    const addDocument = (kind: RecordKind, record: unknown): void => {
      if (!record) return;
      const typed = record as Project | JournalEntry | Milestone | Task;
      if (!query.includeDeleted && typed.deleted_at) return;
      if (kind === 'entries') {
        const entry = typed as JournalEntry;
        if (query.projectId !== undefined && entry.project_id !== query.projectId) return;
        if (query.types && query.types.length > 0 && !query.types.includes(entry.type)) return;
      }
      if ((kind === 'tasks' || kind === 'milestones') && query.projectId !== undefined) {
        const withProject = typed as { project_id?: string | null };
        if (withProject.project_id !== query.projectId) return;
      }
      const document = toDocument(kind, typed, projectNames.get((typed as { project_id?: string | null }).project_id ?? '') ?? null);
      if (document) documents.push(document);
    };
    projects.forEach((project) => addDocument('projects', project));
    entries.forEach((entry) => addDocument('entries', entry));
    milestones.forEach((milestone) => addDocument('milestones', milestone));
    tasks.forEach((task) => addDocument('tasks', task));

    const matchedProjectIds = new Set(
      documents
        .filter((document) => document.kind === 'projects' && wanted.every((token) => document.title.toLowerCase().includes(token)))
        .map((document) => document.id)
    );

    const hits = documents
      .map((document) => scoreDocument(document, { parsed: effective, today, timezone: tz, matchedProjectIds }))
      .filter((scored): scored is NonNullable<typeof scored> => scored !== null)
      .filter((scored) => {
        const document = scored.document;
        if (query.tags && query.tags.length > 0) {
          const wantedTags = query.tags.map(normalizeTag);
          if (!wantedTags.every((tag) => document.tags.includes(tag))) return false;
        }
        // A date filter only applies to records that actually have a date: an
        // undated task must not sneak in because it was edited today.
        if (query.from || query.to) {
          if (!document.filterDate) return false;
          const day = document.filterDate.slice(0, 10);
          if (query.from && day < query.from) return false;
          if (query.to && day > query.to) return false;
        }
        return true;
      })
      .sort((a, b) => b.score - a.score || a.document.title.localeCompare(b.document.title))
      .slice(0, limit)
      .map((scored) => toHit(scored, projectNames));

    return hits;
  }

  /* ---------------------------------------------------------------- *
   * Capture
   * ---------------------------------------------------------------- */

  async captureContext(options: { activeProjectId?: string | null; limit?: number } = {}): Promise<CaptureContext> {
    const db = this.require();
    const settings = await this.getSettings();
    const limit = options.limit ?? 8;
    const [projects, recentEntries, openTasks, recentMilestones, tags] = await Promise.all([
      db.projects.filter((project) => !project.deleted_at).reverse().sortBy('updated_at'),
      db.entries
        .filter((entry) => !entry.deleted_at)
        .reverse()
        .sortBy('occurred_at')
        .then((entries) => entries.slice(0, limit)),
      db.tasks
        .filter((task) => !task.deleted_at && task.status !== 'done' && task.status !== 'dropped')
        .reverse()
        .sortBy('updated_at')
        .then((tasks) => tasks.slice(0, 40)),
      db.milestones
        .filter((milestone) => !milestone.deleted_at)
        .reverse()
        .sortBy('date')
        .then((milestones) => milestones.slice(0, 25)),
      this.listTags()
    ]);

    // Prioritise active and recently touched projects; keep the list small so a
    // capture never loads the whole archive (§28.14).
    const activeFirst = [...projects].sort((a, b) => {
      const aActive = a.status === 'development' || a.status === 'prototyping' || a.status === 'testing' ? 1 : 0;
      const bActive = b.status === 'development' || b.status === 'prototyping' || b.status === 'testing' ? 1 : 0;
      return bActive - aActive || b.updated_at.localeCompare(a.updated_at);
    });

    const lastCommit = await this.getLastCommit();

    return {
      now: new Date(),
      timezone: resolveTimeZone(settings.timezone),
      mode: settings.capture_mode,
      projects: activeFirst.slice(0, 40),
      recentEntries,
      openTasks,
      recentMilestones,
      existingTags: tags.slice(0, 60).map((tag) => tag.tag),
      activeProjectId: options.activeProjectId ?? null,
      lastCommit
    };
  }

  /** Adapter that lets the domain commit a proposal without knowing Dexie. */
  private captureWriter(): CaptureWriter {
    const db = this.require();
    return {
      transaction: async <T>(work: () => Promise<T>): Promise<T> =>
        db.transaction(
          'rw',
          [db.entries, db.tasks, db.milestones, db.projects, db.searchIndex],
          async () => {
            // Liveness watchdog. IndexedDB can wedge on mobile (storage
            // pressure, suspended tabs, browser bugs); without this the
            // transaction promise never settles and the UI stays busy forever.
            //
            // Aborting is *safe* here: `tx.abort()` rolls the whole IndexedDB
            // transaction back atomically, so a watchdog abort can never
            // produce a partial commit, and capture ids act as idempotency
            // keys, so a retry after an abort cannot duplicate records.
            //
            // The race is necessary because Dexie only settles the
            // transaction promise once the scope function settles — a scope
            // wedged on a never-settling promise would swallow a bare
            // `tx.abort()`. Rejecting the scope ourselves guarantees the
            // caller always gets a settle: an AbortError, which the UI
            // reports as a visible, actionable failure.
            const tx = Dexie.currentTransaction;
            let timer: ReturnType<typeof setTimeout> | null = null;
            const wedged = tx
              ? new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(() => {
                    tx.abort();
                    const failure = new Error(
                      `Transaction aborted by the capture watchdog after ${writeTxWatchdogMs}ms.`
                    );
                    failure.name = 'AbortError';
                    reject(failure);
                  }, writeTxWatchdogMs);
                })
              : null;
            try {
              return wedged ? await Promise.race([work(), wedged]) : await work();
            } finally {
              if (timer !== null) clearTimeout(timer);
            }
          }
        ),
      getEntry: async (id) => (await db.entries.get(id)) ?? null,
      getTask: async (id) => (await db.tasks.get(id)) ?? null,
      getMilestone: async (id) => (await db.milestones.get(id)) ?? null,
      getProject: async (id) => (await db.projects.get(id)) ?? null,
      putEntry: async (entry) => {
        await db.entries.put(entry);
        await this.indexRecord('entries', entry);
      },
      putTask: async (task) => {
        await db.tasks.put(task);
        await this.indexRecord('tasks', task);
      },
      putMilestone: async (milestone) => {
        await db.milestones.put(milestone);
        await this.indexRecord('milestones', milestone);
      },
      putProject: async (project) => {
        await db.projects.put(project);
        await this.indexRecord('projects', project);
      }
    };
  }

  async commitCapture(proposal: CaptureProposal): Promise<CommitResult> {
    const settings = await this.getSettings();
    const result = await commitProposal(proposal, this.captureWriter(), {
      context: { timezone: resolveTimeZone(settings.timezone) },
      onCommitted: (commit) => {
        void this.setLastCommit(commit);
      }
    });
    return result;
  }

  async getLastCommit(): Promise<LastCommit | null> {
    return this.metaGet<LastCommit>(LAST_COMMIT_KEY);
  }

  async setLastCommit(commit: LastCommit | null): Promise<void> {
    if (commit === null) {
      await this.require().meta.delete(LAST_COMMIT_KEY);
      return;
    }
    await this.metaSet(LAST_COMMIT_KEY, commit);
  }

  /* ---------------------------------------------------------------- *
   * Export / import
   * ---------------------------------------------------------------- */

  async readAll(): Promise<ChronicleLifeRecords> {
    const db = this.require();
    const [projects, entries, milestones, tasks, revisions] = await Promise.all([
      db.projects.toArray(),
      db.entries.toArray(),
      db.milestones.toArray(),
      db.tasks.toArray(),
      db.revisions.toArray()
    ]);
    const [chapters, paths, places, people, trips, collections, links] = await Promise.all([
      db.chapters.toArray(),
      db.paths.toArray(),
      db.places.toArray(),
      db.people.toArray(),
      db.trips.toArray(),
      db.collections.toArray(),
      db.links.toArray()
    ]);
    return { projects, entries, milestones, tasks, revisions, chapters, paths, places, people, trips, collections, links };
  }

  async buildArchive(options: { includeDeleted?: boolean } = {}): Promise<ChronicleArchive> {
    const settings = await this.getSettings();
    const records = await this.readAll();
    return buildArchive(records, {
      includeDeleted: options.includeDeleted ?? true,
      timezone: resolveTimeZone(settings.timezone),
      schemaVersion: settings.schema_version,
      appVersion: APP_VERSION
    });
  }

  async markdownFiles(options: { includePrivate?: boolean } = {}): Promise<MarkdownFile[]> {
    const settings = await this.getSettings();
    const records = await this.readAll();
    // The Markdown bundle covers the V0.1 collections; chapters and paths are
    // intentionally summarised separately in the JSON archive only, so a
    // half-written folder can never imply the life archive is complete.
    return archiveToMarkdownFiles(records, {
      timezone: resolveTimeZone(settings.timezone),
      includePrivate: options.includePrivate ?? true
    });
  }

  async parseArchive(text: string): Promise<ParseArchiveResultAlias> {
    return parseArchiveText(text);
  }

  async planImport(parsed: ParsedArchive, strategy: ImportStrategy): Promise<ImportPlan> {
    const current = await this.readAll();
    return planImport(parsed, current, strategy);
  }

  async applyImport(plan: ImportPlan, options: { backupAcknowledged?: boolean } = {}): Promise<ImportReport> {
    const db = this.require();
    const writer: ArchiveWriter = {
      transaction: async <T>(work: () => Promise<T>): Promise<T> =>
        db.transaction(
          'rw',
          [
            db.projects,
            db.entries,
            db.milestones,
            db.tasks,
            db.revisions,
            db.chapters,
            db.paths,
            db.places,
            db.people,
            db.trips,
            db.collections,
            db.links,
            db.searchIndex
          ],
          work
        ),
      upsert: async <K extends RecordKind>(kind: K, record: RecordTypeMap[K]): Promise<void> => {
        if (kind === 'projects') await db.projects.put(record as Project);
        if (kind === 'entries') await db.entries.put(record as JournalEntry);
        if (kind === 'milestones') await db.milestones.put(record as Milestone);
        if (kind === 'tasks') await db.tasks.put(record as Task);
        if (kind === 'revisions') await db.revisions.put(record as Revision);
        if (kind === 'chapters') await db.chapters.put(record as Chapter);
        if (kind === 'paths') await db.paths.put(record as Path);
        if (kind === 'places') await db.places.put(record as Place);
        if (kind === 'people') await db.people.put(record as Person);
        if (kind === 'trips') await db.trips.put(record as Trip);
        if (kind === 'collections') await db.collections.put(record as Collection);
        if (kind === 'links') await db.links.put(record as MemoryLink);
      },
      clearAll: async (): Promise<void> => {
        await Promise.all([
          db.projects.clear(),
          db.entries.clear(),
          db.milestones.clear(),
          db.tasks.clear(),
          db.revisions.clear(),
          db.chapters.clear(),
          db.paths.clear(),
          db.places.clear(),
          db.people.clear(),
          db.trips.clear(),
          db.collections.clear(),
          db.links.clear(),
          db.searchIndex.clear()
        ]);
      }
    };
    const report = await applyImport(plan, writer, options);
    if (report.ok) await this.rebuildSearchIndex();
    return report;
  }


  /* ---------------------------------------------------------------- *
   * Life archive (V0.2): chapters, paths, places, people, trips,
   * collections and memory links.
   *
   * Every write below is a single Dexie transaction that covers every table
   * it reads, so a relationship can never be half-written: linking an
   * experience to a chapter updates the entry and the chapter's own query in
   * the same commit. Nothing here logs or returns record text.
   * ---------------------------------------------------------------- */

  private async getLifeRecord<T extends RecordMeta>(table: Table<T, string>, id: string): Promise<T | null> {
    const record = await table.get(id);
    return record && !record.deleted_at ? record : null;
  }

  private async requireLive<T extends RecordMeta>(table: Table<T, string>, id: string, label: string): Promise<T> {
    const record = await table.get(id);
    if (!record) throw new Error(`That ${label} no longer exists.`);
    if (record.deleted_at) throw new Error(`That ${label} has been deleted.`);
    return record;
  }

  /* -- chapters ------------------------------------------------------ */

  async listChapters(filter: ChapterFilter = {}): Promise<Chapter[]> {
    const db = this.require();
    /* `toArray`, not `orderBy('start_date')`: a chapter whose start date is
       unknown stores `null` there, and Dexie skips records with a null index
       key. Sorting happens below, so a date-less era is still listed. */
    let chapters = await db.chapters.toArray();
    if (!filter.includeDeleted) chapters = chapters.filter((chapter) => !chapter.deleted_at);
    if (filter.statuses && filter.statuses.length > 0) {
      chapters = chapters.filter((chapter) => filter.statuses?.includes(chapter.status));
    }
    // Records with no start date sort last: an era whose start is unknown is
    // still a chapter, it simply cannot be placed on the axis.
    chapters.sort((a, b) => {
      if (a.start_date && b.start_date) return a.start_date.localeCompare(b.start_date);
      if (a.start_date) return -1;
      if (b.start_date) return 1;
      return compareIsoDesc(a.created_at, b.created_at);
    });
    return chapters.slice(0, filter.limit ?? 500);
  }

  async getChapter(id: string): Promise<Chapter | null> {
    return this.getLifeRecord(this.require().chapters, id);
  }

  async createChapter(input: ChapterInput): Promise<Chapter> {
    const chapter = buildChapter(input, { timezone: this.timezone() });
    await this.require().chapters.add(chapter);
    return chapter;
  }

  async updateChapter(id: string, changes: Partial<Chapter>): Promise<Chapter> {
    const db = this.require();
    const existing = await this.requireLive(db.chapters, id, 'chapter');
    const next = touch({ ...existing, ...changes, id: existing.id, created_at: existing.created_at });
    delete next.deleted_at;
    await db.chapters.put(next);
    return next;
  }

  async deleteChapter(id: string): Promise<Chapter> {
    const db = this.require();
    const existing = await this.requireLive(db.chapters, id, 'chapter');
    const stamp = nowIso();
    const tombstone: Chapter = { ...existing, deleted_at: stamp, updated_at: stamp, rev: existing.rev + 1 };
    await db.transaction('rw', [db.chapters, db.entries, db.links], async () => {
      await db.chapters.put(tombstone);
      // Experiences keep their words and their other links; only the membership
      // in this chapter is removed. Nothing is silently deleted with a chapter.
      const entries = await db.entries.toArray();
      for (const entry of entries) {
        if (!entry.links?.chapter_ids.includes(id)) continue;
        await db.entries.put(
          touch({
            ...entry,
            links: { ...entry.links, chapter_ids: entry.links.chapter_ids.filter((chapterId) => chapterId !== id) }
          })
        );
      }
      const links = await db.links.filter((link) => link.to_kind === 'chapter' && link.to_id === id).toArray();
      for (const link of links) {
        await db.links.put({ ...link, deleted_at: stamp, updated_at: stamp, rev: link.rev + 1 });
      }
    });
    return tombstone;
  }

  async restoreChapter(id: string): Promise<Chapter> {
    const db = this.require();
    const existing = await db.chapters.get(id);
    if (!existing) throw new Error('That chapter no longer exists.');
    // A restore brings the chapter back, never the memberships that were
    // removed when it was deleted: those are the user's edits, not the
    // chapter's data.
    const next: Chapter = touch({ ...existing });
    delete next.deleted_at;
    await db.chapters.put(next);
    return next;
  }

  /* -- paths --------------------------------------------------------- */

  async listPaths(filter: PathFilter = {}): Promise<Path[]> {
    const db = this.require();
    let paths = await db.paths.toArray();
    if (!filter.includeDeleted) paths = paths.filter((path) => !path.deleted_at);
    if (filter.states && filter.states.length > 0) paths = paths.filter((path) => filter.states?.includes(path.state));
    paths.sort((a, b) => compareIsoDesc(a.updated_at, b.updated_at));
    return paths.slice(0, filter.limit ?? 500);
  }

  async getPath(id: string): Promise<Path | null> {
    return this.getLifeRecord(this.require().paths, id);
  }

  async createPath(input: PathInput): Promise<Path> {
    const path = buildPath({ ...input, tags: normalizeTags(input.tags) }, { timezone: this.timezone() });
    await this.require().paths.add(path);
    return path;
  }

  async updatePath(id: string, changes: Partial<Path>): Promise<Path> {
    const db = this.require();
    const existing = await this.requireLive(db.paths, id, 'path');
    const next = touch({
      ...existing,
      ...changes,
      id: existing.id,
      created_at: existing.created_at,
      tags: changes.tags ? normalizeTags(changes.tags) : existing.tags
    });
    delete next.deleted_at;
    await db.paths.put(next);
    return next;
  }

  async deletePath(id: string): Promise<Path> {
    const db = this.require();
    const existing = await this.requireLive(db.paths, id, 'path');
    const stamp = nowIso();
    const tombstone: Path = { ...existing, deleted_at: stamp, updated_at: stamp, rev: existing.rev + 1 };
    await db.transaction('rw', [db.paths, db.entries, db.links], async () => {
      await db.paths.put(tombstone);
      const entries = await db.entries.toArray();
      for (const entry of entries) {
        if (!entry.links?.path_ids.includes(id)) continue;
        await db.entries.put(
          touch({
            ...entry,
            links: { ...entry.links, path_ids: entry.links.path_ids.filter((pathId) => pathId !== id) }
          })
        );
      }
      const links = await db.links.filter((link) => link.to_kind === 'path' && link.to_id === id).toArray();
      for (const link of links) {
        await db.links.put({ ...link, deleted_at: stamp, updated_at: stamp, rev: link.rev + 1 });
      }
    });
    return tombstone;
  }

  async restorePath(id: string): Promise<Path> {
    const db = this.require();
    const existing = await db.paths.get(id);
    if (!existing) throw new Error('That path no longer exists.');
    const next: Path = touch({ ...existing });
    delete next.deleted_at;
    await db.paths.put(next);
    return next;
  }

  /* -- places & people ----------------------------------------------- */

  async listPlaces(filter: LifeFilter = {}): Promise<Place[]> {
    const db = this.require();
    let places = await db.places.orderBy('name').toArray();
    if (!filter.includeDeleted) places = places.filter((place) => !place.deleted_at);
    return places.slice(0, filter.limit ?? 500);
  }

  async getPlace(id: string): Promise<Place | null> {
    return this.getLifeRecord(this.require().places, id);
  }

  async createPlace(input: PlaceInput): Promise<Place> {
    const place = buildPlace(input, { timezone: this.timezone() });
    await this.require().places.add(place);
    return place;
  }

  async updatePlace(id: string, changes: Partial<Place>): Promise<Place> {
    const db = this.require();
    const existing = await this.requireLive(db.places, id, 'place');
    const next = touch({ ...existing, ...changes, id: existing.id, created_at: existing.created_at });
    delete next.deleted_at;
    await db.places.put(next);
    return next;
  }

  async deletePlace(id: string): Promise<Place> {
    const db = this.require();
    const existing = await this.requireLive(db.places, id, 'place');
    const stamp = nowIso();
    const tombstone: Place = { ...existing, deleted_at: stamp, updated_at: stamp, rev: existing.rev + 1 };
    await db.transaction('rw', [db.places, db.trips, db.links], async () => {
      await db.places.put(tombstone);
      // Trips keep their dates and notes; the place association is removed.
      const trips = await db.trips.toArray();
      for (const trip of trips) {
        if (!trip.place_ids.includes(id)) continue;
        await db.trips.put(touch({ ...trip, place_ids: trip.place_ids.filter((placeId) => placeId !== id) }));
      }
      const links = await db.links.filter((link) => link.to_kind === 'place' && link.to_id === id).toArray();
      for (const link of links) {
        await db.links.put({ ...link, deleted_at: stamp, updated_at: stamp, rev: link.rev + 1 });
      }
    });
    return tombstone;
  }

  async restorePlace(id: string): Promise<Place> {
    const db = this.require();
    const existing = await db.places.get(id);
    if (!existing) throw new Error('That place no longer exists.');
    const next: Place = touch({ ...existing });
    delete next.deleted_at;
    await db.places.put(next);
    return next;
  }

  async listPeople(filter: LifeFilter = {}): Promise<Person[]> {
    const db = this.require();
    let people = await db.people.orderBy('name').toArray();
    if (!filter.includeDeleted) people = people.filter((person) => !person.deleted_at);
    return people.slice(0, filter.limit ?? 500);
  }

  async getPerson(id: string): Promise<Person | null> {
    return this.getLifeRecord(this.require().people, id);
  }

  async createPerson(input: PersonInput): Promise<Person> {
    const person = buildPerson(input, { timezone: this.timezone() });
    await this.require().people.add(person);
    return person;
  }

  async updatePerson(id: string, changes: Partial<Person>): Promise<Person> {
    const db = this.require();
    const existing = await this.requireLive(db.people, id, 'person');
    const next = touch({ ...existing, ...changes, id: existing.id, created_at: existing.created_at });
    delete next.deleted_at;
    await db.people.put(next);
    return next;
  }

  async deletePerson(id: string): Promise<Person> {
    const db = this.require();
    const existing = await this.requireLive(db.people, id, 'person');
    const stamp = nowIso();
    const tombstone: Person = { ...existing, deleted_at: stamp, updated_at: stamp, rev: existing.rev + 1 };
    await db.transaction('rw', [db.people, db.links], async () => {
      await db.people.put(tombstone);
      const links = await db.links.filter((link) => link.to_kind === 'person' && link.to_id === id).toArray();
      for (const link of links) {
        await db.links.put({ ...link, deleted_at: stamp, updated_at: stamp, rev: link.rev + 1 });
      }
    });
    return tombstone;
  }

  async restorePerson(id: string): Promise<Person> {
    const db = this.require();
    const existing = await db.people.get(id);
    if (!existing) throw new Error('That person no longer exists.');
    const next: Person = touch({ ...existing });
    delete next.deleted_at;
    await db.people.put(next);
    return next;
  }

  /* -- trips --------------------------------------------------------- */

  async listTrips(filter: LifeFilter = {}): Promise<Trip[]> {
    const db = this.require();
    let trips = await db.trips.toArray();
    if (!filter.includeDeleted) trips = trips.filter((trip) => !trip.deleted_at);
    trips.sort((a, b) => {
      if (a.start_date && b.start_date) return b.start_date.localeCompare(a.start_date);
      if (a.start_date) return -1;
      if (b.start_date) return 1;
      return compareIsoDesc(a.updated_at, b.updated_at);
    });
    return trips.slice(0, filter.limit ?? 200);
  }

  async getTrip(id: string): Promise<Trip | null> {
    return this.getLifeRecord(this.require().trips, id);
  }

  async createTrip(input: TripInput): Promise<Trip> {
    const trip = buildTrip(input, { timezone: this.timezone() });
    const db = this.require();
    if (trip.place_ids.length > 0) {
      const places = await db.places.bulkGet(trip.place_ids);
      if (places.some((place) => !place || place.deleted_at)) {
        throw new Error('A selected place does not exist any more.');
      }
    }
    await db.trips.add(trip);
    return trip;
  }

  async updateTrip(id: string, changes: Partial<Trip>): Promise<Trip> {
    const db = this.require();
    const existing = await this.requireLive(db.trips, id, 'trip');
    const next = touch({ ...existing, ...changes, id: existing.id, created_at: existing.created_at });
    delete next.deleted_at;
    await db.trips.put(next);
    return next;
  }

  async deleteTrip(id: string): Promise<Trip> {
    const db = this.require();
    const existing = await this.requireLive(db.trips, id, 'trip');
    const stamp = nowIso();
    const tombstone: Trip = { ...existing, deleted_at: stamp, updated_at: stamp, rev: existing.rev + 1 };
    await db.transaction('rw', [db.trips, db.links], async () => {
      await db.trips.put(tombstone);
      const links = await db.links.filter((link) => link.to_kind === 'trip' && link.to_id === id).toArray();
      for (const link of links) {
        await db.links.put({ ...link, deleted_at: stamp, updated_at: stamp, rev: link.rev + 1 });
      }
    });
    return tombstone;
  }

  async restoreTrip(id: string): Promise<Trip> {
    const db = this.require();
    const existing = await db.trips.get(id);
    if (!existing) throw new Error('That trip no longer exists.');
    const next: Trip = touch({ ...existing });
    delete next.deleted_at;
    await db.trips.put(next);
    return next;
  }

  /* -- collections --------------------------------------------------- */

  async listCollections(filter: LifeFilter = {}): Promise<Collection[]> {
    const db = this.require();
    let collections = await db.collections.toArray();
    if (!filter.includeDeleted) collections = collections.filter((collection) => !collection.deleted_at);
    collections.sort((a, b) => compareIsoDesc(a.updated_at, b.updated_at));
    return collections.slice(0, filter.limit ?? 200);
  }

  async getCollection(id: string): Promise<Collection | null> {
    return this.getLifeRecord(this.require().collections, id);
  }

  async createCollection(input: CollectionInput): Promise<Collection> {
    const collection = buildCollection(input, { timezone: this.timezone() });
    await this.require().collections.add(collection);
    return collection;
  }

  async updateCollection(id: string, changes: Partial<Collection>): Promise<Collection> {
    const db = this.require();
    const existing = await this.requireLive(db.collections, id, 'collection');
    const next = touch({ ...existing, ...changes, id: existing.id, created_at: existing.created_at });
    delete next.deleted_at;
    await db.collections.put(next);
    return next;
  }

  async deleteCollection(id: string): Promise<Collection> {
    const db = this.require();
    const existing = await this.requireLive(db.collections, id, 'collection');
    const stamp = nowIso();
    const tombstone: Collection = { ...existing, deleted_at: stamp, updated_at: stamp, rev: existing.rev + 1 };
    await db.collections.put(tombstone);
    return tombstone;
  }

  async restoreCollection(id: string): Promise<Collection> {
    const db = this.require();
    const existing = await db.collections.get(id);
    if (!existing) throw new Error('That collection no longer exists.');
    const next: Collection = touch({ ...existing });
    delete next.deleted_at;
    await db.collections.put(next);
    return next;
  }

  /* -- memory links -------------------------------------------------- */

  async listLinks(filter: LinkFilter = {}): Promise<MemoryLink[]> {
    const db = this.require();
    let links = await db.links.toArray();
    // `includeDeleted` controls both the link's own tombstone and the
    // tombstones of the records it points at: a link to a deleted experience
    // is not a live connection.
    if (!filter.includeDeleted) links = links.filter((link) => !link.deleted_at);
    if (!filter.includeDeleted) {
      const [entries, chapters, paths, places, people, trips, collections] = await Promise.all([
        db.entries.toArray(),
        db.chapters.toArray(),
        db.paths.toArray(),
        db.places.toArray(),
        db.people.toArray(),
        db.trips.toArray(),
        db.collections.toArray()
      ]);
      const live = (list: { id: string; deleted_at?: IsoDateTime | null }[]): Set<string> =>
        new Set(list.filter((record) => !record.deleted_at).map((record) => record.id));
      const living: Record<MemoryLink['from_kind'], Set<string>> = {
        entry: live(entries),
        chapter: live(chapters),
        path: live(paths),
        place: live(places),
        person: live(people),
        trip: live(trips),
        collection: live(collections)
      };
      links = links.filter(
        (link) => living[link.from_kind].has(link.from_id) && living[link.to_kind].has(link.to_id)
      );
    }
    if (filter.status) links = links.filter((link) => link.status === filter.status);
    if (filter.recordId) {
      links = links.filter((link) => link.from_id === filter.recordId || link.to_id === filter.recordId);
    }
    links.sort((a, b) => compareIsoDesc(a.updated_at, b.updated_at));
    return links.slice(0, filter.limit ?? 1000);
  }

  async createLink(input: MemoryLinkInput): Promise<MemoryLink> {
    const db = this.require();
    const link = buildMemoryLink(input, { timezone: this.timezone() });
    if (!link.from_id || !link.to_id) throw new Error('A link needs two records.');
    if (link.from_id === link.to_id) throw new Error('A record cannot be linked to itself.');
    if (link.to_kind === 'entry') await this.requireLive(db.entries, link.to_id, 'experience');
    if (link.from_kind === 'entry') await this.requireLive(db.entries, link.from_id, 'experience');
    const duplicate = await this.samePair(link);
    if (duplicate) return duplicate;
    await db.links.add(link);
    return link;
  }

  async setLinkStatus(id: string, status: MemoryLinkStatus): Promise<MemoryLink> {
    const db = this.require();
    const existing = await this.requireLive(db.links, id, 'link');
    const next = touch({ ...existing, status });
    delete next.deleted_at;
    await db.links.put(next);
    return next;
  }

  async deleteLink(id: string): Promise<MemoryLink> {
    const db = this.require();
    const existing = await this.requireLive(db.links, id, 'link');
    const stamp = nowIso();
    const tombstone: MemoryLink = { ...existing, deleted_at: stamp, updated_at: stamp, rev: existing.rev + 1 };
    await db.links.put(tombstone);
    return tombstone;
  }

  /** Approved connections for the map: never a suggestion, never a tombstone. */
  async approvedLinks(): Promise<MemoryLink[]> {
    const links = await this.listLinks({ limit: 5000 });
    return links.filter((link) => link.status === 'confirmed');
  }

  private async samePair(link: MemoryLink): Promise<MemoryLink | null> {
    const db = this.require();
    const links = await db.links.toArray();
    const same = (candidate: MemoryLink): boolean =>
      !candidate.deleted_at &&
      ((candidate.from_kind === link.from_kind &&
        candidate.from_id === link.from_id &&
        candidate.to_kind === link.to_kind &&
        candidate.to_id === link.to_id) ||
        (candidate.from_kind === link.to_kind &&
          candidate.from_id === link.to_id &&
          candidate.to_kind === link.from_kind &&
          candidate.to_id === link.from_id));
    return links.find(same) ?? null;
  }

  /* -- experience relationships -------------------------------------- */

  /**
   * Replace the chapters/paths an experience belongs to. Both sides of the
   * relationship are written in one transaction: the entry gets its links and
   * each chapter/path is verified to exist. Removing a membership is a user
   * edit, so a slug is never re-added implicitly later.
   */
  async setEntryRelations(id: string, relations: { chapter_ids?: string[]; path_ids?: string[] }): Promise<JournalEntry> {
    const db = this.require();
    const existing = await this.requireLive(db.entries, id, 'experience');
    if (relations.chapter_ids) {
      const chapters = await db.chapters.bulkGet(relations.chapter_ids);
      if (chapters.some((chapter) => !chapter || chapter.deleted_at)) {
        throw new Error('A selected chapter does not exist any more.');
      }
    }
    if (relations.path_ids) {
      const paths = await db.paths.bulkGet(relations.path_ids);
      if (paths.some((path) => !path || path.deleted_at)) {
        throw new Error('A selected path does not exist any more.');
      }
    }
    const links = {
      chapter_ids: relations.chapter_ids ?? existing.links?.chapter_ids ?? [],
      path_ids: relations.path_ids ?? existing.links?.path_ids ?? []
    };
    const next = touch({ ...existing, links });
    delete next.deleted_at;
    await db.entries.put(next);
    await this.indexRecord('entries', next);
    return next;
  }

  /** Experiences that belong to a chapter, newest first. */
  async entriesForChapter(chapterId: string): Promise<JournalEntry[]> {
    const entries = await this.require().entries.toArray();
    return entries
      .filter((entry) => !entry.deleted_at && entry.links?.chapter_ids.includes(chapterId))
      .sort((a, b) => compareIsoDesc(a.occurred_at, b.occurred_at));
  }

  /** Experiences linked to a path, newest first. */
  async entriesForPath(pathId: string): Promise<JournalEntry[]> {
    const entries = await this.require().entries.toArray();
    return entries
      .filter((entry) => !entry.deleted_at && entry.links?.path_ids.includes(pathId))
      .sort((a, b) => compareIsoDesc(a.occurred_at, b.occurred_at));
  }

  /** One read for the Life Map: every live record it can draw. */
  async lifeMapSource(): Promise<LifeMapSource> {
    const [records, links] = await Promise.all([this.readAll(), this.listLinks({ limit: 5000 })]);
    return {
      entries: records.entries.filter((entry) => !entry.deleted_at),
      chapters: records.chapters.filter((chapter) => !chapter.deleted_at),
      paths: records.paths.filter((path) => !path.deleted_at),
      places: records.places.filter((place) => !place.deleted_at),
      people: records.people.filter((person) => !person.deleted_at),
      trips: records.trips.filter((trip) => !trip.deleted_at),
      collections: records.collections.filter((collection) => !collection.deleted_at),
      links
    };
  }

  /* ---------------------------------------------------------------- *
   * Housekeeping
   * ---------------------------------------------------------------- */

  async stats(): Promise<ArchiveStats> {
    const db = this.require();
    const [projects, entries, milestones, tasks, tags] = await Promise.all([
      db.projects.toArray(),
      db.entries.toArray(),
      db.milestones.toArray(),
      db.tasks.toArray(),
      this.listTags()
    ]);
    const live = (list: { deleted_at?: IsoDateTime | null }[]): number => list.filter((record) => !record.deleted_at).length;
    const liveEntries = entries.filter((entry) => !entry.deleted_at);
    const sorted = liveEntries.map((entry) => entry.occurred_at).sort();
    const bytes = JSON.stringify({ projects, entries, milestones, tasks }).length;
    return {
      projects: live(projects),
      activeProjects: projects.filter(
        (project) => !project.deleted_at && project.status !== 'archived' && project.status !== 'paused'
      ).length,
      entries: liveEntries.length,
      milestones: live(milestones),
      openTasks: tasks.filter((task) => !task.deleted_at && task.status !== 'done' && task.status !== 'dropped').length,
      tags: tags.length,
      deletedRecords:
        projects.filter((project) => project.deleted_at).length +
        entries.filter((entry) => entry.deleted_at).length +
        milestones.filter((milestone) => milestone.deleted_at).length +
        tasks.filter((task) => task.deleted_at).length,
      oldestEntry: sorted[0] ?? null,
      newestEntry: sorted.length > 0 ? (sorted[sorted.length - 1] as IsoDateTime) : null,
      bytesEstimate: bytes
    };
  }

  async listDeleted(): Promise<DeletedRecordSummary[]> {
    const db = this.require();
    const [projects, entries, milestones, tasks, chapters, paths, places, people, trips, collections, links] =
      await Promise.all([
        db.projects.filter((record) => Boolean(record.deleted_at)).toArray(),
        db.entries.filter((record) => Boolean(record.deleted_at)).toArray(),
        db.milestones.filter((record) => Boolean(record.deleted_at)).toArray(),
        db.tasks.filter((record) => Boolean(record.deleted_at)).toArray(),
        db.chapters.filter((record) => Boolean(record.deleted_at)).toArray(),
        db.paths.filter((record) => Boolean(record.deleted_at)).toArray(),
        db.places.filter((record) => Boolean(record.deleted_at)).toArray(),
        db.people.filter((record) => Boolean(record.deleted_at)).toArray(),
        db.trips.filter((record) => Boolean(record.deleted_at)).toArray(),
        db.collections.filter((record) => Boolean(record.deleted_at)).toArray(),
        db.links.filter((record) => Boolean(record.deleted_at)).toArray()
      ]);
    const summary: DeletedRecordSummary[] = [
      ...projects.map((project) => ({ kind: 'projects' as RecordKind, id: project.id, label: project.name, deleted_at: project.deleted_at as IsoDateTime })),
      ...entries.map((entry) => ({
        kind: 'entries' as RecordKind,
        id: entry.id,
        label: entry.title || firstLine(entry.body) || 'Untitled entry',
        deleted_at: entry.deleted_at as IsoDateTime
      })),
      ...milestones.map((milestone) => ({ kind: 'milestones' as RecordKind, id: milestone.id, label: milestone.title, deleted_at: milestone.deleted_at as IsoDateTime })),
      ...tasks.map((task) => ({ kind: 'tasks' as RecordKind, id: task.id, label: task.title, deleted_at: task.deleted_at as IsoDateTime })),
      ...chapters.map((chapter) => ({ kind: 'chapters' as RecordKind, id: chapter.id, label: chapter.name, deleted_at: chapter.deleted_at as IsoDateTime })),
      ...paths.map((path) => ({ kind: 'paths' as RecordKind, id: path.id, label: path.title, deleted_at: path.deleted_at as IsoDateTime })),
      ...places.map((place) => ({ kind: 'places' as RecordKind, id: place.id, label: place.name, deleted_at: place.deleted_at as IsoDateTime })),
      ...people.map((person) => ({ kind: 'people' as RecordKind, id: person.id, label: person.name, deleted_at: person.deleted_at as IsoDateTime })),
      ...trips.map((trip) => ({ kind: 'trips' as RecordKind, id: trip.id, label: trip.name, deleted_at: trip.deleted_at as IsoDateTime })),
      ...collections.map((collection) => ({ kind: 'collections' as RecordKind, id: collection.id, label: collection.name, deleted_at: collection.deleted_at as IsoDateTime })),
      ...links.map((link) => ({ kind: 'links' as RecordKind, id: link.id, label: link.role, deleted_at: link.deleted_at as IsoDateTime }))
    ];
    return summary.sort((a, b) => compareIsoDesc(a.deleted_at, b.deleted_at));
  }

  async restoreRecord(kind: RecordKind, id: string): Promise<boolean> {
    // A record can vanish between listing deletions and restoring one (another
    // tab, a purge). That is reported as "not restored", never as a crash.
    try {
      if (kind === 'projects') return Boolean(await this.restoreProject(id));
      if (kind === 'entries') return Boolean(await this.restoreEntry(id));
      if (kind === 'milestones') return Boolean(await this.restoreMilestone(id));
      if (kind === 'tasks') return Boolean(await this.restoreTask(id));
      if (kind === 'chapters') return Boolean(await this.restoreChapter(id));
      if (kind === 'paths') return Boolean(await this.restorePath(id));
      if (kind === 'places') return Boolean(await this.restorePlace(id));
      if (kind === 'people') return Boolean(await this.restorePerson(id));
      if (kind === 'trips') return Boolean(await this.restoreTrip(id));
      if (kind === 'collections') return Boolean(await this.restoreCollection(id));
      if (kind === 'links') {
        // A link can only come back while both of its ends are still live.
        const link = await this.require().links.get(id);
        if (!link) return false;
        const next = touch({ ...link }) as MemoryLink & { deleted_at?: IsoDateTime | null };
        delete next.deleted_at;
        await this.require().links.put(next);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  /** Permanently remove tombstoned records. Irreversible and explicit. */
  async purgeDeleted(): Promise<number> {
    const db = this.require();
    let removed = 0;
    await db.transaction(
      'rw',
      [
        db.projects,
        db.entries,
        db.milestones,
        db.tasks,
        db.revisions,
        db.chapters,
        db.paths,
        db.places,
        db.people,
        db.trips,
        db.collections,
        db.links,
        db.searchIndex
      ],
      async () => {
      const collect = async <T extends { id: string; deleted_at?: IsoDateTime | null }>(
        table: { filter(fn: (record: T) => boolean): { toArray(): Promise<T[]>; delete(): Promise<number> } }
      ): Promise<number> => {
        const stale = await table.filter((record) => Boolean(record.deleted_at)).toArray();
        const ids = stale.map((record) => record.id);
        if (ids.length === 0) return 0;
        return table.filter((record) => Boolean(record.deleted_at)).delete();
      };
      removed += await collect<Project>(db.projects);
      removed += await collect<JournalEntry>(db.entries);
      removed += await collect<Milestone>(db.milestones);
      removed += await collect<Task>(db.tasks);
      removed += await collect<Chapter>(db.chapters);
      removed += await collect<Path>(db.paths);
      removed += await collect<Place>(db.places);
      removed += await collect<Person>(db.people);
      removed += await collect<Trip>(db.trips);
      removed += await collect<Collection>(db.collections);
      removed += await collect<MemoryLink>(db.links);
      // Revisions of purged entries go too.
      const liveProjects = await db.projects.toArray();
      const liveEntries = await db.entries.toArray();
      const liveMilestones = await db.milestones.toArray();
      const liveTasks = await db.tasks.toArray();
      const projectIds = new Set(liveProjects.map((project) => project.id));
      const entryIds = new Set(liveEntries.map((entry) => entry.id));
      const milestoneIds = new Set(liveMilestones.map((milestone) => milestone.id));

      const revisions = await db.revisions.toArray();
      const orphans = revisions.filter((revision) => !entryIds.has(revision.entry_id)).map((revision) => revision.id);
      if (orphans.length > 0) {
        await db.revisions.bulkDelete(orphans);
        removed += orphans.length;
      }

      // Now that the records are really gone, clear the references that
      // pointed at them. A dangling id would otherwise survive forever.
      const stamp = nowIso();
      const kept = <T>(value: T | null | undefined, ids: Set<string>): T | null =>
        value != null && ids.has(value as unknown as string) ? value : null;

      for (const entry of liveEntries) {
        const projectId = kept(entry.project_id, projectIds);
        const milestoneId = kept(entry.milestone_id, milestoneIds);
        const related = (entry.related_entry_ids ?? []).filter((related) => entryIds.has(related));
        if (
          projectId === (entry.project_id ?? null) &&
          milestoneId === (entry.milestone_id ?? null) &&
          related.length === (entry.related_entry_ids ?? []).length
        ) {
          continue;
        }
        await db.entries.put({
          ...entry,
          project_id: projectId,
          milestone_id: milestoneId,
          related_entry_ids: related,
          updated_at: stamp,
          rev: entry.rev + 1
        });
      }
      for (const task of liveTasks) {
        const projectId = kept(task.project_id, projectIds);
        const sourceEntryId = kept(task.source_entry_id, entryIds);
        if (projectId === (task.project_id ?? null) && sourceEntryId === (task.source_entry_id ?? null)) continue;
        await db.tasks.put({
          ...task,
          project_id: projectId,
          source_entry_id: sourceEntryId,
          updated_at: stamp,
          rev: task.rev + 1
        });
      }
      for (const milestone of liveMilestones) {
        const projectId = kept(milestone.project_id, projectIds);
        const linked = (milestone.entry_ids ?? []).filter((entryId) => entryIds.has(entryId));
        if (projectId === (milestone.project_id ?? null) && linked.length === (milestone.entry_ids ?? []).length) continue;
        await db.milestones.put({
          ...milestone,
          project_id: projectId,
          entry_ids: linked,
          updated_at: stamp,
          rev: milestone.rev + 1
        });
      }
      for (const project of liveProjects) {
        const linked = (project.linked_project_ids ?? []).filter((other) => projectIds.has(other));
        if (linked.length === (project.linked_project_ids ?? []).length) continue;
        await db.projects.put({ ...project, linked_project_ids: linked, updated_at: stamp, rev: project.rev + 1 });
      }
      // Life-archive references: a permanently removed chapter, path, place,
      // person or experience must not linger inside any surviving record.
      const liveChapters = await db.chapters.toArray();
      const livePaths = await db.paths.toArray();
      const livePlaces = await db.places.toArray();
      const livePeople = await db.people.toArray();
      const liveTrips = await db.trips.toArray();
      const liveCollections = await db.collections.toArray();
      const chapterIds = new Set(liveChapters.map((chapter) => chapter.id));
      const pathIds = new Set(livePaths.map((path) => path.id));
      const placeIds = new Set(livePlaces.map((place) => place.id));
      const personIds = new Set(livePeople.map((person) => person.id));
      const tripIds = new Set(liveTrips.map((trip) => trip.id));
      const collectionIds = new Set(liveCollections.map((collection) => collection.id));

      for (const entry of liveEntries) {
        if (!entry.links) continue;
        const chapters = entry.links.chapter_ids.filter((chapterId) => chapterIds.has(chapterId));
        const paths = entry.links.path_ids.filter((pathId) => pathIds.has(pathId));
        if (chapters.length === entry.links.chapter_ids.length && paths.length === entry.links.path_ids.length) continue;
        await db.entries.put(
          touch({ ...entry, links: { chapter_ids: chapters, path_ids: paths } }, stamp)
        );
      }
      for (const trip of liveTrips) {
        const places = trip.place_ids.filter((placeId) => placeIds.has(placeId));
        if (places.length === trip.place_ids.length) continue;
        await db.trips.put(touch({ ...trip, place_ids: places }, stamp));
      }
      for (const collection of liveCollections) {
        const entries = collection.entry_ids.filter((entryId) => entryIds.has(entryId));
        if (entries.length === collection.entry_ids.length) continue;
        await db.collections.put(touch({ ...collection, entry_ids: entries }, stamp));
      }
      // A link survives only if both of its ends still exist.
      const linkEndExists = (kindName: MemoryLink['from_kind'], kindId: string): boolean => {
        if (kindName === 'entry') return entryIds.has(kindId);
        if (kindName === 'chapter') return chapterIds.has(kindId);
        if (kindName === 'path') return pathIds.has(kindId);
        if (kindName === 'place') return placeIds.has(kindId);
        if (kindName === 'person') return personIds.has(kindId);
        if (kindName === 'trip') return tripIds.has(kindId);
        if (kindName === 'collection') return collectionIds.has(kindId);
        return false;
      };
      const survivingLinks = await db.links.toArray();
      const dangling = survivingLinks
        .filter((link) => !linkEndExists(link.from_kind, link.from_id) || !linkEndExists(link.to_kind, link.to_id))
        .map((link) => link.id);
      if (dangling.length > 0) {
        await db.links.bulkDelete(dangling);
        removed += dangling.length;
      }
      // Re-index anything that changed so search never points at a dead record.
      await this.rebuildSearchIndex();
    });
    return removed;
  }

  async clearAll(): Promise<void> {
    const db = this.require();
    await db.transaction(
      'rw',
      [
        db.projects,
        db.entries,
        db.milestones,
        db.tasks,
        db.revisions,
        db.chapters,
        db.paths,
        db.places,
        db.people,
        db.trips,
        db.collections,
        db.links,
        db.searchIndex,
        db.meta
      ],
      async () => {
        await Promise.all([
          db.projects.clear(),
          db.entries.clear(),
          db.milestones.clear(),
          db.tasks.clear(),
          db.revisions.clear(),
          db.chapters.clear(),
          db.paths.clear(),
          db.places.clear(),
          db.people.clear(),
          db.trips.clear(),
          db.collections.clear(),
          db.links.clear(),
          db.searchIndex.clear(),
          db.meta.delete(LAST_COMMIT_KEY)
        ]);
      }
    );
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Restoring a record removes the tombstone key altogether, so exports and
 * revisions never carry a `deleted_at: null` that reads like a real value.
 */
/** Bump a record's revision and timestamp for an in-place update. */
function touch<T extends { updated_at: string; rev: number }>(record: T, stamp: IsoDateTime = nowIso()): T {
  return { ...record, updated_at: stamp, rev: record.rev + 1 };
}

function clearTombstone(record: { deleted_at?: string | null }): void {
  if (record.deleted_at == null) delete record.deleted_at;
}

export function normalizeSettings(stored: Partial<AppSettings> | null | undefined): AppSettings {
  const base: AppSettings = { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai } };
  if (!stored) return base;
  // "device" must survive a round trip: resolving it here would freeze the
  // timezone to wherever the settings were last written.
  const timezone =
    stored.timezone === 'device' || stored.timezone === undefined || stored.timezone === null
      ? 'device'
      : isValidTimeZone(stored.timezone)
        ? stored.timezone
        : base.timezone;
  return {
    ...base,
    ...stored,
    schema_version: Number.isFinite(stored.schema_version) ? Number(stored.schema_version) : base.schema_version,
    theme: stored.theme === 'light' || stored.theme === 'dark' || stored.theme === 'system' ? stored.theme : base.theme,
    capture_mode:
      stored.capture_mode === 'quick' || stored.capture_mode === 'review' || stored.capture_mode === 'autonomous'
        ? stored.capture_mode
        : base.capture_mode,
    timezone,
    reduce_motion: Boolean(stored.reduce_motion),
    sidebar_pinned: stored.sidebar_pinned !== false,
    onboarded: Boolean(stored.onboarded),
    app_version: typeof stored.app_version === 'string' && stored.app_version ? stored.app_version : base.app_version,
    ai: {
      // Off unless explicitly enabled; an API key is never part of stored settings.
      enabled: Boolean(stored.ai?.enabled),
      provider: stored.ai?.provider === 'http' ? 'http' : 'none',
      endpoint: typeof stored.ai?.endpoint === 'string' ? stored.ai.endpoint : '',
      model: typeof stored.ai?.model === 'string' ? stored.ai.model : '',
      allow_private: Boolean(stored.ai?.allow_private),
      disclosure_acknowledged_at:
        typeof stored.ai?.disclosure_acknowledged_at === 'string' &&
        isValidIsoDateTime(stored.ai.disclosure_acknowledged_at)
          ? stored.ai.disclosure_acknowledged_at
          : null
    }
  };
}

function firstLine(body: string): string {
  return body.split('\n')[0]?.trim() ?? '';
}

/** True when a record was materially edited after it was created. */
function wasEdited(record: { created_at: string; updated_at: string; rev: number }): boolean {
  return record.rev > 1 && record.updated_at !== record.created_at;
}

/** Convenience for tests and diagnostics. */
export function kindLabel(kind: RecordKind): string {
  return kind;
}

export const ALL_KINDS: readonly RecordKind[] = RECORD_KINDS;
export type { EntryType, IsoDate };
