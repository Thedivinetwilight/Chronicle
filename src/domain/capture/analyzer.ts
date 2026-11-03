/**
 * The local capture analyzer — the pipeline described in §28.2.
 *
 * `analyzeCapture` is pure and synchronous apart from its inputs: it takes the
 * user's message plus a *targeted* slice of context and returns a
 * `CaptureProposal`. Nothing is written here; committing happens in
 * `./proposal.ts` through the `CaptureWriter` port.
 *
 * Design rules enforced by this module:
 * - The user's original paragraph is stored verbatim as the entry body and as
 *   `source.original_input`. Derived values are flagged in `derived`.
 * - Record ids are derived from the capture id, so a retry cannot create a
 *   second copy of the same record (§28.13).
 * - Anything uncertain becomes a question or a note, never a silent guess.
 */

import { deterministicId } from '../ids';
import { tidyText, normalizeWhitespace, truncate } from '../text';
import { localDateIso } from '../time';
import type { EntryType, IsoDateTime } from '../types';
import { classifyIntent, extractSignals as intentSignals } from './intent';
import { detectMilestones, toProposedMilestone } from './milestones';
import { resolveProject } from './projects';
import { extractSignals, extractMeasurements, hasUnresolvedConclusion, signalsOfKind } from './signals';
import { buildSummary, buildTitle } from './summarize';
import { extractTags } from './tags';
import { extractTasks, toProposedTask } from './tasks';
import { primaryTemporal, splitEventAndCommitment, extractDurations, CONFIDENT, USABLE } from './temporal';
import { interpretCorrection } from './corrections';
import type {
  CaptureContext,
  CaptureProposal,
  Clarification,
  ProposedRecord,
  Understanding
} from './types';

export interface AnalyzeOptions {
  input: string;
  context: CaptureContext;
  /** Supplied by the caller (UI) so a retried submission reuses the same id. */
  captureId?: string;
}

/** A stable id for one capture operation. */
export function captureIdFor(input: string, now: Date): string {
  const bucket = Math.floor(now.getTime() / 60_000);
  return deterministicId(`${normalizeWhitespace(input)}|${bucket}|${now.getTimezoneOffset()}`, bucket * 60_000);
}

export function analyzeCapture(options: AnalyzeOptions): CaptureProposal {
  const { context } = options;
  const input = options.input;
  const clean = tidyText(input);
  const captureId = options.captureId ?? captureIdFor(input, context.now);
  const timezone = context.timezone;
  const nowIso = context.now.toISOString();
  const issues: CaptureProposal['issues'] = [];

  if (!clean) {
    return {
      capture_id: captureId,
      input,
      created_at: nowIso,
      mode: context.mode,
      timezone,
      analyzer: 'local',
      understanding: emptyUnderstanding(nowIso, timezone),
      records: [],
      requires_review: true,
      issues: [{ severity: 'error', message: 'Nothing to record: the message is empty.' }]
    };
  }

  /* -- Step 1: is this a correction of something already recorded? ----- */
  const correction = interpretCorrection(clean, context);
  if (correction) {
    return {
      capture_id: captureId,
      input,
      created_at: nowIso,
      mode: context.mode,
      timezone,
      analyzer: 'local',
      understanding: {
        ...emptyUnderstanding(nowIso, timezone),
        notes: [correction.explanation],
        questions: correction.needsConfirmation
          ? [{
              id: 'confirm-correction',
              reason: 'correction',
              question: correction.explanation,
              options: [
                { label: 'Apply change', value: 'apply' },
                { label: 'Cancel', value: 'cancel' }
              ]
            }]
          : []
      },
      records: [
        {
          key: 'update-1',
          kind: 'update',
          include: !correction.needsConfirmation,
          confidence: correction.confidence,
          reason: correction.explanation,
          update: correction.update
        }
      ],
      // A correction rewrites an existing record: always show it first.
      requires_review: true,
      issues: correction.issues.map((message) => ({ severity: 'warning' as const, message }))
    };
  }

  /* -- Steps 2–4: context, intent, extraction ------------------------- */
  const temporalCtx = { now: context.now, timezone };
  const intent = classifyIntent(clean);
  const { event, commitment } = splitEventAndCommitment(clean, temporalCtx);
  const projectResolution = resolveProject(clean, context.projects, {
    isPersonal: intent.isPersonal,
    activeProjectId: context.activeProjectId ?? null
  });
  const project = projectResolution.match;
  const projectId = project?.project_id ?? null;
  const projectRecord = projectId
    ? context.projects.find((candidate) => candidate.id === projectId) ?? null
    : null;

  const tagExtraction = extractTags(clean, {
    existingTags: context.existingTags,
    projects: context.projects,
    exclude: projectRecord ? [projectRecord.name, ...projectRecord.aliases] : []
  });

  const signals = extractSignals(clean);
  const measurements = extractMeasurements(clean);
  const reflections = signalsOfKind(signals, 'reflection');
  const durations = extractDurations(clean);
  const cues = intentSignals(clean);

  /* -- Timestamps: event date vs. capture time ------------------------ */
  const occurred: { at: IsoDateTime; precision: Understanding['occurred_precision']; source: Understanding['occurred_source']; confidence: number; phrase?: string; ambiguity?: string } =
    event && event.confidence >= USABLE && !event.isFuture
      ? {
          at: event.occurred_at,
          precision: event.precision,
          source: 'text',
          confidence: event.confidence,
          phrase: event.phrase,
          ...(event.ambiguity ? { ambiguity: event.ambiguity } : {})
        }
      : {
          at: nowIso,
          precision: 'exact',
          source: 'capture_time',
          confidence: event ? event.confidence : 0.4
        };

  if (event && event.confidence < USABLE && !event.isFuture) {
    issues.push({
      severity: 'info',
      message: `"${event.phrase}" suggests ${event.date} but was too vague to record as the event date; the capture time was used instead.`
    });
  }
  if (event && event.confidence >= USABLE && event.confidence < CONFIDENT && !event.isFuture) {
    issues.push({
      severity: 'info',
      message: `The event date was read as ${event.date} (${event.precision} precision) from "${event.phrase}".`
    });
  }
  if (event?.ambiguity) {
    issues.push({ severity: 'info', message: `Date reading: ${event.ambiguity}.` });
  }

  /* -- Title, summary, type ------------------------------------------ */
  const title = buildTitle(clean, { projectName: project?.name ?? null, type: intent.type });
  const summary = buildSummary(clean, { signals });

  const questions: Clarification[] = [];
  const notes: string[] = [...projectResolution.notes];

  if (projectResolution.candidates.length > 0 && !project) {
    questions.push({
      id: 'project',
      reason: 'project',
      question: projectResolution.ambiguousReference
        ? 'Which project is this about?'
        : `Should this be linked to ${projectResolution.candidates.map((c) => c.name).join(' or ')}?`,
      options: [
        { label: 'No project', value: '' },
        ...projectResolution.candidates.slice(0, 3).map((candidate) => ({
          label: candidate.name,
          value: candidate.project_id
        }))
      ]
    });
  }

  if (event && event.confidence < CONFIDENT && !event.isFuture && event.confidence >= USABLE) {
    questions.push({
      id: 'occurred_at',
      reason: 'date',
      question: `Read as ${event.date} (${event.precision}) from "${event.phrase}". Correct?`,
      options: [
        { label: `Yes, ${event.date}`, value: event.date },
        { label: 'It happened now', value: '' }
      ]
    });
  }

  if (intent.hedged) {
    notes.push(`Tentative wording preserved ("${intent.tentativePhrases[0]}"); nothing was marked verified.`);
  }
  if (intent.verificationLanguage.length > 0 && !intent.measurementsMentioned) {
    questions.push({
      id: 'evidence',
      reason: 'verification',
      question: 'This reads like a verified result. Add the measurement or artefact that proves it?',
      options: [
        { label: 'Keep as a claim', value: 'claim' },
        { label: 'Add evidence', value: 'evidence' }
      ]
    });
  }
  if (intent.unmeasuredComparisons.length > 0) {
    questions.push({
      id: 'comparison-evidence',
      reason: 'verification',
      question: `You wrote "${intent.unmeasuredComparisons[0]}" without a measurement. Record the benchmark or observation that supports it?`,
      options: [
        { label: 'Keep as a claim', value: 'claim' },
        { label: 'Add evidence', value: 'evidence' }
      ]
    });
    notes.push('A comparative claim was kept as a claim: no measurement was stated.');
  }
  if (measurements.some((measurement) => measurement.missing)) {
    notes.push('A missing measurement was recorded as an open question rather than a conclusion.');
  }
  if (hasUnresolvedConclusion(clean)) {
    notes.push('The conclusion is still open; the entry keeps that uncertainty.');
  }
  if (intent.isPersonal && !project) {
    notes.push('Recorded as a personal entry and marked private.');
  }
  if (cues.completed.length > 0 && cues.problems.length > 0) {
    notes.push('Completed work and remaining problems are listed separately in the review.');
  }

  /* -- Step 5: build the proposed records ---------------------------- */
  const entryId = deterministicId(`${captureId}:entry`, Date.parse(nowIso) || 0);
  const records: ProposedRecord[] = [];

  const isPersonalEntry = intent.isPersonal && !projectId;

  records.push({
    key: 'entry-1',
    kind: 'entry',
    include: true,
    confidence: Math.max(0.5, intent.confidence),
    entry: {
      id: entryId,
      title,
      // The user's own words, unmodified.
      body: clean,
      ...(summary ? { summary } : {}),
      type: intent.type,
      occurred_at: occurred.at,
      occurred_precision: occurred.precision,
      occurred_source: occurred.source,
      project_id: projectId,
      tags: tagExtraction.tags,
      evidence_level: intent.evidenceLevel,
      evidence: [],
      related_entry_ids: [],
      private: isPersonalEntry,
      timezone,
      pinned: false,
      source: {
        kind: 'capture',
        original_input: input,
        analyzer: 'local',
        capture_id: captureId,
        captured_at: nowIso
      },
      derived: {
        title: true,
        ...(summary ? { summary: true } : {}),
        tags: tagExtraction.tags.length > 0,
        type: true,
        project: Boolean(projectId),
        occurred_at: occurred.source === 'text'
      }
    }
  });

  const extractedTasks = extractTasks(clean, temporalCtx);
  extractedTasks.slice(0, 3).forEach((extracted, index) => {
    const proposed = toProposedTask(extracted, {
      key: `task-${index + 1}`,
      projectId,
      tags: tagExtraction.tags.slice(0, 3),
      sourceEntryId: entryId,
      existing: context.openTasks,
      ctx: temporalCtx
    });
    proposed.task.id = deterministicId(`${captureId}:task:${index}`, Date.parse(nowIso) || 0);
    if (proposed.duplicate_of) {
      notes.push(`Did not create a duplicate of "${truncate(proposed.duplicate_title ?? '', 48)}".`);
    }
    records.push(proposed);
  });

  const milestoneCandidates = detectMilestones(clean, {
    now: context.now,
    timezone,
    temporal: primaryTemporal(clean, temporalCtx),
    hedged: intent.hedged
  });
  milestoneCandidates.forEach((candidate, index) => {
    const proposed = toProposedMilestone(candidate, {
      key: `milestone-${index + 1}`,
      projectId,
      tags: tagExtraction.tags.slice(0, 3),
      existing: context.recentMilestones,
      entryId
    });
    proposed.milestone.id = deterministicId(`${captureId}:milestone:${index}`, Date.parse(nowIso) || 0);
    records.push(proposed);
    if (proposed.include) {
      notes.push('Milestone proposed as a claim; verification requires evidence you add yourself.');
    }
  });

  /* -- Steps 6–7: validation and presentation ------------------------ */
  const extras = records.length - 1;
  const requiresReview =
    context.mode === 'review' ||
    records.some((record) => record.kind === 'update') ||
    (context.mode === 'quick' && (extras > 0 || questions.length > 0)) ||
    (context.mode === 'autonomous' &&
      (records.some((record) => record.kind !== 'entry' && !record.include) ||
        questions.some((question) => question.reason === 'verification')));

  if (durations.length > 0) {
    notes.push(`Time mentioned: ${durations.map((duration) => duration.phrase).join(', ')} (kept in the entry text, not stored as a separate field).`);
  }
  if (reflections.length > 0 && intent.type !== 'reflection') {
    notes.push('Personal reflections were preserved in the entry text.');
  }
  if (commitment && !extractedTasks.length) {
    notes.push(`"${truncate(commitment.phrase, 40)}" looks like a future commitment but no task wording was found.`);
  }
  if (tagExtraction.reused.length > 0) {
    notes.push(`Reused existing tag${tagExtraction.reused.length > 1 ? 's' : ''}: ${tagExtraction.reused.join(', ')}.`);
  }

  const understanding: Understanding = {
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    type: intent.type as EntryType,
    type_confidence: intent.confidence,
    project: project ?? null,
    project_candidates: projectResolution.candidates,
    tags: tagExtraction.tags,
    occurred_at: occurred.at,
    occurred_precision: occurred.precision,
    occurred_source: occurred.source,
    ...(occurred.phrase ? { temporal_phrase: occurred.phrase } : {}),
    temporal_confidence: occurred.confidence,
    ...(occurred.ambiguity ? { temporal_ambiguity: occurred.ambiguity } : {}),
    is_personal: intent.isPersonal,
    hedged: intent.hedged,
    tentative_phrases: intent.tentativePhrases,
    evidence_level: intent.evidenceLevel,
    completed: signalsOfKind(signals, 'completed'),
    problems: signalsOfKind(signals, 'problem'),
    discoveries: signalsOfKind(signals, 'discovery'),
    decisions: signalsOfKind(signals, 'decision'),
    measurements,
    reflections,
    durations,
    questions,
    notes: dedupeNotes([...notes, ...(intent.evidenceNote ? [intent.evidenceNote] : [])])
  };

  // Sanity check: never record a future-dated event as having already happened.
  const today = localDateIso(context.now, timezone);
  if (occurred.source === 'text' && occurred.at.slice(0, 10) > today && !commitment) {
    understanding.occurred_at = nowIso;
    understanding.occurred_precision = 'exact';
    understanding.occurred_source = 'capture_time';
    understanding.notes.push('The stated date is in the future, so the event date was left as the capture time.');
    const entryRecord = records[0];
    if (entryRecord && entryRecord.kind === 'entry') {
      entryRecord.entry.occurred_at = nowIso;
      entryRecord.entry.occurred_precision = 'exact';
      entryRecord.entry.occurred_source = 'capture_time';
    }
  }

  return {
    capture_id: captureId,
    input,
    created_at: nowIso,
    mode: context.mode,
    timezone,
    analyzer: 'local',
    understanding,
    records,
    requires_review: requiresReview,
    issues
  };
}

function dedupeNotes(notes: readonly string[]): string[] {
  return [...new Set(notes.filter(Boolean))];
}

function emptyUnderstanding(nowIso: IsoDateTime, timezone: string): Understanding {
  return {
    type: 'note',
    type_confidence: 0,
    project: null,
    project_candidates: [],
    tags: [],
    occurred_at: nowIso,
    occurred_precision: 'exact',
    occurred_source: 'capture_time',
    temporal_confidence: 0,
    is_personal: false,
    hedged: false,
    tentative_phrases: [],
    evidence_level: 'concept',
    completed: [],
    problems: [],
    discoveries: [],
    decisions: [],
    measurements: [],
    reflections: [],
    durations: [],
    questions: [],
    notes: [`Timezone in use: ${timezone}`]
  };
}
