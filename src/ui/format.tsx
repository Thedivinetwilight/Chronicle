/**
 * Presentation helpers for records: relative times that refresh themselves,
 * day headers, and the small metadata line every list row shares.
 */

import { useEffect, useState } from 'react';
import { formatDayHeader, formatRelative, formatDateTime, formatTime } from '../domain/time';
import type { IsoDateTime, TimeZoneId } from '../domain/types';
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
