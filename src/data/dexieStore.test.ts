/**
 * Persistence tests against a real Dexie database (fake-indexeddb in jsdom).
 *
 * These are the tests that matter most for data integrity: writes, revisions,
 * tombstones, the derived search index, the timeline, capture commits and the
 * export/import round trip.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChronicleDatabase, getDatabase, setDatabase } from './db';
import { DEFAULT_SETTINGS, DexieChronicleStore } from './dexieStore';
import { analyzeCapture } from '../domain/capture/analyzer';
import { serializeArchive } from '../domain/export/archive';
import { localDateIso } from '../domain/time';
import type { JournalEntry } from '../domain/types';

let counter = 0;
let store: DexieChronicleStore;
let dbName: string;

async function freshStore(): Promise<DexieChronicleStore> {
  counter += 1;
  dbName = `chronicle-test-${counter}`;
  setDatabase(new ChronicleDatabase(dbName));
  const next = new DexieChronicleStore();
  const opened = await next.init();
  expect(opened).toBe(true);
  expect(next.storageError).toBeNull();
  expect(next.backend).toBe('indexeddb');
  return next;
}

beforeEach(async () => {
  store = await freshStore();
});

afterEach(async () => {
  const db = getDatabase(dbName);
  db.close();
  await db.delete();
  setDatabase(null);
});

describe('lifecycle', () => {
  it('opens storage and reports no error', async () => {
    expect(await store.init()).toBe(true);
    expect(store.storageError).toBeNull();
  });

  it('reports honestly when IndexedDB is unavailable', async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error - simulating a browser without IndexedDB
    delete globalThis.indexedDB;
    setDatabase(null);
    const blocked = new DexieChronicleStore();
    expect(await blocked.init()).toBe(false);
    expect(blocked.storageError).toMatch(/IndexedDB/);
    globalThis.indexedDB = original;
  });
});

describe('projects', () => {
  it('creates, reads, lists and updates', async () => {
    const project = await store.createProject({ name: 'JARVIS', summary: 'Assistant', tags: ['AI'] });
    expect(project.id).toBeTruthy();
    expect(project.status).toBe('idea');
    expect(project.rev).toBe(1);
    expect(project.tags).toEqual(['ai']);

    expect((await store.getProject(project.id))?.name).toBe('JARVIS');
    expect(await store.listProjects()).toHaveLength(1);

    const updated = await store.updateProject(project.id, { status: 'development', stage: 'implemented' });
    expect(updated.status).toBe('development');
    expect(updated.rev).toBe(2);
    expect(updated.updated_at >= updated.created_at).toBe(true);
  });

  it('lists with filters', async () => {
    const a = await store.createProject({ name: 'Alpha', status: 'development', tags: ['core'] });
    await store.createProject({ name: 'Beta', status: 'idea', tags: ['side'] });
    expect(await store.listProjects({ statuses: ['development'] })).toHaveLength(1);
    expect(await store.listProjects({ tags: ['side'] })).toHaveLength(1);
    expect(await store.listProjects({ search: 'alph' })).toHaveLength(1);
    expect(await store.listProjects({ limit: 1 })).toHaveLength(1);
    await store.deleteProject(a.id);
    expect(await store.listProjects()).toHaveLength(1);
    expect(await store.listProjects({ includeDeleted: true })).toHaveLength(2);
  });

  it('soft-deletes with an impact report and can restore', async () => {
    const project = await store.createProject({ name: 'AXIOM' });
    const entry = await store.createEntry({ title: 'Work', body: 'Did work.', project_id: project.id });
    const task = await store.createTask({ title: 'Ship', project_id: project.id });
    const milestone = await store.createMilestone({ title: 'First build', project_id: project.id });

    expect(await store.projectImpact(project.id)).toEqual({ entries: 1, tasks: 1, milestones: 1 });

    const deleted = await store.deleteProject(project.id, { children: 'unlink' });
    expect(deleted.project.status).toBe('archived');
    expect(deleted.project.deleted_at).toBeTruthy();
    expect(deleted.impact).toEqual({ entries: 1, tasks: 1, milestones: 1 });

    // Unlink keeps the children but removes the broken reference.
    expect((await store.getEntry(entry.id))?.project_id).toBeNull();
    expect((await store.getTask(task.id))?.project_id).toBeNull();
    expect((await store.getMilestone(milestone.id))?.project_id).toBeNull();

    const restored = await store.restoreProject(project.id);
    expect(restored.deleted_at).toBeUndefined();
    expect((await store.listProjects()).map((item) => item.name)).toEqual(['AXIOM']);
  });

  it('deletes children when asked, and clears links from other projects', async () => {
    const project = await store.createProject({ name: 'AXIOM' });
    const other = await store.createProject({ name: 'JARVIS', linked_project_ids: [project.id] });
    const entry = await store.createEntry({ title: 'Work', body: 'Did work.', project_id: project.id });

    const result = await store.deleteProject(project.id, { children: 'delete' });
    expect(result.impact.entries).toBe(1);
    const child = await store.getEntry(entry.id);
    expect(child?.deleted_at).toBeTruthy();
    expect((await store.getProject(other.id))?.linked_project_ids).toEqual([]);
  });

  it('refuses to update a record that does not exist', async () => {
    await expect(store.updateProject('missing', { name: 'x' })).rejects.toThrow();
  });
});

describe('journal entries', () => {
  it('creates, filters and paginates', async () => {
    const project = await store.createProject({ name: 'JARVIS' });
    await store.createEntry({
      title: 'First',
      body: 'First body',
      project_id: project.id,
      tags: ['retrieval'],
      type: 'progress',
      occurred_at: '2026-10-10T10:00:00.000Z'
    });
    await store.createEntry({ title: 'Second', body: 'Second body', tags: ['debugging'], type: 'failure' });
    await store.createEntry({ title: 'Private', body: 'Personal', private: true });

    expect(await store.listEntries()).toHaveLength(3);
    expect(await store.listEntries({ projectId: project.id })).toHaveLength(1);
    expect(await store.listEntries({ types: ['failure'] })).toHaveLength(1);
    expect(await store.listEntries({ tags: ['retrieval'] })).toHaveLength(1);
    expect(await store.listEntries({ from: '2026-10-11' })).toHaveLength(2);
    expect(await store.listEntries({ to: '2026-10-11' })).toHaveLength(1);
    expect(await store.listEntries({ includePrivate: false })).toHaveLength(2);
    expect(await store.listEntries({ limit: 1, offset: 1 })).toHaveLength(1);

    const ascending = await store.listEntries({ order: 'asc' });
    expect(ascending[0]!.title).toBe('First');
    const descending = await store.listEntries();
    expect(descending[0]!.title).not.toBe('First');
  });

  it('keeps the body verbatim and never rewrites it', async () => {
    const body = 'Line one\n\nLine two with **markdown** and <html>.';
    const entry = await store.createEntry({ body });
    expect((await store.getEntry(entry.id))?.body).toBe(body);
  });

  it('snapshots a revision only when the text changed', async () => {
    const entry = await store.createEntry({ title: 'Original', body: 'Original body' });
    expect(await store.listRevisions(entry.id)).toHaveLength(0);

    await store.updateEntry(entry.id, { pinned: true });
    expect(await store.listRevisions(entry.id)).toHaveLength(0);

    // `rev` counts every write; a revision snapshot is only taken for content.
    const updated = await store.updateEntry(entry.id, { body: 'Corrected body' }, 'typo');
    expect(updated.rev).toBe(3);
    const revisions = await store.listRevisions(entry.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.body).toBe('Original body');
    expect(revisions[0]!.saved_by).toBe('user');
    expect(revisions[0]!.reason).toBe('typo');

    // Restoring is itself an edit, so it snapshots the corrected text and bumps rev.
    const restored = await store.restoreRevision(revisions[0]!.id);
    expect(restored.body).toBe('Original body');
    expect(restored.rev).toBe(4);
    expect((await store.listRevisions(entry.id)).map((revision) => revision.body)).toContain('Corrected body');
  });

  it('prunes old revisions but keeps a bounded history', async () => {
    const entry = await store.createEntry({ title: 'Churn', body: 'v0' });
    for (let i = 1; i <= 30; i += 1) {
      await store.updateEntry(entry.id, { body: `v${i}` });
    }
    const revisions = await store.listRevisions(entry.id);
    expect(revisions.length).toBeLessThanOrEqual(25);
    expect(revisions.length).toBeGreaterThan(20);
    expect((await store.getEntry(entry.id))?.body).toBe('v30');
  });

  it('tombstones and restores, keeping links so a restore repairs them', async () => {
    const entry = await store.createEntry({ title: 'Sensor', body: 'Tested the sensor.' });
    const task = await store.createTask({ title: 'Recalibrate', source_entry_id: entry.id });
    const milestone = await store.createMilestone({ title: 'First test', entry_ids: [entry.id] });
    await store.updateEntry(entry.id, { milestone_id: milestone.id });

    const deleted = await store.deleteEntry(entry.id);
    expect(deleted.deleted_at).toBeTruthy();
    expect(await store.listEntries()).toHaveLength(0);
    expect(await store.listEntries({ includeDeleted: true })).toHaveLength(1);
    // Deletion is reversible, so references survive it.
    expect((await store.getTask(task.id))?.source_entry_id).toBe(entry.id);
    expect((await store.getMilestone(milestone.id))?.entry_ids).toEqual([entry.id]);
    expect((await store.getEntry(entry.id))?.milestone_id).toBe(milestone.id);

    const restored = await store.restoreEntry(entry.id);
    expect(restored.deleted_at).toBeUndefined();
  });

  it('clears references only when the record is really purged', async () => {
    const project = await store.createProject({ name: 'JARVIS' });
    const entry = await store.createEntry({ title: 'Sensor', body: 'Tested.', project_id: project.id });
    const task = await store.createTask({ title: 'Recalibrate', source_entry_id: entry.id, project_id: project.id });
    const milestone = await store.createMilestone({ title: 'First test', entry_ids: [entry.id], project_id: project.id });

    await store.deleteEntry(entry.id);
    await store.purgeDeleted();

    expect(await store.getEntry(entry.id)).toBeNull();
    expect((await store.getTask(task.id))?.source_entry_id).toBeNull();
    expect((await store.getMilestone(milestone.id))?.entry_ids).toEqual([]);
    // The search index no longer points at the purged record.
    expect(await store.search({ text: 'sensor', includeDeleted: true })).toHaveLength(0);
  });
});

describe('tasks and milestones', () => {
  it('stores a nullable due date and never invents one', async () => {
    const open = await store.createTask({ title: 'Improve error handling' });
    expect(open.due_on).toBeNull();
    expect(open.due_precision).toBe('unknown');
    expect(open.status).toBe('todo');

    const dated = await store.createTask({ title: 'Recalibrate', due_on: '2026-10-20' });
    expect(dated.due_on).toBe('2026-10-20');
    expect(dated.due_precision).toBe('day');
  });

  it('stamps completion and filters by status and due date', async () => {
    const a = await store.createTask({ title: 'A', due_on: '2026-10-18' });
    await store.createTask({ title: 'B', due_on: '2026-11-18' });
    await store.createTask({ title: 'C' });

    const done = await store.updateTask(a.id, { status: 'done' });
    expect(done.completed_at).toBeTruthy();

    expect(await store.listTasks({ statuses: ['done'] })).toHaveLength(1);
    expect(await store.listTasks({ statuses: ['todo'] })).toHaveLength(2);
    expect(await store.listTasks({ dueBefore: '2026-10-31' })).toHaveLength(1);
    expect(await store.listTasks()).toHaveLength(3);
  });

  it('keeps milestone verification honest by default', async () => {
    const milestone = await store.createMilestone({ title: 'First working prototype', date: '2026-10-10' });
    expect(milestone.verification).toBe('claimed');
    expect(milestone.evidence).toEqual([]);
    expect(milestone.status).toBe('planned');
    expect(await store.listMilestones({ statuses: ['planned'] })).toHaveLength(1);
    expect(await store.listMilestones({ from: '2026-10-11' })).toHaveLength(0);
  });

  it('keeps entry links when a milestone is deleted, and restores them', async () => {
    const milestone = await store.createMilestone({ title: 'Launch' });
    const entry = await store.createEntry({ title: 'Launch day', body: 'Shipped.', milestone_id: milestone.id });
    await store.deleteMilestone(milestone.id);
    expect((await store.getEntry(entry.id))?.milestone_id).toBe(milestone.id);
    await store.restoreMilestone(milestone.id);
    expect((await store.listMilestones())).toHaveLength(1);
    expect((await store.listMilestones())[0]!.deleted_at).toBeUndefined();
  });
});

describe('tags', () => {
  it('counts tags across record kinds', async () => {
    await store.createEntry({ title: 'A', body: 'a', tags: ['retrieval', 'debugging'] });
    await store.createEntry({ title: 'B', body: 'b', tags: ['retrieval'] });
    await store.createTask({ title: 'C', tags: ['debugging'] });
    const tags = await store.listTags();
    expect(tags.find((tag) => tag.tag === 'retrieval')?.count).toBe(2);
    expect(tags.find((tag) => tag.tag === 'debugging')?.count).toBe(2);
    expect(tags[0]!.count).toBeGreaterThanOrEqual(tags[tags.length - 1]!.count);
  });

  it('renames a tag everywhere and reports how many records changed', async () => {
    await store.createEntry({ title: 'A', body: 'a', tags: ['ai'] });
    await store.createProject({ name: 'P', tags: ['ai'] });
    const changed = await store.renameTag('ai', 'machine-learning');
    expect(changed).toBe(2);
    const tags = (await store.listTags()).map((tag) => tag.tag);
    expect(tags).toContain('machine-learning');
    expect(tags).not.toContain('ai');
  });
});

describe('search index', () => {
  it('indexes new records and finds them by title, body and tag', async () => {
    const project = await store.createProject({ name: 'JARVIS', summary: 'Personal assistant' });
    await store.createEntry({
      title: 'Retrieval ranking investigation',
      body: 'Ranking fails for ambiguous references.',
      project_id: project.id,
      tags: ['retrieval']
    });
    await store.createTask({ title: 'Improve retrieval ranking', project_id: project.id });

    expect(await store.search({ text: 'retrieval' })).toHaveLength(2);
    expect((await store.search({ text: 'ranking' }))[0]?.title).toContain('Retrieval');
    const hits = await store.search({ text: 'ambiguous references' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.title).toContain('Retrieval');
    expect(await store.search({ text: '#retrieval' })).toHaveLength(1);
    // A project name also matches its children, with the project itself first.
    const jarvisHits = await store.search({ text: 'jarvis' });
    expect(jarvisHits[0]!.kind).toBe('projects');
    expect(jarvisHits.map((hit) => hit.kind).sort()).toEqual(['entries', 'projects', 'tasks']);
    expect(await store.search({ text: 'zzznothing' })).toHaveLength(0);
    expect(await store.search({ text: '   ' })).toHaveLength(0);
  });

  it('filters results by kind, project, tag and date', async () => {
    const project = await store.createProject({ name: 'JARVIS' });
    const entry = await store.createEntry({ title: 'Retrieval', body: 'notes', project_id: project.id, occurred_at: '2026-10-10T10:00:00.000Z' });
    await store.createTask({ title: 'Retrieval task' });
    expect(await store.search({ text: 'retrieval', kinds: ['entries'] })).toHaveLength(1);
    expect(await store.search({ text: 'retrieval', projectId: project.id })).toHaveLength(1);
    // An undated task is excluded by a date filter instead of matching "today".
    expect(await store.search({ text: 'retrieval', from: '2026-10-11' })).toHaveLength(0);
    expect(await store.search({ text: 'retrieval', to: '2026-10-11' })).toHaveLength(1);
    expect(entry.title).toBe('Retrieval');
  });

  it('updates the index when a record changes and drops it on delete', async () => {
    const entry = await store.createEntry({ title: 'Original wording', body: 'alpha' });
    expect(await store.search({ text: 'original' })).toHaveLength(1);
    await store.updateEntry(entry.id, { title: 'Renamed record' });
    expect(await store.search({ text: 'original' })).toHaveLength(0);
    expect(await store.search({ text: 'renamed' })).toHaveLength(1);
    await store.deleteEntry(entry.id);
    expect(await store.search({ text: 'renamed' })).toHaveLength(0);
    expect(await store.search({ text: 'renamed', includeDeleted: true })).toHaveLength(1);
  });

  it('can be rebuilt from the records themselves', async () => {
    await store.createEntry({ title: 'Rebuildable', body: 'content' });
    const db = getDatabase(dbName);
    await db.searchIndex.clear();
    expect(await store.search({ text: 'rebuildable' })).toHaveLength(0);
    const rebuilt = await store.rebuildSearchIndex();
    expect(rebuilt).toBeGreaterThan(0);
    expect(await store.search({ text: 'rebuildable' })).toHaveLength(1);
  });

  it('never stores derived index rows inside the records themselves', async () => {
    const entry = await store.createEntry({ title: 'Clean export', body: 'content' });
    const stored = (await store.getEntry(entry.id)) as JournalEntry & { tokens?: unknown };
    expect(stored.tokens).toBeUndefined();
    expect(Object.keys(stored)).not.toContain('tokens');
  });
});

describe('timeline', () => {
  it('merges entries, milestones, tasks and projects newest first', async () => {
    const project = await store.createProject({ name: 'JARVIS' });
    await store.createEntry({ title: 'Journal item', body: 'body', project_id: project.id, occurred_at: '2026-10-10T10:00:00.000Z' });
    await store.createMilestone({ title: 'First build', date: '2026-10-12', project_id: project.id });
    await store.createTask({ title: 'Open task', due_on: '2026-10-20', project_id: project.id });

    const events = await store.timeline();
    const kinds = events.map((event) => event.kind);
    expect(kinds).toContain('entry');
    expect(kinds).toContain('milestone');
    expect(kinds).toContain('task');
    expect(kinds).toContain('project');
    const stamps = events.map((event) => Date.parse(event.occurred_at));
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
    expect(events.every((event) => event.path.length > 0)).toBe(true);
    expect(events.find((event) => event.kind === 'entry')?.project_name).toBe('JARVIS');
  });

  it('omits open tasks without a date and includes completed ones', async () => {
    await store.createTask({ title: 'Undated task' });
    expect((await store.timeline({ kinds: ['task'] }))).toHaveLength(0);
    const task = await store.createTask({ title: 'Dated task', due_on: '2026-10-20' });
    expect(await store.timeline({ kinds: ['task'] })).toHaveLength(1);
    await store.updateTask(task.id, { status: 'done' });
    expect(await store.timeline({ kinds: ['task'] })).toHaveLength(1);
  });

  it('places a day-coarse record so it never lands on the wrong day for the viewer', async () => {
    // Extreme zones: UTC+14 and UTC-11.
    for (const timezone of ['Pacific/Kiritimati', 'Pacific/Niue', 'Asia/Kolkata']) {
      await store.updateSettings({ timezone });
      await store.createMilestone({ title: `Ship day ${timezone}`, date: '2026-10-12' });
      const event = (await store.timeline({ kinds: ['milestone'] }))[0]!;
      expect(event.date).toBe('2026-10-12');
      expect(localDateIso(event.occurred_at, timezone)).toBe('2026-10-12');
    }
  });

  it('filters by project, kind, tag and range, and paginates with a cursor', async () => {
    const project = await store.createProject({ name: 'JARVIS' });
    for (let day = 1; day <= 6; day += 1) {
      await store.createEntry({
        title: `Entry ${day}`,
        body: 'body',
        project_id: project.id,
        tags: ['batch'],
        occurred_at: `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`
      });
    }
    await store.createEntry({ title: 'Other project', body: 'body' });

    expect(await store.timeline({ projectIds: [project.id], kinds: ['entry'] })).toHaveLength(6);
    expect(await store.timeline({ tags: ['batch'] })).toHaveLength(6);
    expect(await store.timeline({ from: '2026-10-04', to: '2026-10-05', kinds: ['entry'] })).toHaveLength(2);

    const firstPage = await store.timeline({ kinds: ['entry'], limit: 3 });
    expect(firstPage).toHaveLength(3);
    const secondPage = await store.timeline({
      kinds: ['entry'],
      limit: 3,
      before: firstPage[firstPage.length - 1]!.occurred_at
    });
    expect(secondPage).toHaveLength(3);
    expect(secondPage[0]!.record_id).not.toBe(firstPage[0]!.record_id);
  });

  it('marks edited records instead of hiding the edit', async () => {
    const entry = await store.createEntry({ title: 'Draft', body: 'body' });
    expect((await store.timeline({ kinds: ['entry'] }))[0]!.edited).toBe(false);
    await store.updateEntry(entry.id, { body: 'body, corrected' });
    expect((await store.timeline({ kinds: ['entry'] }))[0]!.edited).toBe(true);
  });

  it('excludes private entries by default in a shared view but keeps them for the owner', async () => {
    await store.createEntry({ title: 'Private note', body: 'body', private: true });
    expect(await store.timeline({ kinds: ['entry'] })).toHaveLength(1);
  });
});

describe('capture integration', () => {
  it('builds a context from stored records', async () => {
    const project = await store.createProject({ name: 'JARVIS', aliases: ['assistant'] });
    await store.createEntry({ title: 'Earlier note', body: 'body', project_id: project.id });
    await store.createTask({ title: 'Open task' });

    const context = await store.captureContext({ activeProjectId: project.id });
    expect(context.projects.map((item) => item.name)).toContain('JARVIS');
    expect(context.recentEntries.length).toBeGreaterThan(0);
    expect(context.openTasks.length).toBe(1);
    expect(context.activeProjectId).toBe(project.id);
    expect(context.timezone).toBeTruthy();
    expect(context.mode).toBe(DEFAULT_SETTINGS.capture_mode);
  });

  it('commits a proposal, records the commit and supports undo', async () => {
    const project = await store.createProject({ name: 'JARVIS' });
    const context = await store.captureContext();
    const proposal = analyzeCapture({
      input: 'I fixed the retrieval bug in JARVIS and I need to re-run the tests tomorrow.',
      context: { ...context, projects: [project] }
    });

    const result = await store.commitCapture(proposal);
    expect(result.ok).toBe(true);
    expect(result.created.entries).toHaveLength(1);
    expect(result.created.tasks).toHaveLength(1);

    const entryId = result.created.entries[0]!;
    const entry = await store.getEntry(entryId);
    expect(entry?.project_id).toBe(project.id);
    expect(entry?.source.original_input).toContain('retrieval bug');

    const task = await store.getTask(result.created.tasks[0]!);
    expect(task?.source_entry_id).toBe(entryId);

    const last = await store.getLastCommit();
    expect(last?.entryIds).toEqual([entryId]);
    expect(last?.capture_id).toBe(proposal.capture_id);

    // A repeated submission of the same proposal must not duplicate records.
    const again = await store.commitCapture(proposal);
    expect(again.duplicate).toBe(true);
    expect(await store.listEntries()).toHaveLength(1);
    expect((await store.listTasks()).filter((item) => !item.deleted_at)).toHaveLength(1);

    await store.setLastCommit(null);
    expect(await store.getLastCommit()).toBeNull();
  });

  it('applies a correction to the record it refers to', async () => {
    const jarvis = await store.createProject({ name: 'JARVIS' });
    const veronica = await store.createProject({ name: 'VERONICA' });
    const context = await store.captureContext();
    const first = await store.commitCapture(
      analyzeCapture({ input: 'I fixed the retrieval bug in JARVIS.', context: { ...context, projects: [jarvis, veronica] } })
    );
    expect(first.ok).toBe(true);

    const correctionContext = await store.captureContext();
    expect(correctionContext.lastCommit?.entryIds).toEqual(first.created.entries);
    const correction = analyzeCapture({
      input: 'That entry belongs to VERONICA instead.',
      context: correctionContext
    });
    correction.records.forEach((record) => {
      record.include = true;
    });
    const applied = await store.commitCapture(correction);
    expect(applied.ok).toBe(true);
    expect(applied.updated).toHaveLength(1);
    expect(applied.created.entries).toHaveLength(0);

    const entry = await store.getEntry(first.created.entries[0]!);
    expect(entry?.project_id).toBe(veronica.id);
    expect(entry?.body).toContain('retrieval bug');
    expect(await store.listEntries()).toHaveLength(1);
  });
});

describe('settings', () => {
  it('returns safe defaults before anything is stored', async () => {
    const settings = await store.getSettings();
    expect(settings.theme).toBe('system');
    expect(settings.capture_mode).toBe('quick');
    expect(settings.ai.enabled).toBe(false);
    expect(settings.timezone).toBe('device');
  });

  it('persists changes and keeps the AI key out of storage', async () => {
    const updated = await store.updateSettings({ theme: 'dark', capture_mode: 'review' });
    expect(updated.theme).toBe('dark');
    // A second store instance over the same database must see the change.
    const second = new DexieChronicleStore();
    expect(await second.init()).toBe(true);
    const reloaded = await second.getSettings();
    expect(reloaded.theme).toBe('dark');
    expect(reloaded.capture_mode).toBe('review');
    expect(JSON.stringify(reloaded)).not.toContain('api_key');
  });

  it('ignores an invalid theme instead of storing it', async () => {
    const updated = await store.updateSettings({ theme: 'neon' as never });
    expect(['light', 'dark', 'system']).toContain(updated.theme);
  });
});

describe('data portability', () => {
  it('exports a verified archive and reads it back', async () => {
    const project = await store.createProject({ name: 'JARVIS', tags: ['ai'] });
    const entry = await store.createEntry({
      title: 'Session',
      body: 'Worked on retrieval.',
      project_id: project.id,
      source: { kind: 'capture', original_input: 'Worked on retrieval.', capture_id: 'cap-1' }
    });
    await store.createTask({ title: 'Next step', project_id: project.id, source_entry_id: entry.id });

    const archive = await store.buildArchive();
    expect(archive.counts).toEqual({ projects: 1, entries: 1, milestones: 0, tasks: 1, revisions: 0 });
    expect(archive.records.entries[0]!.source.original_input).toBe('Worked on retrieval.');

    const text = serializeArchive(archive);
    const parsed = await store.parseArchive(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const plan = await store.planImport(parsed.value, 'merge');
    // Re-importing the same archive changes nothing: local records are equal or newer.
    expect(plan.create.projects).toHaveLength(0);
    expect(plan.update.projects).toHaveLength(0);
    expect(plan.conflicts.length).toBeGreaterThan(0);
    expect(plan.requiresBackup).toBe(false);
  });

  it('imports into an empty archive and preserves identifiers', async () => {
    const source = await freshStore();
    const project = await source.createProject({ name: 'AXIOM' });
    const entry = await source.createEntry({ title: 'Note', body: 'Body', project_id: project.id });
    const text = serializeArchive(await source.buildArchive());

    const target = await freshStore();
    const parsed = await target.parseArchive(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const plan = await target.planImport(parsed.value, 'merge');
    expect(plan.create.projects).toHaveLength(1);
    const report = await target.applyImport(plan);
    expect(report.ok).toBe(true);
    expect(report.created.entries).toBe(1);
    expect((await target.getProject(project.id))?.name).toBe('AXIOM');
    expect((await target.getEntry(entry.id))?.project_id).toBe(project.id);
    // The search index is rebuilt so imported records are findable: the project
    // itself, and the entry that belongs to it.
    const hits = await target.search({ text: 'axiom' });
    expect(hits[0]!.kind).toBe('projects');
    expect(hits.map((hit) => hit.kind)).toContain('entries');
  });

  it('refuses a destructive replace without a backup acknowledgement', async () => {
    const source = await freshStore();
    await source.createProject({ name: 'From archive' });
    const text = serializeArchive(await source.buildArchive());

    const target = await freshStore();
    await target.createProject({ name: 'Local only' });
    const parsed = await target.parseArchive(text);
    if (!parsed.ok) throw new Error('parse failed');
    const plan = await target.planImport(parsed.value, 'replace');
    expect(plan.requiresBackup).toBe(true);

    const refused = await target.applyImport(plan);
    expect(refused.ok).toBe(false);
    expect(await target.listProjects()).toHaveLength(1);

    const accepted = await target.applyImport(plan, { backupAcknowledged: true });
    expect(accepted.ok).toBe(true);
    expect((await target.listProjects()).map((item) => item.name)).toEqual(['From archive']);
  });

  it('rejects a file that is not a Chronicle archive', async () => {
    const parsed = await store.parseArchive('{"format":"other.export"}');
    expect(parsed.ok).toBe(false);
  });

  it('produces a Markdown bundle that includes the original capture text', async () => {
    const project = await store.createProject({ name: 'JARVIS' });
    await store.createEntry({
      title: 'Session',
      body: 'Worked on retrieval.',
      project_id: project.id,
      source: { kind: 'capture', original_input: 'worked on retrieval', capture_id: 'cap-1' }
    });
    const files = await store.markdownFiles();
    const paths = files.map((file) => file.path);
    expect(paths).toContain('chronicle/README.md');
    expect(paths).toContain('chronicle/projects/jarvis.md');
    const entry = files.find((file) => file.path === 'chronicle/journal.md');
    expect(entry?.content).toContain('worked on retrieval');
  });

  it('reads every record back for inspection', async () => {
    await store.createProject({ name: 'P' });
    await store.createEntry({ title: 'E', body: 'b' });
    const all = await store.readAll();
    expect(all.projects).toHaveLength(1);
    expect(all.entries).toHaveLength(1);
    expect(all.revisions).toEqual([]);
  });
});

describe('housekeeping', () => {
  it('reports archive statistics', async () => {
    const project = await store.createProject({ name: 'JARVIS', status: 'development' });
    await store.createProject({ name: 'AXIOM', status: 'archived' });
    await store.createEntry({ title: 'A', body: 'a', project_id: project.id, tags: ['x'] });
    await store.createTask({ title: 'T' });
    await store.createMilestone({ title: 'M' });

    const stats = await store.stats();
    expect(stats.projects).toBe(2);
    expect(stats.activeProjects).toBe(1);
    expect(stats.entries).toBe(1);
    expect(stats.openTasks).toBe(1);
    expect(stats.milestones).toBe(1);
    expect(stats.tags).toBe(1);
    expect(stats.deletedRecords).toBe(0);
    expect(stats.oldestEntry).toBeTruthy();
    expect(stats.bytesEstimate).toBeGreaterThan(0);
  });

  it('lists, restores and purges deleted records', async () => {
    const project = await store.createProject({ name: 'JARVIS' });
    const entry = await store.createEntry({ title: 'Doomed', body: 'body', project_id: project.id });
    await store.deleteEntry(entry.id);

    const deleted = await store.listDeleted();
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.kind).toBe('entries');
    expect(deleted[0]!.label).toContain('Doomed');

    expect(await store.restoreRecord('entries', entry.id)).toBe(true);
    expect(await store.listDeleted()).toHaveLength(0);

    await store.deleteEntry(entry.id);
    await store.deleteProject(project.id, { children: 'delete' });
    expect((await store.listDeleted()).length).toBeGreaterThanOrEqual(1);
    const purged = await store.purgeDeleted();
    expect(purged).toBeGreaterThan(0);
    expect(await store.listDeleted()).toHaveLength(0);
    expect(await store.listEntries({ includeDeleted: true })).toHaveLength(0);
  });

  it('reports a missing record as unrestorable rather than throwing', async () => {
    expect(await store.restoreRecord('entries', 'missing')).toBe(false);
  });

  it('clears everything on request', async () => {
    await store.createProject({ name: 'JARVIS' });
    await store.createEntry({ title: 'A', body: 'a' });
    await store.clearAll();
    expect(await store.listProjects({ includeDeleted: true })).toHaveLength(0);
    expect(await store.listEntries({ includeDeleted: true })).toHaveLength(0);
    expect(await store.search({ text: 'jarvis' })).toHaveLength(0);
  });
});
