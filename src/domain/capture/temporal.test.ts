/** Temporal parsing tests: natural dates, timezone handling and honesty. */

import { describe, expect, it } from 'vitest';
import {
  CONFIDENT,
  USABLE,
  extractDurations,
  extractTemporal,
  primaryTemporal,
  splitEventAndCommitment
} from './temporal';
import { fixedNow } from '../../testing/helpers';

// Reference instant: Saturday 2026-10-17T09:30:00Z.
const NOW = fixedNow();
const UTC = 'UTC';
const IST = 'Asia/Kolkata';
const ctx = { now: NOW, timezone: UTC };

function one(text: string, timezone = UTC) {
  const matches = extractTemporal(text, { now: NOW, timezone });
  return matches[0];
}

describe('explicit dates', () => {
  it('reads ISO dates at day precision', () => {
    const match = one('Shipped on 2026-10-12');
    expect(match?.date).toBe('2026-10-12');
    expect(match?.precision).toBe('day');
    expect(match?.confidence).toBeGreaterThan(0.9);
  });

  it('reads written dates and months', () => {
    expect(one('Deployed on 12 October 2026')?.date).toBe('2026-10-12');
    expect(one('October 2026 was busy')?.date).toBe('2026-10-01');
    expect(one('October 2026 was busy')?.precision).toBe('month');
    expect(one('In Jan 2026')?.date).toBe('2026-01-01');
    expect(one('Planned for Oct 3rd')?.date).toBe('2026-10-03');
  });

  it('rejects impossible calendar dates', () => {
    expect(one('Scheduled for 2026-13-45')).toBeUndefined();
    expect(one('Scheduled for 2026-02-30')).toBeUndefined();
  });

  it('reads an exact clock time at high confidence', () => {
    const match = one('The outage started at 14:30');
    expect(match?.hour).toBe(14);
    expect(match?.minute).toBe(30);
    expect(match?.confidence).toBe(0.5);
    expect(match?.precision).toBe('exact');
  });
});

describe('relative dates', () => {
  it('reads today, yesterday and tomorrow', () => {
    expect(one('Fixed it today')?.date).toBe('2026-10-17');
    expect(one('Fixed it yesterday')?.date).toBe('2026-10-16');
    expect(one('Ship it tomorrow')?.date).toBe('2026-10-18');
    expect(one('Ship it tomorrow')?.isFuture).toBe(true);
    expect(one('last night')?.date).toBe('2026-10-16');
  });

  it('reads "N days ago" from the local date', () => {
    expect(one('That happened three days ago')?.date).toBe('2026-10-14');
    expect(one('That happened 3 days ago')?.date).toBe('2026-10-14');
    expect(one('2 weeks ago')?.date).toBe('2026-10-03');
    expect(one('3 months ago')?.date).toBe('2026-07-17');
  });

  it('never rewrites an "hours ago" reference into the wrong day', () => {
    // 09:30Z is 15:00 in IST; 8 hours earlier is 07:00 IST, still the same day.
    expect(one('That was 8 hours ago', IST)?.date).toBe('2026-10-17');
    // 20 hours earlier crosses into the previous local day in IST.
    expect(one('That was 20 hours ago', IST)?.date).toBe('2026-10-16');
  });

  it('reads "last week" and "next week" at week precision', () => {
    // Resolved to a day inside the previous ISO week, not to today.
    const lastWeek = one('Last week was productive')?.date ?? '';
    expect(lastWeek >= '2026-10-05' && lastWeek <= '2026-10-11').toBe(true);
    expect(one('Last week was productive')?.precision).toBe('week');
    const nextWeek = one('Next week I will test it')?.date ?? '';
    expect(nextWeek >= '2026-10-19' && nextWeek <= '2026-10-25').toBe(true);
    expect(one('Next week I will test it')?.isFuture).toBe(true);
  });

  it('reads vague quantities as approximate and below the silent-apply threshold', () => {
    const match = one('A few days ago I rewired it');
    expect(match?.date).toBe('2026-10-14');
    expect(match?.precision).toBe('week');
    expect(match?.ambiguity).toMatch(/approximate/);
    expect(match!.confidence).toBeGreaterThanOrEqual(USABLE);
    expect(match!.confidence).toBeLessThan(CONFIDENT);
    expect(one('A couple of weeks ago')?.date).toBe('2026-10-03');
    // Nothing resolvable at all must not be turned into a date.
    expect(one('Sometime recently')).toBeUndefined();
  });
});

describe('weekday references', () => {
  it('reads "last Friday" as the most recent Friday and flags the ambiguity', () => {
    const match = one('That happened last Friday');
    expect(match?.date).toBe('2026-10-16');
    expect(match?.confidence).toBe(0.8);
    expect(match?.ambiguity).toBeTruthy();
    expect(match?.isFuture).toBe(false);
  });

  it('reads a bare weekday with the tense of its own sentence', () => {
    // Today is Saturday 17 Oct 2026.
    expect(one('I will do it Monday')?.date).toBe('2026-10-19'); // coming Monday
    expect(one('I will do it Monday')?.isFuture).toBe(true);
    expect(one('It broke Monday')?.date).toBe('2026-10-12'); // most recent Monday
    expect(one('Monday')?.confidence).toBe(0.55);
    expect(one('The report is due Thursday')?.date).toBe('2026-10-22');
    expect(one('Monday')?.ambiguity).toBeTruthy();
  });

  it('does not let a later clause flip an earlier weekday into the future', () => {
    const text = 'I worked on Monday and will finish the rest tomorrow.';
    const monday = extractTemporal(text, ctx).find((match) => /monday/i.test(match.phrase));
    expect(monday?.date).toBe('2026-10-12');
    expect(monday?.isFuture).toBe(false);
  });

  it('reads "next Tuesday" as the coming Tuesday and flags the ambiguity', () => {
    expect(one('Next Tuesday')?.date).toBe('2026-10-20');
    expect(one('Next Tuesday')?.isFuture).toBe(true);
    expect(one('Next Tuesday')?.ambiguity).toBeTruthy();
  });
});

describe('timezone behaviour', () => {
  it('resolves the same phrase to different local dates across zones', () => {
    // 2026-10-17T20:00:00Z is already 18 October in IST.
    const late = new Date('2026-10-17T20:00:00.000Z');
    const utcMatches = extractTemporal('Fixed it today', { now: late, timezone: UTC });
    const istMatches = extractTemporal('Fixed it today', { now: late, timezone: IST });
    expect(utcMatches[0]?.date).toBe('2026-10-17');
    expect(istMatches[0]?.date).toBe('2026-10-18');
  });

  it('stores dates without a timezone designator and reads them in local time', () => {
    const match = one('Shipped on 2026-10-12', IST);
    expect(match?.date).toBe('2026-10-12');
    // Day precision is recorded at local noon so it cannot drift across days.
    expect(match?.occurred_at).toBe('2026-10-12T06:30:00.000Z');
  });
});

describe('selection and separation', () => {
  it('prefers the most confident match, then the earliest mention', () => {
    const matches = extractTemporal('Yesterday I planned to ship tomorrow.', ctx);
    expect(matches.length).toBe(2);
    expect(primaryTemporal('Yesterday I planned to ship tomorrow.', ctx)?.date).toBe('2026-10-16');
    expect(matches[0]?.confidence).toBeGreaterThanOrEqual(matches[1]!.confidence);
  });

  it('separates the event date from the commitment date', () => {
    const split = splitEventAndCommitment('I finished the prototype yesterday and will test it tomorrow.', ctx);
    expect(split.event?.date).toBe('2026-10-16');
    expect(split.commitment?.date).toBe('2026-10-18');
    expect(split.commitment?.isFuture).toBe(true);
  });

  it('does not treat a future plan as an event', () => {
    const split = splitEventAndCommitment('Tomorrow I need to recalibrate the sensor.', ctx);
    expect(split.event).toBeNull();
    expect(split.commitment?.date).toBe('2026-10-18');
  });

  it('refines an event date with a clock time', () => {
    const split = splitEventAndCommitment('The crash happened yesterday at 22:15.', ctx);
    expect(split.event?.date).toBe('2026-10-16');
    expect(split.event?.hour).toBe(22);
    expect(split.event?.minute).toBe(15);
    expect(split.event?.precision).toBe('exact');
  });

  it('keeps an explicit due date with the commitment', () => {
    const split = splitEventAndCommitment('Tested the sensor; calibration is due on 2026-11-02.', ctx);
    expect(split.commitment?.date).toBe('2026-11-02');
  });

  it('confirms only sufficiently strong readings', () => {
    expect(CONFIDENT).toBeGreaterThan(USABLE);
    expect(one('Shipped on 2026-10-12')!.confidence).toBeGreaterThanOrEqual(CONFIDENT);
    expect(one('Sometime recently')).toBeUndefined();
  });
});

describe('durations', () => {
  it('reads durations in minutes and ignores bare clock times', () => {
    expect(extractDurations('It ran for 12 minutes')).toEqual([{ phrase: '12 minutes', minutes: 12 }]);
    expect(extractDurations('Two hours of work')).toEqual([{ phrase: 'Two hours', minutes: 120 }]);
    expect(extractDurations('Nothing timed here')).toEqual([]);
    expect(extractDurations('Started at 14:30')).toEqual([]);
    // "3 days ago" is a date, not a duration.
    expect(extractDurations('That was 3 days ago')).toEqual([]);
  });
});
