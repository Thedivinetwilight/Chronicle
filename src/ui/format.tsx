/**
 * Presentation helpers for records: relative times that refresh themselves,
 * day headers, and the small metadata line every list row shares.
 */

import { useEffect, useState } from 'react';
import { formatDayHeader, formatRelative, formatDateTime, formatTime } from '../domain/time';
import type { DatePrecision, IsoDateTime, TimeZoneId } from '../domain/types';
import { Icon, type IconName } from './Icon';

/** Re-renders once a minute so relative times stay honest. */
export function useNowTick(intervalMs = 60_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return tick;
}

export function RelativeTime({ at, timezone }: { at: IsoDateTime; timezone: TimeZoneId }) {
  useNowTick();
  return <time dateTime={at}>{formatRelative(at, timezone)}</time>;
}

/**
 * A record can carry a real timestamp and still not know when it happened.
 * Choosing "I don't know when this happened" stores `occurred_at` as the moment
 * of writing so that lists still have something to sort by, which means a naive
 * row prints "26 Sep 2026 · date unknown" — a visible contradiction.
 *
 * So: when the precision is `unknown`, the honest phrase is the only thing
 * printed, and `precisionNote` says nothing further. Callers must not append
 * their own "date unknown" beside a date; that is how the two came to disagree
 * on four different screens.
 */
export function WhenExactly({
  at,
  precision,
  timezone,
  unknownLabel = 'Date not recorded'
}: {
  at: IsoDateTime;
  precision: DatePrecision;
  timezone: TimeZoneId;
  unknownLabel?: string;
}) {
  if (precision === 'unknown') return <span className="text-muted">{unknownLabel}</span>;
  return (
    <time dateTime={at} title={formatDateTime(at, timezone)}>
      {formatDateTime(at, timezone)}
    </time>
  );
}

export function WhenItHappened({
  at,
  precision,
  timezone,
  unknownLabel = 'Date not recorded'
}: {
  at: IsoDateTime;
  precision: DatePrecision;
  timezone: TimeZoneId;
  unknownLabel?: string;
}) {
  if (precision === 'unknown') return <span className="text-muted">{unknownLabel}</span>;
  return <RelativeTime at={at} timezone={timezone} />;
}

export function DayHeader({ date, timezone }: { date: string; timezone: TimeZoneId }) {
  return <div className="timeline__day-label">{formatDayHeader(date, timezone)}</div>;
}

export function MetaLine({
  icon,
  children,
  title
}: {
  icon?: IconName;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="entrycard__meta" title={title}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </div>
  );
}

export function ExactTime({ at, timezone }: { at: IsoDateTime; timezone: TimeZoneId }) {
  return (
    <time dateTime={at} title={formatDateTime(at, timezone)}>
      {formatTime(at, timezone)}
    </time>
  );
}

/**
 * How much to say about how precisely a date is known.
 *
 * Six precisions exist, and only three deserve a note. A `day`-precision date is
 * exact to the day, and an `unknown` date is not an estimate at all — it is the
 * absence of one. Repeating "approximate" for every value that was not literally
 * `exact` put the word on nearly every row in the archive and made it mean
 * nothing. `null` means say nothing.
 */
export function precisionNote(precision: DatePrecision): string | null {
  switch (precision) {
    case 'week':
      return 'week only';
    case 'month':
      return 'month only';
    case 'year':
      return 'year only';
    // `unknown` prints through WhenItHappened/WhenExactly instead. Returning a
    // string here would double the message on every row that pairs the two, and
    // `exact`/`day` genuinely have nothing to add.
    case 'unknown':
    default:
      return null;
  }
}
