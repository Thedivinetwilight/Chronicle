/**
 * Interactive corrections (§28.8).
 *
 * "That was for VERONICA, not JARVIS." must update the existing record instead
 * of creating another entry. This module recognises a small, explicit set of
 * correction shapes and always returns a *proposal*; nothing is applied until
 * the user confirms (and destructive or ambiguous corrections are flagged as
 * requiring confirmation).
 *
 * Anything it cannot resolve confidently returns `null`, so the message is
 * processed as an ordinary capture instead of being silently misapplied.
 */

import { normalizeWhitespace, titleCase, truncate } from '../text';
import { addLocalDays, localDateIso } from '../time';
import type { JournalEntry, Milestone, Task } from '../types';
import { resolveProject } from './projects';
import { extractTemporal, type TemporalMatch } from './temporal';
import type { CaptureContext, RecordUpdate } from './types';
import type { EntryType } from '../types';

export interface CorrectionResult {
  update: RecordUpdate;
  explanation: string;
  confidence: number;
  /** True when the change is ambiguous or destructive and must be confirmed. */
  needsConfirmation: boolean;
  issues: string[];
}

const CORRECTION_STARTERS =
  /^(that|this|these|those|the (?:entry|note|task|milestone|date|title|project)|actually|instead|no,?|wait|correction|change|set|move|rename|reclassify|make|mark|don'?t|do not|remove|delete|undo|link|attach|keep)\b/i;

/** An explicit reference to a record, which allows a fallback target. */
const RECORD_REFERENCE =
  /\b(?:that|this|the|my)\s+(?:entry|note|record|task|milestone|journal|project)\b|\bmy last\b|\bthe last (?:entry|note|one|task|milestone)\b|\bprevious (?:entry|note|one)\b/i;

/** Words that make an intent to correct unmistakable. */
const CORRECTION_INTENT =
  /\b(instead|actually|wrong|correction|mistake|not right|should be|should have been|change|changed|rename|undo|delete|remove|link|attach|move|reclassify|mark it|make it)\b/i;

/** A correction may only refer back this far into the session. */
const CORRECTION_WINDOW_MS = 6 * 3_600_000;

const DEICTIC = /\b(that|this|it|its|the (?:entry|note|record|task|milestone|date|title)|my (?:entry|note|last)|last (?:entry|note|one)|previous (?:entry|one))\b/i;

const NEGATION_PROJECT = /\bnot\s+(?:for\s+)?([A-Z0-9][\w:.'-]*(?:\s+[A-Z0-9][\w:.'-]*)*)/;

const DATE_CHANGE =
  /\b(?:change|set|move|make|update)\s+(?:the\s+)?(?:event\s+)?(?:date|time|when)\s+(?:to\s+)?([^.,;]+)/i;
const HAPPENED = /\b(?:it\s+)?(?:was|happened|occurred|took place)\s+(?:on\s+)?([^.,;]+)/i;

const TASK_SUPPRESSION =
  /\b(?:don'?t|do not|no)\s+(?:create\s+)?(?:a\s+)?(?:separate\s+)?task\b|\bremove the task\b|\bskip the task\b|\bwithout a task\b|\bdrop the task\b/i;
const MILESTONE_SUPPRESSION =
  /\bnot a milestone\b|\b(?:don'?t|do not)\s+(?:mark|create|record)\s+(?:it|this|that)?\s*(?:as\s+)?(?:a\s+)?milestone\b|\bremove the milestone\b/i;
const PERSONAL_KEEP =
  /\bkeep this (?:as )?(?:a )?(?:personal|private)\b|\bmake (?:it|this) (?:personal|private)\b|\bpersonal (?:journal|entry|note)\b|\bnot (?:a )?(?:technical|project)\b|\bunrelated to (?:any )?project\b/i;
const TITLE_CHANGE = /\b(?:rename|retitle|change the title to|title should be|call it)\s+["“']?(.+?)["”']?\s*$/i;
const TYPE_CHANGE =
  /\b(?:mark|classify|reclassify|make|record|treat)\s+(?:it|this|that)?\s*(?:as\s+)?(?:a\s+|an\s+)?(failure|discovery|decision|experiment|research(?: note)?|note|reflection|progress(?: update)?|milestone)\b/i;
const PROJECT_CHANGE =
  /\b(?:belongs to|should be (?:for|under|in|linked to)|link(?:ed)? to|attach(?:ed)? to|move(?:d)? to|it was for|that was for|this was for|it'?s for|for)\s+([A-Z0-9][\w:.'-]*(?:\s+[A-Z0-9][\w:.'-]*)*)/;

const ENTRY_TYPES: Record<string, EntryType> = {
  failure: 'failure',
  discovery: 'discovery',
  decision: 'decision',
  experiment: 'experiment',
  research: 'research',
  'research note': 'research',
  note: 'note',
  reflection: 'reflection',
  progress: 'progress',
  'progress update': 'progress',
  milestone: 'milestone'
};

interface Target {
  kind: RecordUpdate['target_kind'];
  id: string;
  label: string;
}

function pickTarget(
  text: string,
  context: CaptureContext,
  options: { allowFallback: boolean }
): Target | null {
  const last = context.lastCommit;
  const explicitTask = /\btask\b/i.test(text);
  const explicitMilestone = /\bmilestone\b/i.test(text);

  if (last) {
    if (explicitTask && last.taskIds[0]) {
      return { kind: 'tasks', id: last.taskIds[0], label: 'the task from your last capture' };
    }
    if (explicitMilestone && last.milestoneIds[0]) {
      return { kind: 'milestones', id: last.milestoneIds[0], label: 'the milestone from your last capture' };
    }
    if (last.entryIds[0]) {
      return { kind: 'entries', id: last.entryIds[0], label: 'the entry from your last capture' };
    }
    if (last.updatedIds[0]) {
      return { kind: 'entries', id: last.updatedIds[0], label: 'the record you last changed' };
    }
  }

  // No capture session in memory: fall back to the most recent record, but only
  // when the message explicitly names a record ("that entry", "my last note").
  const entry = options.allowFallback ? context.recentEntries[0] : undefined;
  if (entry && !entry.deleted_at) {
    return {
      kind: 'entries',
      id: entry.id,
      label: `"${truncate(entry.title || firstWords(entry.body), 40)}" (your most recent entry)`
    };
  }
  return null;
}

function firstWords(body: string): string {
  return normalizeWhitespace(body).split(/\s+/).slice(0, 6).join(' ');
}

function describeEntry(entry: JournalEntry): string {
  return `"${truncate(entry.title || firstWords(entry.body), 48)}"`;
}

/**
 * Interpret a message as a correction of an existing record.
 * Returns `null` when the message is not a correction.
 */
export function interpretCorrection(text: string, context: CaptureContext): CorrectionResult | null {
  const clean = normalizeWhitespace(text);
  if (!clean || clean.length > 240) return null;

  const startsLikeCorrection = CORRECTION_STARTERS.test(clean.slice(0, 48));
  const hasDeictic = DEICTIC.test(clean);
  const namesARecord = RECORD_REFERENCE.test(clean);
  const recentCommit = context.lastCommit
    ? Date.parse(context.lastCommit.committed_at) > context.now.getTime() - CORRECTION_WINDOW_MS
    : false;

  // Guard against false positives. A correction must (a) point at something and
  // (b) have a session or an explicit record reference to point at. "That
  // happened last Friday" on its own is a new entry, not a correction.
  if (!startsLikeCorrection && !hasDeictic) return null;
  if (!recentCommit && !namesARecord) return null;

  const issues: string[] = [];
  const target = pickTarget(clean, context, { allowFallback: namesARecord });
  if (!target) {
    return null;
  }

  /* -- Task suppression --------------------------------------------- */
  if (TASK_SUPPRESSION.test(clean)) {
    if (target.kind !== 'tasks') {
      const taskId = context.lastCommit?.taskIds[0];
      if (!taskId) {
        return {
          update: {
            target_kind: 'entries',
            target_id: target.id,
            target_label: target.label,
            explanation: 'No task was found in your last capture, so nothing was changed.',
            changes: {}
          },
          explanation: 'No task was found in your last capture.',
          confidence: 0.3,
          needsConfirmation: true,
          issues: ['Nothing to remove: the last capture did not create a task.']
        };
      }
      target.kind = 'tasks';
      target.id = taskId;
      target.label = 'the task from your last capture';
    }
    return {
      update: {
        target_kind: 'tasks',
        target_id: target.id,
        target_label: target.label,
        explanation: 'Mark the task as dropped instead of deleting it (recoverable).',
        changes: { status: 'dropped' }
      },
      explanation: `Marking ${target.label} as dropped. It stays in your history and can be reopened.`,
      confidence: 0.8,
      needsConfirmation: false,
      issues
    };
  }

  /* -- Milestone suppression ---------------------------------------- */
  if (MILESTONE_SUPPRESSION.test(clean)) {
    const milestoneId = target.kind === 'milestones' ? target.id : context.lastCommit?.milestoneIds[0];
    if (!milestoneId) {
      issues.push('Nothing to remove: the last capture did not create a milestone.');
      return {
        update: {
          target_kind: 'entries',
          target_id: target.id,
          target_label: target.label,
          explanation: issues[0] ?? '',
          changes: {}
        },
        explanation: issues[0] ?? 'No milestone was found.',
        confidence: 0.3,
        needsConfirmation: true,
        issues
      };
    }
    return {
      update: {
        target_kind: 'milestones',
        target_id: milestoneId,
        target_label: 'the milestone from your last capture',
        explanation: 'Change the milestone back to a plan instead of deleting it.',
        changes: { status: 'planned' }
      },
      explanation: 'Moving the proposed milestone back to "planned" — the record stays, the claim is withdrawn.',
      confidence: 0.8,
      needsConfirmation: false,
      issues
    };
  }

  /* -- Personal / privacy ------------------------------------------ */
  if (PERSONAL_KEEP.test(clean)) {
    if (target.kind !== 'entries') {
      issues.push('Privacy applies to journal entries; the target was left unchanged.');
      return null;
    }
    const changes: RecordUpdate['changes'] = { private: true, type: 'reflection' };
    const existingProject = context.recentEntries.find((entry) => entry.id === target.id)?.project_id;
    if (existingProject) {
      changes.project_id = null;
      issues.push('The project link was removed because you asked to keep this personal.');
    }
    return {
      update: {
        target_kind: 'entries',
        target_id: target.id,
        target_label: target.label,
        explanation: 'Mark the entry private, set its type to reflection and unlink any project.',
        changes
      },
      explanation: `${target.label} will be marked private and unlinked from any project. Your text is not changed.`,
      confidence: 0.85,
      needsConfirmation: false,
      issues
    };
  }

  /* -- Title change ------------------------------------------------- */
  const titleMatch = TITLE_CHANGE.exec(clean);
  if (titleMatch && target.kind === 'entries') {
    const newTitle = truncate(titleMatch[1] ?? '', 120);
    return {
      update: {
        target_kind: 'entries',
        target_id: target.id,
        target_label: target.label,
        explanation: `Replace the title with "${newTitle}".`,
        changes: { title: newTitle }
      },
      explanation: `Setting the title of ${target.label} to "${newTitle}".`,
      confidence: 0.85,
      needsConfirmation: false,
      issues
    };
  }

  /* -- Entry type change ------------------------------------------- */
  const typeMatch = TYPE_CHANGE.exec(clean);
  if (typeMatch && target.kind === 'entries') {
    const requested = (typeMatch[1] ?? '').toLowerCase();
    const type = ENTRY_TYPES[requested];
    if (type) {
      return {
        update: {
          target_kind: 'entries',
          target_id: target.id,
          target_label: target.label,
          explanation: `Reclassify the entry as "${type}".`,
          changes: { type }
        },
        explanation: `${target.label} will be recorded as ${type}. The original wording is preserved.`,
        confidence: 0.85,
        needsConfirmation: false,
        issues
      };
    }
  }

  /* -- Date change -------------------------------------------------- */
  const explicitDateChange = DATE_CHANGE.exec(clean);
  const datePhrase = explicitDateChange?.[1] ?? HAPPENED.exec(clean)?.[1];
  if (datePhrase && target.kind === 'entries') {
    const matches: TemporalMatch[] = extractTemporal(datePhrase, { now: context.now, timezone: context.timezone });
    const best = matches[0];
    if (best) {
      return {
        update: {
          target_kind: 'entries',
          target_id: target.id,
          target_label: target.label,
          explanation: `Set the event date to ${best.date} (from "${truncate(datePhrase, 32)}").`,
          changes: {
            occurred_at: best.occurred_at,
            occurred_precision: best.precision,
            occurred_source: 'user'
          }
        },
        explanation: `${target.label} will be dated ${best.date}. The creation timestamp stays as it was, so the correction remains visible.`,
        confidence: Math.min(0.9, best.confidence + 0.1),
        needsConfirmation: best.confidence < 0.7,
        issues: best.ambiguity ? [best.ambiguity] : issues
      };
    }
    // Only an explicit "change the date to X" counts as a correction when the
    // date itself cannot be resolved; "it was a frustrating day" must not.
    if (explicitDateChange) {
      issues.push(`"${truncate(datePhrase, 32)}" could not be resolved to a date.`);
    }
  }

  /* -- Project change ---------------------------------------------- */
  const negated = NEGATION_PROJECT.exec(clean);
  const projectText = PROJECT_CHANGE.exec(clean)?.[1] ?? clean;
  const resolution = resolveProject(projectText, context.projects, {});
  if (resolution.match) {
    const match = resolution.match;
    if (target.kind === 'entries' || target.kind === 'tasks' || target.kind === 'milestones') {
      const excluded = negated ? negated[1] : undefined;
      return {
        update: {
          target_kind: target.kind,
          target_id: target.id,
          target_label: target.label,
          explanation: `Link to "${match.name}"${excluded ? ` instead of ${excluded}` : ''}.`,
          changes: { project_id: match.project_id }
        },
        explanation: `${target.label} will be linked to ${match.name}. Everything else stays as it is.`,
        confidence: Math.min(0.95, match.confidence + 0.05),
        needsConfirmation: match.confidence < 0.8,
        issues
      };
    }
  }

  const deliberate = startsLikeCorrection && hasDeictic && clean.length < 120 && CORRECTION_INTENT.test(clean);
  if (deliberate || issues.length > 0) {
    // The message looks like a correction but Chronicle cannot resolve it:
    // ask rather than guessing, and never create a new record from it.
    return {
      update: {
        target_kind: target.kind,
        target_id: target.id,
        target_label: target.label,
        explanation: 'No change could be determined automatically.',
        changes: {}
      },
      explanation: `This looks like a correction to ${target.label}, but Chronicle could not determine the change. Edit the record directly, or rephrase (for example: "that was for <project>" or "change the date to yesterday").`,
      confidence: 0.2,
      needsConfirmation: true,
      issues: issues.length > 0 ? issues : ['Unresolved correction.']
    };
  }

  return null;
}

/** Convenience used by the review panel to describe a target record. */
export function describeTarget(
  kind: RecordUpdate['target_kind'],
  record: JournalEntry | Task | Milestone | null
): string {
  if (!record) return 'the selected record';
  switch (kind) {
    case 'entries':
      return describeEntry(record as JournalEntry);
    case 'tasks':
      return `"${truncate((record as Task).title, 48)}" (task)`;
    case 'milestones':
      return `"${truncate((record as Milestone).title, 48)}" (milestone)`;
    default:
      return 'the selected project';
  }
}

/** Helper for tests and the UI: "tomorrow" in the user's timezone. */
export function tomorrowIn(timezone: string, now: Date): string {
  return addLocalDays(localDateIso(now, timezone), 1);
}

/** Used by the review panel when a title needs a fallback. */
export function fallbackTitle(text: string): string {
  return titleCase(truncate(normalizeWhitespace(text), 48, ''));
}
