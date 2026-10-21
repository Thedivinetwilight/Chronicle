/**
 * IndexedDB schema (Dexie).
 *
 * Versioning policy: every schema change gets a new `version(n)` with an
 * explicit `upgrade` function, so an existing archive on a user's device is
 * migrated instead of discarded. The version number is also stored in `meta`
 * and exported in the archive envelope.
 *
 * Indexes are chosen for the queries the UI actually runs:
 * - chronological listing (`occurred_at`, `date`, `due_on`)
 * - filtering (`project_id`, `type`, `status`, `deleted_at`)
 * - tag filtering (`*tags` multiEntry)
 * - full-text retrieval (`*tokens` multiEntry on the derived `searchIndex`)
 */

import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  JournalEntry,
  Milestone,
  Project,
  Revision,
  Task
} from '../domain/types';

/** One row per searchable record. Derived data — never exported, always rebuildable. */
export interface SearchIndexRow {
  /** `${kind}:${record_id}` */
  id: string;
  kind: 'projects' | 'entries' | 'milestones' | 'tasks';
  record_id: string;
  tokens: string[];
  title: string;
  project_id: string | null;
  occurred_at: string;
  updated_at: string;
  /**
   * Set when the record is a tombstone. Rows are kept (not deleted) so that a
   * search for deleted records — the recovery screen — still works, and so that
   * restoring a record does not require a full re-index.
   */
  deleted_at?: string | null;
}

export interface MetaRow {
  key: string;
  value: unknown;
  updated_at: string;
}

export const DATABASE_NAME = 'chronicle';
export const DATABASE_VERSION = 1;

export class ChronicleDatabase extends Dexie {
  declare projects: Table<Project, string>;
  declare entries: Table<JournalEntry, string>;
  declare milestones: Table<Milestone, string>;
  declare tasks: Table<Task, string>;
  declare revisions: Table<Revision, string>;
  declare searchIndex: Table<SearchIndexRow, string>;
  declare meta: Table<MetaRow, string>;

  constructor(name: string = DATABASE_NAME) {
    super(name);
    this.version(DATABASE_VERSION).stores({
      projects: 'id, name, status, stage, created_at, updated_at, deleted_at, *tags',
      entries: 'id, occurred_at, created_at, updated_at, project_id, type, deleted_at, *tags, milestone_id',
      milestones: 'id, date, project_id, status, verification, deleted_at, *tags',
      tasks: 'id, due_on, status, priority, project_id, deleted_at, updated_at, source_entry_id, *tags',
      revisions: 'id, entry_id, created_at',
      searchIndex: 'id, kind, record_id, project_id, *tokens, updated_at',
      meta: 'key'
    });
  }
}

let instance: ChronicleDatabase | null = null;

/** Lazily create the singleton database handle. */
export function getDatabase(name: string = DATABASE_NAME): ChronicleDatabase {
  if (!instance) instance = new ChronicleDatabase(name);
  return instance;
}

/** Replace the singleton (used by tests that need isolated databases). */
export function setDatabase(database: ChronicleDatabase | null): void {
  instance = database;
}

export type { EntityTable };

/**
 * Open the database and report honestly whether browser storage is usable.
 * Private-browsing modes and blocked storage must not silently produce an app
 * that appears to save but does not.
 */
export async function openDatabase(
  name: string = DATABASE_NAME
): Promise<{ ok: true; db: ChronicleDatabase } | { ok: false; error: string }> {
  if (typeof indexedDB === 'undefined') {
    return { ok: false, error: 'This browser does not expose IndexedDB, so Chronicle cannot store records locally.' };
  }
  const db = getDatabase(name);
  try {
    await db.open();
    return { ok: true, db };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Local storage could not be opened (${message}). Chronicle needs browser storage permission to save records.`
    };
  }
}

/** Approximate storage usage, when the browser supports the Storage API. */
export async function storageEstimate(): Promise<{ usage?: number; quota?: number } | null> {
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        ...(estimate.usage !== undefined ? { usage: estimate.usage } : {}),
        ...(estimate.quota !== undefined ? { quota: estimate.quota } : {})
      };
    }
  } catch {
    /* not supported */
  }
  return null;
}

/** Ask the browser to keep data even under storage pressure (best effort). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not supported */
  }
  return false;
}
