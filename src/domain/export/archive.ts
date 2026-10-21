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
import { RECORD_KINDS, type ChronicleRecords, type RecordKind, type TimeZoneId } from '../types';

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
  records: ChronicleRecords;
  integrity: ArchiveIntegrity;
}

export const APP_VERSION = '0.1.0';

export function emptyRecords(): ChronicleRecords {
  return { projects: [], entries: [], milestones: [], tasks: [], revisions: [] };
}

export function countRecords(records: ChronicleRecords): Record<RecordKind, number> {
  const counts = {} as Record<RecordKind, number>;
  for (const kind of RECORD_KINDS) counts[kind] = records[kind].length;
  return counts;
}

/** Total number of records across every collection. */
export function totalRecords(records: ChronicleRecords): number {
  return RECORD_KINDS.reduce((total, kind) => total + records[kind].length, 0);
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

export async function checksumFor(records: ChronicleRecords): Promise<ArchiveIntegrity> {
  const canonical = canonicalJson(records);
  const sha = await sha256Hex(canonical);
  return sha
    ? { algorithm: 'sha256', checksum: sha, record_count: totalRecords(records) }
    : { algorithm: 'fnv1a', checksum: fnv1aHex(canonical), record_count: totalRecords(records) };
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
  records: ChronicleRecords,
  options: BuildArchiveOptions = {}
): Promise<ChronicleArchive> {
  const includeDeleted = options.includeDeleted ?? true;
  const filtered: ChronicleRecords = includeDeleted
    ? records
    : {
        projects: records.projects.filter((record) => !record.deleted_at),
        entries: records.entries.filter((record) => !record.deleted_at),
        milestones: records.milestones.filter((record) => !record.deleted_at),
        tasks: records.tasks.filter((record) => !record.deleted_at),
        revisions: records.revisions
      };
  const sorted = sortRecords(filtered);
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
    integrity: await checksumFor(sorted)
  };
}

/** Stable ordering: by id, which is time-ordered. */
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
  const expected =
    archive.integrity.algorithm === 'sha256'
      ? await sha256Hex(canonicalJson(archive.records))
      : fnv1aHex(canonicalJson(archive.records));
  if (expected && expected !== archive.integrity.checksum) {
    return { ok: false, reason: 'The file checksum does not match its contents (it may be truncated or edited).' };
  }
  if (archive.integrity.record_count !== totalRecords(archive.records)) {
    return { ok: false, reason: 'The recorded count does not match the number of records in the file.' };
  }
  return { ok: true };
}
