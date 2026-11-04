/**
 * Life Map layout — a pure geometry module.
 *
 * The map answers one question quietly: *how does my life connect?* The
 * structure it draws is taken only from records the user actually made:
 *
 *   centre      "You" (not a record — the viewer's own archive)
 *   radial axes the chapters, in chronological order, clockwise from the top.
 *               A chapter with no dates sits on a dashed "undated" axis at the
 *               end, rather than being hidden or given an invented date.
 *   branches    the things an experience connected to, drawn as organic arcs
 *               off the chapter axis: paths (a living thread that runs the
 *               length of the era) and "orbit" clusters — places, people,
 *               trips, collections — that only exist if a real record does.
 *   nodes       one per live record. Experiences sit on the chapter axis at
 *               the angle of their date; everything else hangs off it.
 *
 * Rules the layout deliberately follows:
 * - Nothing is invented to fill space. No places → no places cluster. One
 *   chapter → a single axis, not a decorated ring.
 * - Edges are drawn only for approved relationships. `suggested` links are
 *   returned separately so the UI can list them for review; they are never
 *   drawn as if they were part of the archive.
 * - Every node carries a plain-text description, because the drawing is not
 *   the only way to read the map.
 * - Layout is deterministic: the same records always produce the same
 *   coordinates, so tests can assert on it and a user's map does not shuffle
 *   between visits.
 */

import type {
  Chapter,
  Collection,
  JournalEntry,
  MemoryLink,
  Path,
  Person,
  Place,
  Trip
} from '../types';

/* ------------------------------------------------------------------ *
 * Input & output
 * ------------------------------------------------------------------ */

export interface LifeMapInput {
  entries: JournalEntry[];
  chapters: Chapter[];
  paths: Path[];
  places: Place[];
  people: Person[];
  trips: Trip[];
  collections: Collection[];
  links: MemoryLink[];
}

export type LifeNodeKind =
  | 'chapter'
  | 'experience'
  | 'path'
  | 'place'
  | 'person'
  | 'trip'
  | 'collection';

export interface LifeNode {
  /** `${kind}:${id}` — stable across renders and safe as a DOM id. */
  key: string;
  kind: LifeNodeKind;
  id: string;
  label: string;
  /** One plain sentence for screen readers and the list view. */
  description: string;
  x: number;
  y: number;
  /** Visual radius in map units; also the tap target floor. */
  r: number;
  chapterId: string | null;
  /** ISO date used for ordering/labelling, when the record has one. */
  date: string | null;
  /** True when the record's date is deliberately imprecise or missing. */
  uncertain: boolean;
  /** Visibility is carried through so the UI can mark non-private records. */
  visibility: 'private' | 'circles' | 'public';
}

export type LifeEdgeKind = 'spine' | 'branch' | 'link';

export interface LifeEdge {
  /** Deterministic id built from both ends and the kind. */
  id: string;
  from: string;
  to: string;
  kind: LifeEdgeKind;
  /** Human-readable relationship, e.g. "part of Learning to travel". */
  label: string;
}

export interface LifeAxis {
  chapterId: string;
  label: string;
  angle: number;
  /** Where the axis starts (the centre ring) and ends, in map units. */
  startRadius: number;
  endRadius: number;
  /** Set when the chapter itself has no dates; the axis is drawn dashed. */
  undated: boolean;
}

/** A run of entries on one chapter axis, for list navigation and zooming. */
export interface LifeRegion {
  chapterId: string;
  startAngle: number;
  endAngle: number;
  startRadius: number;
  endRadius: number;
}

export interface LifeMapLayout {
  nodes: LifeNode[];
  edges: LifeEdge[];
  axes: LifeAxis[];
  /** Approved links, drawn. Suggested links, listed but never drawn. */
  approvedLinks: MemoryLink[];
  suggestedLinks: MemoryLink[];
  /** Label boxes, already de-collided. The renderer draws exactly these. */
  labels: Map<string, LabelPlacement>;
  /** The map bounds, with padding already applied. */
  bounds: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  /** Counts used to explain an empty map honestly. */
  counts: {
    experiences: number;
    chapters: number;
    paths: number;
    places: number;
    people: number;
    trips: number;
    collections: number;
    approvedLinks: number;
    suggestedLinks: number;
  };
}

export interface LayoutOptions {
  /** Map width/height in map units. The viewBox scales, so this is a shape. */
  width?: number;
  height?: number;
}

const TAU = Math.PI * 2;
/* Radii are derived from the canvas, not fixed. Fixed radii were the reason the
   map collapsed into a vertical line on a phone and overflowed on desktop:
   two chapters sit at 12 and 6 o'clock, and everything else was stacked on
   those two axes. */
const CENTRE_RING = 54;
const EXPERIENCE_KINDS: ReadonlySet<string> = new Set(['experience']);

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function compareDates(a: string | null | undefined, b: string | null | undefined): number {
  if (a && b) return a < b ? -1 : a > b ? 1 : 0;
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/** Trim to a label the map can carry without becoming a wall of text. */
export function mapLabel(text: string, max = 34): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Untitled';
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > max * 0.55 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

function entryLabel(entry: JournalEntry): string {
  if (entry.title.trim()) return entry.title.trim();
  const firstLine = entry.body.split('\n').find((line) => line.trim().length > 0) ?? '';
  return firstLine.replace(/[#>*_`-]/g, '').trim() || 'Untitled experience';
}

function entryDate(entry: JournalEntry): string | null {
  // A date is only placed on the map when the user supplied one or the capture
  // engine read one from their words; a capture timestamp is still a real
  // record of when it was written, so it is used but marked uncertain.
  return entry.occurred_at || null;
}

function isImprecise(entry: JournalEntry): boolean {
  return entry.occurred_precision === 'week' || entry.occurred_precision === 'month' || entry.occurred_precision === 'year' || entry.occurred_precision === 'unknown';
}

function chapterDateRange(chapter: Chapter): { start: string | null; end: string | null } {
  return { start: chapter.start_date ?? null, end: chapter.end_date ?? null };
}

function visibilityOf(record: { visibility?: 'private' | 'circles' | 'public' }): 'private' | 'circles' | 'public' {
  return record.visibility ?? 'private';
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

/**
 * Build the map. Deterministic, pure, and tolerant of every empty case:
 * an archive with no records returns an empty layout rather than a decorative
 * skeleton.
 */
export function buildLifeMap(input: LifeMapInput, options: LayoutOptions = {}): LifeMapLayout {
  const width = options.width ?? 920;
  const height = options.height ?? 720;
  const cx = width / 2;
  const cy = height / 2;

  // The map only ever draws live records. The store already filters, but the
  // layout must be safe on its own: it is the last place that could put a
  // deleted chapter or experience back in front of someone.
  const chapters = input.chapters.filter((chapter) => !chapter.deleted_at).sort((a, b) => {
    const start = compareDates(chapterDateRange(a).start, chapterDateRange(b).start);
    if (start !== 0) return start;
    return compareDates(a.created_at, b.created_at);
  });

  const nodes: LifeNode[] = [];
  const edges: LifeEdge[] = [];
  const axes: LifeAxis[] = [];

  /* -- experiences grouped by chapter ------------------------------- */
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const byChapter = new Map<string | null, JournalEntry[]>();
  const unassigned: JournalEntry[] = [];
  for (const entry of input.entries) {
    if (entry.deleted_at) continue;
    const links = (entry.links?.chapter_ids ?? []).filter((id) => chapterIds.has(id));
    if (links.length === 0) {
      unassigned.push(entry);
      continue;
    }
    // An experience may belong to more than one era; it is drawn on each axis
    // it belongs to, because hiding it from one of its chapters would misstate
    // the archive. The detail panel lists every chapter it belongs to.
    for (const chapterId of links) {
      const list = byChapter.get(chapterId) ?? [];
      list.push(entry);
      byChapter.set(chapterId, list);
    }
  }

  /* -- canvas-relative geometry ------------------------------------- *
     A radial tree needs two things a fixed layout cannot guarantee:
     (a) axes spread widely enough that branches do not overlap, and
     (b) enough radius that labels fit without colliding.
     `ax`/`ay` are the usable half-extents after a margin for labels. */
  /* Margins are proportional to the canvas. Fixed 150×96 margins were most of
     a small phone canvas, which left the drawing tiny in a sea of background. */
  const marginX = Math.min(150, width * 0.16);
  const marginY = Math.min(96, height * 0.13);
  const ax = Math.max(90, width / 2 - marginX);
  const ay = Math.max(90, height / 2 - marginY);

  /* On a narrow canvas, long labels cannot be drawn legibly however they are
     placed, so they are elided at build time — the same way `mapLabel` already
     elides very long titles. The full text stays in the node's description and
     in the outline view. */
  const labelBudget = width < 520 ? 18 : width < 760 ? 26 : 34;
  const fitLabel = (text: string): string => mapLabel(text, labelBudget);

  const axisCount = chapters.length;
  /* With one or two chapters a naive `TAU / count` puts every branch on the
     same vertical line. Chapters are laid out clockwise from twelve o'clock,
     but never closer together than 100°; when two would collide the second is
     pushed to the opposite quadrant, which is what makes a small archive read
     as a branching tree rather than a spine. */
  const preferredStep = axisCount > 0 ? TAU / axisCount : 0;
  const axisStep = axisCount <= 1 ? 0 : Math.max(preferredStep, (100 * Math.PI) / 180);
  const startAngle = -Math.PI / 2; // twelve o'clock

  /* Deliberately a circle, not an ellipse. The renderer draws axis lines from
     `angle` + `startRadius`/`endRadius` itself; an elliptical fit would make
     those lines and these nodes disagree, which reads as a drawing bug. A
     uniform `reach` keeps one source of geometry truth. It is the smaller of
     the two half-extents so nothing can ever leave the canvas. */
  const reach = Math.min(ax, ay);

  const polarFit = (angle: number, radius: number): { x: number; y: number } => ({
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius
  });
  const AXIS_LENGTH = Math.round(reach * 0.62);       // chapter spine length
  const CHAPTER_RADIUS = CENTRE_RING + AXIS_LENGTH;    // where the chapter dot sits
  const OUTER_RADIUS = reach * 0.94;                   // unfiled experiences
  const ORBIT_RADIUS = CENTRE_RING + AXIS_LENGTH * 0.96; // records hanging off a chapter

  chapters.forEach((chapter, index) => {
    const angle = startAngle + index * axisStep;
    const undated = !chapter.start_date;
    axes.push({
      chapterId: chapter.id,
      label: chapter.name,
      angle,
      startRadius: CENTRE_RING + 20,
      endRadius: CHAPTER_RADIUS - 18,
      undated
    });
    const spineEnd = polarFit(angle, CHAPTER_RADIUS);
    nodes.push({
      key: `chapter:${chapter.id}`,
      kind: 'chapter',
      id: chapter.id,
      label: fitLabel(chapter.name),
      description: chapter.description?.trim()
        ? `${chapter.name}: ${chapter.description.trim()}`
        : `${chapter.name} — a chapter with ${plural((byChapter.get(chapter.id) ?? []).length, 'experience')}.`,
      x: spineEnd.x,
      y: spineEnd.y,
      r: 13,
      chapterId: chapter.id,
      date: chapter.start_date ?? null,
      uncertain: undated,
      visibility: visibilityOf(chapter)
    });
    edges.push({
      id: `spine:${chapter.id}`,
      from: 'self',
      to: `chapter:${chapter.id}`,
      kind: 'spine',
      label: undated ? `Chapter with no known date: ${chapter.name}` : `Chapter: ${chapter.name}`
    });
    edges.push({
      id: `axis:${chapter.id}`,
      from: `chapter:${chapter.id}`,
      to: `chapter:${chapter.id}`,
      kind: 'spine',
      label: `Timeline of ${chapter.name}`
    });

    /* -- experiences along the axis ---------------------------------- */
    const entries = [...(byChapter.get(chapter.id) ?? [])].sort((a, b) => compareDates(entryDate(a), entryDate(b)));
    const inner = CENTRE_RING + 30;
    const outer = CHAPTER_RADIUS - 30;
    const span = Math.max(outer - inner, 1);
    entries.forEach((entry, entryIndex) => {
      const t = entries.length === 1 ? 0.5 : entryIndex / (entries.length - 1);
      const radius = entries.length === 1 ? inner + span / 2 : inner + t * span;
      // A slight, deterministic fan keeps dense runs readable without random
      // jitter: neighbours alternate either side of the axis by a few degrees.
      const fan = entries.length > 2 ? (entryIndex % 2 === 0 ? -1 : 1) * 0.055 : 0;
      const point = polarFit(angle + fan, radius);
      const key = `experience:${entry.id}`;
      if (!nodes.some((node) => node.key === key)) {
        nodes.push({
          key,
          kind: 'experience',
          id: entry.id,
          label: fitLabel(entryLabel(entry)),
          description: describeExperience(entry, chapter.name),
          x: point.x,
          y: point.y,
          r: 7,
          chapterId: chapter.id,
          date: entryDate(entry),
          uncertain: isImprecise(entry),
          visibility: visibilityOf(entry)
        });
      }
      edges.push({
        id: `branch:${chapter.id}:${entry.id}`,
        from: `chapter:${chapter.id}`,
        to: key,
        kind: 'branch',
        label: `Part of ${chapter.name}`
      });
    });
  });

  /* -- experiences with no chapter: a dashed outer ring ------------- */
  if (unassigned.length > 0) {
    /* Unfiled experiences sit on an outer ring, spread evenly. With a single
       unfiled memory the old code put it at exactly twelve o'clock on top of
       the first chapter; start half a step round instead. */
    const ringRadius = OUTER_RADIUS;
    const sorted = [...unassigned].sort((a, b) => compareDates(entryDate(a), entryDate(b)));
    sorted.forEach((entry, index) => {
      const angle = startAngle + ((index + 0.5) / Math.max(sorted.length, 1)) * TAU;
      const point = polarFit(angle, ringRadius);
      const key = `experience:${entry.id}`;
      if (!nodes.some((node) => node.key === key)) {
        nodes.push({
          key,
          kind: 'experience',
          id: entry.id,
          label: fitLabel(entryLabel(entry)),
          description: describeExperience(entry, null),
          x: point.x,
          y: point.y,
          r: 7,
          chapterId: null,
          date: entryDate(entry),
          uncertain: isImprecise(entry),
          visibility: visibilityOf(entry)
        });
        edges.push({
          id: `branch:unfiled:${entry.id}`,
          from: 'self',
          to: key,
          kind: 'branch',
          label: 'Not filed in a chapter'
        });
      }
    });
  }

  /* -- owned records: paths and orbit clusters ---------------------- */
  const links = input.links.filter((link) => !link.deleted_at);
  const approved = links.filter((link) => link.status === 'confirmed');
  const suggested = links.filter((link) => link.status === 'suggested');

  const nodeByEntry = new Map<string, LifeNode>();
  for (const node of nodes) {
    if (node.kind === 'experience') nodeByEntry.set(node.id, node);
  }

  /** The chapter an owned record hangs from: the chapter of its first linked experience. */
  const chapterForRecord = (kind: 'path' | 'place' | 'person' | 'trip' | 'collection', id: string): string | null => {
    for (const link of approved) {
      if (link.to_kind === kind && link.to_id === id && link.from_kind === 'entry') {
        const node = nodeByEntry.get(link.from_id);
        if (node) return node.chapterId;
      }
      if (link.from_kind === kind && link.from_id === id && link.to_kind === 'entry') {
        const node = nodeByEntry.get(link.to_id);
        if (node) return node.chapterId;
      }
    }
    return null;
  };

  const chapterAngle = new Map(chapters.map((chapter, index) => [chapter.id, startAngle + index * axisStep]));

  const placeNode = new Map<string, LifeNode>();
  const personNode = new Map<string, LifeNode>();
  const tripNode = new Map<string, LifeNode>();
  const collectionNode = new Map<string, LifeNode>();

  /* -- angular slots for owned records ------------------------------- *
     Before placing anything, give every owned record a distinct angular slot.
     Placing them per-kind around a chapter axis put a place, a person and a
     trip within a few degrees of each other, so their labels overlapped into
     an unreadable pile. Slots are allocated round-robin by chapter, so records
     belonging to the same era still sit near each other (keeping edges short)
     while no two records share an angle. */
  const ownRecords: { kind: 'path' | 'place' | 'person' | 'trip' | 'collection'; id: string }[] = [
    ...input.paths.filter((path) => !path.deleted_at).map((path) => ({ kind: 'path' as const, id: path.id })),
    ...input.places.filter((place) => !place.deleted_at).map((place) => ({ kind: 'place' as const, id: place.id })),
    ...input.people.filter((person) => !person.deleted_at).map((person) => ({ kind: 'person' as const, id: person.id })),
    ...input.trips.filter((trip) => !trip.deleted_at).map((trip) => ({ kind: 'trip' as const, id: trip.id })),
    ...input.collections
      .filter((collection) => !collection.deleted_at)
      .map((collection) => ({ kind: 'collection' as const, id: collection.id }))
  ];
  const slotByKey = new Map<string, number>();
  {
    // Group by owning chapter (null = unfiled) then interleave the groups, so
    // each chapter's records are spread around the circle rather than bunched.
    const groups = new Map<string, { kind: string; id: string }[]>();
    for (const record of ownRecords) {
      const owner = chapterForRecord(record.kind, record.id) ?? '__none__';
      const list = groups.get(owner) ?? [];
      list.push(record);
      groups.set(owner, list);
    }
    const ordered: { kind: string; id: string }[] = [];
    const buckets = [...groups.values()];
    const longest = buckets.reduce((max, bucket) => Math.max(max, bucket.length), 0);
    for (let column = 0; column < longest; column += 1) {
      for (const bucket of buckets) if (bucket[column]) ordered.push(bucket[column]!);
    }
    /* The whole ring is offset by half the chapter step, so a record never
       lands exactly on a chapter spine (which is where the axis label and the
       spine's own end label are drawn). */
    const ringOffset = axisCount > 0 ? axisStep / 2 : 0;
    ordered.forEach((record, index) => {
      const slot = ringOffset + ((index + 0.5) / Math.max(ordered.length, 1)) * TAU;
      slotByKey.set(`${record.kind}:${record.id}`, startAngle + slot);
    });
  }

  /** Place a record on its own angular slot, off its chapter's radius. */
  const placeOrbit = (
    kind: 'place' | 'person' | 'trip' | 'collection',
    record: Place | Person | Trip | Collection,
    index: number
  ): LifeNode => {
    const chapterId = chapterForRecord(kind, record.id);
    const anchor = slotByKey.get(`${kind}:${record.id}`) ?? startAngle;
    // Each orbit of a chapter is offset a little further round, so a chapter
    // with several kinds of relationship reads as a branching tree rather
    // than a starburst.
    const laneBase = chapterId ? ORBIT_RADIUS : OUTER_RADIUS * 0.86;
    // Records of the same kind fan out around the chapter's axis; the fan is
    // wider when there are few axes, so two chapters do not stack their
    // places, people and trips on one line.
    /* Two-ring stagger. Labels are wide and horizontal, so eleven of them on
       one ring collide however evenly the angles are spread. Alternating slots
       between an inner and an outer ring doubles the effective separation and
       is instantly readable: it looks like a deliberate map, not an accident. */
    const stagger = Math.round(reach * 0.075) * (index % 2 === 0 ? 0 : 1);
    const kindOffset = kind === 'person' ? 34 : kind === 'place' ? 0 : kind === 'trip' ? 17 : 52;
    const radius = Math.max(CENTRE_RING + 40, laneBase + kindOffset + stagger);
    const point = polarFit(anchor, radius);
    const label = 'name' in record ? fitLabel(record.name) : fitLabel((record as Path).title);
    const node: LifeNode = {
      key: `${kind}:${record.id}`,
      kind,
      id: record.id,
      label,
      description: describeOwned(kind, record),
      x: point.x,
      y: point.y,
      r: kind === 'trip' ? 9 : 8,
      chapterId,
      date: kind === 'trip' ? ((record as Trip).start_date ?? null) : null,
      uncertain: kind === 'trip' ? (record as Trip).date_precision === 'unknown' : false,
      visibility: visibilityOf(record)
    };
    nodes.push(node);
    edges.push({
      id: `orbit:${chapterId ?? 'self'}:${node.key}`,
      from: chapterId ? `chapter:${chapterId}` : 'self',
      to: node.key,
      kind: 'branch',
      label: chapterId ? `${capitalise(kind)} connected to this chapter` : `${capitalise(kind)} not filed in a chapter`
    });
    return node;
  };

  input.paths
    .filter((path) => !path.deleted_at)
    .forEach((path) => {
      const chapterId = chapterForRecord('path', path.id);
      // Paths use the same slot allocator as every other owned record, so a
      // path never lands on top of a chapter's spine.
      const anchor = slotByKey.get(`path:${path.id}`) ?? (chapterId ? (chapterAngle.get(chapterId) ?? startAngle) : startAngle);
      const spread = 0;
      // A path is a line, not a dot: it runs alongside the chapter it belongs
      // to, which is what "the direction this era was heading" looks like.
      const outer = polarFit(anchor + spread, CHAPTER_RADIUS + 24);
      const node: LifeNode = {
        key: `path:${path.id}`,
        kind: 'path',
        id: path.id,
        label: fitLabel(path.title),
        description: describeOwned('path', path),
        x: outer.x,
        y: outer.y,
        r: 9,
        chapterId,
        date: path.start_date ?? null,
        uncertain: !path.start_date,
        visibility: visibilityOf(path)
      };
      nodes.push(node);
      axes.push({
        chapterId: path.id,
        label: path.title,
        angle: anchor + spread,
        startRadius: CENTRE_RING + 40,
        endRadius: CHAPTER_RADIUS + 24,
        undated: !path.start_date
      });
      edges.push({
        id: `path-spine:${path.id}`,
        from: 'self',
        to: node.key,
        kind: 'spine',
        label: `Path: ${path.title}`
      });
    });

  const places = input.places.filter((place) => !place.deleted_at);
  places.forEach((place, index) => {
    placeNode.set(place.id, placeOrbit('place', place, index));
  });
  const people = input.people.filter((person) => !person.deleted_at);
  people.forEach((person, index) => {
    personNode.set(person.id, placeOrbit('person', person, index));
  });
  const trips = input.trips.filter((trip) => !trip.deleted_at);
  trips.forEach((trip, index) => {
    tripNode.set(trip.id, placeOrbit('trip', trip, index));
  });
  const collections = input.collections.filter((collection) => !collection.deleted_at);
  collections.forEach((collection, index) => {
    collectionNode.set(collection.id, placeOrbit('collection', collection, index));
  });

  /* -- trip → place and collection → experience membership ---------- */
  for (const trip of trips) {
    for (const placeId of trip.place_ids) {
      const place = placeNode.get(placeId);
      const tripEntry = tripNode.get(trip.id);
      if (!place || !tripEntry) continue;
      edges.push({
        id: `member:trip:${trip.id}:${placeId}`,
        from: tripEntry.key,
        to: place.key,
        kind: 'link',
        label: `Place visited on ${trip.name}`
      });
    }
  }
  for (const collection of collections) {
    const collectionEntry = collectionNode.get(collection.id);
    if (!collectionEntry) continue;
    for (const entryId of collection.entry_ids) {
      const node = nodeByEntry.get(entryId);
      if (!node) continue;
      edges.push({
        id: `member:collection:${collection.id}:${entryId}`,
        from: collectionEntry.key,
        to: node.key,
        kind: 'link',
        label: `In collection ${collection.name}`
      });
    }
  }

  /* -- approved memory links ---------------------------------------- */
  const lookup = new Map(nodes.map((node) => [node.key, node]));
  const keyFor = (kind: MemoryLink['from_kind'], id: string): string | null => {
    const map: Record<MemoryLink['from_kind'], LifeNodeKind> = {
      entry: 'experience',
      chapter: 'chapter',
      path: 'path',
      place: 'place',
      person: 'person',
      trip: 'trip',
      collection: 'collection'
    };
    const key = `${map[kind]}:${id}`;
    return lookup.has(key) ? key : null;
  };
  for (const link of approved) {
    const from = keyFor(link.from_kind, link.from_id);
    const to = keyFor(link.to_kind, link.to_id);
    if (!from || !to || from === to) continue;
    edges.push({
      id: `link:${link.id}`,
      from,
      to,
      kind: 'link',
      label: `${lookup.get(from)?.label ?? 'Record'} ${link.role} ${lookup.get(to)?.label ?? 'record'}`
    });
  }

  /* -- deduplicate edges ------------------------------------------- */
  const seenEdges = new Set<string>();
  const uniqueEdges = edges.filter((edge) => {
    const pair = [edge.from, edge.to].sort().join('|');
    const identity = `${edge.kind}:${pair}`;
    if (seenEdges.has(identity)) return false;
    seenEdges.add(identity);
    return true;
  });

  /* -- labels, then bounds ------------------------------------------ *
     Labels are resolved before bounds so the fit transform reserves room for
     the text as it will actually be drawn.

     On a narrow canvas the UI labels only the structure (chapters and paths)
     and whatever is selected, because eleven ~120px labels cannot fit in 350
     CSS pixels at a legible size. The resolver is told the same thing, so the
     bounds do not reserve room for text that is never drawn — which is what
     left a dead band above the map on a phone. */
  const labels = resolveLabelCollisions(nodes, width, height, { dense: width >= 640 });
  const bounds = computeBounds(nodes, width, height, labels);

  return {
    nodes,
    edges: uniqueEdges,
    axes,
    approvedLinks: approved,
    suggestedLinks: suggested,
    labels,
    bounds,
    width,
    height,
    counts: {
      experiences: nodes.filter((node) => EXPERIENCE_KINDS.has(node.kind)).length,
      chapters: chapters.length,
      paths: input.paths.filter((path) => !path.deleted_at).length,
      places: places.length,
      people: people.length,
      trips: trips.length,
      collections: collections.length,
      approvedLinks: approved.length,
      suggestedLinks: suggested.length
    }
  };
}

/* ------------------------------------------------------------------ *
 * Descriptions — the text equivalent of the drawing
 * ------------------------------------------------------------------ */

function describeExperience(entry: JournalEntry, chapterName: string | null): string {
  const parts: string[] = [];
  if (entry.title.trim()) parts.push(entry.title.trim());
  else {
    const line = entry.body.split('\n').find((value) => value.trim().length > 0) ?? '';
    parts.push(line.replace(/[#>*_`-]/g, '').trim() || 'Untitled experience');
  }
  if (isImprecise(entry)) parts.push(`date is approximate (${entry.occurred_precision})`);
  if (entry.occurred_source === 'text') parts.push('date read from your words');
  if (entry.private) parts.push('marked private');
  parts.push(chapterName ? `in chapter ${chapterName}` : 'not in a chapter');
  return parts.join(' · ');
}

function describeOwned(kind: 'path' | 'place' | 'person' | 'trip' | 'collection', record: unknown): string {
  if (kind === 'path') {
    const path = record as Path;
    const state = path.state === 'active' ? 'active path' : `${path.state} path`;
    return `${path.title} — ${state}${path.start_date ? `, from ${path.start_date}` : ', no start date'}`;
  }
  if (kind === 'place') {
    const place = record as Place;
    return `${place.name}${place.region ? `, ${place.region}` : ''} — place`;
  }
  if (kind === 'person') {
    const person = record as Person;
    return `${person.name}${person.relationship ? ` (${person.relationship})` : ''} — person`;
  }
  if (kind === 'trip') {
    const trip = record as Trip;
    return `${trip.name}${trip.start_date ? `, ${trip.start_date}` : ', dates not known'} — trip`;
  }
  const collection = record as Collection;
  return `${collection.name} — collection of ${plural(collection.entry_ids.length, 'experience')}`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function computeBounds(
  nodes: LifeNode[],
  width: number,
  height: number,
  labels: Map<string, LabelPlacement>
): LifeMapLayout['bounds'] {
  if (nodes.length === 0) return { x: 0, y: 0, width, height };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const node of nodes) {
    // Glyph.
    include(node.x - node.r, node.y - node.r);
    include(node.x + node.r, node.y + node.r);
    /* Label, using the exact rule the renderer draws with. Without this the
       fit transform clips labels at the edges — which is what happened when
       only the glyph radius was considered. */
    const label = labels.get(node.key);
    if (!label) continue;
    include(label.box.x, label.box.y);
    include(label.box.x + label.box.width, label.box.y + label.box.height);
    if (node.uncertain) {
      const y = label.y + (label.y > node.y ? 13 : -13);
      include(label.box.x, y - 10);
      include(label.box.x + label.box.width, y + 3);
    }
  }
  const padding = 26;
  const x = minX - padding;
  const y = minY - padding;
  return {
    x,
    y,
    width: Math.max(maxX + padding - x, 1),
    height: Math.max(maxY + padding - y, 1)
  };
}

/* ------------------------------------------------------------------ *
 * Label placement — one rule, shared by bounds and the renderer
 * ------------------------------------------------------------------ */

/* Labels are drawn at a fixed 11px CSS size, but the map is drawn in map units
   and then fitted. On a 350px phone canvas one map unit is barely 0.4 CSS
   pixels, so a 34-character label is wider than the canvas. These constants
   are the cap used when *laying out*, scaled by the canvas, so a label is
   never wider than roughly a third of the drawing on any device. */
const CHAR_WIDTH = 5.6;
const LABEL_SHARE = 0.30;

/** Estimated horizontal extent of a label at its rendered size. */
export function labelWidth(label: string, canvasWidth = 920): number {
  const cap = Math.max(88, Math.min(160, canvasWidth * LABEL_SHARE));
  return Math.min(label.length * CHAR_WIDTH, cap);
}

export interface LabelPlacement {
  /** Where the text's anchor sits. */
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  /** The label's box, used for bounds and for tests. */
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Place a node's label so it extends *outward* from the centre of the map.
 *
 * This is the readable arrangement for a radial diagram: a horizontal,
 * centre-anchored label under every node collides as soon as two nodes share a
 * radius, because a label is much wider than it is tall. Pushing the text along
 * the node's own radius turns the labels into a sunburst, where only nodes at
 * similar angles can ever meet.
 *
 * The rule is exported so `computeBounds` can reserve exactly the space the
 * renderer uses — a label can then never be clipped by the fit transform.
 */
export function placeLabel(
  node: Pick<LifeNode, 'x' | 'y' | 'r' | 'label'>,
  width: number,
  height: number
): LabelPlacement {
  const centreX = width / 2;
  const centreY = height / 2;
  const dx = node.x - centreX;
  const dy = node.y - centreY;
  const distance = Math.hypot(dx, dy);
  const ux = distance > 0.001 ? dx / distance : 0;
  const uy = distance > 0.001 ? dy / distance : 1;
  const w = labelWidth(node.label, width);
  const h = 12;

  let anchor: 'start' | 'middle' | 'end' = 'middle';
  let x = node.x;
  let y = node.y + node.r + 16;

  if (distance > 6) {
    if (Math.abs(ux) >= 0.25) {
      anchor = ux > 0 ? 'start' : 'end';
      x = node.x + ux * (node.r + 10);
      y = node.y + uy * (node.r + 4) + 4;
    } else {
      anchor = 'middle';
      y = uy > 0 ? node.y + node.r + 17 : node.y - node.r - 9;
    }
  }

  const boxX = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x, y, anchor, box: { x: boxX, y: y - h, width: w, height: h } };
}

/**
 * Resolve label collisions for the whole map at once.
 *
 * `placeLabel` decides the *direction* a label grows (outward from the centre).
 * That alone is not enough: two nodes at similar angles still produce two wide
 * horizontal boxes in the same band. This pass takes the whole set, walks it in
 * a stable order, and slides any label that would overlap vertically — away
 * from the centre, so the label keeps pointing at its own node.
 *
 * It is deterministic (no randomness, no DOM measurement) so the same archive
 * always draws the same map — which is also what the layout tests assert.
 */
export function resolveLabelCollisions(
  nodes: LifeNode[],
  width: number,
  height: number,
  options: { dense?: boolean } = {}
): Map<string, LabelPlacement> {
  /* `dense: false` is the narrow-canvas mode: only the structural nodes get a
     placement, matching what the renderer draws. */
  const dense = options.dense ?? true;
  const labelled = dense
    ? nodes
    : nodes.filter((node) => node.kind === 'chapter' || node.kind === 'path');
  const placed: { key: string; placement: LabelPlacement }[] = [];
  const out = new Map<string, LabelPlacement>();

  const overlaps = (a: LabelPlacement['box'], b: LabelPlacement['box']): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  // Chapters and paths first: they are the structure of the map, so they keep
  // the position the rule gives them and everything else moves around them.
  const priority: Record<LifeNodeKind, number> = {
    chapter: 0,
    path: 1,
    place: 2,
    person: 3,
    trip: 4,
    collection: 5,
    experience: 6
  };
  const ordered = [...labelled].sort((a, b) => {
    const byKind = priority[a.kind] - priority[b.kind];
    if (byKind !== 0) return byKind;
    return a.y - b.y || a.x - b.x || a.key.localeCompare(b.key);
  });

  /** Slide a placement, keeping the text and its box in sync. */
  const shift = (base: LabelPlacement, dx: number, dy: number): LabelPlacement => ({
    ...base,
    x: base.x + dx,
    y: base.y + dy,
    box: { ...base.box, x: base.box.x + dx, y: base.box.y + dy }
  });

  /* Glyphs are obstacles too. A label may not cover another node's marker —
     that hides a record completely, which is worse than a tight label. */
  const glyphBoxes = nodes.map((node) => ({
    x: node.x - node.r - 3,
    y: node.y - node.r - 3,
    width: (node.r + 3) * 2,
    height: (node.r + 3) * 2
  }));

  for (const node of ordered) {
    const base = placeLabel(node, width, height);
    // Labels move away from the centre of the map, so they read as coming from
    // their own node rather than drifting across the drawing.
    const awayY = base.y > height / 2 ? 1 : -1;
    const awayX = base.x > width / 2 ? 1 : -1;
    let candidate = base;

    /* Candidate offsets, cheapest first: straight out, then a line up/down,
       then further out to the side. A label that only ever moves vertically
       ends up stacked directly on another one, which is not "no collision". */
    const offsets: { dx: number; dy: number }[] = [];
    // 1) straight out, then 2) a diagonal ladder, then 3) pure sideways. Ordered
    // by distance so the label stays as close to its node as possible.
    for (let step = 1; step <= 8; step += 1) {
      offsets.push({ dx: 0, dy: 14 * step * awayY });
      offsets.push({ dx: 14 * step * awayX, dy: 13 * step * awayY });
      offsets.push({ dx: 14 * step * awayX, dy: 0 });
      offsets.push({ dx: -14 * step * awayX, dy: 13 * step * awayY });
    }

    const hitsGlyph = (box: LabelPlacement['box']) =>
      glyphBoxes.some((glyph) => overlaps(box, glyph));

    for (const offset of offsets) {
      const next = shift(base, offset.dx, offset.dy);
      const clash = placed.some((other) => overlaps(next.box, other.placement.box));
      // Never let the resolver itself push text outside the canvas — an
      // off-canvas label is worse than a slightly tight one.
      const inside = next.box.x >= 4 && next.box.x + next.box.width <= width - 4;
      if (!clash && inside && !hitsGlyph(next.box)) {
        candidate = next;
        break;
      }
    }

    /* Fallback: if nothing was clear, clamp the label inside the canvas so it
       is never silently cut off. Truncation hides a record; overlap only makes
       it slightly harder to read. */
    if (candidate.box.x < 4) candidate = shift(candidate, 4 - candidate.box.x, 0);
    if (candidate.box.x + candidate.box.width > width - 4) {
      candidate = shift(candidate, width - 4 - (candidate.box.x + candidate.box.width), 0);
    }
    out.set(node.key, candidate);
    placed.push({ key: node.key, placement: candidate });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Focus & search helpers (used by the UI, tested without a DOM)
 * ------------------------------------------------------------------ */

/** True when a node matches a chapter focus. */
export function nodeMatchesChapter(node: LifeNode, chapterId: string | null): boolean {
  if (!chapterId) return true;
  return node.chapterId === chapterId || (node.kind === 'chapter' && node.id === chapterId);
}

/** Case-insensitive search over labels and descriptions. */
export function filterNodes(nodes: readonly LifeNode[], query: string): LifeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...nodes];
  return nodes.filter(
    (node) => node.label.toLowerCase().includes(needle) || node.description.toLowerCase().includes(needle)
  );
}

/** The node a user tapped, or the nearest one within a generous radius. */
export function hitTest(nodes: readonly LifeNode[], x: number, y: number, tolerance = 18): LifeNode | null {
  let best: LifeNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const distance = Math.hypot(node.x - x, node.y - y);
    const reach = node.r + tolerance;
    if (distance <= reach && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * A zoom transform that fits `bounds` into a viewport, never zooming in past a
 * comfortable reading scale for a nearly-empty map.
 */
export function fitTransform(
  bounds: LifeMapLayout['bounds'],
  viewport: { width: number; height: number },
  maxScale = 1.6
): { x: number; y: number; scale: number } {
  if (viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0, scale: 1 };
  const scale = Math.min(viewport.width / bounds.width, viewport.height / bounds.height, maxScale);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: viewport.width / 2 - (bounds.x + bounds.width / 2) * safeScale,
    y: viewport.height / 2 - (bounds.y + bounds.height / 2) * safeScale,
    scale: safeScale
  };
}
