/**
 * Title and summary generation (§28.5).
 *
 * Deliberate constraint: Chronicle **selects and trims the user's own words**,
 * it does not paraphrase them. A generated title can therefore never upgrade
 * "I investigated the problem" into "I fixed the problem". Derived values are
 * always flagged in `derived` so the UI can mark them as suggestions.
 */

import { normalizeWhitespace, splitSentences, tidyText, truncate } from '../text';
import type { EntryType } from '../types';
import type { SentenceSignal } from './signals';

/** Leading phrases that add no information to a title. */
const LEAD_IN_NOISE =
  /^(?:so|well|okay|ok|today|tonight|yesterday|last night|this morning|this afternoon|this evening|earlier|just now|right now|btw|by the way|note|log|entry)\s*[,:-]?\s*/i;

const LEAD_SUBJECT_NOISE =
  /^(?:i|we|you|they)\s+(?:spent|spend)\s+(?:about\s+|around\s+|roughly\s+)?(?:\d+|[a-z]+)\s+(?:minutes?|hours?|mins?|hrs?)\s+(?:working\s+on|on|with)?\s*/i;

const SUBJECT_NOISE = /^(?:i|we|you|they)\s+/i;

export interface TitleOptions {
  /** Linked project name; used as a prefix when the title lacks it. */
  projectName?: string | null;
  type?: EntryType;
  maxLength?: number;
}

/**
 * Build a title from the message. Falls back to a trimmed first sentence, then
 * to a type-based placeholder — never to an invented claim.
 */
export function buildTitle(text: string, options: TitleOptions = {}): string {
  const maxLength = options.maxLength ?? 72;
  const clean = tidyText(text);
  const lines = clean.split('\n').map((line) => line.trim()).filter(Boolean);

  // A short first line with no terminal punctuation reads as a heading.
  const first = lines[0] ?? '';
  const looksLikeHeading =
    first.length > 0 && first.length <= maxLength && !/[.!?]$/.test(first) && lines.length > 1;

  let core = looksLikeHeading ? first : coreClause(clean);
  core = core.replace(/\s*[.!?]$/, '').trim();

  if (!core) return '';

  let title = core.charAt(0).toUpperCase() + core.slice(1);

  const projectName = options.projectName?.trim();
  if (projectName && !title.toLowerCase().includes(projectName.toLowerCase())) {
    title = `${projectName}: ${title}`;
  }

  return truncate(title, maxLength, '…').replace(/\s+…$/, '…');
}

/** The clause that carries the most information about what happened. */
/** Lines that carry no subject matter: dates, greetings and bare labels. */
const EMPTY_LEAD =
  /^(today|tonight|yesterday|tomorrow|now|later|soon|this morning|this afternoon|this evening|last night|morning|afternoon|evening|night|done|ok|okay|note|notes|update|log|journal|entry|todo|misc|miscellaneous|general)\W*$/i;

export function coreClause(text: string, signals: readonly SentenceSignal[] = []): string {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return normalizeWhitespace(text);

  // Prefer a sentence that contains a completion / problem / discovery signal,
  // then the first sentence that actually says something ("Today." does not).
  const informative =
    signals.find((signal) => ['completed', 'problem', 'discovery', 'decision'].includes(signal.kind))?.text ?? null;
  const meaningful =
    sentences.find((sentence) => {
      const value = normalizeWhitespace(sentence).trim();
      return value.length >= 6 && !EMPTY_LEAD.test(value);
    }) ?? null;

  const candidateRaw = informative ?? meaningful ?? sentences[0] ?? '';
  let candidate = normalizeWhitespace(candidateRaw);
  candidate = candidate.replace(LEAD_IN_NOISE, '');
  candidate = candidate.replace(LEAD_SUBJECT_NOISE, '');
  candidate = candidate.replace(SUBJECT_NOISE, '');
  // Drop a trailing temporal clause: the date is metadata, not the title.
  candidate = candidate
    .replace(/\b(today|tonight|yesterday|tomorrow|this morning|this evening|last night)\s*$/i, '')
    .replace(/\s+[,]\s*$/, '')
    .trim();

  if (candidate.length < 6) candidate = normalizeWhitespace(meaningful ?? sentences[0] ?? text);
  return candidate;
}

/**
 * A one-to-three sentence summary built from verbatim sentences. Sentences that
 * contain hedging ("probably", "seems") are preserved with their hedging.
 */
export function buildSummary(
  text: string,
  options: { signals?: readonly SentenceSignal[]; maxLength?: number; maxSentences?: number } = {}
): string | undefined {
  const maxLength = options.maxLength ?? 240;
  const maxSentences = options.maxSentences ?? 2;
  const sentences = splitSentences(text);
  if (sentences.length === 0) return undefined;

  if (tidyText(text).length <= 120 && sentences.length <= 2) {
    // The message is already short enough to read as its own summary.
    return undefined;
  }

  const signals = options.signals ?? [];
  const wanted = new Set(signals.filter((signal) => signal.kind !== 'context').map((signal) => signal.text));
  const ordered = [...sentences].sort((a, b) => {
    const aWanted = wanted.has(a) ? 1 : 0;
    const bWanted = wanted.has(b) ? 1 : 0;
    if (aWanted !== bWanted) return bWanted - aWanted;
    return sentences.indexOf(a) - sentences.indexOf(b);
  });

  // Restore reading order, then trim to a compact paragraph.
  const picked = ordered
    .slice(0, maxSentences)
    .sort((a, b) => sentences.indexOf(a) - sentences.indexOf(b));
  const joined = picked.map((sentence) => sentence.replace(/\s*[.!?]$/, '')).join('. ');
  const summary = truncate(joined, maxLength);
  return summary.length > 0 ? summary : undefined;
}

/** A single line describing what the entry is about, for list previews. */
export function previewLine(entry: { summary?: string; body: string }): string {
  const source = entry.summary && entry.summary.trim() ? entry.summary : entry.body;
  const firstSentence = splitSentences(source)[0] ?? '';
  return truncate(firstSentence || normalizeWhitespace(source), 160);
}
