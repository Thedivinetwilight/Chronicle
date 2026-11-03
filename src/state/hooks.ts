/**
 * Live queries over the store.
 *
 * `useLiveQuery` re-runs a query whenever any Dexie write happens, so lists
 * update without manual invalidation. Each hook returns `undefined` while its
 * first query is in flight — callers render a loading state for that.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useChronicle } from './ChronicleContext';
import type {
  ArchiveStats,
  ChapterFilter,
  DeletedRecordSummary,
  EntryFilter,
  LifeMapSource,
  LinkFilter,
  MilestoneFilter,
  PathFilter,
  ProjectFilter,
  SearchQuery,
  TagCount,
  TaskFilter,
  TimelineFilter
} from '../data/store';
import type { SearchHit } from '../domain/search';
import type {
  Chapter,
  Collection,
  EntryType,
  JournalEntry,
  MemoryLink,
  Milestone,
  Path,
  Person,
  Place,
  Project,
  Revision,
  Task,
  Trip
} from '../domain/types';

export function useProjects(filter: ProjectFilter = {}): Project[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listProjects(filter), [store, JSON.stringify(filter)]);
}

export function useProject(id: string | undefined): Project | null | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => (id ? store.getProject(id) : Promise.resolve(null)), [store, id]);
}

export function useEntries(filter: EntryFilter = {}): JournalEntry[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listEntries(filter), [store, JSON.stringify(filter)]);
}

export function useEntry(id: string | undefined): JournalEntry | null | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => (id ? store.getEntry(id) : Promise.resolve(null)), [store, id]);
}

export function useRevisions(entryId: string | undefined): Revision[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => (entryId ? store.listRevisions(entryId) : Promise.resolve([])), [store, entryId]);
}

export function useTasks(filter: TaskFilter = {}): Task[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listTasks(filter), [store, JSON.stringify(filter)]);
}

export function useMilestones(filter: MilestoneFilter = {}): Milestone[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listMilestones(filter), [store, JSON.stringify(filter)]);
}

export function useTimeline(filter: TimelineFilter = {}): import('../data/store').TimelineEvent[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.timeline(filter), [store, JSON.stringify(filter)]);
}

export function useTags(): TagCount[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listTags(), [store]);
}

export function useStats(): ArchiveStats | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.stats(), [store]);
}

export function useDeleted(): DeletedRecordSummary[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listDeleted(), [store]);
}

/** Debounced full-text search; `undefined` while waiting for input or results. */
export function useSearch(query: SearchQuery): SearchHit[] | undefined {
  const { store } = useChronicle();
  const [debounced, setDebounced] = useState(query.text);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.text), 180);
    return () => window.clearTimeout(timer);
  }, [query.text]);

  const key = useMemo(() => JSON.stringify({ ...query, text: debounced }), [query, debounced]);
  const parsed = useMemo<SearchQuery>(() => ({ ...query, text: debounced }), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return useLiveQuery(() => store.search(parsed), [store, key, parsed]);
}

/** Every entry type label, in the order the UI presents them. */
export const ENTRY_TYPE_OPTIONS: { value: EntryType; label: string }[] = [
  { value: 'note', label: 'Note' },
  { value: 'progress', label: 'Progress' },
  { value: 'decision', label: 'Decision' },
  { value: 'experiment', label: 'Experiment' },
  { value: 'failure', label: 'Failure' },
  { value: 'discovery', label: 'Discovery' },
  { value: 'research', label: 'Research' },
  { value: 'reflection', label: 'Reflection' },
  { value: 'milestone', label: 'Milestone' }
];

/* ===========================================================================
   Life archive hooks (V0.2)
   ---------------------------------------------------------------------------
   Same contract as above: `undefined` while the first query is in flight, so
   every screen can render a loading state instead of a wrong one.
   =========================================================================== */

export function useChapters(filter: ChapterFilter = {}): Chapter[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listChapters(filter), [store, JSON.stringify(filter)]);
}

export function useChapter(id: string | undefined): Chapter | null | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => (id ? store.getChapter(id) : Promise.resolve(null)), [store, id]);
}

export function usePaths(filter: PathFilter = {}): Path[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listPaths(filter), [store, JSON.stringify(filter)]);
}

export function usePath(id: string | undefined): Path | null | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => (id ? store.getPath(id) : Promise.resolve(null)), [store, id]);
}

export function usePlaces(): Place[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listPlaces(), [store]);
}

export function usePeople(): Person[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listPeople(), [store]);
}

export function useTrips(): Trip[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listTrips(), [store]);
}

export function useTrip(id: string | undefined): Trip | null | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => (id ? store.getTrip(id) : Promise.resolve(null)), [store, id]);
}

export function useCollections(): Collection[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listCollections(), [store]);
}

export function useCollection(id: string | undefined): Collection | null | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => (id ? store.getCollection(id) : Promise.resolve(null)), [store, id]);
}

export function useMemoryLinks(filter: LinkFilter = {}): MemoryLink[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.listLinks(filter), [store, JSON.stringify(filter)]);
}

/** One read for the Life Map; rebuilds whenever any archived record changes. */
export function useLifeMapSource(): LifeMapSource | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => store.lifeMapSource(), [store]);
}

/** Experiences filed in a chapter, newest first. */
export function useChapterEntries(chapterId: string | undefined): JournalEntry[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(
    () => (chapterId ? store.entriesForChapter(chapterId) : Promise.resolve([])),
    [store, chapterId]
  );
}

/** Experiences linked to a path, newest first. */
export function usePathEntries(pathId: string | undefined): JournalEntry[] | undefined {
  const { store } = useChronicle();
  return useLiveQuery(() => (pathId ? store.entriesForPath(pathId) : Promise.resolve([])), [store, pathId]);
}
