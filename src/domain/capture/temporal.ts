/**
 * Temporal understanding for conversational capture.
 *
 * Responsibilities (§28.3):
 * - Resolve *when the documented event happened* (`occurred_at`) from ordinary
 *   language, separately from the moment Chronicle records it (`created_at`).
 * - Resolve *when a future commitment is due* (`due_on`) for tasks.
 * - Report precision and confidence honestly: "last week" becomes a
 *   week-precision date with an explicit ambiguity note, never a fabricated
 *   instant.
 * - Never assign "today" to an explicitly historical statement.
 *
 * All calendar arithmetic happens in the user's timezone, on date strings, so
 * DST transitions cannot shift a day.
 */

import {
  addLocalDays,
  addMonths,
  diffLocalDays,
  formatIsoDate,
  isValidIsoDate,
  localDateIso,
  localParts,
  parseIsoDate,
  startOfWeek,
  weekdayLabel,
  zonedTimeToUtc
} from '../time';
import type { DatePrecision, DateSource, IsoDate, IsoDateTime, TimeZoneId } from '../types';

export interface TemporalContext {
  now: Date;
  timezone: TimeZoneId;
}

export interface TemporalMatch {
  /** UTC instant the text refers to. */
  occurred_at: IsoDateTime;
  /** Local calendar date, when the resolution is day-level or coarser. */
  date: IsoDate;
  precision: DatePrecision;
  source: DateSource;
  /** The exact phrase that produced this interpretation. */
  phrase: string;
  /** 0…1. Below `CONFIDENT` the UI should surface the interpretation. */
  confidence: number;
  isFuture: boolean;
  /** Set when the phrase could reasonably mean more than one date. */
  ambiguity?: string;
  /** Wall-clock hour used (local), when the text stated one. */
  hour?: number;
  /** Wall-clock minute (local), when the text stated one. */
  minute?: number;
}

/** Threshold above which Chronicle applies a date without asking. */
export const CONFIDENT = 0.7;

/**
 * Threshold above which a *past* reference is still recorded as the event date,
 * with its real precision. An explicitly historical statement must never be
 * silently re-dated to "now" (§28.3); when confidence is between USABLE and
 * CONFIDENT the date is applied *and* surfaced as a question.
 */
export const USABLE = 0.55;

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, 'thirty': 30,
  couple: 2, few: 3, several: 3, handful: 3, fortnight: 14
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9,
  sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
};

/**
 * Cues that make a bare weekday refer to the future. Only the text *before*
 * the mention inside its own sentence is inspected, so "I worked on Monday and
 * will finish tomorrow" still reads Monday as the past.
 */
const FUTURE_CUES =
  /\b(will|would|going to|gonna|planning to|plan to|intend to|need to|want to|should|must|shall|by|before|due|scheduled|upcoming|aim to|hope to|set to)\b/;

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6
};

/** Hours used when the text names a part of the day but no clock time. */
const PART_OF_DAY: Record<string, number> = {
  dawn: 6, morning: 9, midday: 12, noon: 12, lunch: 13,
  afternoon: 15, evening: 19, night: 22, midnight: 23
};

/** Quantifiers that mean "approximately", never an exact count. */
const VAGUE_COUNTS = new Set(['few', 'couple', 'several', 'handful']);

function parseCount(word: string): number | null {
  const lower = word.toLowerCase();
  if (/^\d+$/.test(lower)) return Number(lower);
  return NUMBER_WORDS[lower] ?? null;
}

function weekdayOf(date: IsoDate): number {
  const parsed = parseIsoDate(date);
  if (!parsed) return 0;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

function atHour(
  date: IsoDate,
  hour: number | undefined,
  minute: number | undefined,
  tz: TimeZoneId,
  precision: DatePrecision
): IsoDateTime {
  // A date-only resolution is recorded at local noon so that it cannot fall on
  // the neighbouring day in any timezone when displayed.
  const exact = precision === 'exact';
  return zonedTimeToUtc(date, exact ? (hour ?? 12) : 12, exact ? (minute ?? 0) : 0, tz);
}

function build(
  date: IsoDate,
  phrase: string,
  precision: DatePrecision,
  confidence: number,
  ctx: TemporalContext,
  options: { hour?: number; minute?: number; isFuture?: boolean; ambiguity?: string } = {}
): TemporalMatch {
  const hour = options.hour;
  const minute = options.minute;
  return {
    occurred_at: atHour(date, hour, minute, ctx.timezone, precision),
    date,
    precision,
    source: 'text',
    phrase,
    confidence,
    isFuture: options.isFuture ?? false,
    ...(hour !== undefined ? { hour } : {}),
    ...(minute !== undefined ? { minute } : {}),
    ...(options.ambiguity ? { ambiguity: options.ambiguity } : {})
  };
}

interface PatternHit {
  match: TemporalMatch;
  index: number;
  length: number;
}

function scanPatterns(text: string, ctx: TemporalContext): PatternHit[] {
  const normalized = text.replace(/\s+/g, ' ');
  const lower = normalized.toLowerCase();
  const today = localDateIso(ctx.now, ctx.timezone);
  const hits: PatternHit[] = [];

  const push = (re: RegExp, factory: (groups: RegExpExecArray, index: number) => TemporalMatch | null): void => {
    let exec = re.exec(lower);
    while (exec) {
      const produced = factory(exec, exec.index);
      if (produced) hits.push({ match: produced, index: exec.index, length: exec[0].length });
      exec = re.exec(lower);
    }
  };

  /* --- "N <unit> ago" / "in N <unit>" ------------------------------ */
  push(/\b(?:about\s+|around\s+|roughly\s+|nearly\s+|almost\s+)?(\d+|[a-z]+)\s+(minute|hour|day|week|month|year)s?\s+ago\b/g, (groups) => {
    // Vague quantities are handled by their own pattern so they are never
    // reported with the confidence of an exact count.
    if (VAGUE_COUNTS.has((groups[1] ?? '').toLowerCase())) return null;
    const count = parseCount(groups[1] ?? '');
    const unit = groups[2] ?? '';
    if (count === null) return null;
    if (unit === 'minute' || unit === 'hour') {
      const ms = unit === 'hour' ? count * 3_600_000 : count * 60_000;
      const instant = new Date(ctx.now.getTime() - ms);
      const date = localDateIso(instant, ctx.timezone);
      return {
        occurred_at: instant.toISOString(),
        date,
        precision: 'exact',
        source: 'text',
        phrase: groups[0],
        confidence: 0.85,
        isFuture: false,
        hour: localParts(instant, ctx.timezone).hour,
        minute: localParts(instant, ctx.timezone).minute
      };
    }
    const date =
      unit === 'day' ? addLocalDays(today, -count)
      : unit === 'week' ? addLocalDays(today, -7 * count)
      : unit === 'month' ? addMonths(today, -count)
      : addMonths(today, -12 * count);
    const precision: DatePrecision = unit === 'day' ? 'day' : unit === 'week' ? 'week' : unit === 'month' ? 'month' : 'year';
    return build(date, groups[0], precision, 0.8, ctx);
  });

  push(/\bin\s+(\d+|[a-z]+)\s+(minute|hour|day|week|month|year)s?\b/g, (groups) => {
    if (VAGUE_COUNTS.has((groups[1] ?? '').toLowerCase())) return null;
    const count = parseCount(groups[1] ?? '');
    const unit = groups[2] ?? '';
    if (count === null) return null;
    const date =
      unit === 'day' ? addLocalDays(today, count)
      : unit === 'week' ? addLocalDays(today, 7 * count)
      : unit === 'month' ? addMonths(today, count)
      : unit === 'minute' || unit === 'hour'
        ? localDateIso(new Date(ctx.now.getTime() + count * (unit === 'hour' ? 3_600_000 : 60_000)), ctx.timezone)
        : addMonths(today, 12 * count);
    const precision: DatePrecision =
      unit === 'day' ? 'day' : unit === 'week' ? 'week' : unit === 'month' ? 'month' : unit === 'year' ? 'year' : 'exact';
    return build(date, groups[0], precision, 0.8, ctx, { isFuture: true });
  });

  /* --- Named days -------------------------------------------------- */
  push(/\bday before yesterday\b/g, (groups) => build(addLocalDays(today, -2), groups[0], 'day', 0.9, ctx));
  push(/\byesterday(?:\s+(morning|afternoon|evening|night))?\b/g, (groups) =>
    build(addLocalDays(today, -1), groups[0], 'day', 0.92, ctx, { hour: PART_OF_DAY[groups[1] ?? ''] }));
  push(/\blast night\b/g, (groups) =>
    build(addLocalDays(today, -1), groups[0], 'day', 0.88, ctx, { hour: PART_OF_DAY.night }));
  push(/\btomorrow(?:\s+(morning|afternoon|evening|night))?\b/g, (groups) =>
    build(addLocalDays(today, 1), groups[0], 'day', 0.92, ctx, { hour: PART_OF_DAY[groups[1] ?? ''], isFuture: true }));
  push(/\btonight\b/g, (groups) => build(today, groups[0], 'day', 0.85, ctx, { hour: PART_OF_DAY.evening }));
  push(/\btoday(?:\s+(morning|afternoon|evening|night))?\b/g, (groups) =>
    build(today, groups[0], 'day', 0.9, ctx, { hour: PART_OF_DAY[groups[1] ?? ''] }));
  push(/\bthis\s+(morning|afternoon|evening|midday|noon)\b/g, (groups) =>
    build(today, groups[0], 'day', 0.88, ctx, { hour: PART_OF_DAY[groups[1] ?? ''] }));

  /* --- Week / month / year relative expressions --------------------- */
  push(/\blast\s+week(?:end)?\b/g, (groups) => {
    const phrase = groups[0];
    const isWeekend = /weekend/.test(phrase);
    if (isWeekend) {
      // Most recent Saturday.
      const delta = (weekdayOf(today) + 7 - 6) % 7 || 7;
      return build(addLocalDays(today, -delta), phrase, 'day', 0.7, ctx, {
        ambiguity: '"last weekend" was read as the most recent Saturday'
      });
    }
    const weekStart = addLocalDays(startOfWeek(today), -7);
    return build(addLocalDays(weekStart, 3), phrase, 'week', 0.65, ctx, {
      ambiguity: 'the exact day within last week was not stated'
    });
  });
  push(/\bthis\s+week\b/g, (groups) =>
    build(addLocalDays(startOfWeek(today), 3), groups[0], 'week', 0.6, ctx, {
      ambiguity: 'the exact day within this week was not stated'
    }));
  push(/\bnext\s+week(?:end)?\b/g, (groups) => {
    if (/weekend/.test(groups[0])) {
      const delta = (6 - weekdayOf(today) + 7) % 7 || 7;
      return build(addLocalDays(today, delta), groups[0], 'day', 0.7, ctx, { isFuture: true });
    }
    return build(addLocalDays(startOfWeek(today), 10), groups[0], 'week', 0.6, ctx, {
      isFuture: true,
      ambiguity: 'a day within next week, not a specific date'
    });
  });
  push(/\blast\s+month\b/g, (groups) =>
    build(addMonths(today, -1), groups[0], 'month', 0.6, ctx, { ambiguity: 'only the month was stated' }));
  push(/\bthis\s+month\b/g, (groups) => build(today, groups[0], 'month', 0.55, ctx));
  push(/\bnext\s+month\b/g, (groups) =>
    build(addMonths(today, 1), groups[0], 'month', 0.6, ctx, { isFuture: true }));
  push(/\blast\s+year\b/g, (groups) =>
    build(addMonths(today, -12), groups[0], 'year', 0.55, ctx, { ambiguity: 'only the year was stated' }));
  push(/\bnext\s+year\b/g, (groups) =>
    build(addMonths(today, 12), groups[0], 'year', 0.55, ctx, { isFuture: true }));
  push(/\b(?:a\s+)?(couple|few|several|handful)\s+(?:of\s+)?(day|week|month|year)s?\s+ago\b/g, (groups) => {
    const quantifier = (groups[1] ?? 'few').toLowerCase();
    const unit = groups[2] ?? 'day';
    const approx = quantifier === 'couple' ? 2 : 3;
    const date =
      unit === 'day'
        ? addLocalDays(today, -approx)
        : unit === 'week'
          ? addLocalDays(today, -7 * approx)
          : unit === 'month'
            ? addMonths(today, -approx)
            : addMonths(today, -12 * approx);
    return build(date, groups[0], unit === 'day' ? 'week' : 'month', 0.55, ctx, {
      ambiguity: `"${quantifier}" is approximate, so this is a best guess`
    });
  });

  /* --- Named weekdays --------------------------------------------- */
  push(/\b(?:last|this|on|next)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/g, (groups, index) => {
    const raw = groups[0].trim();
    const name = (groups[1] ?? '').trim();
    const target = WEEKDAYS[name];
    if (target === undefined) return null;
    const qualifier = /\blast\b/.test(raw) ? 'last' : /\bnext\b/.test(raw) ? 'next' : /\bthis\b/.test(raw) ? 'this' : 'on';
    const todayWeekday = weekdayOf(today);
    if (qualifier === 'next') {
      // "next Tuesday" usually means the coming one, but some people mean the
      // Tuesday of next week. Resolve to the nearer reading and flag it.
      const delta = ((target - todayWeekday + 7) % 7) || 7;
      const date = addLocalDays(today, delta);
      return build(date, raw, 'day', 0.75, ctx, {
        isFuture: true,
        ambiguity: `read as the coming ${weekdayLabel(date)} (${formatIsoDate(...dateParts(date))}); some people mean the one in the following week`
      });
    }
    if (qualifier === 'this') {
      const delta = (target - todayWeekday + 7) % 7;
      const future = delta > 0 && delta <= 3;
      return build(addLocalDays(today, delta), raw, 'day', future ? 0.6 : 0.75, ctx, {
        isFuture: future,
        ambiguity: future ? `"this ${weekdayLabel(addLocalDays(today, delta)).toLowerCase()}" has not happened yet` : undefined
      });
    }
    if (qualifier === 'last') {
      // "last X" is always in the past: the most recent occurrence.
      const delta = ((todayWeekday - target + 7) % 7) || 7;
      const date = addLocalDays(today, -delta);
      return build(date, raw, 'day', 0.8, ctx, {
        ambiguity: `read as the most recent ${weekdayLabel(date)} (${formatIsoDate(...dateParts(date))})`
      });
    }

    // A bare weekday is genuinely ambiguous. Resolve it with the tense of its
    // own sentence: "I will test it Monday" is the coming Monday, "it broke
    // Monday" is the one that just passed. Never today.
    const sentenceStart =
      Math.max(lower.lastIndexOf('.', index), lower.lastIndexOf('!', index), lower.lastIndexOf('?', index)) + 1;
    const preceding = lower.slice(sentenceStart, index);
    const wantsFuture = FUTURE_CUES.test(preceding);
    const delta = wantsFuture ? ((target - todayWeekday + 7) % 7) || 7 : ((todayWeekday - target + 7) % 7) || 7;
    const date = addLocalDays(today, wantsFuture ? delta : -delta);
    return build(date, raw, 'day', 0.55, ctx, {
      isFuture: wantsFuture,
      ambiguity: `"${weekdayLabel(date)}" without a qualifier was read as the ${
        wantsFuture ? 'coming' : 'most recent'
      } one`
    });
  });

  /* --- Explicit calendar dates ------------------------------------ */
  push(/\b(?:on\s+)?(\d{4})-(\d{2})-(\d{2})\b/g, (groups) => {
    const candidate = `${groups[1]}-${groups[2]}-${groups[3]}`;
    if (!isValidIsoDate(candidate)) return null;
    const future = diffLocalDays(today, candidate) > 0;
    return build(candidate, groups[0], 'day', 0.95, ctx, { isFuture: future });
  });
  push(/\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s*,?\s*(\d{4}))?\b/g, (groups) => {
    const day = Number(groups[1]);
    const month = MONTHS[groups[2] ?? ''];
    if (!month || !day || day > 31) return null;
    let year = groups[3] ? Number(groups[3]) : ctx.now.getUTCFullYear();
    const candidate = formatIsoDate(year, month, day);
    if (!isValidIsoDate(candidate)) return null;
    // Without a year, a date more than ~6 months in the future probably means
    // last year (e.g. writing about "12 March" in October).
    if (!groups[3]) {
      const yearLocal = Number(today.slice(0, 4));
      const guess = formatIsoDate(yearLocal, month, day);
      if (diffLocalDays(today, guess) > 180) year = yearLocal - 1;
    }
    const resolved = formatIsoDate(year, month, day);
    return build(resolved, groups[0], 'day', groups[3] ? 0.95 : 0.85, ctx, {
      isFuture: diffLocalDays(today, resolved) > 0
    });
  });
  push(/\b(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/g, (groups) => {
    const month = MONTHS[groups[1] ?? ''];
    const day = Number(groups[2]);
    if (!month || !day) return null;
    let year = groups[3] ? Number(groups[3]) : Number(today.slice(0, 4));
    if (!groups[3] && diffLocalDays(today, formatIsoDate(year, month, day)) > 180) year -= 1;
    const resolved = formatIsoDate(year, month, day);
    if (!isValidIsoDate(resolved)) return null;
    return build(resolved, groups[0], 'day', groups[3] ? 0.95 : 0.85, ctx, {
      isFuture: diffLocalDays(today, resolved) > 0
    });
  });

  /* --- Month and year only ("October 2026") ------------------------ */
  push(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{4})\b/g, (groups) => {
    const month = MONTHS[groups[1] ?? ''];
    const year = Number(groups[2]);
    if (!month || !year || year < 1970 || year > 2200) return null;
    const date = formatIsoDate(year, month, 1);
    if (!isValidIsoDate(date)) return null;
    return build(date, groups[0], 'month', 0.8, ctx, { isFuture: diffLocalDays(today, date) > 0 });
  });

  /* --- Month and day, with or without a year ("Oct 3", "October 12, 2026") --- */
  push(/\b(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/g, (groups) => {
    const month = MONTHS[groups[1] ?? ''];
    const day = Number(groups[2]);
    if (!month || !day || day < 1 || day > 31) return null;
    let year = groups[3] ? Number(groups[3]) : Number(today.slice(0, 4));
    const resolved = formatIsoDate(year, month, day);
    if (!isValidIsoDate(resolved)) return null;
    // Without a year, prefer the reading closest to today: a date more than
    // six months away is far more likely to belong to the previous year.
    if (!groups[3] && diffLocalDays(today, resolved) > 180) {
      year -= 1;
      if (!isValidIsoDate(formatIsoDate(year, month, day))) return null;
    }
    const finalDate = formatIsoDate(year, month, day);
    return build(finalDate, groups[0], 'day', groups[3] ? 0.95 : 0.85, ctx, {
      isFuture: diffLocalDays(today, finalDate) > 0
    });
  });

  /* --- Clock times refine an existing day-level match -------------- */
  const clock = /\b(?:at|around|about|near)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b(?:\s+(?:in the\s+)?(morning|afternoon|evening|night))?/gi;
  let clockExec = clock.exec(normalized);
  while (clockExec) {
    const rawHour = Number(clockExec[1]);
    const rawMinute = clockExec[2] ? Number(clockExec[2]) : undefined;
    const meridiem = (clockExec[3] ?? '').toLowerCase();
    const part = (clockExec[4] ?? '').toLowerCase();
    const hasSignal = Boolean(meridiem || clockExec[2] || /\bat\b/i.test(clockExec[0]));
    if (hasSignal && rawHour <= 23) {
      let hour = rawHour;
      if (meridiem === 'pm' && hour < 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
      if (!meridiem && part && PART_OF_DAY[part] !== undefined && hour < 12) {
        hour = part === 'evening' || part === 'night' ? hour + 12 : hour;
      }
      hits.push({
        match: {
          occurred_at: atHour(today, hour, rawMinute, ctx.timezone, 'exact'),
          date: today,
          precision: 'exact',
          source: 'text',
          phrase: clockExec[0].trim(),
          confidence: 0.5,
          isFuture: false,
          hour,
          ...(rawMinute !== undefined ? { minute: rawMinute } : {})
        },
        index: clockExec.index,
        length: clockExec[0].length
      });
    }
    clockExec = clock.exec(normalized);
  }

  return hits;
}

function dateParts(date: IsoDate): [number, number, number] {
  const parsed = parseIsoDate(date);
  return parsed ? [parsed.year, parsed.month, parsed.day] : [1970, 1, 1];
}

/**
 * All temporal interpretations found in the text, best first.
 *
 * Ranking prefers: explicit dates > named days > relative offsets > vague
 * ranges. Clock-only matches are treated as refinements and ranked last so
 * that "I worked at 3pm yesterday" resolves to yesterday at 15:00.
 */
export function extractTemporal(text: string, ctx: TemporalContext): TemporalMatch[] {
  if (!text || !text.trim()) return [];
  const hits = scanPatterns(text, ctx);
  if (hits.length === 0) return [];

  const refined = hits.map((hit) => {
    if (hit.match.precision !== 'day' && hit.match.precision !== 'exact') return hit;
    const clockHit = hits.find(
      (other) => other.match.precision === 'exact' && other.match.hour !== undefined && other.match.confidence <= 0.5
    );
    if (!clockHit || clockHit === hit) return hit;
    const hour = clockHit.match.hour as number;
    const minute = clockHit.match.minute;
    return {
      ...hit,
      match: {
        ...hit.match,
        hour,
        ...(minute !== undefined ? { minute } : {}),
        precision: 'exact' as DatePrecision,
        occurred_at: atHour(hit.match.date, hour, minute, ctx.timezone, 'exact'),
        phrase: `${hit.match.phrase} ${clockHit.match.phrase}`.trim(),
        confidence: Math.min(0.95, hit.match.confidence + 0.05)
      }
    };
  });

  return refined
    .filter((hit) => hit.match.confidence > 0.45)
    .map((hit) => hit.match)
    .sort((a, b) => b.confidence - a.confidence || a.date.localeCompare(b.date));
}

/** The interpretation Chronicle will act on, or `null` when none was stated. */
export function primaryTemporal(text: string, ctx: TemporalContext): TemporalMatch | null {
  const matches = extractTemporal(text, ctx);
  return matches[0] ?? null;
}

/**
 * Separate the *event* date from any *future commitment* date in the same
 * message: "Yesterday I broke the build; I will fix it tomorrow" yields a past
 * event plus a future due date.
 */
export function splitEventAndCommitment(
  text: string,
  ctx: TemporalContext
): { event: TemporalMatch | null; commitment: TemporalMatch | null } {
  const matches = extractTemporal(text, ctx);
  const commitment = matches.find((match) => match.isFuture) ?? null;
  const event = matches.find((match) => !match.isFuture) ?? null;
  return { event, commitment };
}

/** Durations mentioned in the text ("about three hours"). Never a date. */
export function extractDurations(text: string): { phrase: string; minutes: number }[] {
  const out: { phrase: string; minutes: number }[] = [];
  const re = /\b(\d+|[a-z]+)\s+(minute|hour|day|week)s?\b(?!\s+ago)/gi;
  let exec = re.exec(text);
  while (exec) {
    const count = parseCount(exec[1] ?? '');
    const unit = (exec[2] ?? '').toLowerCase();
    if (count !== null && (unit === 'minute' || unit === 'hour')) {
      out.push({ phrase: exec[0], minutes: count * (unit === 'hour' ? 60 : 1) });
    }
    exec = re.exec(text);
  }
  return out;
}

/** Today in the user's timezone, measured from the context's own clock. */
export function today(ctx: TemporalContext): IsoDate {
  return localDateIso(ctx.now, ctx.timezone);
}
