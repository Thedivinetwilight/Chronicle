/**
 * Local full-text search: tokenisation, query parsing and ranking.
 *
 * Approach (see docs/DECISIONS/0005-local-fulltext-search.md):
 * - Each searchable record stores a `tokens` array that is indexed by IndexedDB
 *   as a `multiEntry` index. Candidate retrieval is therefore an indexed
 *   lookup (`where('tokens').startsWith(...)`), not a table scan.
 * - Ranking happens in memory over the candidate set using field weights,
 *   phrase proximity and a recency boost. For a personal archive the candidate
 *   set is small, and in-memory ranking keeps the index storage cheap and the
 *   behaviour easy to test.
 * - No external search library: the requirements are prefix matching,
 *   multi-token intersection, field weighting and highlighting.
 */

import { foldDiacritics, highlight, normalizeWhitespace, snippet, truncate } from './text';
import { localDateIso, diffLocalDays } from './time';
import type { JournalEntry, Milestone, Project, RecordKind, Task } from './types';

/* ------------------------------------------------------------------ *
 * Tokenisation
 * ------------------------------------------------------------------ */

/**
 * A short stopword list. Removing these from the *index* keeps it small; they
 * are still allowed in queries but do not by themselves select records.
 */
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
  'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its',
  'just', 'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
  'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'will', 'with', 'would', 'you', 'your'
]);

const MIN_TOKEN_LENGTH = 2;
const MAX_TOKENS_PER_RECORD = 4000;

/** Split text into normalised, lowercase, diacritic-folded tokens. */
export function tokenize(text: string, options: { keepStopwords?: boolean; minLength?: number } = {}): string[] {
  if (!text) return [];
  const folded = foldDiacritics(text).toLowerCase();
  const raw = folded.split(/[^a-z0-9+#._'-]+/).filter(Boolean);
  const min = options.minLength ?? MIN_TOKEN_LENGTH;
  const out: string[] = [];
  for (const token of raw) {
    const cleaned = token.replace(/^['.-]+|['.-]+$/g, '');
    if (cleaned.length < min) continue;
    if (!options.keepStopwords && STOPWORDS.has(cleaned)) continue;
    out.push(cleaned);
    // Index the head of hyphenated/compound tokens so "re-ranking" is found
    // by searching "ranking".
    if (cleaned.includes('-')) {
      for (const part of cleaned.split('-')) {
        if (part.length >= min && !(STOPWORDS.has(part) && !options.keepStopwords)) out.push(part);
      }
    }
  }
  return out;
}

/** Unique tokens for indexing, capped to keep very large entries sane. */
export function indexTokens(texts: readonly (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const token of tokenize(text)) {
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
      if (out.length >= MAX_TOKENS_PER_RECORD) return out;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Searchable projection
 * ------------------------------------------------------------------ */

export type SearchableRecord = Project | JournalEntry | Milestone | Task;

export interface SearchDocument {
  kind: RecordKind;
  id: string;
  title: string;
  body: string;
  tags: string[];
  projectId: string | null;
  /** Instant used for recency boosting and display. */
  date: string;
  /**
   * The date a user-facing date filter should apply to, or `null` when the
   * record has no meaningful date of its own (an undated task, a project that
   * was never started). Filtering then excludes it instead of guessing.
   */
  filterDate: string | null;
  status?: string;
  extra?: string;
}

export function toDocument(
  kind: RecordKind,
  record: SearchableRecord,
  projectName?: string | null
): SearchDocument | null {
  switch (kind) {
    case 'projects': {
      const project = record as Project;
      return {
        kind,
        id: project.id,
        title: project.name,
        body: [project.summary ?? '', project.objectives ?? '', project.aliases.join(' ')].join('\n'),
        tags: project.tags,
        projectId: project.id,
        date: project.updated_at,
        filterDate: project.started_on ? `${project.started_on}T12:00:00.000Z` : null,
        status: project.status,
        extra: project.stage
      };
    }
    case 'entries': {
      const entry = record as JournalEntry;
      return {
        kind,
        id: entry.id,
        title: entry.title,
        body: entry.body,
        tags: entry.tags,
        projectId: entry.project_id ?? null,
        date: entry.occurred_at,
        filterDate: entry.occurred_at,
        status: entry.type,
        extra: [entry.summary ?? '', projectName ?? '', (entry.source.original_input ?? '')].join('\n')
      };
    }
    case 'milestones': {
      const milestone = record as Milestone;
      return {
        kind,
        id: milestone.id,
        title: milestone.title,
        body: milestone.description ?? '',
        tags: milestone.tags,
        projectId: milestone.project_id ?? null,
        date: `${milestone.date}T12:00:00.000Z`,
        filterDate: `${milestone.date}T12:00:00.000Z`,
        status: milestone.status,
        extra: [milestone.verification, projectName ?? ''].join(' ')
      };
    }
    case 'tasks': {
      const task = record as Task;
      return {
        kind,
        id: task.id,
        title: task.title,
        body: task.description ?? '',
        tags: task.tags,
        projectId: task.project_id ?? null,
        date: task.due_on ? `${task.due_on}T12:00:00.000Z` : task.updated_at,
        filterDate: task.due_on
          ? `${task.due_on}T12:00:00.000Z`
          : task.completed_at
            ? task.completed_at
            : null,
        status: task.status,
        extra: [task.priority, projectName ?? ''].join(' ')
      };
    }
    default:
      return null;
  }
}

/** Tokens stored on a record for indexed retrieval. */
export function documentTokens(document: SearchDocument): string[] {
  return indexTokens([
    document.title,
    document.body,
    document.tags.join(' '),
    document.extra ?? '',
    document.status ?? ''
  ]);
}

/* ------------------------------------------------------------------ *
 * Query parsing
 * ------------------------------------------------------------------ */

export interface ParsedQuery {
  /** Raw, trimmed query text. */
  raw: string;
  /** Tokens that must (or should) match. */
  tokens: string[];
  /** Tokens including stopwords, used for highlighting and phrase matching. */
  highlightTerms: string[];
  /** `#tag` filters written inline in the query. */
  tags: string[];
  /** True when the whole query was wrapped in quotes (phrase search). */
  phrase: boolean;
  /** True when the query is empty/whitespace. */
  empty: boolean;
}

export function parseQuery(input: string): ParsedQuery {
  const raw = normalizeWhitespace(input ?? '');
  const inlineTags: string[] = [];
  const withoutTags = raw.replace(/(^|\s)#([a-z0-9][a-z0-9-]*)/gi, (_m, space: string, tag: string) => {
    inlineTags.push(tag.toLowerCase());
    return space;
  });
  const phrase = /^"(.+)"$/.test(withoutTags.trim());
  const core = phrase ? withoutTags.trim().slice(1, -1) : withoutTags;
  const tokens = tokenize(core);
  const highlightTerms = foldDiacritics(core.toLowerCase())
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9+#._'-]/g, ''))
    .filter((word) => word.length > 1);
  return {
    raw,
    tokens,
    highlightTerms: highlightTerms.length > 0 ? highlightTerms : tokens,
    tags: inlineTags,
    phrase,
    empty: raw.length === 0
  };
}

/* ------------------------------------------------------------------ *
 * Ranking
 * ------------------------------------------------------------------ */

export const FIELD_WEIGHTS = {
  titleExact: 120,
  titlePrefix: 60,
  titleToken: 14,
  tag: 9,
  status: 5,
  extra: 4,
  body: 3
} as const;

/** Recency contributes at most this much, decaying over `RECENCY_HORIZON_DAYS`. */
const RECENCY_MAX = 18;
const RECENCY_HORIZON_DAYS = 365;

export interface ScoredDocument {
  document: SearchDocument;
  score: number;
  matched: string[];
  fields: string[];
}

export interface ScoreOptions {
  parsed: ParsedQuery;
  /** Local date used for the recency boost. */
  today: string;
  timezone: string;
  /** Ids of projects whose names matched the query (used to boost children). */
  matchedProjectIds?: ReadonlySet<string>;
}

/**
 * Score one document against a parsed query.
 * Returns `null` when the document does not match at all.
 *
 * Matching rules:
 * - Every non-stopword query token must appear as a prefix of some field token
 *   (AND semantics). This keeps results relevant for multi-word queries.
 * - A quoted query additionally requires the exact phrase in title/body.
 */
export function scoreDocument(document: SearchDocument, options: ScoreOptions): ScoredDocument | null {
  const { parsed, today, timezone, matchedProjectIds } = options;
  if (parsed.empty) return null;

  const title = foldDiacritics(document.title).toLowerCase();
  const body = foldDiacritics(document.body).toLowerCase();
  const extra = foldDiacritics(document.extra ?? '').toLowerCase();
  const tags = document.tags.map((tag) => foldDiacritics(tag).toLowerCase());
  const status = foldDiacritics(document.status ?? '').toLowerCase();

  const titleTokens = tokenize(document.title);
  const bodyTokens = tokenize(document.body);
  const extraTokens = tokenize(document.extra ?? '');

  const matched: string[] = [];
  const fields = new Set<string>();
  let score = 0;

  for (const token of parsed.tokens) {
    let tokenScore = 0;

    if (title === token) {
      tokenScore += FIELD_WEIGHTS.titleExact;
      fields.add('title');
    } else if (title.startsWith(token) || title.includes(` ${token}`)) {
      tokenScore += FIELD_WEIGHTS.titlePrefix;
      fields.add('title');
    } else if (titleTokens.some((t) => t.startsWith(token))) {
      tokenScore += FIELD_WEIGHTS.titleToken;
      fields.add('title');
    }

    if (tags.some((tag) => tag === token || tag.startsWith(token))) {
      tokenScore += FIELD_WEIGHTS.tag;
      fields.add('tags');
    }

    if (status === token || status.startsWith(token)) {
      tokenScore += FIELD_WEIGHTS.status;
      fields.add('status');
    }

    if (extraTokens.some((t) => t.startsWith(token))) {
      tokenScore += FIELD_WEIGHTS.extra;
      fields.add('context');
    }

    const bodyHits = bodyTokens.filter((t) => t.startsWith(token)).length;
    if (bodyHits > 0) {
      // Sub-linear term frequency so a long entry cannot out-rank a title hit.
      tokenScore += FIELD_WEIGHTS.body * (1 + Math.log10(bodyHits));
      fields.add('body');
    }
    // Raw substring check catches tokens inside code, URLs and punctuation.
    else if (body.includes(token)) {
      tokenScore += FIELD_WEIGHTS.body;
      fields.add('body');
    }

    if (tokenScore === 0) {
      // AND semantics: an unmatched required token disqualifies the document.
      return null;
    }
    score += tokenScore;
    matched.push(token);
  }

  if (parsed.phrase) {
    const needle = parsed.raw.replace(/^"|"$/g, '').toLowerCase();
    if (!title.includes(needle) && !body.includes(needle) && !extra.includes(needle)) return null;
    score += 25;
    fields.add('phrase');
  }

  if (parsed.tags.length > 0) {
    const wanted = parsed.tags.map((tag) => tag.toLowerCase());
    if (!wanted.every((tag) => tags.some((t) => t === tag || t.startsWith(tag)))) return null;
    score += 10 * wanted.length;
    fields.add('tags');
  }

  if (matchedProjectIds && document.projectId && matchedProjectIds.has(document.projectId)) {
    score += 8;
    fields.add('project');
  }

  // Recency boost: newer records rank higher among equally relevant matches.
  const documentDate = localDateIso(document.date, timezone);
  const ageDays = Math.max(0, diffLocalDays(documentDate, today));
  if (Number.isFinite(ageDays)) {
    score += RECENCY_MAX * Math.max(0, 1 - ageDays / RECENCY_HORIZON_DAYS);
  }

  return { document, score: Math.round(score * 100) / 100, matched, fields: [...fields] };
}

/* ------------------------------------------------------------------ *
 * Result shaping
 * ------------------------------------------------------------------ */

export interface SearchHit {
  kind: RecordKind;
  id: string;
  title: string;
  /** Where the match came from, e.g. "Journal · JARVIS". */
  origin: string;
  snippet: string;
  matched: string[];
  fields: string[];
  score: number;
  date: string;
  projectId: string | null;
  status?: string;
}

export function toHit(scored: ScoredDocument, projectNames: Map<string, string>): SearchHit {
  const { document } = scored;
  const kindLabel: Record<string, string> = {
    projects: 'Project',
    entries: 'Journal',
    milestones: 'Milestone',
    tasks: 'Task',
    revisions: 'Revision'
  };
  const projectName = document.projectId ? projectNames.get(document.projectId) : undefined;
  const originParts = [kindLabel[document.kind] ?? 'Record'];
  if (projectName && document.kind !== 'projects') originParts.push(projectName);
  const terms = scored.matched.length > 0 ? scored.matched : parseQuery(document.title).tokens;
  const source = document.body || document.extra || '';
  return {
    kind: document.kind,
    id: document.id,
    title: document.title || truncate(source, 60) || 'Untitled',
    origin: originParts.join(' · '),
    snippet: source ? snippet(source, terms, 90) : (document.tags.length > 0 ? document.tags.map((t) => `#${t}`).join(' ') : ''),
    matched: scored.matched,
    fields: scored.fields,
    score: scored.score,
    date: document.date,
    projectId: document.projectId,
    ...(document.status ? { status: document.status } : {})
  };
}

export function highlightSegments(text: string, terms: readonly string[]) {
  return highlight(text, terms);
}

/** Group hits by kind for the results screen, preserving rank order. */
export function groupHits(hits: readonly SearchHit[]): { kind: RecordKind; hits: SearchHit[] }[] {
  const order: RecordKind[] = ['projects', 'entries', 'milestones', 'tasks'];
  return order
    .map((kind) => ({ kind, hits: hits.filter((hit) => hit.kind === kind) }))
    .filter((group) => group.hits.length > 0);
}

/** Route target for a hit, so results can be opened directly. */
export function hitPath(hit: Pick<SearchHit, 'kind' | 'id' | 'projectId'>): string {
  switch (hit.kind) {
    case 'projects':
      return `/projects/${hit.id}`;
    case 'entries':
      return `/journal/${hit.id}`;
    case 'milestones':
      return hit.projectId ? `/projects/${hit.projectId}?focus=milestone-${hit.id}` : `/timeline?milestone=${hit.id}`;
    case 'tasks':
      return hit.projectId ? `/projects/${hit.projectId}?focus=task-${hit.id}` : `/journal?task=${hit.id}`;
    default:
      return '/search';
  }
}
