/** Search tests: tokenisation, query parsing, ranking and result shaping. */

import { describe, expect, it } from 'vitest';
import {
  documentTokens,
  groupHits,
  hitPath,
  highlightSegments,
  indexTokens,
  parseQuery,
  scoreDocument,
  toDocument,
  toHit,
  tokenize
} from './search';
import type { JournalEntry, Milestone, Project, Task } from './types';
import { createEntry, createMilestone, createProject, createTask } from './factories';

const TZ = 'UTC';
const TODAY = '2026-10-17';

function scoreOptions(overrides: Partial<Parameters<typeof scoreDocument>[1]> = {}) {
  return {
    parsed: parseQuery('retrieval'),
    today: TODAY,
    timezone: TZ,
    ...overrides
  } as Parameters<typeof scoreDocument>[1];
}

describe('tokenize', () => {
  it('lowercases, folds diacritics and drops stopwords', () => {
    expect(tokenize('The Retrieval café System')).toEqual(['retrieval', 'cafe', 'system']);
  });

  it('keeps stopwords when asked', () => {
    expect(tokenize('the system', { keepStopwords: true })).toEqual(['the', 'system']);
  });

  it('splits hyphenated compounds so parts are searchable', () => {
    expect(tokenize('re-ranking the pipeline')).toContain('ranking');
    expect(tokenize('re-ranking the pipeline')).toContain('re-ranking');
  });

  it('drops very short tokens', () => {
    expect(tokenize('a b cc ddd')).toEqual(['cc', 'ddd']);
  });

  it('builds a unique index token list, capped for huge documents', () => {
    const tokens = indexTokens(['retrieval retrieval', 'ranking', undefined, null]);
    expect(tokens).toEqual(['retrieval', 'ranking']);
    const huge = indexTokens([new Array(6000).join('word ') + ' tail']);
    expect(huge.length).toBeLessThanOrEqual(4000);
  });
});

describe('parseQuery', () => {
  it('detects an empty query', () => {
    expect(parseQuery('   ').empty).toBe(true);
    expect(parseQuery('retrieval').empty).toBe(false);
  });

  it('extracts inline #tag filters', () => {
    const parsed = parseQuery('retrieval #debugging #memory');
    expect(parsed.tags).toEqual(['debugging', 'memory']);
    expect(parsed.tokens).toContain('retrieval');
    expect(parsed.tokens).not.toContain('debugging');
  });

  it('recognises a quoted phrase search', () => {
    expect(parseQuery('"retrieval ranking"').phrase).toBe(true);
    expect(parseQuery('retrieval ranking').phrase).toBe(false);
  });
});

describe('documents and scoring', () => {
  const project: Project = createProject({
    name: 'JARVIS',
    summary: 'Personal assistant with retrieval',
    tags: ['ai'],
    aliases: ['assistant']
  });
  const entry: JournalEntry = createEntry({
    title: 'Retrieval ranking investigation',
    body: 'Investigated why retrieval ranking fails for ambiguous references.',
    tags: ['retrieval', 'debugging'],
    project_id: project.id,
    occurred_at: '2026-10-17T09:00:00.000Z'
  });
  const task: Task = createTask({ title: 'Improve retrieval ranking', due_on: '2026-10-18' });
  const milestone: Milestone = createMilestone({ title: 'First working retrieval', date: '2026-10-10' });

  it('projects every record kind into a search document', () => {
    expect(toDocument('projects', project, null)?.title).toBe('JARVIS');
    expect(toDocument('entries', entry, 'JARVIS')?.extra).toContain('JARVIS');
    expect(toDocument('tasks', task, null)?.status).toBe('todo');
    expect(toDocument('milestones', milestone, null)?.date).toBe('2026-10-10T12:00:00.000Z');
    expect(toDocument('revisions', entry)).toBeNull();
  });

  it('indexes aliases so a project is findable by another name', () => {
    const tokens = documentTokens(toDocument('projects', project, null)!);
    expect(tokens).toContain('assistant');
  });

  it('ranks a title match above a body match', () => {
    const titleHit = scoreDocument(toDocument('entries', entry, null)!, scoreOptions());
    const bodyOnly = scoreDocument(
      toDocument('entries', createEntry({ title: 'Notes', body: 'Some thoughts about retrieval.' }), null)!,
      scoreOptions()
    );
    expect(titleHit).not.toBeNull();
    expect(bodyOnly).not.toBeNull();
    expect(titleHit!.score).toBeGreaterThan(bodyOnly!.score);
  });

  it('uses AND semantics across tokens', () => {
    expect(scoreDocument(toDocument('entries', entry, null)!, scoreOptions({ parsed: parseQuery('retrieval ranking') }))).not.toBeNull();
    expect(scoreDocument(toDocument('entries', entry, null)!, scoreOptions({ parsed: parseQuery('retrieval blockchain') }))).toBeNull();
  });

  it('matches prefixes so partial words work', () => {
    expect(scoreDocument(toDocument('entries', entry, null)!, scoreOptions({ parsed: parseQuery('retrie') }))).not.toBeNull();
  });

  it('honours a quoted phrase', () => {
    const phrase = scoreDocument(toDocument('entries', entry, null)!, scoreOptions({ parsed: parseQuery('"ambiguous references"') }));
    expect(phrase).not.toBeNull();
    const wrong = scoreDocument(toDocument('entries', entry, null)!, scoreOptions({ parsed: parseQuery('"references ambiguous"') }));
    expect(wrong).toBeNull();
  });

  it('honours inline #tag filters', () => {
    expect(scoreDocument(toDocument('entries', entry, null)!, scoreOptions({ parsed: parseQuery('retrieval #debugging') }))).not.toBeNull();
    expect(scoreDocument(toDocument('entries', entry, null)!, scoreOptions({ parsed: parseQuery('retrieval #missing') }))).toBeNull();
  });

  it('boosts newer records among equal matches', () => {
    const old = createEntry({ title: 'Retrieval notes', body: 'retrieval', occurred_at: '2025-10-17T09:00:00.000Z' });
    const fresh = createEntry({ title: 'Retrieval notes', body: 'retrieval', occurred_at: '2026-10-17T09:00:00.000Z' });
    const oldScore = scoreDocument(toDocument('entries', old, null)!, scoreOptions())!.score;
    const freshScore = scoreDocument(toDocument('entries', fresh, null)!, scoreOptions())!.score;
    expect(freshScore).toBeGreaterThan(oldScore);
  });

  it('boosts children of a matched project', () => {
    const withProject = scoreDocument(
      toDocument('entries', entry, 'JARVIS')!,
      scoreOptions({ matchedProjectIds: new Set([project.id]) })
    )!.score;
    const without = scoreDocument(toDocument('entries', entry, 'JARVIS')!, scoreOptions())!.score;
    expect(withProject).toBeGreaterThan(without);
  });

  it('shapes a hit with origin, snippet and matched terms', () => {
    const scored = scoreDocument(toDocument('entries', entry, 'JARVIS')!, scoreOptions())!;
    const hit = toHit(scored, new Map([[project.id, 'JARVIS']]));
    expect(hit.origin).toBe('Journal · JARVIS');
    expect(hit.snippet.toLowerCase()).toContain('retrieval');
    expect(hit.matched).toContain('retrieval');
    expect(hit.title).toBe(entry.title);
  });

  it('falls back to the body for an untitled record', () => {
    const untitled = createEntry({ title: '', body: 'Retrieval broke again today.' });
    const scored = scoreDocument(toDocument('entries', untitled, null)!, scoreOptions())!;
    expect(toHit(scored, new Map()).title).toContain('Retrieval');
  });
});

describe('result grouping and routing', () => {
  const hits = [
    { kind: 'entries', id: 'e1', projectId: null },
    { kind: 'projects', id: 'p1', projectId: 'p1' },
    { kind: 'tasks', id: 't1', projectId: 'p1' },
    { kind: 'milestones', id: 'm1', projectId: null }
  ] as unknown as ReturnType<typeof toHit>[];

  it('groups by kind in a stable order and drops empty groups', () => {
    const groups = groupHits(hits);
    expect(groups.map((group) => group.kind)).toEqual(['projects', 'entries', 'milestones', 'tasks']);
  });

  it('routes each kind to the right screen', () => {
    expect(hitPath({ kind: 'projects', id: 'p1', projectId: null })).toBe('/projects/p1');
    expect(hitPath({ kind: 'entries', id: 'e1', projectId: 'p1' })).toBe('/journal/e1');
    expect(hitPath({ kind: 'milestones', id: 'm1', projectId: 'p1' })).toBe('/projects/p1?focus=milestone-m1');
    expect(hitPath({ kind: 'tasks', id: 't1', projectId: null })).toBe('/journal?task=t1');
  });
});

describe('highlightSegments', () => {
  it('marks matched terms for the results list', () => {
    const segments = highlightSegments('Retrieval ranking', ['retrieval']);
    expect(segments[0]).toEqual({ text: 'Retrieval', match: true });
  });
});
