/**
 * Unit tests for the local understanding pipeline: project association,
 * personal-content detection, intent, signals, tags, tasks, milestones and
 * title/summary generation.
 */

import { describe, expect, it } from 'vitest';
import { classifyPersonal, projectSurfaceForms, resolveProject } from './projects';
import { classifyIntent } from './intent';
import { extractMeasurements, extractSignals, signalsOfKind } from './signals';
import { extractTags } from './tags';
import { extractListTasks, extractTasks, toProposedTask } from './tasks';
import { detectMilestones, findDuplicateMilestone, toProposedMilestone } from './milestones';
import { buildSummary, buildTitle, coreClause, previewLine } from './summarize';
import { localProvider } from './provider';
import { primaryTemporal } from './temporal';
import { makeContext, makeMilestone, makeProject, makeTask } from '../../testing/helpers';
import type { Project } from '../types';

const TZ = 'UTC';
const NOW = new Date('2026-10-17T09:30:00.000Z');
const ctx = { now: NOW, timezone: TZ };

function list(...specs: Array<{ name: string; aliases?: string[]; privacy?: Project['privacy'] }>): Project[] {
  return specs.map((spec) => makeProject(spec));
}

describe('project association (§28.4)', () => {
  const projects = list({ name: 'JARVIS', aliases: ['assistant'] }, { name: 'AXIOM' });

  it('matches an exact name at the highest confidence', () => {
    const result = resolveProject('Debugged the JARVIS retrieval path.', projects);
    expect(result.match?.name).toBe('JARVIS');
    expect(result.match!.confidence).toBeGreaterThan(0.98);
    expect(result.ambiguousReference).toBe(false);
  });

  it('matches a punctuation-free form', () => {
    expect(resolveProject('AXIOM-4 build finished', projects).match?.name).toBe('AXIOM');
  });

  it('matches a known alias', () => {
    const result = resolveProject('Spent the evening on the assistant.', projects);
    expect(result.match?.name).toBe('JARVIS');
    expect(result.match!.phrase).toContain('assistant');
  });

  it('matches a name written without its punctuation', () => {
    expect(resolveProject('Worked on mark-50 today.', list({ name: 'MARK 50' })).match?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(resolveProject('Shipped the reinvent build.', list({ name: 'RE:INVENT' })).match?.name).toBe('RE:INVENT');
  });

  it('does not match a longer word that merely contains the name', () => {
    // "jarviss" contains "jarvis" but is not the project name.
    expect(resolveProject('Worked on jarviss today.', list({ name: 'JARVIS' })).match?.phrase).not.toBe('jarvis');
  });

  it('offers an acronym as a candidate instead of auto-linking', () => {
    const pos = list({ name: 'Personal Operating System' });
    const result = resolveProject('POS boot loop again.', pos);
    expect(result.match).toBeNull();
    expect(result.candidates[0]?.name).toBe('Personal Operating System');
    expect(result.candidates[0]!.confidence).toBeLessThan(0.82);
  });

  it('does not pick a winner when two projects match equally', () => {
    const rivals = list({ name: 'Personal Operating System' }, { name: 'Portable Ops Suite' });
    const result = resolveProject('POS crashed again.', rivals);
    expect(result.match).toBeNull();
    expect(result.candidates).toHaveLength(2);
    expect(result.notes.join(' ')).toMatch(/Both .* and .* were mentioned/);
  });

  it('excludes a negated mention and explains why', () => {
    const result = resolveProject('This was not for JARVIS, it was for AXIOM.', projects);
    expect(result.match?.name).toBe('AXIOM');
    expect(result.excluded).toContain('JARVIS');
    expect(result.notes.join(' ')).toMatch(/mentioned as excluded/);
  });

  it('links an explicitly named project even in personal writing', () => {
    const result = resolveProject('I felt drained after the JARVIS session but proud of the work.', projects, {
      isPersonal: true
    });
    expect(result.match?.name).toBe('JARVIS');
  });

  it('withholds attachment for personal writing on a weak signal', () => {
    const pos = list({ name: 'Personal Operating System' });
    const result = resolveProject('Felt good about POS today.', pos, { isPersonal: true });
    expect(result.match).toBeNull();
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('offers the active project as a candidate for a vague reference', () => {
    const result = resolveProject('That was frustrating on the project.', projects, {
      activeProjectId: projects[0]!.id
    });
    expect(result.ambiguousReference).toBe(true);
    expect(result.candidates.map((candidate) => candidate.project_id)).toContain(projects[0]!.id);
    expect(result.candidates[0]!.confidence).toBe(0.5);
    expect(result.match).toBeNull();
    expect(result.notes.join(' ')).toMatch(/without naming it/);
  });

  it('does not attach anything when the message names no project at all', () => {
    const result = resolveProject('That was frustrating.', projects, { activeProjectId: projects[0]!.id });
    expect(result.match).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it('offers a near-miss spelling as a candidate, never as a fact', () => {
    const close = resolveProject('Worked on JARVISS retrieval.', projects);
    expect(close.match).toBeNull();
    expect(close.candidates[0]?.name).toBe('JARVIS');
    expect(close.notes.join(' ')).toMatch(/matched approximately/i);
    // A distant word is left alone rather than guessed at.
    const far = resolveProject('Worked on JAVRIS retrieval.', projects);
    expect(far.match).toBeNull();
    expect(far.candidates).toEqual([]);
  });

  it('reports no match for unrelated text', () => {
    expect(resolveProject('Replaced a bearing.', projects).match).toBeNull();
    expect(resolveProject('', projects).match).toBeNull();
  });

  it('skips deleted projects', () => {
    const withDeleted = list({ name: 'JARVIS' });
    withDeleted[0]!.deleted_at = '2026-10-01T00:00:00.000Z';
    expect(resolveProject('JARVIS work.', withDeleted).match).toBeNull();
  });

  it('generates the surface forms that are matched against', () => {
    const forms = projectSurfaceForms(makeProject({ name: 'MARK 50' }));
    expect(forms.map((form) => form.form)).toEqual(['mark 50', 'mark-50', 'mark50']);
    expect(forms.map((form) => form.weight)).toEqual([1, 0.95, 0.93]);
    expect(projectSurfaceForms(makeProject({ name: 'RE:INVENT' })).map((form) => form.form)).toEqual([
      're:invent',
      'reinvent',
      're-invent'
    ]);
  });
});

describe('personal content classification', () => {
  it('recognises emotional first-person writing', () => {
    const result = classifyPersonal('I felt lonely tonight and thought about my family.');
    expect(result.isPersonal).toBe(true);
    expect(result.personalScore).toBeGreaterThan(result.technicalScore);
  });

  it('does not flag technical work as personal', () => {
    expect(classifyPersonal('Fixed the firmware bug and re-ran the test suite.').isPersonal).toBe(false);
  });

  it('keeps mixed content technical when the technical signal dominates', () => {
    expect(classifyPersonal('Frustrating day, but the sensor firmware finally passed its test.').isPersonal).toBe(false);
  });
});

describe('intent classification (§28.2 step 4)', () => {
  it('detects failures, decisions, discoveries and experiments', () => {
    expect(classifyIntent('It failed because the readings were unstable.').type).toBe('failure');
    expect(classifyIntent('We decided to abandon React Native for Flutter.').type).toBe('decision');
    expect(classifyIntent('Found out that the cache never expired.').type).toBe('discovery');
    expect(classifyIntent('Tested the sensor at 3.3 volts.').type).toBe('experiment');
  });

  it('defaults to a note when nothing is clear', () => {
    const result = classifyIntent('Replaced the bearing.');
    expect(result.type).toBe('note');
    expect(result.confidence).toBeLessThan(0.7);
  });

  it('detects hedged wording and the exact phrase', () => {
    const result = classifyIntent('The new algorithm is probably much faster.');
    expect(result.hedged).toBe(true);
    expect(result.tentativePhrases.join(' ')).toContain('probably');
  });

  it('never claims "verified" without verification language and a measurement', () => {
    expect(classifyIntent('The new algorithm is probably much faster.').evidenceLevel).not.toBe('verified');
    expect(classifyIntent('It works now.').evidenceLevel).not.toBe('verified');
    expect(classifyIntent('Confirmed the fix works: latency dropped to 45 ms.').evidenceLevel).toBe('verified');
  });

  it('demotes a hedge from a claimed verification', () => {
    expect(classifyIntent('Verified that latency dropped to 40 ms.').evidenceLevel).toBe('verified');
    expect(classifyIntent('Probably verified that latency dropped to 40 ms.').evidenceLevel).toBe('implemented');
  });

  it('never invents an evidence level for a bare statement', () => {
    expect(classifyIntent('Probably verified that the output is stable.').evidenceLevel).toBe('concept');
  });

  it('caps a failure and flags the missing measurement', () => {
    const result = classifyIntent('The verified approach failed under load.');
    expect(result.evidenceLevel).not.toBe('verified');
    expect(result.measurementsMentioned).toBe(false);
  });

  it('flags a comparative claim made without a measurement', () => {
    expect(classifyIntent('Much faster than before.').unmeasuredComparisons.length).toBeGreaterThan(0);
    expect(classifyIntent('Much faster than before: 42 ms instead of 120 ms.').unmeasuredComparisons).toEqual([]);
  });

  it('detects verification language', () => {
    expect(classifyIntent('Confirmed with the customer.').verificationLanguage).toContain('confirmed');
  });

  it('marks personal writing', () => {
    expect(classifyIntent('I felt grateful for my family today.').isPersonal).toBe(true);
  });
});

describe('signal extraction', () => {
  it('separates completion, problems, decisions and plans', () => {
    const signals = extractSignals(
      'I finished the harness, but it failed under load. I decided to rewrite it. I will test it tomorrow.'
    );
    expect(signalsOfKind(signals, 'completed').join(' ')).toMatch(/finished the harness/i);
    expect(signalsOfKind(signals, 'problem').join(' ')).toMatch(/failed under load/i);
    expect(signalsOfKind(signals, 'decision').join(' ')).toMatch(/decided to rewrite/i);
    expect(signalsOfKind(signals, 'plan').join(' ')).toMatch(/test it tomorrow/i);
  });

  it('keeps fragments verbatim from the message', () => {
    const signals = extractSignals('I finished the harness, but the readings were unstable.');
    const completed = signalsOfKind(signals, 'completed');
    expect(completed[0]).toContain('finished the harness');
    expect(signals.every((signal) => signal.confidence > 0)).toBe(true);
  });

  it('reads measurements and marks the ones that are missing', () => {
    expect(extractMeasurements('Latency dropped to 45 ms.').some((m) => m.value === 45 && m.unit === 'ms')).toBe(true);
    expect(extractMeasurements("I haven't measured the latency yet.").some((m) => m.missing)).toBe(true);
    expect(extractMeasurements('Nothing measured here.')).toEqual([]);
  });
});

describe('tag suggestion (§28.2 step 5)', () => {
  it('reuses existing tags first', () => {
    const result = extractTags('Debugging the retrieval ranking.', { existingTags: ['debugging'] });
    expect(result.tags[0]).toBe('debugging');
    expect(result.reused).toContain('debugging');
  });

  it('ranks lexicon vocabulary above incidental words', () => {
    const tags = extractTags('Soldered the PCB and checked the firmware.', {}).tags;
    expect(tags).toContain('pcb');
    expect(tags).toContain('firmware');
    // "checked" is filler and must not become a tag.
    expect(tags).not.toContain('checked');
  });

  it('never exceeds five tags', () => {
    const tags = extractTags('Today I worked on the thing with the stuff and did some work.', {}).tags;
    expect(tags.length).toBeLessThanOrEqual(5);
  });

  it('excludes project names from tags', () => {
    const tags = extractTags('JARVIS retrieval work.', { exclude: ['jarvis'] }).tags;
    expect(tags).not.toContain('jarvis');
  });

  it('returns no tags for filler text', () => {
    expect(extractTags('ok', {}).tags).toEqual([]);
  });
});

describe('task extraction (§28.5)', () => {
  it('extracts a commitment with a due date from its own clause', () => {
    const tasks = extractTasks('I fixed the harness today and I need to recalibrate the sensor tomorrow.', ctx);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toMatch(/recalibrate the sensor/i);
    expect(tasks[0]!.due_on).toBe('2026-10-18');
    expect(tasks[0]!.open_ended).toBe(false);
  });

  it('reads bullet lists under a "still to do" header', () => {
    const tasks = extractListTasks('Notes.\n\nStill to do:\n- recalibrate the offset\n- write a sampling test\n\nDone.');
    expect(tasks.map((task) => task.title)).toEqual(['Recalibrate the offset', 'Write a sampling test']);
    expect(tasks.every((task) => task.due_on === null)).toBe(true);
  });

  it('caps extraction at three tasks', () => {
    const text = 'I need to do one, and I need to do two, and I need to do three, and I need to do four.';
    expect(extractTasks(text, ctx)).toHaveLength(3);
  });

  it('leaves the due date null for an open-ended intention and says so', () => {
    const [extracted] = extractTasks('I should improve the error handling eventually.', ctx);
    const proposed = toProposedTask(extracted!, { key: 'task-0', projectId: null, tags: [], existing: [], ctx });
    expect(proposed.task.due_on).toBeNull();
    expect(proposed.task.due_precision).toBe('unknown');
    expect(proposed.reason).toMatch(/no due date/i);
    expect(proposed.include).toBe(true);
  });

  it('keeps the date out of the title and refuses a past-dated due date', () => {
    const [extracted] = extractTasks('I need to finish the report by yesterday.', ctx);
    expect(extracted!.title).toBe('Finish the report');
    const proposed = toProposedTask(extracted!, { key: 'task-0', projectId: null, tags: [], existing: [], ctx });
    expect(proposed.task.due_on).toBeNull();
    expect(proposed.reason).toMatch(/not in the future/i);
  });

  it('drops a due date that a timezone shift pushed into the past', () => {
    const [extracted] = extractTasks('I need to recalibrate the sensor tomorrow.', ctx);
    const stale = { ...extracted!, due_on: '2026-10-01' };
    const proposed = toProposedTask(stale, { key: 'task-0', projectId: null, tags: [], existing: [], ctx });
    expect(proposed.task.due_on).toBeNull();
    expect(proposed.task.due_precision).toBe('unknown');
    expect(proposed.reason).toMatch(/past date/i);
  });

  it('marks an already-open task as a duplicate instead of re-creating it', () => {
    const existing = makeTask({ id: '01TASK0000000000000000000001', title: 'Recalibrate the sensor offset' });
    const [extracted] = extractTasks('I need to recalibrate the sensor offset tomorrow.', ctx);
    const proposed = toProposedTask(extracted!, {
      key: 'task-0',
      projectId: null,
      tags: [],
      existing: [existing],
      ctx
    });
    expect(proposed.include).toBe(false);
    expect(proposed.duplicate_of).toBe(existing.id);
    expect(proposed.duplicate_title).toBe(existing.title);
    expect(proposed.reason).toMatch(/similar open task/i);
  });

  it('ignores completed and dropped tasks when looking for duplicates', () => {
    const done = makeTask({ id: '01TASK0000000000000000000002', title: 'Recalibrate the sensor offset', status: 'done' });
    const [extracted] = extractTasks('I need to recalibrate the sensor offset tomorrow.', ctx);
    const proposed = toProposedTask(extracted!, { key: 'task-0', projectId: null, tags: [], existing: [done], ctx });
    expect(proposed.include).toBe(true);
    expect(proposed.duplicate_of).toBeUndefined();
  });

  it('shortens an over-long title into a description', () => {
    const long = `I need to ${'rewrite the entire ingestion pipeline '.repeat(4)}by tomorrow.`;
    const [extracted] = extractTasks(long, ctx);
    expect(extracted!.title.length).toBeLessThanOrEqual(64);
    expect(extracted!.description).toBeTruthy();
  });

  it('links a task back to the entry that produced it', () => {
    const [extracted] = extractTasks('I need to recalibrate the sensor tomorrow.', ctx);
    const proposed = toProposedTask(extracted!, {
      key: 'task-0',
      projectId: 'p1',
      tags: ['sensor'],
      sourceEntryId: 'e1',
      existing: [],
      ctx
    });
    expect(proposed.task.source_entry_id).toBe('e1');
    expect(proposed.task.project_id).toBe('p1');
    expect(proposed.task.status).toBe('todo');
  });
});

describe('milestone detection (§28.6)', () => {
  it('detects firsts and completions', () => {
    const candidates = detectMilestones('Built the first working prototype of the sensor rig.', ctx);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.title).toMatch(/first working prototype/i);
    expect(candidates[0]!.tentative).toBe(false);
  });

  it('uses the message date for the milestone date', () => {
    const text = 'Shipped the first release yesterday.';
    const temporal = primaryTemporal(text, ctx);
    const candidates = detectMilestones(text, { ...ctx, temporal });
    expect(candidates[0]?.date).toBe('2026-10-16');
  });

  it('never treats a plan or a wish as an achievement', () => {
    const planned = detectMilestones('Planning to launch the first version soon.', ctx);
    expect(planned.every((candidate) => candidate.tentative)).toBe(true);
    const wished = detectMilestones('Hoping to complete the first release.', ctx);
    expect(wished.every((candidate) => candidate.tentative)).toBe(true);
    for (const candidate of [...planned, ...wished]) {
      const proposed = toProposedMilestone(candidate, { key: 'm-0', projectId: null, tags: [], existing: [] });
      expect(proposed.include).toBe(false);
      expect(proposed.milestone.verification).toBe('claimed');
    }
  });

  it('offers a hedged achievement for confirmation only', () => {
    const candidates = detectMilestones('I think I finally got the first version working, maybe.', { ...ctx, hedged: true });
    expect(candidates[0]?.tentative).toBe(true);
    const proposed = toProposedMilestone(candidates[0]!, { key: 'm-0', projectId: null, tags: [], existing: [] });
    expect(proposed.include).toBe(false);
    expect(proposed.reason).toMatch(/tentative/i);
  });

  it('never writes a verified milestone from prose', () => {
    const candidates = detectMilestones('Completed the first full integration run.', ctx);
    const proposed = toProposedMilestone(candidates[0]!, { key: 'm-0', projectId: 'p1', tags: [], existing: [] });
    expect(proposed.include).toBe(true);
    expect(proposed.milestone.status).toBe('achieved');
    expect(proposed.milestone.verification).toBe('claimed');
    expect(proposed.milestone.evidence).toEqual([]);
    expect(proposed.reason).toMatch(/claimed/i);
  });

  it('does not re-detect an existing milestone', () => {
    const existing = makeMilestone({ id: '01MILESTONE000000000000000001', title: 'First working prototype' });
    const candidates = detectMilestones('Built the first working prototype.', ctx);
    expect(findDuplicateMilestone(candidates[0]!, [existing], null)?.id).toBe(existing.id);
    const proposed = toProposedMilestone(candidates[0]!, {
      key: 'm-0',
      projectId: null,
      tags: [],
      existing: [existing]
    });
    expect(proposed.include).toBe(false);
    expect(proposed.duplicate_of).toBe(existing.id);
  });
});

describe('title and summary generation (§28.2 step 5)', () => {
  it('derives the title from the core clause without changing the words', () => {
    expect(buildTitle('Replaced the fan controller today. Readings are stable now.')).toBe('Replaced the fan controller today');
  });

  it('uses a heading-like first line as the title', () => {
    expect(buildTitle('Sensor harness\n\nRewired the connector and logged the results.')).toBe('Sensor harness');
  });

  it('caps the title at 72 characters on a word boundary', () => {
    const title = buildTitle(`${'Investigating the retrieval ranking behaviour '.repeat(3)}today.`);
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title.endsWith('…')).toBe(true);
  });

  it('prefixes the project name only when it is missing', () => {
    expect(buildTitle('Replaced the harness.', { projectName: 'JARVIS' })).toBe('JARVIS: Replaced the harness');
    expect(buildTitle('JARVIS harness replaced.', { projectName: 'JARVIS' })).toBe('JARVIS harness replaced');
  });

  it('keeps hedged wording in the title', () => {
    expect(buildTitle('The new algorithm is probably faster.').toLowerCase()).toContain('probably');
  });

  it('produces no title for empty input', () => {
    expect(buildTitle('   ')).toBe('');
  });

  it('builds a short summary only for longer messages', () => {
    expect(buildSummary('Short note.')).toBeUndefined();
    const long =
      'I started by rewiring the harness. It failed because the readings were unstable. I decided to add a decoupling capacitor.';
    const summary = buildSummary(long, { signals: extractSignals(long) });
    expect(summary).toBeTruthy();
    expect(summary!.length).toBeLessThanOrEqual(240);
    expect(long).toContain(summary!.split('. ')[0]!);
  });

  it('prefers the most informative clause', () => {
    expect(coreClause('Today. Fixed the harness.')).toMatch(/harness/);
  });

  it('gives a single preview line for lists', () => {
    expect(previewLine({ body: 'First line\nsecond line' })).toMatch(/First line/);
    expect(previewLine({ summary: 'A summary.', body: 'First line' })).toBe('A summary.');
    expect(previewLine({ body: '' })).toBe('');
  });
});

describe('AI disclosure (§28.10)', () => {
  it('states that nothing leaves the device with the local provider', () => {
    expect(localProvider.describeTransmission('Fixed the JARVIS bug.', makeContext())).toEqual([
      'Nothing leaves this device.'
    ]);
  });

  it('reports the local provider as always available', () => {
    expect(localProvider.kind).toBe('local');
    expect(localProvider.isAvailable()).toBe(true);
  });
});
