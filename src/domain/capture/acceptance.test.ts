/**
 * Conversational capture acceptance tests (§28.15).
 *
 * One test per scenario from the brief. These exercise the real pipeline:
 * analyze → validate → commit, against an in-memory writer, with a fixed clock
 * so date assertions are exact.
 *
 * Reference "now": Saturday 2026-10-17T09:30:00Z.
 */

import { describe, expect, it, vi } from 'vitest';
import { analyzeCapture, captureIdFor } from './analyzer';
import { commitProposal, describeCommit, validateProposal } from './proposal';
import { createRemoteProvider, localProvider, parseProviderPayload } from './provider';
import { extractTemporal } from './temporal';
import { interpretCorrection } from './corrections';
import { buildArchive } from '../export/archive';
import { tidyText } from '../text';
import { localDateIso } from '../time';
import type { ChronicleRecords, JournalEntry, Project } from '../types';
import type { CaptureContext } from './types';
import {
  FIXED_NOW_ISO,
  emptyMemoryStore,
  fixedNow,
  makeContext,
  makeEntry,
  makeProject,
  makeTask,
  memoryWriter,
  recordContext
} from '../../testing/helpers';

const UTC = 'UTC';
const IST = 'Asia/Kolkata';

function jarvisAndVeronica() {
  const jarvis = makeProject({ id: '01PROJECTJARVIS000000000001', name: 'JARVIS', aliases: ['assistant'] });
  const veronica = makeProject({ id: '01PROJECTVERONICA0000000001', name: 'VERONICA', aliases: ['space'] });
  return { jarvis, veronica };
}

/** Run the full pipeline for one message and return everything about it. */
async function commit(
  input: string,
  options: { timezone?: string; mode?: CaptureContext['mode']; projects?: Project[] } = {}
) {
  const timezone = options.timezone ?? UTC;
  const context = makeContext({ timezone, mode: options.mode ?? 'quick', projects: options.projects ?? [] });
  const proposal = analyzeCapture({ input, context });
  const { writer, store } = memoryWriter();
  const report = validateProposal(proposal, context);
  const result = await commitProposal(proposal, writer, { context: recordContext(timezone, FIXED_NOW_ISO) });
  return { proposal, store, result, report, context, writer };
}

describe('§28.15 TEST 1 — basic journal', () => {
  const input = 'I had a frustrating day but learned a lot about Python.';

  it('creates an entry with an automatic creation timestamp and no forced project', async () => {
    const { proposal, store, result } = await commit(input);
    expect(result.ok).toBe(true);
    expect(store.entries.size).toBe(1);

    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(entry.created_at).toBe(FIXED_NOW_ISO);
    expect(entry.updated_at).toBe(FIXED_NOW_ISO);
    expect(entry.project_id).toBeNull();
    expect(entry.type).toBe('reflection');
    expect(entry.private).toBe(true);
    expect(proposal.understanding.is_personal).toBe(true);
  });

  it('preserves the original wording verbatim', async () => {
    const { store } = await commit(input);
    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(entry.body).toBe(input);
    expect(entry.source.original_input).toBe(input);
    expect(entry.source.kind).toBe('capture');
    expect(entry.derived?.title).toBe(true);
  });
});

describe('§28.15 TEST 2 — project progress', () => {
  const input = 'I fixed the retrieval bug in JARVIS, but ranking still needs work.';

  it('associates the entry with JARVIS', async () => {
    const { jarvis } = jarvisAndVeronica();
    const { proposal, store } = await commit(input, { projects: [jarvis] });
    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(entry.project_id).toBe(jarvis.id);
    expect(proposal.understanding.project?.name).toBe('JARVIS');
    expect(proposal.understanding.project!.confidence).toBeGreaterThanOrEqual(0.82);
  });

  it('separates completed work from remaining work', async () => {
    const { jarvis } = jarvisAndVeronica();
    const { proposal } = await commit(input, { projects: [jarvis] });
    const completed = proposal.understanding.completed.join(' | ').toLowerCase();
    const problems = proposal.understanding.problems.join(' | ').toLowerCase();
    expect(completed).toContain('fixed');
    expect(problems).toMatch(/still needs work|ranking/);
  });

  it('does not claim the work is complete or verified', async () => {
    const { jarvis } = jarvisAndVeronica();
    const { store } = await commit(input, { projects: [jarvis] });
    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(entry.evidence_level).not.toBe('verified');
    expect(entry.evidence_level).not.toBe('deployed');
    expect(entry.evidence).toEqual([]);
  });
});

describe('§28.15 TEST 3 — future task', () => {
  const input = 'Tomorrow I need to test the new implementation against the previous version.';

  it('proposes a task whose due date is tomorrow and separate from creation time', async () => {
    const { proposal, store } = await commit(input);
    const task = [...store.tasks.values()][0];
    expect(task).toBeDefined();
    expect(task?.due_on).toBe('2026-10-18');
    expect(task?.created_at).toBe(FIXED_NOW_ISO);
    expect(task?.title.toLowerCase()).toContain('test the new implementation');
    expect(task?.status).toBe('todo');
    expect(proposal.records.some((record) => record.kind === 'task')).toBe(true);
  });

  it('respects the timezone when resolving "tomorrow"', async () => {
    // 09:30Z is 15:00 in IST on the same calendar day, so "tomorrow" is the same date.
    const { store } = await commit(input, { timezone: IST });
    const task = [...store.tasks.values()][0];
    expect(task?.due_on).toBe(localDateIso(new Date('2026-10-18T09:30:00.000Z'), IST));
  });

  it('does not invent a due date for a vague intention', async () => {
    const { store } = await commit('I should improve the error handling eventually.');
    const task = [...store.tasks.values()][0];
    expect(task?.due_on).toBeNull();
    expect(task?.due_precision).toBe('unknown');
  });
});

describe('§28.15 TEST 4 — historical event', () => {
  const input = 'Last week I finished the first working prototype.';

  it('keeps created_at at capture time and records the historical date separately', async () => {
    const { store, proposal } = await commit(input);
    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(entry.created_at).toBe(FIXED_NOW_ISO);
    expect(entry.occurred_source).toBe('text');
    expect(entry.occurred_precision).toBe('week');
    const eventDate = localDateIso(entry.occurred_at, UTC);
    expect(eventDate).not.toBe('2026-10-17');
    expect(eventDate >= '2026-10-05' && eventDate <= '2026-10-11').toBe(true);
    expect(proposal.understanding.occurred_at).toBe(entry.occurred_at);
  });

  it('proposes the milestone as a claim, not a verified achievement', async () => {
    const { store } = await commit(input);
    const milestone = [...store.milestones.values()][0];
    expect(milestone?.title.toLowerCase()).toContain('first working prototype');
    expect(milestone?.verification).toBe('claimed');
    expect(milestone?.status).toBe('achieved');
    expect(milestone?.evidence).toEqual([]);
  });
});

describe('§28.15 TEST 5 — ambiguous project', () => {
  const input = 'I finally fixed that issue.';

  it('saves the text without inventing the project or the issue', async () => {
    const { jarvis, veronica } = jarvisAndVeronica();
    const { store, proposal, result } = await commit(input, { projects: [jarvis, veronica] });
    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(result.ok).toBe(true);
    expect(entry.body).toBe(input);
    expect(entry.project_id).toBeNull();
    expect(entry.title.toLowerCase()).not.toContain('jarvis');
    expect(entry.title.toLowerCase()).not.toContain('veronica');
    expect(proposal.understanding.project).toBeNull();
  });

  it('is not misread as a correction of a previous record', async () => {
    const { jarvis } = jarvisAndVeronica();
    const context = makeContext({ projects: [jarvis], recentEntries: [makeEntry({ title: 'Earlier work' })] });
    expect(interpretCorrection(input, context)).toBeNull();
    const proposal = analyzeCapture({ input, context });
    expect(proposal.records[0]?.kind).toBe('entry');
  });
});

describe('§28.15 TEST 6 — multiple records', () => {
  const input = 'I tested the new sensor, it failed because of unstable readings, and I need to recalibrate it tomorrow.';

  it('records the test, preserves the failure and proposes a follow-up task', async () => {
    const { store, proposal } = await commit(input);
    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(entry.body).toBe(input);
    expect(['experiment', 'failure']).toContain(entry.type);
    expect(proposal.understanding.problems.join(' ').toLowerCase()).toContain('unstable readings');

    const task = [...store.tasks.values()][0];
    expect(task?.title.toLowerCase()).toContain('recalibrate');
    expect(task?.due_on).toBe('2026-10-18');
    expect(task?.source_entry_id).toBe(entry.id);
  });

  it('does not invent a successful outcome', async () => {
    const { store } = await commit(input);
    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(entry.evidence_level).not.toBe('verified');
    expect(store.milestones.size).toBe(0);
  });
});

describe('§28.15 TEST 7 — correction', () => {
  it('moves the last entry to VERONICA instead of creating a new one', async () => {
    const { jarvis, veronica } = jarvisAndVeronica();
    const first = await commit('I fixed the retrieval bug in JARVIS.', { projects: [jarvis, veronica] });
    const entryId = first.result.created.entries[0] as string;
    expect(entryId).toBeTruthy();

    const context = makeContext({
      projects: [jarvis, veronica],
      lastCommit: {
        capture_id: first.proposal.capture_id,
        committed_at: FIXED_NOW_ISO,
        input: 'I fixed the retrieval bug in JARVIS.',
        entryIds: [entryId],
        taskIds: [],
        milestoneIds: [],
        updatedIds: []
      }
    });

    const correction = analyzeCapture({ input: 'That entry belongs to VERONICA instead.', context });
    expect(correction.records).toHaveLength(1);
    expect(correction.records[0]?.kind).toBe('update');
    expect(correction.requires_review).toBe(true);

    const update = correction.records[0];
    expect(update?.kind === 'update' && update.update.changes.project_id).toBe(veronica.id);

    // Commit the correction against the store that already holds the entry.
    correction.records.forEach((record) => {
      record.include = true;
    });
    const result = await commitProposal(correction, first.writer, { context: recordContext() });
    expect(result.ok).toBe(true);
    expect(result.created.entries).toHaveLength(0);
    expect(first.store.entries.size).toBe(1);
    expect((first.store.entries.get(entryId) as JournalEntry).project_id).toBe(veronica.id);
  });

  it('applies the correction to the stored entry and keeps the original text', async () => {
    const { jarvis, veronica } = jarvisAndVeronica();
    const store = emptyMemoryStore();
    const entry = makeEntry({
      id: '01ENTRY0000000000000000001',
      title: 'Retrieval bug',
      body: 'I fixed the retrieval bug in JARVIS.',
      project_id: jarvis.id
    });
    store.entries.set(entry.id, entry);
    const { writer } = memoryWriter(store);

    const context = makeContext({
      projects: [jarvis, veronica],
      lastCommit: {
        capture_id: 'capture-1',
        committed_at: FIXED_NOW_ISO,
        input: entry.body,
        entryIds: [entry.id],
        taskIds: [],
        milestoneIds: [],
        updatedIds: []
      }
    });

    const correction = analyzeCapture({ input: 'That entry belongs to VERONICA instead.', context });
    correction.records.forEach((record) => {
      record.include = true;
    });
    const result = await commitProposal(correction, writer, { context: recordContext() });

    expect(result.ok).toBe(true);
    expect(result.updated).toHaveLength(1);
    expect(result.created.entries).toHaveLength(0);
    expect(store.entries.size).toBe(1);

    const updated = store.entries.get(entry.id) as JournalEntry;
    expect(updated.project_id).toBe(veronica.id);
    expect(updated.body).toBe(entry.body);
    expect(updated.source.original_input).toBeUndefined();
    expect(updated.rev).toBe(entry.rev + 1);
  });

  it('supports "don\'t create a separate task for this"', async () => {
    const store = emptyMemoryStore();
    const task = makeTask({ id: '01TASK00000000000000000001', title: 'Recalibrate the sensor' });
    store.tasks.set(task.id, task);
    const { writer } = memoryWriter(store);
    const context = makeContext({
      lastCommit: {
        capture_id: 'capture-2',
        committed_at: FIXED_NOW_ISO,
        input: 'I need to recalibrate the sensor.',
        entryIds: [],
        taskIds: [task.id],
        milestoneIds: [],
        updatedIds: []
      }
    });
    const proposal = analyzeCapture({ input: "Don't create a separate task for this.", context });
    const update = proposal.records[0];
    expect(update?.kind).toBe('update');
    if (update?.kind === 'update') expect(update.update.changes.status).toBe('dropped');
    await commitProposal(proposal, writer, { context: recordContext() });
    expect(store.tasks.get(task.id)?.status).toBe('dropped');
    // The task is kept, not destroyed: recovery must stay possible.
    expect(store.tasks.size).toBe(1);
  });
});

describe('§28.15 TEST 8 — offline', () => {
  it('saves the entry locally without touching the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await localProvider.analyze('Spent the evening soldering the power board.', makeContext());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.usedRemote).toBe(false);
    expect(result.notices).toEqual([]);
    expect(result.proposal.records[0]?.kind).toBe('entry');
    vi.unstubAllGlobals();
  });

  it('reports the save honestly through describeCommit', async () => {
    const { store, result } = await commit('Spent the evening soldering the power board.');
    expect(store.entries.size).toBe(1);
    expect(result.ok).toBe(true);
    expect(describeCommit(result)).toContain('saved');
  });

  it('reports failure honestly when the write fails', async () => {
    const input = 'Spent the evening soldering the power board.';
    const proposal = analyzeCapture({ input, context: makeContext() });
    const { writer, store } = memoryWriter();
    writer.putEntry = async () => {
      throw new Error('QuotaExceededError');
    };
    const result = await commitProposal(proposal, writer, { context: recordContext() });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toContain('QuotaExceededError');
    expect(store.entries.size).toBe(0);
    expect(describeCommit(result)).toBe('Nothing was saved.');
    // The original text is still available for a retry.
    expect(proposal.input).toBe(input);
  });
});

describe('§28.15 TEST 9 — invalid AI output', () => {
  it('rejects malformed structured data and keeps the local result', async () => {
    const provider = createRemoteProvider({
      endpoint: 'https://example.invalid/capture',
      model: 'test-model',
      apiKey: 'session-key',
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ entry: { title: 42, project_id: 'made-up-id' }, tasks: 'not-a-list' })
      })) as unknown as typeof fetch
    });

    const result = await provider.analyze('Investigated the ranking problem.', makeContext({ projects: [makeProject({ name: 'JARVIS' })] }));
    expect(result.usedRemote).toBe(false);
    expect(result.notices.join(' ')).toMatch(/invalid|not a known project|was not a list/i);
    expect(result.proposal.analyzer).toBe('local');
    const entry = result.proposal.records[0];
    expect(entry?.kind === 'entry' && entry.entry.body).toBe('Investigated the ranking problem.');
  });

  it('reports a parse failure with a reason', () => {
    const local = analyzeCapture({ input: 'Anything.', context: makeContext() });
    const parsed = parseProviderPayload({ entry: { occurred_at: 'not-a-date' } }, local, makeContext());
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/occurred_at/);
  });

  it('falls back to local capture on HTTP failure and timeout', async () => {
    const failing = createRemoteProvider({
      endpoint: 'https://example.invalid/capture',
      model: 'test-model',
      apiKey: 'k',
      fetchImpl: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch
    });
    const result = await failing.analyze('Fixed the build.', makeContext());
    expect(result.usedRemote).toBe(false);
    expect(result.notices.join(' ')).toMatch(/could not be reached/);

    const timingOut = createRemoteProvider({
      endpoint: 'https://example.invalid/capture',
      model: 'test-model',
      apiKey: 'k',
      timeoutMs: 5,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })) as unknown as typeof fetch
    });
    const timedOut = await timingOut.analyze('Fixed the build.', makeContext());
    expect(timedOut.usedRemote).toBe(false);
    expect(timedOut.notices.join(' ')).toMatch(/timed out/);
  });

  it('never lets a model raise a claim above the local reading', async () => {
    const provider = createRemoteProvider({
      endpoint: 'https://example.invalid/capture',
      model: 'test-model',
      apiKey: 'k',
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          entry: { title: 'Everything works', evidence_level: 'verified', type: 'milestone' },
          tasks: [],
          milestone: { title: 'Project complete', date: '2026-10-17' },
          notes: ['Looks done.']
        })
      })) as unknown as typeof fetch
    });
    const result = await provider.analyze('The new algorithm is probably much faster.', makeContext());
    expect(result.usedRemote).toBe(true);
    const entry = result.proposal.records.find((record) => record.kind === 'entry');
    expect(entry?.kind === 'entry' && entry.entry.evidence_level).not.toBe('verified');
    expect(entry?.kind === 'entry' && entry.entry.body).toBe('The new algorithm is probably much faster.');
    // A remote milestone suggestion is offered unchecked, never applied silently.
    const milestone = result.proposal.records.find((record) => record.kind === 'milestone');
    expect(milestone?.include).toBeFalsy();
    expect(result.proposal.requires_review).toBe(true);
  });
});

describe('§28.15 TEST 10 — repeated submission', () => {
  it('does not duplicate records when the same capture is committed twice', async () => {
    const input = 'Replaced the fan controller and logged the readings.';
    const context = makeContext();
    const captureId = captureIdFor(input, fixedNow());
    const proposal = analyzeCapture({ input, context, captureId });
    const { writer, store } = memoryWriter();

    const first = await commitProposal(proposal, writer, { context: recordContext() });
    const second = await commitProposal(proposal, writer, { context: recordContext() });

    expect(first.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(store.entries.size).toBe(1);
    const entryIds = new Set([...store.entries.keys()]);
    expect(entryIds.size).toBe(1);
  });

  it('derives the same id for the same submission', () => {
    const input = 'Same message.';
    expect(captureIdFor(input, fixedNow())).toBe(captureIdFor(input, fixedNow()));
    expect(captureIdFor(input, fixedNow('2026-10-17T09:31:30.000Z'))).not.toBe(captureIdFor(input, fixedNow()));
  });
});

describe('§28.15 TEST 11 — date ambiguity', () => {
  it('resolves "last Friday" to the most recent Friday and says so', () => {
    const matches = extractTemporal('That happened last Friday.', { now: fixedNow(), timezone: UTC });
    expect(matches.length).toBeGreaterThan(0);
    const best = matches[0]!;
    expect(best.date).toBe('2026-10-16');
    expect(best.precision).toBe('day');
    expect(best.ambiguity).toBeTruthy();
    expect(best.isFuture).toBe(false);
  });

  it('records the historical date instead of today, and asks for confirmation', async () => {
    const { proposal, store } = await commit('That happened last Friday.');
    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(entry.occurred_at.slice(0, 10)).toBe('2026-10-16');
    expect(entry.occurred_source).toBe('text');
    expect(entry.created_at).toBe(FIXED_NOW_ISO);
    // The reading is stated explicitly rather than silently applied.
    expect(proposal.issues.some((issue) => /Date reading/.test(issue.message))).toBe(true);
    expect(proposal.understanding.temporal_ambiguity).toBeTruthy();
  });

  it('does not invent a date when nothing temporal was said', async () => {
    const { store } = await commit('Replaced the bearing in the motor assembly.');
    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(entry.occurred_source).toBe('capture_time');
    expect(entry.occurred_at).toBe(FIXED_NOW_ISO);
  });
});

describe('§28.15 TEST 12 — verified achievement', () => {
  const input = 'The new algorithm is probably much faster.';

  it('preserves the tentative nature of the claim', async () => {
    const { proposal, store } = await commit(input);
    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(proposal.understanding.hedged).toBe(true);
    expect(proposal.understanding.tentative_phrases).toContain('probably');
    expect(entry.evidence_level).not.toBe('verified');
    expect(entry.evidence_level).not.toBe('tested');
    expect(entry.body).toBe(input);
  });

  it('suggests documenting benchmark evidence', async () => {
    const { proposal } = await commit(input);
    expect(proposal.understanding.questions.some((question) => question.reason === 'verification')).toBe(true);
    expect(proposal.understanding.notes.join(' ').toLowerCase()).toMatch(/claim|tentative/);
  });
});

describe('§28.15 TEST 13 — user privacy', () => {
  const input = 'I felt lonely tonight and thought about my family a lot.';

  it('saves a personal reflection locally and marks it private', async () => {
    const { store, proposal } = await commit(input);
    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(entry.private).toBe(true);
    expect(entry.type).toBe('reflection');
    expect(proposal.understanding.is_personal).toBe(true);
  });

  it('never transmits a private reflection when AI sending is disabled', async () => {
    const fetchSpy = vi.fn();
    const provider = createRemoteProvider({
      endpoint: 'https://example.invalid/capture',
      model: 'test-model',
      apiKey: 'k',
      allowPrivate: false,
      fetchImpl: fetchSpy as unknown as typeof fetch
    });
    const result = await provider.analyze(input, makeContext());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.usedRemote).toBe(false);
    expect(result.notices.join(' ')).toMatch(/personal reflection|nothing was transmitted/i);
  });
});

describe('§28.15 TEST 14 — long multiline mobile input', () => {
  const input = [
    'Long session today.',
    '',
    'Started by rewiring the sensor harness, which took about two hours.',
    'The readings were noisy at first, then stabilised after I added a decoupling cap.',
    '',
    'Still to do:',
    '- recalibrate the offset',
    '- write a test for the sampling loop',
    '',
    'Feeling good about this one.'
  ].join('\n');

  it('preserves every line and keeps a bounded title', async () => {
    const { store, proposal } = await commit(input);
    const entry = [...store.entries.values()][0] as JournalEntry;
    expect(entry.body).toBe(tidyText(input));
    for (const line of ['sensor harness', 'decoupling cap', 'recalibrate the offset', 'Feeling good about this one.']) {
      expect(entry.body).toContain(line);
    }
    expect(entry.title.length).toBeLessThanOrEqual(72);
    expect(proposal.records.length).toBeGreaterThan(1);
  });

  it('keeps the input available when processing fails', () => {
    const proposal = analyzeCapture({ input, context: makeContext() });
    expect(proposal.input).toBe(input);
    expect(proposal.capture_id).toBeTruthy();
  });
});

describe('§28.15 TEST 15 — export of captured records', () => {
  it('includes original text, structured records, ids, timestamps and relationships', async () => {
    const { jarvis } = jarvisAndVeronica();
    const input = 'I tested the new JARVIS sensor and I need to recalibrate it tomorrow.';
    const context = makeContext({ projects: [jarvis] });
    const proposal = analyzeCapture({ input, context });
    const store = emptyMemoryStore();
    store.projects.set(jarvis.id, jarvis);
    const { writer } = memoryWriter(store);
    const result = await commitProposal(proposal, writer, { context: recordContext() });
    expect(result.ok).toBe(true);

    const entryId = result.created.entries[0] as string;
    const taskId = result.created.tasks[0] as string;
    const records: ChronicleRecords = {
      projects: [...store.projects.values()],
      entries: [...store.entries.values()],
      milestones: [...store.milestones.values()],
      tasks: [...store.tasks.values()],
      revisions: []
    };
    const archive = await buildArchive(records, { timezone: UTC, exportedAt: FIXED_NOW_ISO });

    expect(archive.format).toBe('chronicle.archive');
    expect(archive.format_version).toBe(1);
    expect(archive.counts.entries).toBe(1);
    expect(archive.counts.tasks).toBe(1);
    expect(archive.integrity.record_count).toBe(2 + 1);

    const exportedEntry = archive.records.entries[0]!;
    expect(exportedEntry.id).toBe(entryId);
    expect(exportedEntry.source.original_input).toBe(input);
    expect(exportedEntry.source.capture_id).toBe(proposal.capture_id);
    expect(exportedEntry.created_at).toBe(FIXED_NOW_ISO);
    expect(exportedEntry.project_id).toBe(jarvis.id);

    const exportedTask = archive.records.tasks[0]!;
    expect(exportedTask.id).toBe(taskId);
    expect(exportedTask.source_entry_id).toBe(entryId);
    expect(exportedTask.due_on).toBe('2026-10-18');

    // The archive must be parseable again with identical identifiers.
    const json = JSON.stringify(archive);
    expect(json).toContain(entryId);
    expect(json).toContain(taskId);
  });
});

describe('proposal validation (§28.2 step 6)', () => {
  it('drops a dangling project reference instead of writing a broken link', () => {
    const context = makeContext({ projects: [] });
    const proposal = analyzeCapture({ input: 'Worked on the retrieval pipeline.', context });
    const entry = proposal.records[0];
    if (entry?.kind === 'entry') entry.entry.project_id = 'does-not-exist';
    const report = validateProposal(proposal, context);
    expect(report.warnings.join(' ')).toMatch(/does not exist/);
    expect(entry?.kind === 'entry' && entry.entry.project_id).toBeNull();
  });

  it('refuses a "verified" entry that carries no evidence', () => {
    const context = makeContext();
    const proposal = analyzeCapture({ input: 'Everything is verified and deployed to production.', context });
    const entry = proposal.records[0];
    if (entry?.kind === 'entry') entry.entry.evidence_level = 'verified';
    const report = validateProposal(proposal, context);
    expect(report.warnings.join(' ')).toMatch(/verified/i);
    expect(entry?.kind === 'entry' && entry.entry.evidence_level).toBe('tested');
  });

  it('does not duplicate an existing open task', async () => {
    const existing = makeTask({ id: '01TASKEXISTING000000000001', title: 'Recalibrate the sensor offset' });
    const context = makeContext({ openTasks: [existing] });
    const proposal = analyzeCapture({ input: 'I need to recalibrate the sensor offset tomorrow.', context });
    const taskRecord = proposal.records.find((record) => record.kind === 'task');
    expect(taskRecord?.include).toBe(false);
    if (taskRecord?.kind === 'task') expect(taskRecord.duplicate_of).toBe(existing.id);
  });
});
