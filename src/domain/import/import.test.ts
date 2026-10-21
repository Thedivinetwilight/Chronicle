/** Import tests: validation, planning and non-destructive application. */

import { describe, expect, it } from 'vitest';
import {
  applyImport,
  parseArchiveText,
  planImport,
  type ArchiveWriter,
  type RecordTypeMap
} from './archive';
import { buildArchive, serializeArchive } from '../export/archive';
import { createEntry, createProject, createTask } from '../factories';
import type { ChronicleRecords, RecordKind } from '../types';

function fakeWriter(current: ChronicleRecords): ArchiveWriter & { cleared: number; written: [RecordKind, string][] } {
  const written: [RecordKind, string][] = [];
  let cleared = 0;
  return {
    cleared,
    written,
    transaction: async <T>(work: () => Promise<T>): Promise<T> => work(),
    upsert: async <K extends RecordKind>(kind: K, record: RecordTypeMap[K]): Promise<void> => {
      written.push([kind, record.id]);
      (current[kind] as RecordTypeMap[K][]).push(record);
    },
    clearAll: async (): Promise<void> => {
      cleared += 1;
      current.projects = [];
      current.entries = [];
      current.milestones = [];
      current.tasks = [];
      current.revisions = [];
    }
  };
}

function records(): ChronicleRecords {
  return { projects: [], entries: [], milestones: [], tasks: [], revisions: [] };
}

async function archiveJson(source: ChronicleRecords): Promise<string> {
  return serializeArchive(await buildArchive(source, { timezone: 'UTC' }));
}

describe('parseArchiveText', () => {
  it('reads a valid archive', async () => {
    const source = records();
    source.projects.push(createProject({ id: '01PROJECT0000000000000000001', name: 'JARVIS' }));
    source.entries.push(createEntry({ id: '01ENTRY000000000000000000001', body: 'Worked on retrieval.' }));
    const result = await parseArchiveText(await archiveJson(source));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.records.projects).toHaveLength(1);
    expect(result.value.records.entries).toHaveLength(1);
    expect(result.value.archive?.format_version).toBe(1);
    expect(result.value.detectedFormatVersion).toBe(1);
  });

  it('rejects an empty file', async () => {
    const result = await parseArchiveText('   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/empty/);
  });

  it('rejects invalid JSON with a readable message', async () => {
    const result = await parseArchiveText('{ not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/not valid JSON/);
  });

  it('rejects a JSON array root', async () => {
    const result = await parseArchiveText('[]');
    expect(result.ok).toBe(false);
  });

  it('rejects a document that is not a Chronicle archive', async () => {
    const result = await parseArchiveText(JSON.stringify({ format: 'notion.export', records: {} }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/notion\.export/);
  });

  it('rejects an archive from a newer Chronicle', async () => {
    const source = records();
    const archive = await buildArchive(source, { timezone: 'UTC' });
    archive.format_version = 99;
    const result = await parseArchiveText(JSON.stringify(archive));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/newer Chronicle/);
  });

  it('accepts a bare record collection without an envelope', async () => {
    const source = records();
    source.projects.push(createProject({ name: 'AXIOM' }));
    const result = await parseArchiveText(JSON.stringify(source));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings.map((warning) => warning.message).join(' ')).toMatch(/no Chronicle envelope/);
    expect(result.value.records.projects).toHaveLength(1);
  });

  it('rejects a non-list collection', async () => {
    const result = await parseArchiveText(JSON.stringify({ format: 'chronicle.archive', records: { projects: {} } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/must be a list/);
  });

  it('rejects a file whose checksum does not match its contents', async () => {
    const source = records();
    source.entries.push(createEntry({ body: 'Original.' }));
    const archive = await buildArchive(source, { timezone: 'UTC' });
    const json = JSON.parse(serializeArchive(archive)) as typeof archive;
    json.records.entries[0]!.body = 'Edited outside Chronicle.';
    const result = await parseArchiveText(JSON.stringify(json));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/checksum|count/);
  });

  it('skips invalid records but keeps the valid ones', async () => {
    const source = records();
    source.entries.push(createEntry({ body: 'Good entry.' }));
    const archive = await buildArchive(source, { timezone: 'UTC' });
    const json = JSON.parse(serializeArchive(archive)) as typeof archive;
    json.records.entries.push({ title: '', body: '' } as never);
    // Recompute integrity so the corruption we test is the record, not the file.
    const patched = await buildArchive(json.records, { timezone: 'UTC' });
    const result = await parseArchiveText(serializeArchive(patched));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.records.entries).toHaveLength(1);
    expect(result.value.warnings.map((warning) => warning.message).join(' ')).toMatch(/invalid record/);
  });

  it('rejects a file where most records are invalid', async () => {
    const broken = {
      format: 'chronicle.archive',
      format_version: 1,
      records: {
        entries: [{ nope: true }, { also: 'nope' }, { still: 3 }],
        projects: [{ name: 'Valid' }]
      }
    };
    const result = await parseArchiveText(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/rejected/);
  });

  it('keeps the first copy of a duplicated id', async () => {
    const source = records();
    const entry = createEntry({ id: '01ENTRY000000000000000000001', body: 'First copy.' });
    source.entries.push(entry, { ...entry, body: 'Second copy.' });
    const archive = await buildArchive(source, { timezone: 'UTC' });
    const result = await parseArchiveText(serializeArchive(archive));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.records.entries).toHaveLength(1);
    expect(result.value.records.entries[0]!.body).toBe('First copy.');
  });

  it('refuses an absurdly large file', async () => {
    const result = await parseArchiveText(`{"format":"chronicle.archive","pad":"${'x'.repeat(1024)}`);
    expect(result.ok).toBe(false);
  });
});

describe('planImport (merge)', () => {
  it('creates records that do not exist locally', async () => {
    const incoming = records();
    incoming.projects.push(createProject({ id: '01PROJECT0000000000000000001', name: 'JARVIS' }));
    const parsed = await parseArchiveText(await archiveJson(incoming));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const plan = planImport(parsed.value, records(), 'merge');
    expect(plan.create.projects).toHaveLength(1);
    expect(plan.update.projects).toHaveLength(0);
    expect(plan.requiresBackup).toBe(false);
    expect(plan.summary).toMatch(/Add 1 record/);
  });

  it('keeps a newer local copy and says so', async () => {
    const local = records();
    local.entries.push(
      createEntry({ id: '01ENTRY000000000000000000001', body: 'Local, newer.', rev: 5 } as never)
    );
    local.entries[0]!.rev = 5;
    const incoming = records();
    incoming.entries.push(createEntry({ id: '01ENTRY000000000000000000001', body: 'Incoming, older.' }));
    const parsed = await parseArchiveText(await archiveJson(incoming));
    if (!parsed.ok) throw new Error('parse failed');
    const plan = planImport(parsed.value, local, 'merge');
    expect(plan.update.entries).toHaveLength(0);
    expect(plan.conflicts.some((conflict) => conflict.resolution === 'keep-local')).toBe(true);
    expect(plan.summary).toMatch(/keep 1 local/);
  });

  it('uses a newer incoming copy', async () => {
    const local = records();
    local.entries.push(createEntry({ id: '01ENTRY000000000000000000001', body: 'Old local.' }));
    const incomingEntry = createEntry({ id: '01ENTRY000000000000000000001', body: 'Newer incoming.' });
    incomingEntry.rev = 4;
    const incoming = records();
    incoming.entries.push(incomingEntry);
    const parsed = await parseArchiveText(await archiveJson(incoming));
    if (!parsed.ok) throw new Error('parse failed');
    const plan = planImport(parsed.value, local, 'merge');
    expect(plan.update.entries).toHaveLength(1);
    expect(plan.update.entries[0]!.body).toBe('Newer incoming.');
    expect(plan.requiresBackup).toBe(true);
  });

  it('repairs dangling references instead of importing broken links', async () => {
    const incoming = records();
    incoming.entries.push(
      createEntry({
        id: '01ENTRY000000000000000000001',
        body: 'Orphan.',
        project_id: 'missing-project',
        related_entry_ids: ['missing-entry']
      })
    );
    const parsed = await parseArchiveText(await archiveJson(incoming));
    if (!parsed.ok) throw new Error('parse failed');
    const plan = planImport(parsed.value, records(), 'merge');
    expect(plan.create.entries[0]!.project_id).toBeNull();
    expect(plan.create.entries[0]!.related_entry_ids).toEqual([]);
    expect(plan.warnings.join(' ')).toMatch(/does not exist|missing/);
  });

  it('restores a record that was deleted locally when the archive is newer', async () => {
    const local = records();
    const deleted = createEntry({ id: '01ENTRY000000000000000000001', body: 'Deleted locally.' });
    deleted.deleted_at = '2026-10-01T00:00:00.000Z';
    local.entries.push(deleted);
    const incoming = records();
    const restored = createEntry({ id: '01ENTRY000000000000000000001', body: 'Alive in the archive.' });
    restored.rev = 3;
    incoming.entries.push(restored);
    const parsed = await parseArchiveText(await archiveJson(incoming));
    if (!parsed.ok) throw new Error('parse failed');
    const plan = planImport(parsed.value, local, 'merge');
    expect(plan.conflicts.some((conflict) => conflict.resolution === 'restore')).toBe(true);
  });
});

describe('planImport (replace)', () => {
  it('requires an acknowledged backup and reports what disappears', async () => {
    const local = records();
    local.projects.push(createProject({ name: 'Local only' }));
    local.entries.push(createEntry({ body: 'Local entry' }));
    const incoming = records();
    incoming.projects.push(createProject({ name: 'From archive' }));
    const parsed = await parseArchiveText(await archiveJson(incoming));
    if (!parsed.ok) throw new Error('parse failed');
    const plan = planImport(parsed.value, local, 'replace');
    expect(plan.requiresBackup).toBe(true);
    expect(plan.replacedLocally).toBe(2);
    expect(plan.summary).toMatch(/Replace 2 local record/);
  });
});

describe('applyImport', () => {
  it('writes created and updated records', async () => {
    const incoming = records();
    incoming.projects.push(createProject({ id: '01PROJECT0000000000000000001', name: 'JARVIS' }));
    incoming.entries.push(createEntry({ id: '01ENTRY000000000000000000001', body: 'Note.' }));
    const parsed = await parseArchiveText(await archiveJson(incoming));
    if (!parsed.ok) throw new Error('parse failed');
    const local = records();
    const plan = planImport(parsed.value, local, 'merge');
    const writer = fakeWriter(local);
    const report = await applyImport(plan, writer);
    expect(report.ok).toBe(true);
    expect(report.created.projects).toBe(1);
    expect(report.created.entries).toBe(1);
    expect(report.summary).toMatch(/Merged: 2 record\(s\) added/);
    expect(writer.written).toHaveLength(2);
  });

  it('refuses a replace without a backup acknowledgement', async () => {
    const incoming = records();
    incoming.projects.push(createProject({ name: 'From archive' }));
    const parsed = await parseArchiveText(await archiveJson(incoming));
    if (!parsed.ok) throw new Error('parse failed');
    const local = records();
    local.entries.push(createEntry({ body: 'Existing' }));
    const plan = planImport(parsed.value, local, 'replace');
    const writer = fakeWriter(local);
    const refused = await applyImport(plan, writer);
    expect(refused.ok).toBe(false);
    expect(refused.errors[0]).toMatch(/backup/);
    expect(local.entries).toHaveLength(1);

    const accepted = await applyImport(plan, writer, { backupAcknowledged: true });
    expect(accepted.ok).toBe(true);
    expect(accepted.cleared).toBe(1);
    expect(accepted.created.projects).toBe(1);
    expect(local.entries).toHaveLength(0);
  });

  it('reports a storage failure instead of claiming success', async () => {
    const incoming = records();
    incoming.projects.push(createProject({ name: 'JARVIS' }));
    const parsed = await parseArchiveText(await archiveJson(incoming));
    if (!parsed.ok) throw new Error('parse failed');
    const local = records();
    const plan = planImport(parsed.value, local, 'merge');
    const failing: ArchiveWriter = {
      transaction: async <T>(work: () => Promise<T>): Promise<T> => work(),
      upsert: async () => {
        throw new Error('IndexedDB is full');
      },
      clearAll: async () => {}
    };
    const report = await applyImport(plan, failing);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/IndexedDB is full/);
  });

  it('round-trips an archive without losing identifiers', async () => {
    const source = records();
    const project = createProject({ id: '01PROJECT0000000000000000001', name: 'JARVIS', tags: ['ai'] });
    const entry = createEntry({
      id: '01ENTRY000000000000000000001',
      title: 'Session',
      body: 'Worked on retrieval.',
      project_id: project.id,
      tags: ['retrieval'],
      source: { kind: 'capture', original_input: 'Worked on retrieval.', capture_id: 'cap-9' }
    });
    const task = createTask({ id: '01TASK0000000000000000000001', title: 'Next', project_id: project.id, source_entry_id: entry.id });
    source.projects.push(project);
    source.entries.push(entry);
    source.tasks.push(task);

    const exported = serializeArchive(await buildArchive(source, { timezone: 'UTC' }));
    const parsed = await parseArchiveText(exported);
    if (!parsed.ok) throw new Error('parse failed');
    const plan = planImport(parsed.value, records(), 'merge');
    const local = records();
    const report = await applyImport(plan, fakeWriter(local));
    expect(report.ok).toBe(true);
    expect(local.projects[0]!.id).toBe(project.id);
    expect(local.entries[0]!.id).toBe(entry.id);
    expect(local.entries[0]!.source.original_input).toBe('Worked on retrieval.');
    expect(local.tasks[0]!.source_entry_id).toBe(entry.id);
    expect(local.tasks[0]!.project_id).toBe(project.id);
  });
});
