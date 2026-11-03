/** Text utility tests: normalisation, tags, similarity, highlighting. */

import { describe, expect, it } from 'vitest';
import {
  diceSimilarity,
  firstWords,
  foldDiacritics,
  highlight,
  levenshtein,
  normalizeTag,
  normalizeTags,
  normalizeWhitespace,
  slugify,
  snippet,
  splitClauses,
  splitSentences,
  stripMarkdown,
  tidyText,
  titleCase,
  truncate,
  wordSimilarity
} from './text';

describe('normalisation', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeWhitespace('  a\n\n b\t c ')).toBe('a b c');
  });

  it('keeps paragraph structure while tidying', () => {
    expect(tidyText('a\r\n\r\n\r\n\r\nb   \nc')).toBe('a\n\nb\nc');
  });

  it('truncates on a word boundary', () => {
    expect(truncate('The quick brown fox jumps', 15)).toBe('The quick brow…');
    expect(truncate('The quick brown fox jumps', 15)).toHaveLength(15);
    expect(truncate('short', 15)).toBe('short');
  });

  it('folds diacritics', () => {
    expect(foldDiacritics('café naïve')).toBe('cafe naive');
  });
});

describe('sentence and clause splitting', () => {
  it('splits sentences without breaking abbreviations or decimals', () => {
    expect(splitSentences('I read e.g. the spec. Latency was 1.5 ms!')).toEqual([
      'I read e.g. the spec.',
      'Latency was 1.5 ms!'
    ]);
  });

  it('splits clauses on conjunctions', () => {
    expect(splitClauses('I fixed the bug, but ranking still needs work')).toEqual([
      'I fixed the bug',
      'ranking still needs work'
    ]);
  });

  it('returns the first words for previews', () => {
    expect(firstWords('one two three four', 2)).toBe('one two…');
  });
});

describe('markdown stripping', () => {
  it('leaves readable plain text', () => {
    expect(stripMarkdown('## Title\n\n- **bold** item\n- `code` and [link](https://x.test)')).toBe(
      'Title bold item code and link'
    );
  });
});

describe('tags', () => {
  it('normalises to lowercase hyphenated values', () => {
    expect(normalizeTag('Machine Learning')).toBe('machine-learning');
    expect(normalizeTag('  Café — Réinventé  ')).toBe('cafe-reinvente');
    expect(normalizeTag('###')).toBe('');
  });

  it('caps tag length and removes trailing separators', () => {
    expect(normalizeTag('a'.repeat(60))).toHaveLength(32);
    expect(normalizeTag('trailing---')).toBe('trailing');
  });

  it('deduplicates and drops empties', () => {
    expect(normalizeTags(['Debugging', 'debugging', '', 'Retrieval'])).toEqual(['debugging', 'retrieval']);
    expect(normalizeTags(null)).toEqual([]);
  });

  it('slugs headings for file names', () => {
    expect(slugify('Mark 50: Wearable R&D')).toBe('mark-50-wearable-r-d');
  });
});

describe('similarity', () => {
  it('scores identical strings at 1', () => {
    expect(diceSimilarity('retrieval ranking', 'retrieval ranking')).toBe(1);
    expect(wordSimilarity('retrieval ranking', 'retrieval ranking')).toBe(1);
  });

  it('scores near duplicates highly and unrelated text low', () => {
    expect(diceSimilarity('Recalibrate the sensor', 'Recalibrate the sensors')).toBeGreaterThan(0.8);
    expect(diceSimilarity('Recalibrate the sensor', 'Soldered the power rail')).toBeLessThan(0.5);
  });

  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });
});

describe('title casing', () => {
  it('keeps small words lowercase and acronyms intact', () => {
    expect(titleCase('jarvis retrieval ranking investigation')).toBe('Jarvis Retrieval Ranking Investigation');
    expect(titleCase('the API of JARVIS')).toBe('The API of JARVIS');
  });
});

describe('highlighting and snippets', () => {
  it('splits text into matched segments without changing it', () => {
    const segments = highlight('Fixed the Retrieval bug', ['retrieval']);
    expect(segments.map((segment) => segment.text).join('')).toBe('Fixed the Retrieval bug');
    expect(segments.filter((segment) => segment.match).map((segment) => segment.text)).toEqual(['Retrieval']);
  });

  it('ignores diacritics when matching', () => {
    const segments = highlight('Étude in café', ['cafe']);
    expect(segments.some((segment) => segment.match)).toBe(true);
  });

  it('returns the original text when nothing matches', () => {
    expect(highlight('nothing here', ['zzz'])).toEqual([{ text: 'nothing here', match: false }]);
  });

  it('centres a snippet on the first match', () => {
    const long = `${'lorem ipsum '.repeat(30)}retrieval ranking${' dolor sit '.repeat(30)}`;
    const result = snippet(long, ['retrieval'], 40);
    expect(result).toContain('retrieval');
    expect(result.startsWith('…')).toBe(true);
    expect(result.length).toBeLessThan(120);
  });
});
