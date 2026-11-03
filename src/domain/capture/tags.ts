/**
 * Tag extraction (§28.5).
 *
 * Goals, in order:
 * 1. Reuse an existing tag when the text mentions it — the tag list must not
 *    rot into near-duplicates.
 * 2. Surface a small number (max 5) of genuinely informative terms.
 * 3. Never emit filler: no project names (already linked), no dates, no verbs
 *    that appear in almost every entry.
 */

import { foldDiacritics, normalizeTag, normalizeWhitespace } from '../text';
import { tokenize } from '../search';
import type { Project } from '../types';

/** Terms that carry engineering meaning in this product's domain. */
const LEXICON = new Set([
  // AI / data
  'ai', 'llm', 'agent', 'agents', 'embedding', 'embeddings', 'retrieval', 'ranking', 'memory',
  'context', 'prompt', 'prompts', 'inference', 'training', 'dataset', 'model', 'models',
  'rag', 'vector', 'tokenizer', 'fine-tuning', 'evaluation', 'accuracy', 'precision', 'recall',
  'latency', 'throughput', 'hallucination', 'grounding', 'classification', 'clustering',
  // Trading / finance
  'trading', 'backtest', 'backtesting', 'paper-trading', 'risk', 'portfolio', 'order', 'orders',
  'execution', 'broker', 'strategy', 'strategies', 'slippage', 'drawdown', 'sharpe', 'market',
  // Space / hardware
  'satellite', 'orbit', 'payload', 'telemetry', 'observation', 'imaging', 'antenna', 'rf',
  'sensor', 'sensors', 'imu', 'gps', 'lidar', 'radar', 'camera', 'optics', 'thermal',
  'power', 'battery', 'solar', 'voltage', 'current', 'pcb', 'microcontroller', 'firmware',
  'embedded', 'actuator', 'motor', 'motors', 'robot', 'robotics', 'arm', 'gripper', 'chassis',
  'solder', 'soldering', 'soldered', 'wiring', 'harness', 'connector', 'connectors',
  'enclosure', 'filament', 'servo', 'stepper', 'esp32', 'arduino', 'raspberry', 'gpio',
  'bluetooth', 'wifi', 'usb', 'oscilloscope', 'multimeter', '3d-printer', 'cnc', 'torque',
  'materials', 'material', 'wearable', 'wearables', 'textile', 'holography', 'holographic',
  'display', 'projection', 'calibration', 'prototype', 'prototyping', 'cad', '3d-printing',
  'machining', 'assembly', 'tolerance', 'airflow', 'cooling', 'fan', 'vibration',
  // Software engineering
  'architecture', 'design', 'api', 'apis', 'backend', 'frontend', 'ui', 'ux', 'database',
  'sqlite', 'indexeddb', 'postgres', 'schema', 'migration', 'indexing', 'caching', 'queue',
  'sync', 'offline', 'pwa', 'service-worker', 'bundle', 'performance', 'profiling', 'memory-leak',
  'testing', 'tests', 'unit-test', 'integration', 'e2e', 'coverage', 'ci', 'deployment',
  'docker', 'kubernetes', 'serverless', 'auth', 'security', 'encryption', 'privacy',
  'typescript', 'javascript', 'react', 'vite', 'python', 'rust', 'go', 'cpp', 'shell',
  'git', 'branching', 'code-review', 'refactoring', 'debugging', 'logging', 'observability',
  'algorithms', 'data-structure', 'concurrency', 'parallelism', 'optimization', 'os', 'kernel',
  'scheduler', 'compiler', 'runtime', 'cli', 'sdk', 'documentation', 'research', 'experiment',
  'benchmark', 'measurement', 'analysis', 'decision', 'postmortem', 'lessons'
]);

/** Words that are almost never useful tags. */
const NEVER = new Set([
  'today', 'tomorrow', 'yesterday', 'tonight', 'morning', 'afternoon', 'evening', 'night',
  'week', 'month', 'year', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'sunday', 'spent', 'working', 'worked', 'work', 'thing', 'things', 'stuff', 'lot', 'bit',
  'time', 'hours', 'hour', 'minutes', 'days', 'really', 'quite', 'much', 'many', 'something',
  'anything', 'everything', 'nothing', 'still', 'already', 'actually', 'basically', 'literally',
  'problem', 'issue', 'bug', 'fix', 'fixed', 'test', 'tested', 'new', 'old', 'good', 'bad',
  'first', 'second', 'third', 'next', 'last', 'final', 'day', 'night', 'need', 'want', 'got',
  'made', 'make', 'making', 'using', 'used', 'use', 'trying', 'tried', 'try', 'found', 'find',
  'know', 'known', 'think', 'thought', 'feel', 'felt', 'learning', 'learned', 'looks', 'look',
  'seems', 'seemed', 'way', 'ways', 'part', 'parts', 'end', 'start', 'started', 'done',
  // Verbs that appear in almost every journal line and carry no topic.
  'check', 'checked', 'checking', 'run', 'running', 'ran', 'add', 'added', 'adding',
  'write', 'wrote', 'writing', 'see', 'saw', 'seeing', 'look', 'looked', 'looking',
  'move', 'moved', 'moving', 'change', 'changed', 'changing', 'update', 'updated',
  'updating', 'build', 'building', 'ship', 'shipping', 'finish', 'finishing',
  'complete', 'completing', 'happen', 'happened', 'happens', 'plan', 'planned',
  'planning', 'get', 'gets', 'getting', 'give', 'gave', 'given', 'take', 'took',
  'taken', 'keep', 'kept', 'keeping', 'put', 'puts', 'set', 'sets', 'setting',
  'show', 'showed', 'shown', 'tell', 'told', 'ask', 'asked', 'call', 'called',
  'turn', 'turned', 'turning', 'come', 'came', 'go', 'went', 'gone', 'going',
  'let', 'left', 'say', 'said', 'says', 'mean', 'means', 'meant', 'seem',
  // Connectives and degree words.
  'also', 'because', 'while', 'after', 'before', 'without', 'within', 'again',
  'away', 'back', 'down', 'up', 'out', 'off', 'over', 'under', 'very', 'too',
  'just', 'even', 'only', 'some', 'any', 'each', 'every', 'both', 'few', 'more',
  'most', 'less', 'least', 'other', 'another', 'same', 'different', 'sure',
  'able', 'maybe', 'probably', 'almost', 'enough', 'quite', 'rather', 'then',
  'than', 'so', 'but', 'and', 'or', 'if', 'when', 'where', 'how', 'why', 'what'
]);

const TEMPORAL_NOISE =
  /\b(today|tonight|yesterday|tomorrow|morning|afternoon|evening|night|last\s+\w+|next\s+\w+|this\s+\w+|\d+\s*(?:am|pm|hours?|minutes?|days?|weeks?|months?)|\d{1,2}(?::\d{2})?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;

export interface TagExtraction {
  tags: string[];
  reused: string[];
  candidates: { tag: string; score: number }[];
}

export function extractTags(
  text: string,
  options: {
    existingTags?: readonly string[];
    projects?: readonly Project[];
    /** Tags that must not be proposed (e.g. the linked project's own name). */
    exclude?: readonly string[];
    max?: number;
  } = {}
): TagExtraction {
  const max = options.max ?? 5;
  const existing = (options.existingTags ?? []).map((tag) => normalizeTag(tag)).filter(Boolean);
  const excluded = new Set([
    ...(options.exclude ?? []).map((tag) => normalizeTag(tag)),
    ...(options.projects ?? []).flatMap((project) =>
      [project.name, ...project.aliases].map((name) => normalizeTag(name)).filter(Boolean)
    )
  ]);

  const cleaned = normalizeWhitespace(text).replace(TEMPORAL_NOISE, ' ');
  const tokens = tokenize(cleaned, { keepStopwords: false, minLength: 3 });
  const firstSentence = normalizeWhitespace(text).split(/[.!?]/)[0]?.toLowerCase() ?? '';

  const scores = new Map<string, number>();
  const bump = (tag: string, amount: number): void => {
    if (!tag || tag.length < 3 || excluded.has(tag)) return;
    scores.set(tag, (scores.get(tag) ?? 0) + amount);
  };

  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

  for (const [token, count] of counts) {
    if (NEVER.has(token)) continue;
    if (/^\d+$/.test(token)) continue;
    let score = 0;
    // Repeated mentions matter, sub-linearly.
    score += 1.5 + Math.min(2, (count - 1) * 0.8);
    if (LEXICON.has(token)) score += 3.5;
    if (existing.includes(token)) score += 4;
    if (firstSentence.includes(token)) score += 1.5;
    // Technical-looking tokens (hyphenated, camelCase remnants, dotted).
    if (token.includes('-') || token.includes('.') || token.includes('+')) score += 1.5;
    if (token.length > 12) score -= 1;
    if (score > 0) bump(token, score);
  }

  // Multi-word lexicon terms, e.g. "machine learning", "paper trading".
  const haystack = foldDiacritics(cleaned).toLowerCase();
  for (const term of LEXICON) {
    if (!term.includes('-')) continue;
    const spaced = term.replace(/-/g, ' ');
    if (haystack.includes(spaced) || haystack.includes(term)) bump(term, 4.5);
  }

  // Reuse existing tags that appear in the raw text even when tokenisation
  // splits them differently ("3d printing" → "3d-printing").
  for (const tag of existing) {
    const spaced = tag.replace(/-/g, ' ');
    if (haystack.includes(tag) || (spaced.length > 3 && haystack.includes(spaced))) {
      bump(tag, 6);
    }
  }

  const candidates = [...scores.entries()]
    .map(([tag, score]) => ({ tag, score: Math.round(score * 100) / 100 }))
    .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));

  const tags: string[] = [];
  const reused: string[] = [];
  for (const candidate of candidates) {
    if (tags.length >= max) break;
    const tag = normalizeTag(candidate.tag);
    if (!tag || tags.includes(tag)) continue;
    tags.push(tag);
    if (existing.includes(tag)) reused.push(tag);
  }

  return { tags, reused, candidates: candidates.slice(0, 12) };
}

/** Minimum score a candidate must reach to be offered at all. */
export const TAG_MIN_SCORE = 3;
