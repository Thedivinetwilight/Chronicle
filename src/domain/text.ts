/**
 * Text utilities shared by search, capture and export.
 *
 * Everything here is pure and synchronous so it can be unit tested without a
 * DOM and reused by a future native or server implementation.
 */

const MAX_TAG_LENGTH = 32;

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Preserve paragraph structure but collapse runs of spaces/newlines. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(text: string, max: number, ellipsis = '…'): string {
  const clean = normalizeWhitespace(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, Math.max(1, max - ellipsis.length));
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}${ellipsis}`;
}

/** Split into sentences without breaking on common abbreviations or decimals. */
export function splitSentences(text: string): string[] {
  const clean = tidyText(text);
  if (!clean) return [];
  const protectedText = clean
    .replace(/\b(?:e\.g|i\.e|etc|vs|approx|Mr|Ms|Dr|Sr|Jr|No|Fig|v)\./gi, '$&\u0000')
    .replace(/(\d)\.(\d)/g, '$1\u0001$2');
  const raw = protectedText.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\u2018\u201C])/);
  return raw
    .map((sentence) => sentence.replace(/\u0000/g, '').replace(/\u0001/g, '.'))
    .map((sentence) => normalizeWhitespace(sentence))
    .filter(Boolean);
}

/** Split into clauses on conjunctions/punctuation — used for summarising. */
export function splitClauses(sentence: string): string[] {
  return sentence
    .split(/[,;:]|\band\b|\bbut\b|\bso\b|\bbecause\b|\bwhile\b|\bhowever\b|\balthough\b/gi)
    .map(normalizeWhitespace)
    .filter((clause) => clause.length > 2);
}

export function firstLine(text: string): string {
  return normalizeWhitespace(text.split('\n')[0] ?? '');
}

export function firstWords(text: string, count: number): string {
  const words = normalizeWhitespace(text).split(' ');
  if (words.length <= count) return words.join(' ');
  return `${words.slice(0, count).join(' ')}…`;
}

/** Remove the Markdown subset Chronicle renders, leaving readable plain text. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^\s*([-*_]\s*){3,}$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(text: string): string {
  return normalizeWhitespace(text)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Normalize a user-supplied tag: lowercase, hyphen-separated, ASCII-folded,
 * length-capped. Two spellings of the same idea collapse onto one tag, which
 * is what keeps the tag list from rotting into near-duplicates (§28.5).
 */
export function normalizeTag(tag: string): string {
  const folded = foldDiacritics(tag)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return folded.slice(0, MAX_TAG_LENGTH).replace(/-+$/g, '');
}

export function normalizeTags(tags: readonly string[] | undefined | null): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function foldDiacritics(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

export function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/* ------------------------------------------------------------------ *
 * Similarity
 * ------------------------------------------------------------------ */

function bigrams(text: string): string[] {
  const clean = foldDiacritics(text.toLowerCase()).replace(/[^a-z0-9 ]/g, '');
  if (clean.length < 2) return clean ? [clean] : [];
  const out: string[] = [];
  for (let i = 0; i < clean.length - 1; i += 1) out.push(clean.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice coefficient over character bigrams, 0…1. */
export function diceSimilarity(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) return 0;
  if (left.length + right.length < 4) return a.toLowerCase() === b.toLowerCase() ? 1 : 0;
  const counts = new Map<string, number>();
  for (const gram of left) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let matches = 0;
  for (const gram of right) {
    const remaining = counts.get(gram) ?? 0;
    if (remaining > 0) {
      counts.set(gram, remaining - 1);
      matches += 1;
    }
  }
  return (2 * matches) / (left.length + right.length);
}

function wordSet(text: string): Set<string> {
  return new Set(
    foldDiacritics(text.toLowerCase())
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
}

/** Jaccard similarity over word sets, 0…1. */
export function wordSimilarity(a: string, b: string): number {
  const left = wordSet(a);
  const right = wordSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export function levenshtein(a: string, b: string, max = 64): number {
  const left = a.slice(0, max);
  const right = b.slice(0, max);
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = new Array<number>(right.length + 1);
  let current = new Array<number>(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) previous[j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length] ?? 0;
}

export function titleCase(text: string): string {
  const small = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'for', 'nor', 'on', 'at', 'to', 'of', 'in', 'with', 'by', 'from'
  ]);
  const words = normalizeWhitespace(text).split(' ');
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      const keepSmall = index > 0 && index < words.length - 1 && small.has(lower);
      if (keepSmall) return lower;
      // Preserve acronyms such as JARVIS, AXIOM, API.
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/* ------------------------------------------------------------------ *
 * Highlighting
 * ------------------------------------------------------------------ */

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split text into matched/unmatched segments for the given needles, ignoring
 * case and diacritics. Returns the original text untouched when nothing
 * matches, so highlighting never corrupts the user's words.
 */
export function highlight(text: string, needles: readonly string[]): HighlightSegment[] {
  const terms = needles
    .map((needle) => normalizeWhitespace(needle).toLowerCase())
    .filter((needle) => needle.length > 0)
    .sort((a, b) => b.length - a.length);
  if (terms.length === 0 || !text) return [{ text, match: false }];

  const folded = foldDiacritics(text.toLowerCase());
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let bestIndex = -1;
    let bestLength = 0;
    for (const term of terms) {
      const index = folded.indexOf(term, cursor);
      if (index >= 0 && (bestIndex === -1 || index < bestIndex)) {
        bestIndex = index;
        bestLength = term.length;
      }
    }
    if (bestIndex === -1) {
      segments.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (bestIndex > cursor) {
      segments.push({ text: text.slice(cursor, bestIndex), match: false });
    }
    segments.push({ text: text.slice(bestIndex, bestIndex + bestLength), match: true });
    cursor = bestIndex + bestLength;
  }
  return segments.filter((segment) => segment.text.length > 0);
}

/** Snippet around the first match, for search results. */
export function snippet(text: string, needles: readonly string[], radius = 90): string {
  const folded = foldDiacritics(text.toLowerCase());
  let index = -1;
  for (const needle of needles) {
    const found = folded.indexOf(needle.toLowerCase());
    if (found >= 0 && (index === -1 || found < index)) index = found;
  }
  const clean = tidyText(text).replace(/\n+/g, ' ');
  if (index === -1) return truncate(clean, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(clean.length, index + radius);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}
