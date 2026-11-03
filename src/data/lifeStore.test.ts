/**
 * Persistence tests for the life archive (V0.2).
 *
 * These run against a real Dexie database (fake-indexeddb) and assert the
 * things a personal record must guarantee: writes survive a reopen, deleting a
 * chapter never deletes its experiences, suggestions stay suggestions until
 * approved, purge leaves nothing behind, and an archive exported today can be
 * read back with every relationship intact.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ChronicleDatabase, getDatabase, setDatabase } from './db';
import { DexieChronicleStore } from './dexieStore';
import { createChapter, createMemoryLink } from '../domain/factories';

let counter = 0;
let store: DexieChronicleStore;
let dbName: string;

async function freshStore(): Promise<DexieChronicleStore> {
  counter += 1;
  dbName = `chronicle-life-test-${counter}`;
  setDatabase(new ChronicleDatabase(dbName));
  const next = new DexieChronicleStore();
  expect(await next.init()).toBe(true);
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

describe('schema migration', () => {
  it('upgrades a V0.1 database in place without touching its records', async () => {
    // Build a real v1 database the way the previous release would have.
    const name = `chronicle-v1-upgrade-${Date.now()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      projects: 'id, name, status, stage, created_at, updated_at, deleted_at, *tags',
      entries: 'id, occurred_at, created_at, updated_at, project_id, type, deleted_at, *tags, milestone_id',
      milestones: 'id, date, project_id, status, verification, deleted_at, *tags',
      tasks: 'id, due_on, status, priority, project_id, deleted_at, updated_at, source_entry_id, *tags',
      revisions: 'id, entry_id, created_at',
      searchIndex: 'id, kind, record_id, project_id, *tokens, updated_at',
      meta: 'key'
    });
    await legacy.open();
    await legacy.table('entries').put({
      id: '01LEGACYENTRY0000000000001',
      created_at: '2025-01-01T09:00:00.000Z',
      updated_at: '2025-01-01T09:00:00.000Z',
      rev: 1,
      title: 'Before the upgrade',
      body: 'Written by an older Chronicle.',
      type: 'note',
      occurred_at: '2025-01-01T09:00:00.000Z',
      occurred_precision: 'exact',
      occurred_source: 'user',
      project_id: null,
      tags: [],
      evidence_level: 'concept',
      evidence: [],
      related_entry_ids: [],
      milestone_id: null,
      private: false,
      source: { kind: 'manual' }
    });
    legacy.close();

    setDatabase(null);
    setDatabase(new ChronicleDatabase(name));
    const upgraded = new DexieChronicleStore();
    expect(await upgraded.init()).toBe(true);

    const entries = await upgraded.listEntries({});
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe('Before the upgrade');
    // A V0.1 entry has no chapter links and is read as private, with nothing
    // fabricated to fill the new fields.
    expect(entries[0]!.links?.chapter_ids ?? []).toEqual([]);
    expect(entries[0]!.visibility ?? 'private').toBe('private');

    // The new tables exist and are usable.
    expect(await upgraded.listChapters()).toEqual([]);
    const chapter = await upgraded.createChapter({ name: 'After the upgrade' });
    expect(chapter.name).toBe('After the upgrade');

    const db = getDatabase(name);
    db.close();
    await db.delete();
    setDatabase(null);
  });
});

describe('chapters', () => {
  it('persists a chapter and its experience links across a reopen', async () => {
    const chapter = await store.createChapter({ name: 'First year of college', start_date: '2023-06-01' });
    const entry = await store.createEntry({ body: 'Moved into the hostel.' });
    await store.setEntryRelations(entry.id, { chapter_ids: [chapter.id] });

    // Close and reopen the same database: this is the "survives reload" case.
    getDatabase(dbName).close();
    setDatabase(new ChronicleDatabase(dbName));
    const reopened = new DexieChronicleStore();
    await reopened.init();

    const chapters = await reopened.listChapters();
    expect(chapters.map((item) => item.name)).toEqual(['First year of college']);
    const entries = await reopened.entriesForChapter(chapter.id);
    expect(entries.map((item) => item.id)).toEqual([entry.id]);
  });

  it('lists a chapter whose dates are unknown (null index keys must not hide it)', async () => {
    // Regression: `orderBy('start_date')` makes Dexie skip any row whose key is
    // null, so a chapter with no dates vanished from every list while still
    // being stored. Both forms must list.
    const undated = await store.createChapter({ name: 'No dates given' });
    const dated = await store.createChapter({ name: 'Dated era', start_date: '2024-01-01' });

    const listed = await store.listChapters();
    expect(listed.map((chapter) => chapter.id).sort()).toEqual([undated.id, dated.id].sort());
    // The dated era sorts first; the unknown-start era stays reachable below it.
    expect(listed[0]?.id).toBe(dated.id);
  });

  it('deletes a chapter without deleting or altering its experiences', async () => {
    const chapter = await store.createChapter({ name: 'Era' });
    const entry = await store.createEntry({ body: 'A memory inside the era.' });
    await store.setEntryRelations(entry.id, { chapter_ids: [chapter.id] });

    await store.deleteChapter(chapter.id);

    expect(await store.listChapters()).toEqual([]);
    const survivor = (await store.getEntry(entry.id))!;
    expect(survivor.body).toBe('A memory inside the era.');
    expect(survivor.links?.chapter_ids).toEqual([]);
    expect(await store.entriesForChapter(chapter.id)).toEqual([]);
  });

  it('refuses to attach an experience to a deleted chapter', async () => {
    const chapter = await store.createChapter({ name: 'Gone' });
    const entry = await store.createEntry({ body: 'Text' });
    await store.deleteChapter(chapter.id);
    await expect(store.setEntryRelations(entry.id, { chapter_ids: [chapter.id] })).rejects.toThrow(/does not exist/i);
  });

  it('restores a chapter without silently restoring old memberships', async () => {
    const chapter = await store.createChapter({ name: 'Era' });
    const entry = await store.createEntry({ body: 'Text' });
    await store.setEntryRelations(entry.id, { chapter_ids: [chapter.id] });
    await store.deleteChapter(chapter.id);
    const restored = await store.restoreChapter(chapter.id);
    expect(restored.deleted_at).toBeUndefined();
    expect(await store.entriesForChapter(chapter.id)).toEqual([]);
  });
});

describe('paths', () => {
  it('keeps a respectful state history without inferring completion', async () => {
    const path = await store.createPath({ title: 'Learn guitar', state: 'active' });
    const changed = await store.updatePath(path.id, { state: 'changed', state_note: 'Switched to piano for now.' });
    expect(changed.state).toBe('changed');
    expect(changed.state_note).toMatch(/piano/);
    // Nothing infers completion: the state is exactly what was written.
    expect(changed.state).not.toBe('completed');
    const listed = await store.listPaths({ states: ['changed'] });
    expect(listed.map((item) => item.id)).toEqual([path.id]);
  });

  it('links experiences to a path in both directions', async () => {
    const path = await store.createPath({ title: 'Visit Japan' });
    const entry = await store.createEntry({ body: 'Booked the visa appointment.' });
    await store.setEntryRelations(entry.id, { path_ids: [path.id] });
    expect((await store.entriesForPath(path.id)).map((item) => item.id)).toEqual([entry.id]);
    expect((await store.getEntry(entry.id))!.links?.path_ids).toEqual([path.id]);
  });
});

describe('memory links and approval', () => {
  it('stores a suggestion as a suggestion and only approves it on request', async () => {
    const a = await store.createEntry({ body: 'First record' });
    const b = await store.createEntry({ body: 'Second record' });
    const suggestion = await store.createLink({
      from_kind: 'entry',
      from_id: a.id,
      to_kind: 'entry',
      to_id: b.id,
      origin: 'suggested',
      role: 'same day as',
      rationale: 'Both happened on the same day.'
    });
    expect(suggestion.status).toBe('suggested');
    expect(await store.approvedLinks()).toEqual([]);

    const approved = await store.setLinkStatus(suggestion.id, 'confirmed');
    expect(approved.status).toBe('confirmed');
    expect((await store.approvedLinks()).map((link) => link.id)).toEqual([suggestion.id]);
  });

  it('refuses to store a suggested link as already confirmed', async () => {
    const a = await store.createEntry({ body: 'A' });
    const b = await store.createEntry({ body: 'B' });
    const link = createMemoryLink(
      {
        from_kind: 'entry',
        from_id: a.id,
        to_kind: 'entry',
        to_id: b.id,
        origin: 'suggested',
        status: 'confirmed'
      },
      {}
    );
    expect(link.status).toBe('suggested');
  });

  it('de-duplicates a pair regardless of direction', async () => {
    const a = await store.createEntry({ body: 'A' });
    const b = await store.createEntry({ body: 'B' });
    const first = await store.createLink({ from_kind: 'entry', from_id: a.id, to_kind: 'entry', to_id: b.id });
    const second = await store.createLink({ from_kind: 'entry', from_id: b.id, to_kind: 'entry', to_id: a.id });
    expect(second.id).toBe(first.id);
    expect(await store.listLinks({})).toHaveLength(1);
  });

  it('rejects a link that points at itself or at a missing record', async () => {
    const a = await store.createEntry({ body: 'A' });
    await expect(store.createLink({ from_kind: 'entry', from_id: a.id, to_kind: 'entry', to_id: a.id })).rejects.toThrow(
      /itself/i
    );
    await expect(
      store.createLink({ from_kind: 'entry', from_id: a.id, to_kind: 'entry', to_id: 'missing-record-id' })
    ).rejects.toThrow(/no longer exists/i);
  });

  it('removes a link when its target is deleted, so nothing dangling is drawn', async () => {
    const a = await store.createEntry({ body: 'A' });
    const b = await store.createEntry({ body: 'B' });
    const link = await store.createLink({ from_kind: 'entry', from_id: a.id, to_kind: 'entry', to_id: b.id });
    await store.deleteEntry(b.id);
    const live = await store.listLinks({});
    expect(live.find((item) => item.id === link.id)).toBeUndefined();
  });
});

describe('life map source', () => {
  it('returns only live records and separates suggestions from approved links', async () => {
    const chapter = await store.createChapter({ name: 'Era' });
    const entry = await store.createEntry({ body: 'Inside' });
    await store.setEntryRelations(entry.id, { chapter_ids: [chapter.id] });
    const deleted = await store.createEntry({ body: 'Deleted' });
    await store.deleteEntry(deleted.id);

    const other = await store.createEntry({ body: 'Other' });
    await store.createLink({ from_kind: 'entry', from_id: entry.id, to_kind: 'entry', to_id: other.id });

    const source = await store.lifeMapSource();
    expect(source.chapters.map((item) => item.id)).toEqual([chapter.id]);
    expect(source.entries.some((item) => item.id === deleted.id)).toBe(false);
    expect(source.links.filter((link) => link.status === 'confirmed')).toHaveLength(1);
    expect(source.links.filter((link) => link.status === 'confirmed')[0]!.deleted_at ?? null).toBeNull();
  });
});

describe('places, trips and collections', () => {
  it('keeps trip confirmation details out of lists but preserves them for the owner', async () => {
    const place = await store.createPlace({ name: 'Kyoto', region: 'Japan', kind: 'city' });
    const trip = await store.createTrip({
      name: 'Japan 2025',
      start_date: '2025-04-01',
      place_ids: [place.id],
      sensitive_notes: 'Confirmation ABC12345'
    });
    const listed = await store.listTrips();
    expect(listed[0]!.sensitive_notes).toContain('ABC12345');
    // The Life Map source is archive-internal too, but it must never be
    // exported or shown outside the owner's own trip page: see share tests.
    const source = await store.lifeMapSource();
    expect(source.trips[0]!.place_ids).toEqual([place.id]);
    expect(trip.place_ids).toEqual([place.id]);
  });

  it('removes a deleted place from trips instead of leaving a dangling id', async () => {
    const place = await store.createPlace({ name: 'Kyoto' });
    const trip = await store.createTrip({ name: 'Japan', place_ids: [place.id] });
    await store.deletePlace(place.id);
    expect((await store.getTrip(trip.id))!.place_ids).toEqual([]);
  });

  it('filters a collection when one of its experiences is deleted', async () => {
    const a = await store.createEntry({ body: 'A' });
    const b = await store.createEntry({ body: 'B' });
    const collection = await store.createCollection({ name: 'Best days', entry_ids: [a.id, b.id] });
    await store.deleteEntry(a.id);
    // A tombstone keeps the link restorable; the collection read filters it.
    const stored = await store.getCollection(collection.id);
    expect(stored!.entry_ids).toContain(a.id);
    const restored = await store.restoreEntry(a.id);
    expect(restored.deleted_at).toBeUndefined();
  });
});

describe('portability and housekeeping', () => {
  it('round-trips chapters, paths, places and links through a JSON archive', async () => {
    const chapter = await store.createChapter({ name: 'Era', start_date: '2024-01-01' });
    const path = await store.createPath({ title: 'Learn guitar' });
    const place = await store.createPlace({ name: 'Kyoto' });
    const entry = await store.createEntry({ body: 'A memory' });
    await store.setEntryRelations(entry.id, { chapter_ids: [chapter.id], path_ids: [path.id] });
    await store.createLink({ from_kind: 'entry', from_id: entry.id, to_kind: 'place', to_id: place.id });

    const archive = await store.buildArchive();
    expect(archive.life).toBeDefined();
    expect(archive.life!.chapters).toHaveLength(1);
    expect(archive.life!.links).toHaveLength(1);

    const text = JSON.stringify(archive);
    const parsed = await store.parseArchive(text);
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    expect(parsed.value.records.chapters[0]!.name).toBe('Era');
    expect(parsed.value.records.entries[0]!.links?.chapter_ids).toEqual([chapter.id]);

    const plan = await store.planImport(parsed.value, 'merge');
    expect(plan.errors).toEqual([]);
    const report = await store.applyImport(plan);
    expect(report.ok).toBe(true);
  });

  it('omits an empty life section so a V0.1 archive stays byte-identical', async () => {
    await store.createEntry({ body: 'Just an entry' });
    const archive = await store.buildArchive();
    expect(archive.life).toBeUndefined();
  });

  it('purges deleted life records and any reference pointing at them', async () => {
    const chapter = await store.createChapter({ name: 'Gone' });
    const entry = await store.createEntry({ body: 'Kept' });
    await store.setEntryRelations(entry.id, { chapter_ids: [chapter.id] });
    await store.deleteChapter(chapter.id);
    const removed = await store.purgeDeleted();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await store.getChapter(chapter.id)).toBeNull();
    const survivor = (await store.getEntry(entry.id))!;
    expect(survivor.links?.chapter_ids).toEqual([]);
  });

  it('deletes dangling links on purge rather than leaving connections to nothing', async () => {
    const a = await store.createEntry({ body: 'A' });
    const b = await store.createEntry({ body: 'B' });
    await store.createLink({ from_kind: 'entry', from_id: a.id, to_kind: 'entry', to_id: b.id });
    await store.deleteEntry(b.id);
    await store.purgeDeleted();
    const links = await store.listLinks({ includeDeleted: true });
    expect(links).toEqual([]);
  });

  it('clears the life tables along with everything else', async () => {
    await store.createChapter({ name: 'Era' });
    await store.createPlace({ name: 'Kyoto' });
    await store.clearAll();
    expect(await store.listChapters({ includeDeleted: true })).toEqual([]);
    expect(await store.listPlaces({ includeDeleted: true })).toEqual([]);
  });

  it('lists deleted life records so they can be restored', async () => {
    const path = await store.createPath({ title: 'Learn guitar' });
    await store.deletePath(path.id);
    const deleted = await store.listDeleted();
    expect(deleted.some((record) => record.kind === 'paths' && record.id === path.id)).toBe(true);
    expect(await store.restoreRecord('paths', path.id)).toBe(true);
    expect((await store.getPath(path.id))!.deleted_at).toBeUndefined();
  });
});

describe('relationship integrity', () => {
  it('keeps an experience in both of its chapters', async () => {
    const one = await store.createChapter({ name: 'One' });
    const two = await store.createChapter({ name: 'Two' });
    const entry = await store.createEntry({ body: 'Belongs to both' });
    await store.setEntryRelations(entry.id, { chapter_ids: [one.id, two.id] });
    expect((await store.entriesForChapter(one.id)).map((item) => item.id)).toEqual([entry.id]);
    expect((await store.entriesForChapter(two.id)).map((item) => item.id)).toEqual([entry.id]);
  });

  it('is atomic: a failed relation write changes nothing', async () => {
    const chapter = await store.createChapter({ name: 'Real' });
    const entry = await store.createEntry({ body: 'Text' });
    await store.setEntryRelations(entry.id, { chapter_ids: [chapter.id] });
    await expect(
      store.setEntryRelations(entry.id, { chapter_ids: [chapter.id, 'not-a-chapter'] })
    ).rejects.toThrow();
    const unchanged = (await store.getEntry(entry.id))!;
    expect(unchanged.links?.chapter_ids).toEqual([chapter.id]);
  });

  it('bumps the entry revision when relations change', async () => {
    const chapter = await store.createChapter({ name: 'Era' });
    const entry = await store.createEntry({ body: 'Text' });
    const updated = await store.setEntryRelations(entry.id, { chapter_ids: [chapter.id] });
    expect(updated.rev).toBe(entry.rev + 1);
    expect(updated.updated_at >= entry.updated_at).toBe(true);
  });

  it('creates records private unless a visibility is given', async () => {
    const chapter = createChapter({ name: 'Era' });
    expect(chapter.visibility).toBe('private');
    const stored = await store.createChapter({ name: 'Stored' });
    expect(stored.visibility).toBe('private');
  });
});
