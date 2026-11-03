/**
 * Milestone detection (§28.7).
 *
 * Chronicle proposes milestones; it never awards them. A detected achievement is
 * always `verification: 'claimed'` until the owner attaches evidence and
 * explicitly confirms it. A component working is never treated as a project
 * being complete, and a passing test suite is reported as evidence rather than
 * as proof of production readiness.
 */

import { diceSimilarity, normalizeWhitespace, titleCase, truncate, wordSimilarity } from '../text';
import { localDateIso } from '../time';
import type { DatePrecision, IsoDate, Milestone } from '../types';
import type { TemporalMatch } from './temporal';
import type { ProposedMilestone } from './types';

interface AchievementPattern {
  re: RegExp;
  confidence: number;
  /** Shown in the review panel so the owner knows why this was proposed. */
  note?: string;
}

const PATTERNS: AchievementPattern[] = [
  { re: /\bfirst\s+(?:working|successful|complete|finished|end-to-end)\b[^.!?]*/i, confidence: 0.85 },
  { re: /\bfirst\s+(?:prototype|build|version|run|commit|deploy|launch|power-?on)\b[^.!?]*/i, confidence: 0.85 },
  { re: /\bfinally\s+(?:works|worked|succeeded|booted|compiled|passed|launched|shipped|powered on)\b[^.!?]*/i, confidence: 0.8 },
  { re: /\b(?:powered? on|booted (?:up)?|lifted off|flew)\b[^.!?]*/i, confidence: 0.75 },
  { re: /\b(?:shipped|launched|released|went live|deployed to production|published)\b[^.!?]*/i, confidence: 0.8 },
  {
    re: /\b(?:all\s+)?(?:tests? (?:pass|passed|are passing)|test suite (?:passed|is green)|green build)\b[^.!?]*/i,
    confidence: 0.55,
    note: 'A passing test suite is evidence, not proof that the product is production-ready.'
  },
  { re: /\b(?:completed|finished)\s+(?:the\s+)?(?:first|initial|entire|whole|full)\b[^.!?]*/i, confidence: 0.7 },
  { re: /\bmilestone\b[^.!?]*/i, confidence: 0.8 },
  { re: /\b(?:achieved|reached|hit)\s+(?:the\s+)?(?:goal|target|milestone)\b[^.!?]*/i, confidence: 0.7 },
  { re: /\bv(?:0|1|2)\.\d+\s+(?:is\s+)?(?:out|released|done|ready)\b[^.!?]*/i, confidence: 0.65 }
];

/** Language that turns an apparent achievement into a plan or a hope. */
const NON_ACHIEVEMENT = /\b(hope|hopefully|plan to|planning to|want to|need to|should|will|going to|if|when|once|someday|almost|nearly|not yet|still)\b/i;

export interface MilestoneCandidate {
  title: string;
  description: string;
  date: IsoDate;
  date_precision: DatePrecision;
  phrase: string;
  confidence: number;
  tentative: boolean;
  note?: string;
}

export function detectMilestones(
  text: string,
  options: {
    now: Date;
    timezone: string;
    /** Best temporal interpretation for the message, if any. */
    temporal?: TemporalMatch | null;
    hedged?: boolean;
  }
): MilestoneCandidate[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  const sentences = normalized.split(/(?<=[.!?])\s+/);
  const fallbackDate = localDateIso(options.now, options.timezone);
  const candidates: MilestoneCandidate[] = [];

  for (const sentence of sentences) {
    for (const pattern of PATTERNS) {
      const match = pattern.re.exec(sentence);
      if (!match) continue;
      const phrase = normalizeWhitespace(match[0]);
      // "I plan to ship v1 tomorrow" is a plan, not an achievement.
      const tentative = NON_ACHIEVEMENT.test(sentence) || Boolean(options.hedged);
      const date = options.temporal && !options.temporal.isFuture ? options.temporal.date : fallbackDate;
      const precision: DatePrecision = options.temporal?.precision ?? 'day';
      candidates.push({
        title: buildTitle(phrase, sentence),
        description: truncate(sentence, 220),
        date,
        date_precision: precision,
        phrase,
        confidence: tentative ? Math.min(0.45, pattern.confidence) : pattern.confidence,
        tentative,
        ...(pattern.note ? { note: pattern.note } : {})
      });
      break; // one candidate per sentence
    }
  }

  return dedupe(candidates).slice(0, 2);
}

function buildTitle(phrase: string, sentence: string): string {
  const core = phrase
    .replace(/^(?:and|but|so|then|today|yesterday|finally)\s+/i, '')
    .replace(/\s+(?:today|yesterday)\.?$/i, '')
    .trim();
  const base = core.length >= 8 ? core : sentence;
  const cleaned = normalizeWhitespace(base)
    .replace(/\s*[.!?]$/, '')
    .replace(/^(?:i|we)\s+/i, '');
  return titleCase(truncate(cleaned, 72, ''));
}

function dedupe(candidates: MilestoneCandidate[]): MilestoneCandidate[] {
  const out: MilestoneCandidate[] = [];
  for (const candidate of candidates) {
    if (!out.some((existing) => diceSimilarity(existing.title, candidate.title) > 0.8)) out.push(candidate);
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

/** A milestone is a duplicate when the same project already claims it. */
export function findDuplicateMilestone(
  candidate: MilestoneCandidate,
  existing: readonly Milestone[],
  projectId: string | null
): Milestone | null {
  let best: Milestone | null = null;
  let bestScore = 0;
  for (const milestone of existing) {
    if (milestone.deleted_at) continue;
    const sameProject = (milestone.project_id ?? null) === projectId;
    const score = Math.max(diceSimilarity(milestone.title, candidate.title), wordSimilarity(milestone.title, candidate.title));
    const weighted = score * (sameProject ? 1 : 0.7);
    if (weighted > bestScore) {
      bestScore = weighted;
      best = milestone;
    }
  }
  return bestScore >= 0.75 ? best : null;
}

export function toProposedMilestone(
  candidate: MilestoneCandidate,
  options: {
    key: string;
    projectId: string | null;
    tags: string[];
    existing: readonly Milestone[];
    entryId?: string | null;
  }
): ProposedMilestone {
  const duplicate = findDuplicateMilestone(candidate, options.existing, options.projectId);
  const reasons: string[] = [];
  if (candidate.tentative) reasons.push('The wording is tentative, so this is offered for confirmation only.');
  if (duplicate) reasons.push(`A similar milestone already exists: "${truncate(duplicate.title, 50)}".`);
  if (candidate.note) reasons.push(candidate.note);
  reasons.push('Verification stays "claimed" until you attach evidence.');

  return {
    key: options.key,
    kind: 'milestone',
    include: !duplicate && !candidate.tentative && candidate.confidence >= 0.6,
    confidence: candidate.confidence,
    reason: reasons.join(' '),
    ...(duplicate ? { duplicate_of: duplicate.id, duplicate_title: duplicate.title } : {}),
    milestone: {
      title: candidate.title,
      description: candidate.description,
      date: candidate.date,
      date_precision: candidate.date_precision,
      project_id: options.projectId,
      // An achievement stated in prose is a claim, never a verified result.
      status: 'achieved',
      verification: 'claimed',
      evidence: [],
      entry_ids: options.entryId ? [options.entryId] : [],
      tags: options.tags,
      derived: { title: true, milestone: true }
    }
  };
}
