/**
 * Time handling.
 *
 * Rules implemented here (see docs/DATA_MODEL.md §Timestamps):
 *
 * 1. Canonical storage is **UTC** (`IsoDateTime`). Nothing is stored as a
 *    local-time string without an offset.
 * 2. Calendar dates (`IsoDate`) are timezone-relative and are converted to
 *    instants using the user's configured timezone.
 * 3. The device timezone is detected via `Intl`, never hardcoded. When it
 *    cannot be detected the documented fallback is `UTC` and the UI can show
 *    that the timezone is unknown.
 * 4. `created_at` (when Chronicle recorded it), `updated_at` (last change) and
 *    `occurred_at` (when it actually happened) are distinct concepts and are
 *    never substituted for one another.
 * 5. Arithmetic on calendar dates is DST-safe: it operates on date components,
 *    not on millisecond offsets.
 */

import type { DatePrecision, IsoDate, IsoDateTime, TimeZoneId } from './types';

export const UTC: TimeZoneId = 'UTC';

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sunday … 6=Saturday (matches Date#getDay)
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(tz: TimeZoneId, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + '|' + JSON.stringify(options);
  let cached = formatterCache.get(key);
  if (!cached) {
    try {
      cached = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: tz });
    } catch {
      cached = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: UTC });
    }
    formatterCache.set(key, cached);
  }
  return cached;
}

/**
 * Number of cached `Intl.DateTimeFormat` instances. Constructing them is
 * expensive, so every formatter is built once per (timezone, options) pair;
 * this accessor lets tests prove that repeated formatting does not allocate.
 */
export function timeFormatCacheSize(): number {
  return formatterCache.size;
}

function partsOf(date: Date, tz: TimeZoneId): LocalParts {
  const formatter = getFormatter(tz, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short'
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hourRaw = Number(get('hour'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    // `en-GB` with hour12:false can emit "24" for midnight.
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: Math.max(0, weekdayNames.indexOf(get('weekday')))
  };
}

/* ------------------------------------------------------------------ *
 * Timezone resolution
 * ------------------------------------------------------------------ */

/** The device's IANA timezone, or `UTC` when it cannot be determined. */
export function deviceTimeZone(): TimeZoneId {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === 'string') return tz;
  } catch {
    /* fall through */
  }
  return UTC;
}

export function isValidTimeZone(candidate: string | undefined | null): candidate is TimeZoneId {
  if (!candidate) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

/** Resolve the configured preference (`device` or an IANA id) to a real zone. */
export function resolveTimeZone(preference: TimeZoneId | 'device' | undefined | null): TimeZoneId {
  if (!preference || preference === 'device') return deviceTimeZone();
  return isValidTimeZone(preference) ? preference : deviceTimeZone();
}

/** Milliseconds to add to a UTC instant to obtain local wall-clock time. */
export function timeZoneOffsetMs(instant: Date | IsoDateTime, tz: TimeZoneId): number {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const p = partsOf(date, tz);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - (date.getTime() - (date.getTime() % 1000));
}

/* ------------------------------------------------------------------ *
 * Instants
 * ------------------------------------------------------------------ */

export function nowIso(): IsoDateTime {
  return new Date().toISOString();
}

export function toIso(date: Date): IsoDateTime {
  return date.toISOString();
}

export function fromIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isValidIsoDateTime(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  // Require an explicit timezone designator so local-time strings cannot
  // sneak into the archive and be re-interpreted on another device.
  return /(Z|[+-]\d{2}:?\d{2})$/.test(value);
}

export function isValidIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/** Local calendar date for an instant, in the given timezone. */
export function localDateIso(instant: Date | IsoDateTime, tz: TimeZoneId): IsoDate {
  const date = typeof instant === 'string' ? (fromIso(instant) ?? new Date()) : instant;
  const p = partsOf(date, tz);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

export function localParts(instant: Date | IsoDateTime, tz: TimeZoneId): LocalParts {
  const date = typeof instant === 'string' ? (fromIso(instant) ?? new Date()) : instant;
  return partsOf(date, tz);
}

function pad(value: number, length: number): string {
  return String(Math.trunc(Math.abs(value))).padStart(length, '0');
}

/**
 * Convert a local wall-clock time in `tz` to a UTC instant. Iterates once to
 * converge across DST boundaries.
 */
export function zonedTimeToUtc(
  date: IsoDate,
  hour: number,
  minute: number,
  tz: TimeZoneId
): IsoDateTime {
  if (!isValidIsoDate(date)) throw new Error(`Invalid local date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const asIfUtc = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  let guess = asIfUtc - timeZoneOffsetMs(new Date(asIfUtc), tz);
  guess = asIfUtc - timeZoneOffsetMs(new Date(guess), tz);
  return new Date(guess).toISOString();
}

/** Midnight (local) of a calendar date as a UTC instant. */
export function startOfLocalDay(date: IsoDate, tz: TimeZoneId): IsoDateTime {
  return zonedTimeToUtc(date, 0, 0, tz);
}

/** End of a local day, exclusive upper bound as a UTC instant. */
export function endOfLocalDay(date: IsoDate, tz: TimeZoneId): IsoDateTime {
  return zonedTimeToUtc(addLocalDays(date, 1), 0, 0, tz);
}

/* ------------------------------------------------------------------ *
 * Calendar arithmetic (DST safe)
 * ------------------------------------------------------------------ */

export function parseIsoDate(date: IsoDate): { year: number; month: number; day: number } | null {
  if (!isValidIsoDate(date)) return null;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

export function formatIsoDate(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Add (or subtract) whole calendar days. Ignores DST because it is date-only. */
export function addLocalDays(date: IsoDate, days: number): IsoDate {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  const utc = Date.UTC(parsed.year, parsed.month - 1, parsed.day + days);
  const result = new Date(utc);
  return formatIsoDate(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  const day = Math.min(parsed.day, daysInMonth(parsed.year, parsed.month + months));
  const utc = Date.UTC(parsed.year, parsed.month - 1 + months, day);
  const result = new Date(utc);
  return formatIsoDate(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function diffLocalDays(from: IsoDate, to: IsoDate): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) return 0;
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** Monday-based start of week by default; `weekStartsOn` 0 = Sunday. */
export function startOfWeek(date: IsoDate, weekStartsOn: 0 | 1 = 1): IsoDate {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  const utc = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const weekday = new Date(utc).getUTCDay();
  const delta = weekStartsOn === 1 ? ((weekday + 6) % 7) : weekday;
  return addLocalDays(date, -delta);
}

export function startOfMonth(date: IsoDate): IsoDate {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  return formatIsoDate(parsed.year, parsed.month, 1);
}

export function todayIso(tz: TimeZoneId): IsoDate {
  return localDateIso(new Date(), tz);
}

export function isSameLocalDay(a: IsoDateTime, b: IsoDateTime, tz: TimeZoneId): boolean {
  return localDateIso(a, tz) === localDateIso(b, tz);
}

export function monthKey(instant: IsoDateTime, tz: TimeZoneId): string {
  return localDateIso(instant, tz).slice(0, 7);
}

/* ------------------------------------------------------------------ *
 * Presentation
 * ------------------------------------------------------------------ */

export interface FormatOptions {
  timezone?: TimeZoneId;
  now?: () => Date;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = WEEKDAYS.map((d) => d.slice(0, 3));

export { MONTHS, MONTHS_SHORT, WEEKDAYS, WEEKDAYS_SHORT };

/** `17 Oct 2026` — used for dates, never for instants. */
export function formatDateLabel(date: IsoDate): string {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  return `${parsed.day} ${MONTHS_SHORT[parsed.month - 1]} ${parsed.year}`;
}

export function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return `${MONTHS[m - 1]} ${y}`;
}

export function weekdayLabel(date: IsoDate, short = false): string {
  const parsed = parseIsoDate(date);
  if (!parsed) return '';
  const weekday = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
  return short ? (WEEKDAYS_SHORT[weekday] ?? '') : (WEEKDAYS[weekday] ?? '');
}

export function formatTime(instant: IsoDateTime, tz: TimeZoneId): string {
  const p = localParts(instant, tz);
  return `${pad(p.hour, 2)}:${pad(p.minute, 2)}`;
}

/** `17 Oct 2026, 14:05` */
export function formatDateTime(instant: IsoDateTime, tz: TimeZoneId): string {
  const date = localDateIso(instant, tz);
  return `${formatDateLabel(date)}, ${formatTime(instant, tz)}`;
}

/** Day header that reads naturally: Today / Yesterday / Monday / 17 Oct 2026. */
export function formatDayHeader(date: IsoDate, tz: TimeZoneId, now: Date = new Date()): string {
  const today = localDateIso(now, tz);
  const delta = diffLocalDays(today, date);
  if (delta === 0) return 'Today';
  if (delta === -1) return 'Yesterday';
  if (delta === 1) return 'Tomorrow';
  if (delta > -7 && delta < 0) return weekdayLabel(date);
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  if (parsed.year === parseIsoDate(today)?.year) {
    return `${parsed.day} ${MONTHS_SHORT[parsed.month - 1]}`;
  }
  return formatDateLabel(date);
}

/**
 * Compact relative label for an instant: "just now", "12 min ago",
 * "Yesterday 18:04", "3 Oct". Honest about direction and distance.
 */
export function formatRelative(
  instant: IsoDateTime,
  tz: TimeZoneId,
  now: Date = new Date()
): string {
  const date = fromIso(instant);
  if (!date) return '';
  const diffMs = date.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const future = diffMs > 0;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < 45_000) return 'just now';
  if (abs < hour) {
    const mins = Math.round(abs / minute);
    return future ? `in ${mins} min` : `${mins} min ago`;
  }
  if (abs < day && isSameLocalDay(instant, now.toISOString(), tz)) {
    const hours = Math.round(abs / hour);
    return future ? `in ${hours} h` : `${hours} h ago`;
  }
  const localDay = localDateIso(instant, tz);
  const today = localDateIso(now, tz);
  const dayDelta = diffLocalDays(today, localDay);
  if (dayDelta === -1) return `Yesterday ${formatTime(instant, tz)}`;
  if (dayDelta === 1) return `Tomorrow ${formatTime(instant, tz)}`;
  if (dayDelta < -1 && dayDelta > -7) return `${weekdayLabel(localDay, true)} ${formatTime(instant, tz)}`;
  return formatDateLabel(localDay);
}

/** A human description of how precise a date value is. */
export function precisionLabel(precision: DatePrecision): string {
  switch (precision) {
    case 'exact':
      return 'exact time';
    case 'day':
      return 'date only';
    case 'week':
      return 'approximate week';
    case 'month':
      return 'approximate month';
    case 'year':
      return 'approximate year';
    default:
      return 'date unknown';
  }
}

/**
 * Normalize an instant to the precision the user actually stated, so that a
 * "last week" event is not displayed as a precise moment.
 */
export function applyPrecision(instant: IsoDateTime, precision: DatePrecision, tz: TimeZoneId): IsoDateTime {
  const date = localDateIso(instant, tz);
  switch (precision) {
    case 'week':
      return startOfLocalDay(startOfWeek(date), tz);
    case 'month':
      return startOfLocalDay(startOfMonth(date), tz);
    case 'year':
      return startOfLocalDay(`${date.slice(0, 4)}-01-01`, tz);
    case 'day':
      return startOfLocalDay(date, tz);
    default:
      return instant;
  }
}

/** Sort instants newest-first; tolerates missing/invalid values. */
export function compareIsoDesc(a: string | null | undefined, b: string | null | undefined): number {
  const av = a ? Date.parse(a) : Number.NEGATIVE_INFINITY;
  const bv = b ? Date.parse(b) : Number.NEGATIVE_INFINITY;
  return bv - av;
}

export function compareIsoAsc(a: string | null | undefined, b: string | null | undefined): number {
  return -compareIsoDesc(a, b);
}
