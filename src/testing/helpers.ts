/**
 * Shared test helpers.
 *
 * Deliberately small: a fixed clock, a capture context builder and an
 * in-memory `CaptureWriter` so the capture pipeline can be tested without
 * IndexedDB. Persistence itself is tested against real Dexie + fake-indexeddb
 * in `src/data/dexieStore.test.ts`.
 */

import type { CaptureWriter } from '../domain/capture/proposal';
import type { CaptureContext, LastCommit } from '../domain/capture/types';
import { createEntry, createMilestone, createProject, createTask, type RecordContext } from '../domain/factories';
import type {
  EntryInput,
  MilestoneInput,
  ProjectInput,
  TaskInput
} from '../domain/factories';
import type {
  JournalEntry,
  Milestone,
  Project,
  Task
} from '../domain/types';

/** A fixed instant so date arithmetic in tests is reproducible. */
export const FIXED_NOW_ISO = '2026-10-17T09:30:00.000Z';

export function fixedNow(iso: string = FIXED_NOW_ISO): Date {
  return new Date(iso);
}

export function recordContext(timezone = 'UTC', nowIso = FIXED_NOW_ISO): RecordContext {
  return { timezone, now: () => nowIso };
}

export function makeProject(overrides: ProjectInput & { id?: string } = {}): Project {
  return createProject({ name: 'Test project', ...overrides }, recordContext());
}

export function makeEntry(overrides: EntryInput & { id?: string } = {}): JournalEntry {
  return createEntry({ body: 'Something happened.', ...overrides }, recordContext());
}

export function makeTask(overrides: TaskInput & { id?: string } = {}): Task {
  return createTask({ title: 'A task', ...overrides }, recordContext());
}

export function makeMilestone(overrides: MilestoneInput & { id?: string } = {}): Milestone {
  return createMilestone({ title: 'A milestone', ...overrides }, recordContext());
}

export interface CaptureContextOverrides {
  projects?: Project[];
  recentEntries?: JournalEntry[];
  openTasks?: Task[];
  recentMilestones?: Milestone[];
  existingTags?: string[];
  timezone?: string;
  mode?: CaptureContext['mode'];
  now?: Date;
  activeProjectId?: string | null;
  lastCommit?: LastCommit | null;
}

export function makeContext(overrides: CaptureContextOverrides = {}): CaptureContext {
  return {
    now: overrides.now ?? fixedNow(),
    timezone: overrides.timezone ?? 'UTC',
    mode: overrides.mode ?? 'quick',
    projects: overrides.projects ?? [],
    recentEntries: overrides.recentEntries ?? [],
    openTasks: overrides.openTasks ?? [],
    recentMilestones: overrides.recentMilestones ?? [],
    existingTags: overrides.existingTags ?? [],
    activeProjectId: overrides.activeProjectId ?? null,
    lastCommit: overrides.lastCommit ?? null
  };
}

export interface MemoryStore {
  projects: Map<string, Project>;
  entries: Map<string, JournalEntry>;
  milestones: Map<string, Milestone>;
  tasks: Map<string, Task>;
  commits: LastCommit[];
}

/** In-memory `CaptureWriter` used to exercise commit logic in isolation. */
export function memoryWriter(store: MemoryStore = emptyMemoryStore()): {
  writer: CaptureWriter;
  store: MemoryStore;
} {
  const writer: CaptureWriter = {
    transaction: async <T>(work: () => Promise<T>): Promise<T> => work(),
    getEntry: async (id) => store.entries.get(id) ?? null,
    getTask: async (id) => store.tasks.get(id) ?? null,
    getMilestone: async (id) => store.milestones.get(id) ?? null,
    getProject: async (id) => store.projects.get(id) ?? null,
    putEntry: async (entry) => {
      store.entries.set(entry.id, entry);
    },
    putTask: async (task) => {
      store.tasks.set(task.id, task);
    },
    putMilestone: async (milestone) => {
      store.milestones.set(milestone.id, milestone);
    },
    putProject: async (project) => {
      store.projects.set(project.id, project);
    }
  };
  return { writer, store };
}

export function emptyMemoryStore(): MemoryStore {
  return {
    projects: new Map(),
    entries: new Map(),
    milestones: new Map(),
    tasks: new Map(),
    commits: []
  };
}

/** Convenience: the single entry a proposal created (or null). */
export function entryOf(store: MemoryStore): JournalEntry | null {
  const values = [...store.entries.values()];
  return values.length === 1 ? (values[0] as JournalEntry) : (values[0] ?? null);
}
