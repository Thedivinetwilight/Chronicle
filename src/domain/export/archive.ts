/**
 * Versioned JSON archive: the portable form of a Chronicle (§17).
 *
 * Format guarantees:
 * - `format` + `format_version` let a future build read old archives and refuse
 *   ones it cannot understand.
 * - Records keep their ids, timestamps, revision counters, tombstones and every
 *   relationship, so an archive can rebuild the whole graph.
 * - `source.original_input` is part of the record, so conversational captures
 *   export with the user's verbatim words (§28.15 TEST 15).
 * - `integrity` carries a checksum over a canonical serialisation, so a
 *   truncated or edited file can be detected before import.
 *
 * The format is documented in docs/EXPORT_FORMAT.md.
 */

import { nowIso, resolveTimeZone } from '../time';
import {
  RECORD_KINDS,
  type ChronicleLifeRecords,
  type ChronicleRecords,
  type LifeRecords,
  type RecordKind,
  type TimeZoneId
} from '../types';

export const ARCHIVE_FORMAT = 'chronicle.archive';
export const ARCHIVE_FORMAT_VERSION = 1;

export interface ArchiveIntegrity {
  algorithm: 'sha256' | 'fnv1a';
  checksum: string;
  record_count: number;
}

export interface ChronicleArchive {
  format: typeof ARCHIVE_FORMAT;
  format_version: number;
  /** App version that produced the archive (informational). */
  app_version: string;
  /** Schema version of the records inside (informational + compatibility). */
  schema_version: number;
  exported_at: string;
  timezone: TimeZoneId;
  /** Whether tombstoned records were included. */
  include_deleted: boolean;
  counts: Record<RecordKind, number>;
  /**
   * The V0.1 collections. The life collections (V0.2) live in `life` and are
   * absent from archives written before V0.2, which import cleanly.
   */
  records: ChronicleRecords;
  life?: LifeRecords;
  integrity: ArchiveIntegrity;
}

export const APP_VERSION = '0.1.0';

export function emptyRecords(): ChronicleRecords {
  return { projects: [], entries: [], milestones: [], tasks: [], revisions: [] };
}

/** Empty life collections (V0.2). */
export function emptyLifeRecords(): LifeRecords {
  return { chapters: [], paths: [], places: [], people: [], trips: [], collections: [], links: [] };
}

/** Combine both halves into a complete archive record set. */
export function emptyLifeArchiveRecords(): ChronicleLifeRecords {
  return { ...emptyRecords(), ...emptyLifeRecords() };
}

/** True when no life record exists yet (used to keep old archives byte-identical). */
export function isEmptyLifeRecords(life: LifeRecords | undefined): boolean {
  if (!life) return true;
  return LIFE_KINDS.every((kind) => (life[kind]?.length ?? 0) === 0);
}

export const LIFE_KINDS: readonly (keyof LifeRecords)[] = [
  'chapters',
  'paths',
  'places',
  'people',
  'trips',
  'collections',
  'links'
];

/** Total across every collection, V0.1 and V0.2. */
export function totalLifeRecords(records: ChronicleLifeRecords): number {
  return totalRecords(records) + LIFE_KINDS.reduce((total, kind) => total + (records[kind]?.length ?? 0), 0);
}

export function countLifeRecords(records: ChronicleLifeRecords): Record<keyof LifeRecords, number> {
  const counts = {} as Record<keyof LifeRecords, number>;
  for (const kind of LIFE_KINDS) counts[kind] = records[kind].length;
  return counts;
}

export function countRecords(records: ChronicleRecords | ChronicleLifeRecords): Record<RecordKind, number> {
  const counts = {} as Record<RecordKind, number>;
  for (const kind of RECORD_KINDS) {
    // Absent life collections (a bare V0.1 set) count as zero.
    counts[kind] = ((records as Partial<ChronicleLifeRecords>)[kind] ?? []).length;
  }
  return counts;
}

/** Total number of records across every collection. */
export function totalRecords(records: ChronicleRecords | ChronicleLifeRecords): number {
  return RECORD_KINDS.reduce((total, kind) => total + ((records as Partial<ChronicleLifeRecords>)[kind] ?? []).length, 0);
}

/**
 * Deterministic JSON with sorted keys, so the same data always produces the
 * same checksum regardless of property insertion order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortValue(source[key]);
    return out;
  }
  return value;
}

/** FNV-1a (32-bit, hex). Used only when WebCrypto is unavailable. */
export function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') return null;
  try {
    const data = new TextEncoder().encode(text);
    const digest = await subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export async function checksumFor(records: ChronicleRecords, life?: LifeRecords): Promise<ArchiveIntegrity> {
  const canonical = canonicalJson(life ? { ...records, life } : records);
  const count = totalRecords(records) + (life ? LIFE_KINDS.reduce((sum, kind) => sum + life[kind].length, 0) : 0);
  const sha = await sha256Hex(canonical);
  return sha
    ? { algorithm: 'sha256', checksum: sha, record_count: count }
    : { algorithm: 'fnv1a', checksum: fnv1aHex(canonical), record_count: count };
}

export interface BuildArchiveOptions {
  appVersion?: string;
  schemaVersion?: number;
  timezone?: TimeZoneId | 'device';
  includeDeleted?: boolean;
  exportedAt?: string;
}

/** Build an archive object from stored records. */
export async function buildArchive(
  records: ChronicleRecords | ChronicleLifeRecords,
  options: BuildArchiveOptions = {}
): Promise<ChronicleArchive> {
  // Accepts a bare V0.1 record set (so a caller that only has the five original
  // collections keeps working) as well as the complete V0.2 set.
  const full: ChronicleLifeRecords = { ...emptyLifeRecords(), ...records };
  const includeDeleted = options.includeDeleted ?? true;
  const live = <T extends { deleted_at?: string | null }>(list: T[]): T[] =>
    includeDeleted ? list : list.filter((record) => !record.deleted_at);
  const sorted = sortRecords({
    projects: live(full.projects),
    entries: live(full.entries),
    milestones: live(full.milestones),
    tasks: live(full.tasks),
    revisions: full.revisions
  });
  const life: LifeRecords = {
    chapters: live(full.chapters),
    paths: live(full.paths),
    places: live(full.places),
    people: live(full.people),
    trips: live(full.trips),
    collections: live(full.collections),
    links: live(full.links)
  };
  const sortedLife = sortLifeRecords({ ...sorted, ...life });
  return {
    format: ARCHIVE_FORMAT,
    format_version: ARCHIVE_FORMAT_VERSION,
    app_version: options.appVersion ?? APP_VERSION,
    schema_version: options.schemaVersion ?? ARCHIVE_FORMAT_VERSION,
    exported_at: options.exportedAt ?? nowIso(),
    timezone: resolveTimeZone(options.timezone),
    include_deleted: includeDeleted,
    counts: countRecords(sorted),
    records: sorted,
    // A V0.1 archive stays byte-identical: the section is only written when it
    // has something in it.
    ...(isEmptyLifeRecords(sortedLife) ? {} : { life: sortedLife }),
    integrity: await checksumFor(sorted, isEmptyLifeRecords(sortedLife) ? undefined : sortedLife)
  };
}

/**
 * Stable ordering across every collection, V0.1 and V0.2, by id (which is
 * time-ordered). Export and import both use this so an archive read back is in
 * exactly the order it was written.
 */
export function sortLifeRecords(records: ChronicleLifeRecords): ChronicleLifeRecords {
  const byId = <T extends { id: string }>(list: T[]): T[] =>
    [...list].sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
  return {
    ...sortRecords(records),
    chapters: byId(records.chapters),
    paths: byId(records.paths),
    places: byId(records.places),
    people: byId(records.people),
    trips: byId(records.trips),
    collections: byId(records.collections),
    links: byId(records.links)
  };
}

/** Stable ordering for the five V0.1 collections: by id, which is time-ordered. */
export function sortRecords(records: ChronicleRecords): ChronicleRecords {
  // Tolerates a record that somehow lost its id instead of throwing.
  const byId = <T extends { id: string }>(list: T[]): T[] =>
    [...list].sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
  return {
    projects: byId(records.projects),
    entries: byId(records.entries),
    milestones: byId(records.milestones),
    tasks: byId(records.tasks),
    revisions: byId(records.revisions)
  };
}

/** Serialize for download: readable, but compact enough for large archives. */
export function serializeArchive(archive: ChronicleArchive): string {
  return `${JSON.stringify(archive, null, 2)}\n`;
}

export function archiveFilename(archive: ChronicleArchive, kind: 'full' | 'backup' = 'full'): string {
  const date = (archive.exported_at ?? nowIso()).slice(0, 10);
  return `chronicle-${kind}-${date}.json`;
}

/** Verify the integrity block against the archive's own records. */
export async function verifyArchive(archive: ChronicleArchive): Promise<{ ok: boolean; reason?: string }> {
  if (!archive.integrity) return { ok: true }; // older archives may lack it
  const life = archive.life;
  const payload = life ? { ...archive.records, life } : archive.records;
  const expected =
    archive.integrity.algorithm === 'sha256'
      ? await sha256Hex(canonicalJson(payload))
      : fnv1aHex(canonicalJson(payload));
  if (expected && expected !== archive.integrity.checksum) {
    return { ok: false, reason: 'The file checksum does not match its contents (it may be truncated or edited).' };
  }
  const count = totalRecords(archive.records) + (life ? LIFE_KINDS.reduce((sum, kind) => sum + life[kind].length, 0) : 0);
  if (archive.integrity.record_count !== count) {
    return { ok: false, reason: 'The recorded count does not match the number of records in the file.' };
  }
  return { ok: true };
}
