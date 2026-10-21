/** Export tests: versioned JSON archive, integrity and Markdown output. */

import { describe, expect, it } from 'vitest';
import {
  APP_VERSION,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  archiveFilename,
  buildArchive,
  canonicalJson,
  checksumFor,
  countRecords,
  emptyRecords,
  fnv1aHex,
  serializeArchive,
  sortRecords,
  totalRecords,
  verifyArchive
} from './archive';
import {
  archiveToMarkdownFiles,
  bundleToSingleMarkdown,
  entryToMarkdown,
  journalToMarkdown,
  milestonesToMarkdown,
  projectToMarkdown,
  tasksToMarkdown
} from './markdown';
import { createEntry, createMilestone, createProject, createTask, newEvidenceRef } from '../factories';
import type { ChronicleRecords } from '../types';

const TZ = 'UTC';
const EXPORTED_AT = '2026-10-17T09:30:00.000Z';

function sampleRecords(): ChronicleRecords {
  const project = createProject({
    id: '01PROJECT0000000000000000001',
    name: 'JARVIS',
    summary: 'Personal assistant.',
    objectives: 'Retrieve context reliably.',
    status: 'development',
    stage: 'implemented',
    tags: ['ai', 'retrieval']
  });
  const entry = createEntry({
    id: '01ENTRY000000000000000000001',
    title: 'Retrieval ranking investigation',
    body: 'Investigated why retrieval ranking fails for ambiguous references.',
    summary: 'Ranking fails for ambiguous references.',
    type: 'research',
    project_id: project.id,
    tags: ['retrieval', 'debugging'],
    evidence_level: 'researched',
    occurred_at: '2026-10-16T18:00:00.000Z',
    occurred_precision: 'exact',
    occurred_source: 'text',
    evidence: [newEvidenceRef('url', { location: 'https://example.test/notes', verification: 'supported' })],
    source: { kind: 'capture', original_input: 'I looked into why retrieval ranking fails.', capture_id: 'cap-1' },
    derived: { title: true, summary: true, tags: true }
  });
  const task = createTask({
    id: '01TASK0000000000000000000001',
    title: 'Improve the ranking heuristic',
    project_id: project.id,
    due_on: '2026-10-20',
    source_entry_id: entry.id
  });
  const milestone = createMilestone({
    id: '01MILESTONE000000000000000001',
    title: 'First working retrieval pass',
    date: '2026-10-10',
    project_id: project.id,
    status: 'achieved',
    verification: 'claimed',
    entry_ids: [entry.id]
  });
  return { projects: [project], entries: [entry], milestones: [milestone], tasks: [task], revisions: [] };
}

describe('JSON archive', () => {
  it('produces a versioned envelope with counts and integrity', async () => {
    const archive = await buildArchive(sampleRecords(), { timezone: TZ, exportedAt: EXPORTED_AT });
    expect(archive.format).toBe(ARCHIVE_FORMAT);
    expect(archive.format_version).toBe(ARCHIVE_FORMAT_VERSION);
    expect(archive.app_version).toBe(APP_VERSION);
    expect(archive.exported_at).toBe(EXPORTED_AT);
    expect(archive.timezone).toBe(TZ);
    expect(archive.counts).toEqual({ projects: 1, entries: 1, milestones: 1, tasks: 1, revisions: 0 });
    expect(archive.integrity.record_count).toBe(4);
    expect(archive.integrity.checksum).toMatch(/^[0-9a-f]+$/);
  });

  it('verifies its own checksum and detects tampering', async () => {
    const archive = await buildArchive(sampleRecords(), { timezone: TZ });
    expect((await verifyArchive(archive)).ok).toBe(true);

    const tampered = structuredClone(archive);
    tampered.records.entries[0]!.body = 'Rewritten history.';
    const result = await verifyArchive(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/checksum/);
  });

  it('detects a truncated record list', async () => {
    const archive = await buildArchive(sampleRecords(), { timezone: TZ });
    const truncated = structuredClone(archive);
    truncated.records.tasks = [];
    expect((await verifyArchive(truncated)).ok).toBe(false);
  });

  it('keeps relationships, provenance and tombstones in the payload', async () => {
    const records = sampleRecords();
    records.entries[0]!.deleted_at = EXPORTED_AT;
    const archive = await buildArchive(records, { timezone: TZ });
    expect(archive.records.entries[0]!.source.original_input).toContain('retrieval ranking fails');
    expect(archive.records.entries[0]!.deleted_at).toBe(EXPORTED_AT);
    expect(archive.records.tasks[0]!.source_entry_id).toBe(records.entries[0]!.id);
    expect(archive.records.milestones[0]!.entry_ids).toEqual([records.entries[0]!.id]);
    expect(archive.records.entries[0]!.evidence[0]!.location).toBe('https://example.test/notes');
  });

  it('can exclude deleted records', async () => {
    const records = sampleRecords();
    records.entries[0]!.deleted_at = EXPORTED_AT;
    const archive = await buildArchive(records, { timezone: TZ, includeDeleted: false });
    expect(archive.include_deleted).toBe(false);
    expect(archive.counts.entries).toBe(0);
    expect(archive.records.projects).toHaveLength(1);
  });

  it('serialises readably and names the file with the export date', async () => {
    const archive = await buildArchive(sampleRecords(), { timezone: TZ, exportedAt: EXPORTED_AT });
    const json = serializeArchive(archive);
    expect(json).toContain('\n  "format"');
    expect(json.endsWith('\n')).toBe(true);
    expect(archiveFilename(archive)).toBe('chronicle-full-2026-10-17.json');
    expect(archiveFilename(archive, 'backup')).toBe('chronicle-backup-2026-10-17.json');
    expect(JSON.parse(json).format).toBe(ARCHIVE_FORMAT);
  });

  it('sorts records deterministically by id', () => {
    const records = sampleRecords();
    const unsorted: ChronicleRecords = {
      ...records,
      entries: [records.entries[0]!, { ...records.entries[0]!, id: '00ENTRY' } as never]
    };
    const sorted = sortRecords(unsorted);
    expect(sorted.entries.map((entry) => entry.id)).toEqual(['00ENTRY', records.entries[0]!.id]);
  });

  it('counts records per collection', () => {
    expect(countRecords(sampleRecords())).toEqual({ projects: 1, entries: 1, milestones: 1, tasks: 1, revisions: 0 });
    expect(totalRecords(emptyRecords())).toBe(0);
  });
});

describe('canonical JSON and checksums', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ a: 1, b: { c: 2, d: 3 } })).toBe(canonicalJson({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('produces a stable non-crypto fallback hash', () => {
    expect(fnv1aHex('chronicle')).toBe(fnv1aHex('chronicle'));
    expect(fnv1aHex('chronicle')).not.toBe(fnv1aHex('chroniclE'));
    expect(fnv1aHex('')).toBe('811c9dc5');
  });

  it('always returns an integrity block', async () => {
    const integrity = await checksumFor(sampleRecords());
    expect(['sha256', 'fnv1a']).toContain(integrity.algorithm);
    expect(integrity.record_count).toBe(4);
  });
});

describe('Markdown export', () => {
  it('renders an entry with front matter, metadata and verbatim body', () => {
    const records = sampleRecords();
    const md = entryToMarkdown(records.entries[0]!, { timezone: TZ, project: records.projects[0]! });
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain(`id: "${records.entries[0]!.id}"`);
    expect(md).toContain('kind: "chronicle.journal-entry"');
    expect(md).toContain('project: "JARVIS"');
    expect(md).toContain('tags: ["retrieval", "debugging"]');
    expect(md).toContain('# Retrieval ranking investigation');
    expect(md).toContain('Investigated why retrieval ranking fails for ambiguous references.');
    expect(md).toContain('## Evidence');
    expect(md).toContain('## Original capture');
    expect(md).toContain('Suggested by Chronicle');
  });

  it('marks the evidence level and never upgrades it', () => {
    const records = sampleRecords();
    const md = entryToMarkdown(records.entries[0]!, { timezone: TZ });
    expect(md).toContain('**Evidence level:** researched');
    expect(md).not.toContain('verified');
  });

  it('uses a dated heading for an untitled entry', () => {
    const entry = createEntry({ id: '01UNTITLED000000000000000001', title: '', body: 'Notes.', occurred_at: '2026-10-16T18:00:00.000Z' });
    expect(entryToMarkdown(entry, { timezone: TZ })).toContain('# Untitled entry (16 Oct 2026)');
  });

  it('renders a project dossier with milestones, tasks and journal', () => {
    const records = sampleRecords();
    const md = projectToMarkdown(records.projects[0]!, records, { timezone: TZ });
    expect(md).toContain('# JARVIS');
    expect(md).toContain('| Status | development |');
    expect(md).toContain('## Objectives');
    expect(md).toContain('## Milestones');
    expect(md).toContain('First working retrieval pass (achieved, claimed)');
    expect(md).toContain('## Open tasks');
    expect(md).toContain('- [ ] Improve the ranking heuristic — due 20 Oct 2026');
    expect(md).toContain('## Journal (1)');
    expect(md).toContain('### 16 Oct 2026 — Retrieval ranking investigation');
  });

  it('says so honestly when a project has no journal yet', () => {
    const records = sampleRecords();
    records.entries = [];
    expect(projectToMarkdown(records.projects[0]!, records)).toContain('_No entries recorded yet._');
  });

  it('renders journal, milestone and task collections', () => {
    const records = sampleRecords();
    expect(journalToMarkdown(records, { timezone: TZ })).toContain('## 2026-10');
    expect(milestonesToMarkdown(records)).toContain('## 10 Oct 2026 — First working retrieval pass');
    expect(tasksToMarkdown(records)).toContain('- [ ] **Improve the ranking heuristic**');
    expect(tasksToMarkdown(emptyRecords())).toContain('_No tasks yet._');
  });

  it('excludes private entries when asked', () => {
    const records = sampleRecords();
    records.entries[0]!.private = true;
    expect(journalToMarkdown(records, { includePrivate: false })).toContain('_No entries yet._');
    expect(journalToMarkdown(records, { includePrivate: true })).toContain('Retrieval ranking investigation');
  });

  it('produces a file bundle with an index and per-project dossiers', () => {
    const files = archiveToMarkdownFiles(sampleRecords(), { timezone: TZ });
    const paths = files.map((file) => file.path);
    expect(paths).toContain('chronicle/README.md');
    expect(paths).toContain('chronicle/journal.md');
    expect(paths).toContain('chronicle/milestones.md');
    expect(paths).toContain('chronicle/tasks.md');
    expect(paths).toContain('chronicle/projects/jarvis.md');
    expect(files[0]!.content).toContain('# Chronicle export');
  });

  it('concatenates a bundle into a single document', () => {
    const bundle = bundleToSingleMarkdown(archiveToMarkdownFiles(sampleRecords(), { timezone: TZ }));
    expect(bundle).toContain('<!-- chronicle/README.md -->');
    expect(bundle).toContain('<!-- chronicle/projects/jarvis.md -->');
  });
});
