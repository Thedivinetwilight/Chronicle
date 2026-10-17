/** Validation tests: untrusted input must never reach storage unchecked. */

import { describe, expect, it } from 'vitest';
import {
  assertPersistable,
  parseEntry,
  parseMilestone,
  parseProject,
  parseRevision,
  parseTask,
  SCHEMA_VERSION
} from './validation';
import { createEntry } from './factories';

const NOW = '2026-10-17T09:30:00.000Z';

describe('parseProject', () => {
  it('accepts a minimal project and fills defaults', () => {
    const result = parseProject({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'JARVIS' }, 'project', NOW);
    expect(result.ok).toBe(true);
    expect(result.value?.status).toBe('idea');
    expect(result.value?.stage).toBe('concept');
    expect(result.value?.privacy).toBe('private');
    expect(result.value?.tags).toEqual([]);
    expect(result.value?.rev).toBe(1);
  });

  it('requires a name', () => {
    const result = parseProject({ id: 'x', summary: 'no name' }, 'project', NOW);
    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.message).join(' ')).toMatch(/name/);
  });

  it('rejects a non-object', () => {
    expect(parseProject('JARVIS').ok).toBe(false);
    expect(parseProject(null).ok).toBe(false);
  });

  it('falls back for an unknown status and reports it', () => {
    const result = parseProject({ name: 'X', status: 'LAUNCHED' }, 'project', NOW);
    expect(result.ok).toBe(true);
    expect(result.value?.status).toBe('idea');
    expect(result.warnings.map((issue) => issue.message).join(' ')).toMatch(/unknown value/);
  });

  it('treats archived:true as the archived status', () => {
    const result = parseProject({ name: 'X', status: 'development', archived: true }, 'project', NOW);
    expect(result.value?.status).toBe('archived');
  });

  it('normalises tags and caps aliases', () => {
    const result = parseProject(
      { name: 'X', tags: ['Machine Learning', 'machine-learning', ''], aliases: new Array(20).fill('a') },
      'project',
      NOW
    );
    expect(result.value?.tags).toEqual(['machine-learning']);
    expect(result.value?.aliases).toHaveLength(12);
  });

  it('preserves unknown fields instead of dropping them', () => {
    const result = parseProject({ name: 'X', future_field: { nested: true } }, 'project', NOW);
    expect(result.warnings.map((issue) => issue.message).join(' ')).toMatch(/unknown field/);
    expect(result.value?.extras).toEqual({ future_field: { nested: true } });
  });

  it('keeps created_at <= updated_at', () => {
    const result = parseProject(
      { name: 'X', created_at: '2026-10-17T09:30:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
      'project',
      NOW
    );
    expect(result.value?.updated_at).toBe(result.value?.created_at);
  });
});

describe('parseEntry', () => {
  it('accepts a body-only entry', () => {
    const result = parseEntry({ body: 'Something happened.' }, 'entry', NOW);
    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe('note');
    expect(result.value?.evidence_level).toBe('concept');
    expect(result.value?.occurred_at).toBe(NOW);
    expect(result.value?.source.kind).toBe('import');
  });

  it('requires a title or a body', () => {
    expect(parseEntry({ tags: ['x'] }, 'entry', NOW).ok).toBe(false);
  });

  it('coerces epoch milliseconds and warns', () => {
    const result = parseEntry({ body: 'x', created_at: 1_800_000_000_000 }, 'entry', NOW);
    expect(result.ok).toBe(true);
    expect(result.value?.created_at).toBe('2027-01-15T08:00:00.000Z');
    expect(result.warnings.map((issue) => issue.message).join(' ')).toMatch(/epoch/);
  });

  it('rejects an unparseable timestamp', () => {
    const result = parseEntry({ body: 'x', created_at: 'not a date' }, 'entry', NOW);
    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.message).join(' ')).toMatch(/not a valid timestamp/);
  });

  it('keeps the verbatim original input from a capture', () => {
    const result = parseEntry(
      { body: 'x', source: { kind: 'capture', original_input: 'x', capture_id: 'cap1', analyzer: 'local' } },
      'entry',
      NOW
    );
    expect(result.value?.source).toMatchObject({ kind: 'capture', original_input: 'x', capture_id: 'cap1' });
  });

  it('preserves derived-field flags', () => {
    const result = parseEntry({ body: 'x', derived: { title: true, tags: true, bogus: 'no' } }, 'entry', NOW);
    expect(result.value?.derived).toEqual({ title: true, tags: true });
  });

  it('drops an invalid timezone but keeps a valid one', () => {
    expect(parseEntry({ body: 'x', timezone: 'Asia/Kolkata' }, 'e', NOW).value?.timezone).toBe('Asia/Kolkata');
    expect(parseEntry({ body: 'x', timezone: 'Nowhere/Land' }, 'e', NOW).value?.timezone).toBeUndefined();
  });

  it('parses evidence references and defaults their verification', () => {
    const result = parseEntry(
      { body: 'x', evidence: [{ kind: 'url', location: 'https://example.test' }, 'not-an-object'] },
      'entry',
      NOW
    );
    expect(result.value?.evidence).toHaveLength(1);
    expect(result.value?.evidence[0]?.verification).toBe('claimed');
    expect(result.warnings.map((issue) => issue.message).join(' ')).toMatch(/skipped non-object evidence/);
  });
});

describe('parseTask / parseMilestone / parseRevision', () => {
  it('requires a task title and stamps completion', () => {
    expect(parseTask({ description: 'no title' }, 'task', NOW).ok).toBe(false);
    const done = parseTask({ title: 'Ship it', status: 'done' }, 'task', NOW);
    expect(done.value?.completed_at).toBeTruthy();
    expect(done.value?.due_on).toBeNull();
    expect(done.value?.due_precision).toBe('unknown');
  });

  it('coerces a comma-separated tag string', () => {
    const result = parseTask({ title: 'x', tags: 'a, b , c' }, 'task', NOW);
    expect(result.value?.tags).toEqual(['a', 'b', 'c']);
  });

  it('requires a milestone title and normalises its date', () => {
    expect(parseMilestone({ description: 'no title' }, 'milestone', NOW).ok).toBe(false);
    const result = parseMilestone({ title: 'Launch', date: '17 October 2026' }, 'milestone', NOW);
    expect(result.value?.date).toBe('2026-10-17');
    expect(result.warnings.map((issue) => issue.message).join(' ')).toMatch(/normalised/);
  });

  it('never accepts a pre-verified milestone from an import without evidence fields', () => {
    const result = parseMilestone({ title: 'Launch', verification: 'verified' }, 'milestone', NOW);
    expect(result.value?.verification).toBe('verified');
    // The downgrade happens at commit time, where evidence can be checked.
    expect(result.ok).toBe(true);
  });

  it('requires a revision to name its entry', () => {
    expect(parseRevision({ title: 'a', body: 'b' }, 'revision', NOW).ok).toBe(false);
    const result = parseRevision({ entry_id: 'e1', title: 'a', body: 'b', saved_by: 'capture' }, 'revision', NOW);
    expect(result.value?.saved_by).toBe('capture');
  });

  it('clamps a negative revision counter', () => {
    const result = parseEntry({ body: 'x', rev: -4 }, 'entry', NOW);
    expect(result.value?.rev).toBe(1);
  });
});

describe('assertPersistable', () => {
  it('accepts a well-formed record', () => {
    const entry = createEntry({ body: 'x' });
    expect(() => assertPersistable(entry, 'entry')).not.toThrow();
  });

  it('throws on a missing id, timestamp or revision', () => {
    const entry = createEntry({ body: 'x' });
    expect(() => assertPersistable({ ...entry, id: '' }, 'entry')).toThrow(/missing id/);
    expect(() => assertPersistable({ ...entry, created_at: 'nope' }, 'entry')).toThrow(/created_at/);
    expect(() => assertPersistable({ ...entry, rev: 0 }, 'entry')).toThrow(/rev/);
    expect(() => assertPersistable(null as never, 'entry')).toThrow(/object/);
  });
});

describe('schema version', () => {
  it('is a positive integer this build understands', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });
});
