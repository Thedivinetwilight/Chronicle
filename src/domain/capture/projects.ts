/**
 * Smart project association (§28.4).
 *
 * Principles:
 * - A project is attached only when the text actually names it (or an alias),
 *   with a confidence above `ASSIGN_MIN`.
 * - A personal reflection is never attached to a technical project just
 *   because that project is active.
 * - Negations are honoured: "for VERONICA, not JARVIS" excludes JARVIS.
 * - When the reference is ambiguous ("the project", "it") Chronicle offers
 *   candidates and asks instead of guessing.
 */

import { diceSimilarity, foldDiacritics, normalizeWhitespace } from '../text';
import type { Project } from '../types';
import type { ProjectMatch } from './types';

/** Confidence needed to attach a project without asking. */
export const ASSIGN_MIN = 0.82;
/** Confidence needed to offer a project as a candidate. */
export const CANDIDATE_MIN = 0.5;

const AMBIGUOUS_REFERENCES = [
  'the project', 'this project', 'that project', 'my project', 'our project',
  'the same project', 'the repo', 'this repo', 'the codebase', 'the system'
];

const PERSONAL_CUES = [
  'i felt', 'i feel', 'i am feeling', "i'm feeling", 'i was feeling', 'feeling',
  'my life', 'family', 'friend', 'friends', 'health', 'sleep', 'anxious', 'anxiety',
  'grateful', 'happy', 'sad', 'lonely', 'motivated', 'burnt out', 'burnout', 'tired',
  'exhausted', 'stressed', 'upset', 'annoyed', 'proud', 'excited', 'frustrating',
  'frustrated', 'my day', 'good day', 'bad day', 'tough day', 'long day', 'hard day',
  'learned a lot', 'thoughts about', 'reflection', 'meditat', 'personal'
];

const TECHNICAL_CUES = [
  'bug', 'build', 'code', 'commit', 'compile', 'crash', 'debug', 'deploy', 'api', 'server',
  'database', 'test', 'refactor', 'implement', 'prototype', 'circuit', 'sensor', 'firmware',
  'latency', 'benchmark', 'regression', 'branch', 'merge', 'release', 'dependency',
  'algorithm', 'model', 'training', 'pipeline', 'hardware', 'voltage', 'cad', 'solder'
];

/** All names a project can be matched by, best first. */
export function projectSurfaceForms(project: Project): { form: string; weight: number }[] {
  const forms: { form: string; weight: number }[] = [];
  const push = (value: string | undefined, weight: number): void => {
    if (!value) return;
    const normalized = normalizeWhitespace(foldDiacritics(value)).toLowerCase();
    if (normalized.length < 2) return;
    if (forms.some((entry) => entry.form === normalized)) return;
    forms.push({ form: normalized, weight });
  };

  push(project.name, 1);
  // Punctuation-free variant so "RE:INVENT" matches "re invent" and vice versa.
  push(project.name.replace(/[^\w\s]/g, ''), 0.98);
  // Written the other way round: "MARK 50" is often typed as "mark-50" or
  // "mark50", and "RE:INVENT" as "reinvent".
  push(project.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, ''), 0.95);
  push(project.name.replace(/[^\w]+/g, ''), 0.93);
  for (const alias of project.aliases ?? []) push(alias, 0.95);

  const words = normalizeWhitespace(project.name).split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 5) {
    const acronym = words.map((word) => word[0]).join('').toLowerCase();
    if (acronym.length >= 3) push(acronym, 0.7);
  }
  return forms;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Alphanumeric tokens with their offsets, so a punctuation-blind comparison can
 * still be anchored to a real word boundary. Comparing whole-string substrings
 * would let "jarviss" match "jarvis"; comparing token windows does not.
 */
function wordOffsets(text: string): { word: string; start: number }[] {
  const out: { word: string; start: number }[] = [];
  const pattern = /[a-z0-9]+/g;
  let found = pattern.exec(text);
  while (found) {
    out.push({ word: found[0], start: found.index });
    found = pattern.exec(text);
  }
  return out;
}

/** Connectors that can sit between a negation and the thing being denied. */
const NEGATION_CONNECTORS =
  /(?:\s+(?:for|to|in|on|at|by|about|into|under|over|with|from|the|a|an|my|our|your|this|that|it|part|related|linked|attached|belongs))+$/;

const NEGATION_WORDS =
  /(not|never|no|isn'?t|aren'?t|wasn'?t|weren'?t|don'?t|doesn'?t|didn'?t|cannot|can'?t|won'?t|shouldn'?t|wouldn'?t|instead of|rather than|except|excluding|unrelated to|no longer|nothing to do with)\s*$/;

/** Words that indicate the mention is being denied or contrasted away. */
function isNegated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index).toLowerCase().trim();
  // "not for JARVIS" and "nothing to do with JARVIS" both deny the mention,
  // so trailing connectors are removed before testing for the negation itself.
  if (NEGATION_WORDS.test(before)) return true;
  const stripped = before.replace(NEGATION_CONNECTORS, '').trim();
  return stripped !== before && NEGATION_WORDS.test(stripped);
}

export interface ProjectResolution {
  match: ProjectMatch | null;
  candidates: ProjectMatch[];
  ambiguousReference: boolean;
  excluded: string[];
  notes: string[];
}

/**
 * Find the project a message is about.
 *
 * @param text        verbatim user input
 * @param projects    targeted candidate list (active + recently referenced)
 * @param options     `isPersonal` suppresses weak technical matches;
 *                    `activeProjectId` is used only for explicit vague references.
 */
export function resolveProject(
  text: string,
  projects: readonly Project[],
  options: { isPersonal?: boolean; activeProjectId?: string | null } = {}
): ProjectResolution {
  const notes: string[] = [];
  const haystack = normalizeWhitespace(foldDiacritics(text)).toLowerCase();
  if (!haystack) {
    return { match: null, candidates: [], ambiguousReference: false, excluded: [], notes };
  }

  const matches: ProjectMatch[] = [];
  const excluded: string[] = [];
  // Punctuation-blind view of the text, so "MARK-50" also matches "mark 50".
  const offsets = wordOffsets(haystack);
  const words = offsets.map((token) => token.word);

  for (const project of projects.slice(0, 80)) {
    if (project.deleted_at) continue;
    for (const surface of projectSurfaceForms(project)) {
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(surface.form)}([^a-z0-9]|$)`, 'i');
      let found = pattern.exec(haystack);
      let weight = surface.weight;
      if (!found) {
        const tokens = surface.form.split(/[^a-z0-9]+/).filter(Boolean);
        const compact = tokens.join('');
        // Only worth trying when the name actually contains punctuation or a
        // space, and only for names long enough to be distinctive.
        if (compact.length < 5 || tokens.length === 0 || compact === surface.form) continue;
        let at = -1;
        for (let i = 0; i + tokens.length <= words.length && i < 200; i += 1) {
          if (words.slice(i, i + tokens.length).join('') === compact) {
            at = i;
            break;
          }
        }
        if (at < 0) continue;
        // Matched only after ignoring punctuation: slightly weaker evidence.
        weight = surface.weight * 0.92;
        found = { index: offsets[at]!.start - 1, 0: surface.form, 1: ' ' } as unknown as RegExpExecArray;
      }
      const index = found.index + (found[1]?.length ?? 0);
      if (isNegated(haystack, index)) {
        excluded.push(project.name);
        notes.push(`"${project.name}" was mentioned as excluded, so it was not linked.`);
        break;
      }
      const base = weight;
      // Short surface forms (acronyms) need stronger evidence.
      const lengthPenalty = surface.form.length <= 3 ? 0.85 : 1;
      const confidence = Math.min(0.99, base * lengthPenalty);
      const existing = matches.find((match) => match.project_id === project.id);
      if (!existing || existing.confidence < confidence) {
        const next: ProjectMatch = {
          project_id: project.id,
          name: project.name,
          phrase: surface.form,
          confidence: Math.round(confidence * 100) / 100
        };
        if (existing) matches[matches.indexOf(existing)] = next;
        else matches.push(next);
      }
      break;
    }
  }

  // Typo tolerance: only when nothing matched directly and the text is short.
  if (matches.length === 0) {
    const words = haystack.split(/[^a-z0-9]+/).filter(Boolean);
    for (const project of projects.slice(0, 80)) {
      if (project.deleted_at) continue;
      for (const surface of projectSurfaceForms(project)) {
        if (surface.form.length < 4 || surface.weight < 0.9) continue;
        const surfaceWords = surface.form.split(/\s+/);
        for (let start = 0; start + surfaceWords.length <= words.length && start < 120; start += 1) {
          const window = words.slice(start, start + surfaceWords.length).join(' ');
          const similarity = diceSimilarity(window, surface.form);
          if (similarity >= 0.82 && window !== surface.form) {
            matches.push({
              project_id: project.id,
              name: project.name,
              phrase: window,
              confidence: Math.round(similarity * surface.weight * 0.8 * 100) / 100
            });
            break;
          }
        }
      }
    }
    if (matches.length > 0) {
      notes.push('The project name was matched approximately; please confirm it is correct.');
    }
  }

  const ambiguousReference = AMBIGUOUS_REFERENCES.some((reference) => haystack.includes(reference));

  matches.sort((a, b) => b.confidence - a.confidence);
  const top = matches[0] ?? null;
  const runners = matches.slice(1, 4).filter((match) => match.confidence >= CANDIDATE_MIN);

  // Two projects competing closely: ask instead of choosing.
  if (top && runners.length > 0 && top.confidence - runners[0]!.confidence < 0.08 && top.confidence < 0.95) {
    notes.push(`Both "${top.name}" and "${runners[0]!.name}" were mentioned; no project was attached.`);
    return {
      match: null,
      candidates: [top, ...runners],
      ambiguousReference,
      excluded,
      notes
    };
  }

  if (top && top.confidence >= ASSIGN_MIN) {
    // A personal reflection keeps its independence unless the project is named
    // with high confidence *and* the text carries technical context.
    if (options.isPersonal && top.confidence < 0.95) {
      notes.push(`"${top.name}" was mentioned but this reads as a personal entry, so it was left unlinked.`);
      return { match: null, candidates: [top, ...runners], ambiguousReference, excluded, notes };
    }
    return { match: top, candidates: runners, ambiguousReference, excluded, notes };
  }

  if (top && top.confidence >= CANDIDATE_MIN) {
    notes.push(`"${top.name}" may be related but the reference was not strong enough to link automatically.`);
    return { match: null, candidates: [top, ...runners], ambiguousReference, excluded, notes };
  }

  // Vague reference with a known active project: offer, never assume.
  if (ambiguousReference && options.activeProjectId) {
    const active = projects.find((project) => project.id === options.activeProjectId);
    if (active) {
      notes.push('You wrote "the project" without naming it; nothing was linked automatically.');
      return {
        match: null,
        candidates: [{ project_id: active.id, name: active.name, phrase: 'the project', confidence: 0.5 }],
        ambiguousReference,
        excluded,
        notes
      };
    }
  }

  return { match: null, candidates: [], ambiguousReference, excluded, notes };
}

/** Heuristic used to keep personal entries away from technical projects. */
export function classifyPersonal(text: string): { isPersonal: boolean; technicalScore: number; personalScore: number } {
  const haystack = normalizeWhitespace(text).toLowerCase();
  const technicalScore = TECHNICAL_CUES.reduce((total, cue) => (haystack.includes(cue) ? total + 1 : total), 0);
  const personalScore = PERSONAL_CUES.reduce((total, cue) => (haystack.includes(cue) ? total + 1 : total), 0);
  return { isPersonal: personalScore > technicalScore, technicalScore, personalScore };
}
