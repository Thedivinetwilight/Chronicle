/**
 * The storage port.
 *
 * Everything above this file (features, UI, capture engine) talks to a
 * `ChronicleStore`, never to Dexie directly. That boundary is what makes a
 * future SQLite (native) or server-backed implementation a swap rather than a
 * rewrite (§11), and it lets tests run against an in-memory store.
 *
 * Deliberately *not* abstracted: query objects are plain data, results are
 * domain records, and there is one implementation in this release. The
 * interface exists to isolate persistence, not to add layers.
 */

import type { MarkdownFile } from '../domain/export/markdown';
import type { ChronicleArchive } from '../domain/export/archive';
import type {
  ImportPlan,
  ImportReport,
  ImportStrategy,
  ParsedArchive
} from '../domain/import/archive';
import type { CaptureContext, CaptureProposal, CommitResult, LastCommit } from '../domain/capture/types';
import type { SearchHit } from '../domain/search';
import type {
  AppSettings,
  Chapter,
  Collection,
  EntryType,
  IsoDate,
  IsoDateTime,
  JournalEntry,
  MemoryLink,
  Milestone,
  MemoryLinkStatus,
  Path,
  Person,
  Place,
  Project,
  RecordKind,
  Revision,
  Task,
  Trip
} from '../domain/types';
import type {
  ChapterInput,
  CollectionInput,
  EntryInput,
  MemoryLinkInput,
  MilestoneInput,
  PathInput,
  PersonInput,
  PlaceInput,
  ProjectInput,
  TaskInput,
  TripInput
} from '../domain/factories';

export interface ProjectFilter {
  statuses?: Project['status'][];
  tags?: string[];
  search?: string;
  includeDeleted?: boolean;
  includeArchived?: boolean;
  limit?: number;
}

export interface EntryFilter {
  projectId?: string | null;
  types?: EntryType[];
  tags?: string[];
  from?: IsoDate;
  to?: IsoDate;
  includeDeleted?: boolean;
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
  order?: 'desc' | 'asc';
}

export interface MilestoneFilter {
  projectId?: string | null;
  statuses?: Milestone['status'][];
  from?: IsoDate;
  to?: IsoDate;
  includeDeleted?: boolean;
  limit?: number;
}

export interface TaskFilter {
  projectId?: string | null;
  statuses?: Task['status'][];
  includeDeleted?: boolean;
  dueBefore?: IsoDate;
  limit?: number;
}

export type TimelineKind = 'entry' | 'milestone' | 'task' | 'project';

export interface TimelineEvent {
  /** `${kind}:${record_id}` */
  id: string;
  kind: TimelineKind;
  record_id: string;
  /** The instant this event is placed at on the timeline. */
  occurred_at: IsoDateTime;
  /** Local calendar date, precomputed for grouping. */
  date: IsoDate;
  title: string;
  subtitle?: string;
  project_id: string | null;
  project_name?: string;
  tags: string[];
  type?: string;
  evidence_level?: JournalEntry['evidence_level'];
  private: boolean;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  /** True when the record was edited after it was made (shown, not hidden). */
  edited: boolean;
  path: string;
}

export interface TimelineFilter {
  projectIds?: string[];
  kinds?: TimelineKind[];
  types?: EntryType[];
  tags?: string[];
  from?: IsoDate;
  to?: IsoDate;
  milestonesOnly?: boolean;
  includeDeleted?: boolean;
  limit?: number;
  /** Cursor for pagination: the last `occurred_at` seen. */
  before?: IsoDateTime;
}

export interface SearchQuery {
  text: string;
  kinds?: RecordKind[];
  projectId?: string | null;
  tags?: string[];
  types?: EntryType[];
  from?: IsoDate;
  to?: IsoDate;
  limit?: number;
  includeDeleted?: boolean;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface ArchiveStats {
  projects: number;
  activeProjects: number;
  entries: number;
  milestones: number;
  openTasks: number;
  tags: number;
  deletedRecords: number;
  oldestEntry: IsoDateTime | null;
  newestEntry: IsoDateTime | null;
  bytesEstimate: number;
}

export interface ChapterFilter {
  statuses?: Chapter['status'][];
  includeDeleted?: boolean;
  limit?: number;
}

export interface PathFilter {
  states?: Path['state'][];
  includeDeleted?: boolean;
  limit?: number;
}

export interface LifeFilter {
  includeDeleted?: boolean;
  limit?: number;
}

export interface LinkFilter {
  status?: MemoryLinkStatus;
  /** Match either end of the link. */
  recordId?: string;
  includeDeleted?: boolean;
  limit?: number;
}

/**
 * Everything the Life Map may draw. Produced in one read so the map can never
 * see a half-applied relationship, and containing suggestions in `links` so the
 * map can list them separately without ever drawing them as connections.
 */
export interface LifeMapSource {
  entries: JournalEntry[];
  chapters: Chapter[];
  paths: Path[];
  places: Place[];
  people: Person[];
  trips: Trip[];
  collections: Collection[];
  links: MemoryLink[];
}

export interface DeletionImpact {
  entries: number;
  tasks: number;
  milestones: number;
}

export interface DeletedRecordSummary {
  kind: RecordKind;
  id: string;
  label: string;
  deleted_at: IsoDateTime;
}

export interface DeleteProjectOptions {
  /** What happens to records that reference the project. */
  children: 'unlink' | 'delete';
}

export interface StoreError {
  message: string;
  /** Original error, when available, for diagnostics (never rendered raw). */
  cause?: unknown;
}

/** Everything the application can do with stored data. */
export interface ChronicleStore {
  readonly backend: 'indexeddb' | 'memory';

  /** Open storage. Resolves false (never throws) when storage is unavailable. */
  init(): Promise<boolean>;
  readonly storageError: string | null;

  /* -- projects ------------------------------------------------------ */
  listProjects(filter?: ProjectFilter): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(input: ProjectInput): Promise<Project>;
  updateProject(id: string, changes: Partial<Project>): Promise<Project>;
  deleteProject(id: string, options?: DeleteProjectOptions): Promise<{ project: Project; impact: DeletionImpact }>;
  restoreProject(id: string): Promise<Project>;
  projectImpact(id: string): Promise<DeletionImpact>;

  /* -- journal ------------------------------------------------------- */
  listEntries(filter?: EntryFilter): Promise<JournalEntry[]>;
  getEntry(id: string): Promise<JournalEntry | null>;
  createEntry(input: EntryInput): Promise<JournalEntry>;
  updateEntry(id: string, changes: Partial<JournalEntry>, reason?: string): Promise<JournalEntry>;
  deleteEntry(id: string): Promise<JournalEntry>;
  restoreEntry(id: string): Promise<JournalEntry>;

  /* -- milestones ---------------------------------------------------- */
  listMilestones(filter?: MilestoneFilter): Promise<Milestone[]>;
  getMilestone(id: string): Promise<Milestone | null>;
  createMilestone(input: MilestoneInput): Promise<Milestone>;
  updateMilestone(id: string, changes: Partial<Milestone>): Promise<Milestone>;
  deleteMilestone(id: string): Promise<Milestone>;
  restoreMilestone(id: string): Promise<Milestone>;

  /* -- tasks --------------------------------------------------------- */
  listTasks(filter?: TaskFilter): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  createTask(input: TaskInput): Promise<Task>;
  updateTask(id: string, changes: Partial<Task>): Promise<Task>;
  deleteTask(id: string): Promise<Task>;
  restoreTask(id: string): Promise<Task>;

  /* -- revisions ----------------------------------------------------- */
  listRevisions(entryId: string): Promise<Revision[]>;
  restoreRevision(revisionId: string): Promise<JournalEntry>;

  /* -- tags ---------------------------------------------------------- */
  listTags(): Promise<TagCount[]>;
  renameTag(from: string, to: string): Promise<number>;

  /* -- timeline & search --------------------------------------------- */
  timeline(filter?: TimelineFilter): Promise<TimelineEvent[]>;
  search(query: SearchQuery): Promise<SearchHit[]>;
  rebuildSearchIndex(): Promise<number>;

  /* -- context & capture --------------------------------------------- */
  captureContext(options?: { activeProjectId?: string | null; limit?: number }): Promise<CaptureContext>;
  commitCapture(proposal: CaptureProposal): Promise<CommitResult>;
  getLastCommit(): Promise<LastCommit | null>;
  setLastCommit(commit: LastCommit | null): Promise<void>;

  /* -- settings ------------------------------------------------------ */
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  /* -- data portability ---------------------------------------------- */
  readAll(): Promise<import('../domain/types').ChronicleLifeRecords>;
  buildArchive(options?: { includeDeleted?: boolean }): Promise<ChronicleArchive>;
  markdownFiles(options?: { includePrivate?: boolean }): Promise<MarkdownFile[]>;
  parseArchive(text: string): Promise<ParseArchiveResultAlias>;
  planImport(parsed: ParsedArchive, strategy: ImportStrategy): Promise<ImportPlan>;
  applyImport(plan: ImportPlan, options?: { backupAcknowledged?: boolean }): Promise<ImportReport>;

  /* -- life archive (V0.2) -------------------------------------------- */
  listChapters(filter?: ChapterFilter): Promise<Chapter[]>;
  getChapter(id: string): Promise<Chapter | null>;
  createChapter(input: ChapterInput): Promise<Chapter>;
  updateChapter(id: string, changes: Partial<Chapter>): Promise<Chapter>;
  /** Deletes the chapter only: its experiences keep their words and their other links. */
  deleteChapter(id: string): Promise<Chapter>;
  restoreChapter(id: string): Promise<Chapter>;

  listPaths(filter?: PathFilter): Promise<Path[]>;
  getPath(id: string): Promise<Path | null>;
  createPath(input: PathInput): Promise<Path>;
  updatePath(id: string, changes: Partial<Path>): Promise<Path>;
  deletePath(id: string): Promise<Path>;
  restorePath(id: string): Promise<Path>;

  listPlaces(filter?: LifeFilter): Promise<Place[]>;
  getPlace(id: string): Promise<Place | null>;
  createPlace(input: PlaceInput): Promise<Place>;
  updatePlace(id: string, changes: Partial<Place>): Promise<Place>;
  deletePlace(id: string): Promise<Place>;
  restorePlace(id: string): Promise<Place>;

  listPeople(filter?: LifeFilter): Promise<Person[]>;
  getPerson(id: string): Promise<Person | null>;
  createPerson(input: PersonInput): Promise<Person>;
  updatePerson(id: string, changes: Partial<Person>): Promise<Person>;
  deletePerson(id: string): Promise<Person>;
  restorePerson(id: string): Promise<Person>;

  listTrips(filter?: LifeFilter): Promise<Trip[]>;
  getTrip(id: string): Promise<Trip | null>;
  createTrip(input: TripInput): Promise<Trip>;
  updateTrip(id: string, changes: Partial<Trip>): Promise<Trip>;
  deleteTrip(id: string): Promise<Trip>;
  restoreTrip(id: string): Promise<Trip>;

  listCollections(filter?: LifeFilter): Promise<Collection[]>;
  getCollection(id: string): Promise<Collection | null>;
  createCollection(input: CollectionInput): Promise<Collection>;
  updateCollection(id: string, changes: Partial<Collection>): Promise<Collection>;
  deleteCollection(id: string): Promise<Collection>;
  restoreCollection(id: string): Promise<Collection>;

  listLinks(filter?: LinkFilter): Promise<MemoryLink[]>;
  createLink(input: MemoryLinkInput): Promise<MemoryLink>;
  /** Approve, reject or re-open a suggestion. Never infers approval. */
  setLinkStatus(id: string, status: MemoryLinkStatus): Promise<MemoryLink>;
  deleteLink(id: string): Promise<MemoryLink>;
  /** Approved connections only. Always the source for drawn edges. */
  approvedLinks(): Promise<MemoryLink[]>;

  /** Replace an experience's chapter/path memberships atomically. */
  setEntryRelations(id: string, relations: { chapter_ids?: string[]; path_ids?: string[] }): Promise<JournalEntry>;
  entriesForChapter(chapterId: string): Promise<JournalEntry[]>;
  entriesForPath(pathId: string): Promise<JournalEntry[]>;

  /** One consistent read for the Life Map. Derived data — never exported. */
  lifeMapSource(): Promise<LifeMapSource>;

  /* -- housekeeping --------------------------------------------------- */
  stats(): Promise<ArchiveStats>;
  listDeleted(): Promise<DeletedRecordSummary[]>;
  restoreRecord(kind: RecordKind, id: string): Promise<boolean>;
  purgeDeleted(): Promise<number>;
  clearAll(): Promise<void>;
}

export type ParseArchiveResultAlias =
  | { ok: true; value: ParsedArchive }
  | { ok: false; errors: string[]; warnings: { path: string; message: string }[] };
