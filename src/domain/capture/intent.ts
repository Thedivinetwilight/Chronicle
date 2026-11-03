/**
 * Intent classification and evidence honesty (§28.2 step 3, §15).
 *
 * The classifier decides *what kind of record* a paragraph is, how confident
 * that reading is, whether the claim is tentative, and — crucially — how far up
 * the evidence ladder the text actually goes.
 *
 * A confident-sounding sentence never produces `verified`. Verification
 * requires explicit verification language plus a measurement or referenced
 * artefact, and even then it is recorded as a claim until evidence is attached.
 */

import { normalizeWhitespace } from '../text';
import type { EntryType, EvidenceLevel } from '../types';
import { classifyPersonal } from './projects';

/** Weighted cue phrases per entry type. */
const CUES: Record<EntryType, { phrase: string; weight: number }[]> = {
  failure: [
    { phrase: 'failed', weight: 3 }, { phrase: 'failure', weight: 3 },
    { phrase: "didn't work", weight: 3 }, { phrase: 'did not work', weight: 3 },
    { phrase: 'does not work', weight: 3 }, { phrase: 'not working', weight: 3 },
    { phrase: "doesn't work", weight: 3 }, { phrase: 'isnt working', weight: 2 },
    { phrase: 'broke', weight: 2.5 }, { phrase: 'broken', weight: 2.5 },
    { phrase: 'crash', weight: 2.5 }, { phrase: 'crashed', weight: 3 },
    { phrase: 'regression', weight: 3 }, { phrase: 'bug', weight: 2 },
    { phrase: 'error', weight: 1.5 }, { phrase: 'unstable', weight: 2.5 },
    { phrase: 'gave up', weight: 2 }, { phrase: 'could not', weight: 1 },
    { phrase: "couldn't", weight: 1 }, { phrase: 'stopped working', weight: 3 },
    { phrase: 'lesson learned', weight: 2 }, { phrase: 'went wrong', weight: 3 }
  ],
  discovery: [
    { phrase: 'realized', weight: 3 }, { phrase: 'realised', weight: 3 },
    { phrase: 'discovered', weight: 3.5 }, { phrase: 'found out', weight: 3 },
    { phrase: 'turns out', weight: 3 }, { phrase: 'it turned out', weight: 3 },
    { phrase: 'learned that', weight: 2.5 }, { phrase: 'i learned', weight: 2 },
    { phrase: 'insight', weight: 2.5 }, { phrase: 'noticed that', weight: 2.5 },
    { phrase: 'aha', weight: 2 }, { phrase: 'surprisingly', weight: 2 },
    { phrase: 'unexpectedly', weight: 2 }
  ],
  decision: [
    { phrase: 'decided', weight: 3.5 }, { phrase: 'decision', weight: 3 },
    { phrase: 'chose', weight: 3 }, { phrase: 'choose', weight: 2 },
    { phrase: 'going with', weight: 3 }, { phrase: 'settled on', weight: 3 },
    { phrase: "we'll use", weight: 3 }, { phrase: "i'll use", weight: 2.5 },
    { phrase: 'trade-off', weight: 2.5 }, { phrase: 'tradeoff', weight: 2.5 },
    { phrase: 'instead of', weight: 1.5 }, { phrase: 'rationale', weight: 2.5 },
    { phrase: 'because it', weight: 1 }
  ],
  experiment: [
    { phrase: 'tested', weight: 3 }, { phrase: 'test ', weight: 1.5 },
    { phrase: 'experiment', weight: 3.5 }, { phrase: 'measured', weight: 3.5 },
    { phrase: 'measurement', weight: 3 }, { phrase: 'compared', weight: 2.5 },
    { phrase: 'comparison', weight: 2.5 }, { phrase: 'benchmark', weight: 3 },
    { phrase: 'trial', weight: 2 }, { phrase: 'design b', weight: 2 },
    { phrase: 'sample', weight: 1.5 }, { phrase: 'resulted in', weight: 2 },
    { phrase: 'readings', weight: 2.5 }
  ],
  research: [
    { phrase: 'investigated', weight: 3 }, { phrase: 'researched', weight: 3.5 },
    { phrase: 'research', weight: 2.5 }, { phrase: 'read about', weight: 3 },
    { phrase: 'reading', weight: 1.5 }, { phrase: 'explored', weight: 2.5 },
    { phrase: 'looked into', weight: 3 }, { phrase: 'studied', weight: 2.5 },
    { phrase: 'paper', weight: 2 }, { phrase: 'documentation', weight: 1.5 },
    { phrase: 'reviewed', weight: 2 }, { phrase: 'survey', weight: 2 },
    { phrase: 'state of the art', weight: 2.5 }
  ],
  milestone: [
    { phrase: 'shipped', weight: 3.5 }, { phrase: 'launched', weight: 3.5 },
    { phrase: 'released', weight: 3 }, { phrase: 'first working', weight: 3.5 },
    { phrase: 'first successful', weight: 3.5 }, { phrase: 'finally works', weight: 3 },
    { phrase: 'finally worked', weight: 3 }, { phrase: 'powered on', weight: 3 },
    { phrase: 'power on', weight: 2.5 }, { phrase: 'milestone', weight: 3.5 },
    { phrase: 'completed the first', weight: 3 }, { phrase: 'v1', weight: 2 },
    { phrase: 'went live', weight: 3.5 }, { phrase: 'production', weight: 1.5 }
  ],
  progress: [
    { phrase: 'fixed', weight: 3 }, { phrase: 'implemented', weight: 3 },
    { phrase: 'added', weight: 2 }, { phrase: 'built', weight: 2.5 },
    { phrase: 'finished', weight: 2.5 }, { phrase: 'completed', weight: 2.5 },
    { phrase: 'refactored', weight: 2.5 }, { phrase: 'merged', weight: 2 },
    { phrase: 'wrote', weight: 2 }, { phrase: 'worked on', weight: 2.5 },
    { phrase: 'made progress', weight: 3 }, { phrase: 'progress', weight: 2 },
    { phrase: 'continued', weight: 1.5 }, { phrase: 'session', weight: 1.5 },
    { phrase: 'deployed', weight: 2.5 }, { phrase: 'spent', weight: 1 }
  ],
  reflection: [
    { phrase: 'i felt', weight: 3 }, { phrase: 'i feel', weight: 3 },
    { phrase: "i'm feeling", weight: 3 }, { phrase: 'i was feeling', weight: 3 },
    { phrase: 'frustrating', weight: 2 }, { phrase: 'frustrated', weight: 2.5 },
    { phrase: 'proud', weight: 2.5 }, { phrase: 'grateful', weight: 2.5 },
    { phrase: 'anxious', weight: 2.5 }, { phrase: 'tired', weight: 2 },
    { phrase: 'motivated', weight: 2 }, { phrase: 'overwhelmed', weight: 2.5 },
    { phrase: 'thinking about', weight: 2 }, { phrase: 'reflected', weight: 3 },
    { phrase: 'i learned a lot', weight: 2 }, { phrase: 'reminded me', weight: 2 },
    { phrase: 'life', weight: 1.5 }, { phrase: 'myself', weight: 1.5 }
  ],
  note: []
};

const TENTATIVE_PATTERNS = [
  'probably', 'maybe', 'might', 'may have', 'seems', 'seemed', 'appears', 'apparently',
  'i think', 'i believe', 'i guess', 'i suspect', 'should be', 'likely', 'unlikely',
  'possibly', 'perhaps', 'not sure', 'unsure', 'unclear', 'assume', 'assuming',
  'hopefully', 'could be', 'sort of', 'kind of', 'somewhat', 'roughly', 'approximately',
  'in theory', 'theoretically', 'not verified', 'unverified', 'needs confirmation'
];

/**
 * Comparative performance claims. These are the classic place where a hunch
 * turns into a fake result, so Chronicle flags them when no measurement is
 * present and suggests recording evidence.
 */
const COMPARATIVE_CLAIMS = [
  'faster', 'slower', 'better', 'worse', 'more efficient', 'less efficient',
  'improved', 'improves', 'reduced', 'increased', 'cheaper', 'lighter',
  'stronger', 'more accurate', 'less power', 'more power', 'higher throughput'
];

const VERIFIED_LANGUAGE = [
  'verified', 'confirmed', 'validated', 'reproduced', 'independently checked',
  'measured at', 'benchmark shows', 'tests pass', 'tests passed', 'all tests passing',
  'proven', 'evidence shows', 'signed off'
];

const IMPLEMENTED_LANGUAGE = [
  'implemented', 'wrote', 'coded', 'built', 'added', 'refactored', 'fixed', 'merged', 'committed'
];

const TESTED_LANGUAGE = [
  'tested', 'ran the tests', 'test suite', 'measured', 'benchmarked', 'tried it', 'ran it'
];

const DEPLOYED_LANGUAGE = ['deployed', 'released', 'shipped', 'went live', 'in production'];

const DESIGNED_LANGUAGE = ['designed', 'architecture', 'spec', 'wireframe', 'schema design', 'drafted a plan'];

const RESEARCHED_LANGUAGE = ['researched', 'read about', 'investigated', 'studied', 'literature', 'documentation review'];

function countPhrase(haystack: string, phrase: string): number {
  if (!phrase) return 0;
  const needle = phrase.toLowerCase();
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function anyPhrase(haystack: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => haystack.includes(phrase));
}

export interface IntentResult {
  type: EntryType;
  confidence: number;
  scores: Record<EntryType, number>;
  isPersonal: boolean;
  hedged: boolean;
  tentativePhrases: string[];
  evidenceLevel: EvidenceLevel;
  /** Explains a downgrade so the UI can show why nothing was claimed. */
  evidenceNote?: string;
  verificationLanguage: string[];
  measurementsMentioned: boolean;
  /** Comparative claims made without a measurement ("probably much faster"). */
  unmeasuredComparisons: string[];
}

const MEASUREMENT_RE = /\b\d+(?:\.\d+)?\s*(?:%|percent|ms|s|sec|seconds?|min|minutes?|h|hours?|w|kw|mw|v|a|ma|c|°c|k|kg|g|mm|cm|m|km|rpm|hz|khz|mb|kb|gb|tb|fps|db|lux|psi|nm|μm|um)\b|\b\d+(?:\.\d+)?\s+(?:passing|passed|failed|tests?|commits?|lines?|files?|errors?|users?|requests?)\b/i;

export function classifyIntent(text: string): IntentResult {
  const haystack = normalizeWhitespace(text).toLowerCase();
  const scores = {} as Record<EntryType, number>;
  for (const type of Object.keys(CUES) as EntryType[]) {
    const total = CUES[type].reduce((sum, cue) => sum + countPhrase(haystack, cue.phrase) * cue.weight, 0);
    scores[type] = Math.round(total * 100) / 100;
  }

  const personal = classifyPersonal(text);
  if (personal.isPersonal) scores.reflection = (scores.reflection ?? 0) + 2.5;

  const ranked = (Object.keys(scores) as EntryType[])
    .map((type) => ({ type, score: scores[type] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const runner = ranked[1];
  let type: EntryType = 'note';
  let confidence = 0.35;

  if (best && best.score > 0) {
    type = best.type;
    const margin = best.score - (runner?.score ?? 0);
    confidence = Math.min(0.95, 0.45 + Math.min(best.score, 8) / 16 + Math.min(margin, 4) / 12);
  }

  const tentativePhrases = anyPhrase(haystack, TENTATIVE_PATTERNS);
  const hedged = tentativePhrases.length > 0;
  const verificationLanguage = anyPhrase(haystack, VERIFIED_LANGUAGE);
  const measurementsMentioned = MEASUREMENT_RE.test(text);
  const comparisons = anyPhrase(haystack, COMPARATIVE_CLAIMS);
  const unmeasuredComparisons = measurementsMentioned ? [] : comparisons;

  /* --- Evidence ladder ------------------------------------------------ */
  let evidenceLevel: EvidenceLevel = 'concept';
  let evidenceNote: string | undefined;

  if (anyPhrase(haystack, RESEARCHED_LANGUAGE).length > 0) evidenceLevel = 'researched';
  if (anyPhrase(haystack, DESIGNED_LANGUAGE).length > 0) evidenceLevel = 'designed';
  if (anyPhrase(haystack, IMPLEMENTED_LANGUAGE).length > 0) {
    evidenceLevel = rank(evidenceLevel, 'implemented');
  }
  if (anyPhrase(haystack, TESTED_LANGUAGE).length > 0 || measurementsMentioned) {
    evidenceLevel = rank(evidenceLevel, 'tested');
  }
  if (anyPhrase(haystack, DEPLOYED_LANGUAGE).length > 0) {
    evidenceLevel = rank(evidenceLevel, 'deployed');
  }
  if (verificationLanguage.length > 0 && measurementsMentioned) {
    evidenceLevel = rank(evidenceLevel, 'verified');
  } else if (verificationLanguage.length > 0) {
    evidenceNote = `"${verificationLanguage[0]}" reads like verification but no measurement or artefact was given, so the claim stays at "${evidenceLevel}".`;
  }

  // Tentative language always pulls the ladder down: a hunch is a concept.
  if (hedged) {
    const lowered = demote(evidenceLevel);
    if (lowered !== evidenceLevel) {
      evidenceNote = `Tentative wording ("${tentativePhrases[0]}") lowered the evidence level from "${evidenceLevel}" to "${lowered}".`;
      evidenceLevel = lowered;
    } else if (!evidenceNote) {
      evidenceNote = 'Tentative wording detected; nothing was marked as verified.';
    }
  }

  // Failure entries describe an attempt, not an achievement.
  if (type === 'failure' && evidenceRankValue(evidenceLevel) > evidenceRankValue('implemented')) {
    evidenceNote = 'Recorded as a failure, so the evidence level was not raised above "implemented".';
    evidenceLevel = 'implemented';
  }

  return {
    type,
    confidence: Math.round(confidence * 100) / 100,
    scores,
    isPersonal: personal.isPersonal,
    hedged,
    tentativePhrases,
    evidenceLevel,
    ...(evidenceNote ? { evidenceNote } : {}),
    verificationLanguage,
    measurementsMentioned,
    unmeasuredComparisons
  };
}

const LADDER: EvidenceLevel[] = ['concept', 'researched', 'designed', 'implemented', 'tested', 'verified', 'deployed'];

function evidenceRankValue(level: EvidenceLevel): number {
  return LADDER.indexOf(level);
}

function rank(current: EvidenceLevel, proposed: EvidenceLevel): EvidenceLevel {
  return evidenceRankValue(proposed) > evidenceRankValue(current) ? proposed : current;
}

function demote(level: EvidenceLevel): EvidenceLevel {
  const index = evidenceRankValue(level);
  if (index <= 0) return 'concept';
  // Never let hedged text claim verification.
  const target = level === 'verified' || level === 'deployed' ? index - 2 : index - 1;
  return LADDER[Math.max(0, target)] ?? 'concept';
}

/** Signals used to build the review panel's "what happened" list. */
export function extractSignals(text: string): {
  completed: string[];
  problems: string[];
  decisions: string[];
  discoveries: string[];
} {
  const haystack = normalizeWhitespace(text).toLowerCase();
  return {
    completed: anyPhrase(haystack, IMPLEMENTED_LANGUAGE.concat(['finished', 'completed', 'done'])),
    problems: anyPhrase(haystack, ['failed', 'broken', 'broke', 'bug', 'error', 'crash', 'unstable', 'not working', "doesn't work", 'blocked', 'issue', 'problem']),
    decisions: anyPhrase(haystack, ['decided', 'chose', 'going with', 'settled on', 'instead of', 'trade-off']),
    discoveries: anyPhrase(haystack, ['realized', 'discovered', 'found out', 'turns out', 'learned', 'noticed'])
  };
}
