/**
 * Time handling tests: UTC canonicalisation, timezone resolution, DST-safe
 * calendar arithmetic and presentation.
 */

import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  addMonths,
  applyPrecision,
  compareIsoDesc,
  deviceTimeZone,
  diffLocalDays,
  endOfLocalDay,
  formatDateLabel,
  formatDayHeader,
  formatDateTime,
  formatRelative,
  formatTime,
  isValidIsoDate,
  isValidIsoDateTime,
  isValidTimeZone,
  localDateIso,
  localParts,
  monthKey,
  resolveTimeZone,
  startOfLocalDay,
  startOfWeek,
  timeFormatCacheSize,
  timeZoneOffsetMs,
  todayIso,
  zonedTimeToUtc
} from './time';

const UTC = 'UTC';
const IST = 'Asia/Kolkata'; // UTC+5:30, no DST
const BERLIN = 'Europe/Berlin'; // CET/CEST

describe('canonical timestamps', () => {
  it('accepts only timestamps with an explicit timezone designator', () => {
    expect(isValidIsoDateTime('2026-10-17T09:30:00.000Z')).toBe(true);
    expect(isValidIsoDateTime('2026-10-17T09:30:00+05:30')).toBe(true);
    expect(isValidIsoDateTime('2026-10-17T09:30:00')).toBe(false);
    expect(isValidIsoDateTime('17 October 2026')).toBe(false);
    expect(isValidIsoDateTime(42)).toBe(false);
    expect(isValidIsoDateTime(null)).toBe(false);
  });

  it('validates calendar dates including leap years', () => {
    expect(isValidIsoDate('2026-10-17')).toBe(true);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-10-17T00:00:00Z')).toBe(false);
  });
});

describe('timezone resolution', () => {
  it('detects a device timezone and never hardcodes one', () => {
    const tz = deviceTimeZone();
    expect(isValidTimeZone(tz)).toBe(true);
  });

  it('follows the device when the preference is "device"', () => {
    expect(resolveTimeZone('device')).toBe(deviceTimeZone());
    expect(resolveTimeZone(undefined)).toBe(deviceTimeZone());
  });

  it('falls back to the device zone for an invalid preference', () => {
    expect(resolveTimeZone('Mars/Olympus')).toBe(deviceTimeZone());
  });

  it('computes real offsets, including half-hour zones', () => {
    const instant = '2026-10-17T00:00:00.000Z';
    expect(timeZoneOffsetMs(instant, UTC)).toBe(0);
    expect(timeZoneOffsetMs(instant, IST)).toBe(5.5 * 3_600_000);
    // Berlin is on CEST (+2) in October 2026 until the last Sunday.
    expect(timeZoneOffsetMs(instant, BERLIN)).toBe(2 * 3_600_000);
    // After the DST change (25 October 2026) Berlin is on CET (+1).
    expect(timeZoneOffsetMs('2026-10-26T00:00:00.000Z', BERLIN)).toBe(1 * 3_600_000);
  });
});

describe('zoned conversions', () => {
  it('converts local wall-clock time to a UTC instant', () => {
    expect(zonedTimeToUtc('2026-10-17', 9, 0, UTC)).toBe('2026-10-17T09:00:00.000Z');
    expect(zonedTimeToUtc('2026-10-17', 9, 0, IST)).toBe('2026-10-17T03:30:00.000Z');
  });

  it('handles the DST transition when converting midnight', () => {
    // Berlin switches from CEST to CET at 03:00 UTC on 25 October 2026.
    expect(startOfLocalDay('2026-10-24', BERLIN)).toBe('2026-10-23T22:00:00.000Z');
    expect(startOfLocalDay('2026-10-26', BERLIN)).toBe('2026-10-25T23:00:00.000Z');
  });

  it('gives a 24h local window for endOfLocalDay across DST', () => {
    const start = Date.parse(startOfLocalDay('2026-10-25', BERLIN));
    const end = Date.parse(endOfLocalDay('2026-10-25', BERLIN));
    // A 25-hour local day, not 24: the clock goes back that night.
    expect(end - start).toBe(25 * 3_600_000);
  });

  it('reads local date parts in the requested zone', () => {
    const instant = '2026-10-17T20:00:00.000Z';
    expect(localDateIso(instant, UTC)).toBe('2026-10-17');
    expect(localDateIso(instant, IST)).toBe('2026-10-18');
    expect(localParts(instant, IST).hour).toBe(1); // 01:30 next day
  });

  it('derives today from the active zone', () => {
    const now = new Date('2026-10-17T20:00:00.000Z');
    expect(todayIso(UTC)).toBe(localDateIso(now, UTC));
  });
});

describe('calendar arithmetic', () => {
  it('adds and subtracts whole days across month and year boundaries', () => {
    expect(addLocalDays('2026-10-17', 1)).toBe('2026-10-18');
    expect(addLocalDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addLocalDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('clamps months to a valid day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-10-17', -12)).toBe('2025-10-17');
  });

  it('counts days between dates', () => {
    expect(diffLocalDays('2026-10-17', '2026-10-20')).toBe(3);
    expect(diffLocalDays('2026-10-20', '2026-10-17')).toBe(-3);
  });

  it('starts the week on Monday by default', () => {
    expect(startOfWeek('2026-10-17')).toBe('2026-10-12'); // Saturday -> Monday
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12');
    expect(startOfWeek('2026-10-18', 0)).toBe('2026-10-18'); // Sunday start
  });

  it('keeps month keys stable per zone', () => {
    expect(monthKey('2026-10-17T20:00:00.000Z', UTC)).toBe('2026-10');
    expect(monthKey('2026-10-31T20:00:00.000Z', IST)).toBe('2026-11');
  });
});

describe('presentation', () => {
  it('formats dates and times', () => {
    expect(formatDateLabel('2026-10-17')).toBe('17 Oct 2026');
    expect(formatTime('2026-10-17T20:00:00.000Z', IST)).toBe('01:30');
    expect(formatDateTime('2026-10-17T20:00:00.000Z', UTC)).toBe('17 Oct 2026, 20:00');
  });

  it('uses natural day headers', () => {
    const now = new Date('2026-10-17T09:30:00.000Z');
    expect(formatDayHeader('2026-10-17', UTC, now)).toBe('Today');
    expect(formatDayHeader('2026-10-16', UTC, now)).toBe('Yesterday');
    expect(formatDayHeader('2026-10-18', UTC, now)).toBe('Tomorrow');
    expect(formatDayHeader('2026-10-14', UTC, now)).toBe('Wednesday');
    expect(formatDayHeader('2026-01-04', UTC, now)).toBe('4 Jan');
    expect(formatDayHeader('2025-12-24', UTC, now)).toBe('24 Dec 2025');
  });

  it('describes relative times honestly', () => {
    const now = new Date('2026-10-17T09:30:00.000Z');
    expect(formatRelative('2026-10-17T09:29:45.000Z', UTC, now)).toBe('just now');
    expect(formatRelative('2026-10-17T09:18:00.000Z', UTC, now)).toBe('12 min ago');
    expect(formatRelative('2026-10-17T06:30:00.000Z', UTC, now)).toBe('3 h ago');
    expect(formatRelative('2026-10-16T18:04:00.000Z', UTC, now)).toBe('Yesterday 18:04');
    expect(formatRelative('2026-10-18T09:30:00.000Z', UTC, now)).toBe('Tomorrow 09:30');
    expect(formatRelative('2026-01-04T09:30:00.000Z', UTC, now)).toBe('4 Jan 2026');
  });

  it('normalises an instant to the precision that was actually stated', () => {
    expect(applyPrecision('2026-10-17T18:42:11.000Z', 'day', UTC)).toBe('2026-10-17T00:00:00.000Z');
    expect(applyPrecision('2026-10-17T18:42:11.000Z', 'week', UTC)).toBe('2026-10-12T00:00:00.000Z');
    expect(applyPrecision('2026-10-17T18:42:11.000Z', 'month', UTC)).toBe('2026-10-01T00:00:00.000Z');
    expect(applyPrecision('2026-10-17T18:42:11.000Z', 'exact', UTC)).toBe('2026-10-17T18:42:11.000Z');
  });

  it('sorts newest first and tolerates missing values', () => {
    const values = [null, '2026-10-01T00:00:00.000Z', undefined, '2026-10-17T00:00:00.000Z'];
    expect([...values].sort(compareIsoDesc)).toEqual([
      '2026-10-17T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
      null,
      undefined
    ]);
  });

  it('caches formatters instead of rebuilding them per call', () => {
    const before = timeFormatCacheSize();
    for (let i = 0; i < 50; i += 1) formatDateTime('2026-10-17T09:30:00.000Z', IST);
    expect(timeFormatCacheSize()).toBe(before);
  });
});
