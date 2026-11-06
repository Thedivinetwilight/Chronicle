/**
 * `precisionNote` replaced three copy-pasted expressions that were all wrong in
 * the same way: `occurred_precision !== 'exact' ? ' · approximate' : ''` fired
 * for `day` (exact to the day) and for `unknown` (not an estimate at all), so
 * nearly every row in the archive carried the word and it stopped meaning
 * anything.
 */

import { describe, expect, it } from 'vitest';
import { precisionNote } from './format';
import { DATE_PRECISIONS } from '../domain/types';

describe('precisionNote', () => {
  it('says nothing for dates that are as exact as they claim', () => {
    expect(precisionNote('exact')).toBeNull();
    expect(precisionNote('day')).toBeNull();
  });

  it('leaves an unknown date to the When* components', () => {
    // The date itself renders as "Date not recorded"; a second phrase here
    // produced "Date not recorded · date unknown" on the same row.
    expect(precisionNote('unknown')).toBeNull();
  });

  it('names the unit a loose date was actually given in', () => {
    expect(precisionNote('week')).toBe('week only');
    expect(precisionNote('month')).toBe('month only');
    expect(precisionNote('year')).toBe('year only');
  });

  it('covers every precision the domain can produce', () => {
    // If a new precision is added, this fails rather than silently rendering
    // nothing for it.
    for (const precision of DATE_PRECISIONS) {
      expect(() => precisionNote(precision)).not.toThrow();
    }
    const noted = DATE_PRECISIONS.filter((precision) => precisionNote(precision) !== null);
    expect(noted.sort()).toEqual(['month', 'week', 'year']);
  });
});
