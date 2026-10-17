/**
 * Sentence-level signal extraction.
 *
 * Chronicle never paraphrases the user. These helpers *select* verbatim
 * fragments and label them, so the review panel can show "what was completed",
 * "what failed" and "what is still unknown" using the owner's own words.
 */

import { normalizeWhitespace, splitSentences, splitClauses } from '../text';
import type { Measurement } from './types';

export type SignalKind =
  | 'completed'
  | 'problem'
  | 'discovery'
  | 'decision'
  | 'plan'
  | 'reflection'
  | 'measurement'
  | 'context';

export interface SentenceSignal {
  /** Verbatim fragment from the user's message. */
  text: string;
  kind: SignalKind;
  confidence: number;
}

const KIND_CUES: Record<SignalKind, string[]> = {
  completed: [
    'fixed', 'implemented', 'finished', 'completed', 'built', 'added', 'wrote',
    'refactored', 'merged', 'shipped', 'deployed', 'solved', 'got it working',
    'now works', 'managed to', 'successfully'
  ],
  problem: [
    'failed', 'failure', 'broke', 'broken', 'crash', 'crashed', 'bug', 'error',
    "doesn't work", 'does not work', "didn't work", 'did not work', 'not working',
    'unstable', 'regression', 'blocked', 'issue', 'problem', 'wrong', 'incorrect',
    'still needs', 'still unreliable', 'gave up', 'went wrong', 'frustrating'
  ],
  discovery: [
    'realized', 'realised', 'discovered', 'found out', 'turns out', 'turned out',
    'learned', 'noticed', 'insight', 'surprisingly', 'unexpectedly', 'aha'
  ],
  decision: [
    'decided', 'decision', 'chose', 'going with', 'settled on', "we'll use",
    "i'll use", 'trade-off', 'tradeoff', 'instead of', 'rationale', 'because'
  ],
  plan: [
    'need to', 'should', 'will', 'tomorrow', 'next week', 'plan to', 'planning to',
    'want to', 'have to', 'must', 'todo', 'follow up', 'later', 'eventually',
    'going to', "i'll", 'remember to', 'try to'
  ],
  reflection: [
    'i felt', 'i feel', "i'm feeling", 'frustrating', 'frustrated', 'proud',
    'grateful', 'anxious', 'tired', 'motivated', 'overwhelmed', 'happy', 'sad',
    'i learned a lot', 'reminded me', 'personally', 'i think this means'
  ],
  measurement: ['measured', 'measurement', 'readings', 'benchmark', 'compared', 'tested', 'resulted in'],
  context: []
};

const MEASUREMENT_RE =
  /(-?\d+(?:[.,]\d+)?)\s*(%|percent|ms|milliseconds?|s|sec|seconds?|min|minutes?|h|hr|hours?|w|kw|mw|v|mv|a|ma|ah|wh|c|°c|k|kg|g|mg|mm|cm|m|km|rpm|hz|khz|mhz|ghz|kb|mb|gb|tb|fps|db|dbm|lux|psi|nm|μm|um|l|ml|lm)\b/gi;

const COUNT_RE = /\b(\d+)\s+(passing|passed|failed|skipped)?\s*(tests?|commits?|files?|lines?|errors?|warnings?|issues?|users?|requests?|samples?|designs?|variants?)\b/gi;

const MISSING_MEASUREMENT_RE =
  /\b(?:have not|haven't|has not|hasn't|not yet|yet to|still need to|need to|did not|didn't)\s+(?:measure|measured|verify|verified|test|tested|quantify|quantified|check|checked|compare|compared)\b[^.]*|\bunmeasured\b|\bunknown\b[^.]*\b(value|amount|figure)\b/gi;

/**
 * Label the clauses of a message. Clauses (not whole sentences) are used so a
 * single long paragraph can yield both a completed item and a remaining problem.
 */
export function extractSignals(text: string): SentenceSignal[] {
  const sentences = splitSentences(text);
  const signals: SentenceSignal[] = [];

  for (const sentence of sentences) {
    const clauses = splitClauses(sentence);
    const units = clauses.length > 1 ? clauses : [sentence];
    for (const unit of units) {
      const clean = normalizeWhitespace(unit);
      if (clean.length < 8) continue;
      const kind = classifyFragment(clean);
      if (!kind) continue;
      signals.push({ text: clean, kind, confidence: kindConfidence(kind) });
    }
    // Keep the whole sentence when it carries reflection: emotion is easily
    // lost when a sentence is chopped into clauses.
    if (classifyFragment(sentence) === 'reflection') {
      const clean = normalizeWhitespace(sentence);
      if (!signals.some((signal) => signal.text === clean)) {
        signals.push({ text: clean, kind: 'reflection', confidence: 0.7 });
      }
    }
  }

  return dedupeSignals(signals);
}

function classifyFragment(fragment: string): SignalKind | null {
  const haystack = fragment.toLowerCase();
  let best: SignalKind | null = null;
  let bestScore = 0;
  for (const kind of Object.keys(KIND_CUES) as SignalKind[]) {
    if (kind === 'context') continue;
    const score = KIND_CUES[kind].reduce(
      (total, cue) => (haystack.includes(cue) ? total + cue.length : total),
      0
    );
    if (score > bestScore) {
      bestScore = score;
      best = kind;
    }
  }
  return bestScore > 0 ? best : null;
}

function kindConfidence(kind: SignalKind): number {
  switch (kind) {
    case 'completed':
    case 'problem':
      return 0.75;
    case 'decision':
    case 'discovery':
      return 0.7;
    case 'plan':
      return 0.65;
    case 'measurement':
      return 0.6;
    case 'reflection':
      return 0.55;
    default:
      return 0.4;
  }
}

function dedupeSignals(signals: SentenceSignal[]): SentenceSignal[] {
  const out: SentenceSignal[] = [];
  for (const signal of signals) {
    const normalized = signal.text.toLowerCase();
    const redundant = out.some(
      (existing) =>
        existing.text.toLowerCase().includes(normalized) || normalized.includes(existing.text.toLowerCase())
    );
    if (!redundant) out.push(signal);
  }
  return out;
}

export function signalsOfKind(signals: readonly SentenceSignal[], kind: SignalKind): string[] {
  return signals.filter((signal) => signal.kind === kind).map((signal) => signal.text);
}

/**
 * Measurements stated in the text, plus explicit statements that a measurement
 * is *missing*. The missing case matters: "Design B used less power, but I have
 * not measured airflow yet" must not become a conclusion (§28.7).
 */
export function extractMeasurements(text: string): Measurement[] {
  const out: Measurement[] = [];
  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    MEASUREMENT_RE.lastIndex = 0;
    let exec = MEASUREMENT_RE.exec(sentence);
    while (exec) {
      const raw = exec[0];
      const value = Number((exec[1] ?? '').replace(',', '.'));
      const unit = normalizeWhitespace(exec[2] ?? '').toLowerCase();
      out.push({
        text: normalizeWhitespace(sentence),
        ...(Number.isFinite(value) ? { value } : {}),
        ...(unit ? { unit } : {}),
        ...(subjectOf(raw, sentence) ? { subject: subjectOf(raw, sentence) } : {})
      });
      exec = MEASUREMENT_RE.exec(sentence);
    }

    COUNT_RE.lastIndex = 0;
    let countExec = COUNT_RE.exec(sentence);
    while (countExec) {
      const value = Number(countExec[1]);
      const unit = normalizeWhitespace(`${countExec[2] ?? ''} ${countExec[3] ?? ''}`.trim());
      out.push({
        text: normalizeWhitespace(sentence),
        ...(Number.isFinite(value) ? { value } : {}),
        ...(unit ? { unit } : {})
      });
      countExec = COUNT_RE.exec(sentence);
    }

    MISSING_MEASUREMENT_RE.lastIndex = 0;
    const missing = MISSING_MEASUREMENT_RE.exec(sentence);
    if (missing) {
      out.push({ text: normalizeWhitespace(missing[0]), missing: true });
    }
  }

  return out;
}

function subjectOf(raw: string, sentence: string): string | undefined {
  const index = sentence.toLowerCase().indexOf(raw.toLowerCase());
  if (index <= 0) return undefined;
  const before = sentence.slice(Math.max(0, index - 60), index);
  const words = before.split(/\s+/).filter(Boolean).slice(-6);
  const cleaned = normalizeWhitespace(words.join(' ')).replace(/[,;:]$/, '');
  return cleaned.length > 2 && cleaned.length < 60 ? cleaned : undefined;
}

/** Verbatim personal reflections, kept even when the entry is technical. */
export function extractReflections(text: string): string[] {
  return signalsOfKind(extractSignals(text), 'reflection');
}

/** True when the message states an unresolved conclusion. */
export function hasUnresolvedConclusion(text: string): boolean {
  const haystack = normalizeWhitespace(text).toLowerCase();
  // Reset because the pattern is global and `.test` is stateful.
  MISSING_MEASUREMENT_RE.lastIndex = 0;
  return (
    MISSING_MEASUREMENT_RE.test(text) ||
    /(have not|haven't|not yet|yet to|still need|remains|unclear|unknown|no conclusion|can't conclude|cannot conclude)/.test(haystack)
  );
}
