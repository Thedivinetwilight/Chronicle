/**
 * Task extraction (§28.6).
 *
 * A task is proposed only when the text contains an explicit commitment. The
 * due date is resolved *from the same clause* as the commitment so that a date
 * mentioned elsewhere in the paragraph is never transferred onto a task, and a
 * vague intention ("eventually") never receives an invented deadline.
 */

import { diceSimilarity, normalizeWhitespace, truncate, wordSimilarity } from '../text';
import { isValidIsoDate, localDateIso } from '../time';
import type { DatePrecision, IsoDate, Task } from '../types';
import { splitEventAndCommitment, type TemporalContext } from './temporal';
import type { ProposedTask } from './types';

const COMMITMENT_CUES = [
  'need to', 'needs to', 'have to', 'has to', 'must', 'should', 'ought to',
  'plan to', 'planning to', 'intend to', 'want to', 'will need', 'will have',
  "i'll", 'i will', 'we will', "we'll", 'going to', 'remember to', 'follow up',
  'todo', 'to-do', 'next step', 'next steps', 'action item', 'follow-up'
];

/** Words that express intention without a date. Never invent one. */
const OPEN_ENDED = ['eventually', 'someday', 'one day', 'at some point', 'whenever', 'later on', 'soon-ish'];

const SOON = ['soon', 'shortly', 'asap', 'as soon as possible', 'when i get time', 'in the near term'];

const TRAILING_TIME =
  /\b(today|tonight|tomorrow|this week|next week|this month|next month|later|soon|eventually|someday|in the morning|in the evening|before (?:the|my|next)[^.]{0,24}|after (?:that|this)[^.]{0,16}|by (?:friday|monday|tuesday|wednesday|thursday|saturday|sunday|then|end of (?:the )?(?:day|week|month)))\s*[.]?\s*$/i;

/** A "still to do:" style header followed by bullet items. */
const LIST_HEADER = /^\s*(?:still\s+)?(?:to\s*-?\s*do|todo|next\s+steps?|action\s+items?|follow-?\s?ups?|remaining\s+work)\s*:?\s*$/i;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;

export interface ExtractedTask {
  title: string;
  description?: string;
  due_on: IsoDate | null;
  due_precision: DatePrecision;
  phrase: string;
  confidence: number;
  open_ended: boolean;
  /** Set when a date was stated but could not be used as a due date. */
  due_note?: string;
}

/**
 * Extract commitments from a message. Returns at most three: a paragraph with
 * more action items than that is better handled by editing than by automation.
 */
/**
 * Extract commitments from a message: bullet lists first (they are explicit),
 * then inline cues. Returns at most three — a paragraph with more action items
 * than that is better handled by editing than by automation.
 */
export function extractTasks(text: string, ctx: TemporalContext): ExtractedTask[] {
  return dedupe([...extractListTasks(text), ...extractCueTasks(text, ctx)]).slice(0, 3);
}

/**
 * Tasks written as a list under a header such as "Still to do:".
 * No due date is invented for list items.
 */
export function extractListTasks(text: string): ExtractedTask[] {
  const lines = text.split('\n');
  const out: ExtractedTask[] = [];
  let inList = false;
  for (const line of lines) {
    if (LIST_HEADER.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const bullet = BULLET.exec(line);
    if (!bullet) {
      if (line.trim() === '') continue;
      inList = false;
      continue;
    }
    const raw = normalizeWhitespace(bullet[1] ?? '');
    if (raw.length < 3) continue;
    const { title, description } = splitTitle(finalizeTitle(raw.replace(/\s*[.;,]+$/, '')));
    out.push({
      title,
      ...(description ? { description } : {}),
      due_on: null,
      due_precision: 'unknown',
      phrase: raw,
      confidence: 0.85,
      open_ended: true
    });
    if (out.length >= 3) break;
  }
  return out;
}

function extractCueTasks(text: string, ctx: TemporalContext): ExtractedTask[] {
  const sentences = normalizeWhitespace(text).split(/(?<=[.!?])\s+/);
  const out: ExtractedTask[] = [];

  for (const sentence of sentences) {
    const clauses = sentence
      .split(/[,;]|\band then\b|\bbut\b/g)
      .map((clause) => normalizeWhitespace(clause))
      .filter((clause) => clause.length > 6);

    for (const clause of clauses) {
      const lower = clause.toLowerCase();
      const cue = COMMITMENT_CUES.find((candidate) => lower.includes(candidate));
      if (!cue) continue;

      const cleaned = stripCue(clause, cue);
      if (cleaned.length < 6) continue;

      const { title: rawTitle, description } = splitTitle(cleaned);
      const timePhrase = TRAILING_TIME.exec(clause)?.[0]?.trim();
      const { commitment, event } = splitEventAndCommitment(clause, ctx);
      // The date belongs in `due_on`, not in the title: "Finish the report by
      // yesterday" becomes "Finish the report". A past date is still stripped
      // from the title even though it can never become a due date.
      const title = stripTrailingPhrase(rawTitle, commitment?.phrase ?? event?.phrase ?? '');

      const openEnded = OPEN_ENDED.some((phrase) => lower.includes(phrase));
      const vagueSoon = SOON.some((phrase) => lower.includes(phrase));

      let dueOn: IsoDate | null = null;
      let precision: DatePrecision = 'unknown';
      let dueNote: string | undefined;
      if (!openEnded && commitment && commitment.isFuture) {
        dueOn = commitment.date;
        precision = commitment.precision;
      } else if (!openEnded && (commitment ?? event) && !(commitment ?? event)!.isFuture) {
        // A date was stated but it is not in the future: never turn it into an
        // overdue task, and say why no due date was recorded.
        dueNote = `"${(commitment ?? event)!.phrase}" is not in the future, so no due date was set.`;
      } else if (!openEnded && vagueSoon) {
        // "soon" is a real intention but not a date: keep it undated.
        precision = 'unknown';
      }

      out.push({
        title,
        ...(description ? { description } : {}),
        due_on: dueOn && isValidIsoDate(dueOn) ? dueOn : null,
        due_precision: dueOn ? precision : 'unknown',
        phrase: timePhrase ?? clause,
        confidence: confidenceFor(clause, cue, Boolean(dueOn)),
        open_ended: openEnded,
        ...(dueNote ? { due_note: dueNote } : {})
      });

      if (out.length >= 3) return out;
    }
  }

  return out;
}

/** Remove a trailing date phrase (and its preposition) from a task title. */
function stripTrailingPhrase(title: string, phrase: string): string {
  const trimmed = normalizeWhitespace(phrase).trim();
  if (!trimmed) return title;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `\\s*(?:\\b(?:by|before|until|til|on|due|from|after|at)\\b\\s+)?${escaped}\\s*[.,;:]?\\s*$`,
    'i'
  );
  const stripped = title.replace(pattern, '').trim();
  // Never shorten a title into meaninglessness.
  return stripped.length >= 6 ? finalizeTitle(stripped) : title;
}

function stripCue(clause: string, cue: string): string {
  const index = clause.toLowerCase().indexOf(cue);
  if (index === -1) return clause;
  let rest = clause.slice(index + cue.length).trim();
  rest = rest.replace(/^(?:i|we|you|they|it|to)\s+/i, '').replace(/^to\s+/i, '');
  rest = rest.replace(TRAILING_TIME, '').trim();
  rest = rest.replace(/\s+[.,;:]+$/, '').trim();
  if (!rest) rest = clause.replace(TRAILING_TIME, '').trim();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Keep titles short; push the remainder into the description verbatim. */
function splitTitle(cleaned: string): { title: string; description?: string } {
  const withoutTrailingTime = cleaned.replace(TRAILING_TIME, '').trim();
  if (withoutTrailingTime.length <= 64) {
    return { title: finalizeTitle(withoutTrailingTime) };
  }
  const parts = withoutTrailingTime.split(/\s+and\s+/i);
  if (parts.length > 1 && (parts[0] ?? '').length >= 12) {
    const head = parts[0] ?? '';
    const tail = parts.slice(1).join(' and ');
    return { title: finalizeTitle(head), description: tail };
  }
  return { title: finalizeTitle(truncate(withoutTrailingTime, 64)), description: withoutTrailingTime };
}

function finalizeTitle(title: string): string {
  const cleaned = normalizeWhitespace(title).replace(/\s+[.,;:]+$/, '');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function confidenceFor(clause: string, cue: string, hasDate: boolean): number {
  const strong = ['need to', 'must', 'have to', 'todo', 'next step', 'action item'];
  const base = strong.includes(cue) ? 0.8 : 0.62;
  const question = /\?\s*$/.test(clause);
  const conditional = /\b(if|unless|maybe|might|could)\b/i.test(clause);
  let confidence = base + (hasDate ? 0.1 : 0);
  if (question) confidence -= 0.45;
  if (conditional) confidence -= 0.15;
  return Math.max(0.1, Math.min(0.95, Math.round(confidence * 100) / 100));
}

function dedupe(tasks: ExtractedTask[]): ExtractedTask[] {
  const out: ExtractedTask[] = [];
  for (const task of tasks) {
    const duplicate = out.some((existing) => diceSimilarity(existing.title, task.title) > 0.85);
    if (!duplicate) out.push(task);
  }
  return out;
}

/**
 * Compare an extracted task against existing open tasks so a repeated note
 * never creates a second copy of the same commitment (§28.6, §28.13).
 */
export function findDuplicateTask(
  candidate: ExtractedTask,
  existing: readonly Task[],
  projectId: string | null
): Task | null {
  let best: Task | null = null;
  let bestScore = 0;
  for (const task of existing) {
    if (task.deleted_at) continue;
    if (task.status === 'done' || task.status === 'dropped') continue;
    const sameProject = (task.project_id ?? null) === projectId;
    const dice = diceSimilarity(task.title, candidate.title);
    const words = wordSimilarity(task.title, candidate.title);
    const score = Math.max(dice, words) * (sameProject ? 1 : 0.75);
    if (score > bestScore) {
      bestScore = score;
      best = task;
    }
  }
  return bestScore >= 0.72 ? best : null;
}

/** Build the proposal object for a single extracted task. */
export function toProposedTask(
  extracted: ExtractedTask,
  options: {
    key: string;
    projectId: string | null;
    tags: string[];
    sourceEntryId?: string | null;
    existing: readonly Task[];
    ctx: TemporalContext;
  }
): ProposedTask {
  const duplicate = findDuplicateTask(extracted, options.existing, options.projectId);
  const today = localDateIso(options.ctx.now, options.ctx.timezone);
  // A commitment that resolved to a past date was misread; drop the date
  // rather than silently creating an overdue task.
  const staleDue = extracted.due_on !== null && extracted.due_on < today;
  const dueOn = staleDue ? null : extracted.due_on;
  const duePrecision: DatePrecision = dueOn ? extracted.due_precision : 'unknown';

  const reasonParts: string[] = [];
  if (duplicate) reasonParts.push(`Similar open task exists: "${truncate(duplicate.title, 60)}"`);
  if (staleDue) reasonParts.push(`"${extracted.phrase}" pointed at a past date, so no due date was set.`);
  else if (extracted.due_note) reasonParts.push(extracted.due_note);
  else if (extracted.open_ended) reasonParts.push('No due date was stated, so none was invented.');
  else if (dueOn) reasonParts.push(`Due ${dueOn} (from "${extracted.phrase}")`);

  return {
    key: options.key,
    kind: 'task',
    // A near-duplicate is offered but not checked by default.
    include: !duplicate && extracted.confidence >= 0.55,
    confidence: extracted.confidence,
    ...(reasonParts.length > 0 ? { reason: reasonParts.join(' ') } : {}),
    ...(duplicate ? { duplicate_of: duplicate.id, duplicate_title: duplicate.title } : {}),
    task: {
      title: extracted.title,
      ...(extracted.description ? { description: extracted.description } : {}),
      project_id: options.projectId,
      status: 'todo',
      priority: 'normal',
      due_on: dueOn,
      due_precision: duePrecision,
      tags: options.tags,
      source_entry_id: options.sourceEntryId ?? null,
      derived: { title: true }
    }
  };
}
