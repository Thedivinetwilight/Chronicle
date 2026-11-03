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
const CENTRE_RING = 54;
const AXIS_LENGTH = 236;
const EXPERIENCE_KINDS: ReadonlySet<string> = new Set(['experience']);

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function polar(angle: number, radius: number, cx: number, cy: number): { x: number; y: number } {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

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

  const axisCount = chapters.length;
  const axisStep = axisCount > 0 ? TAU / axisCount : 0;
  const startAngle = -Math.PI / 2; // twelve o'clock

  chapters.forEach((chapter, index) => {
    const angle = startAngle + index * axisStep;
    const undated = !chapter.start_date;
    axes.push({
      chapterId: chapter.id,
      label: chapter.name,
      angle,
      startRadius: CENTRE_RING + 26,
      endRadius: CENTRE_RING + AXIS_LENGTH,
      undated
    });
    const spineEnd = polar(angle, CENTRE_RING + AXIS_LENGTH + CENTRE_RING, cx, cy);
    nodes.push({
      key: `chapter:${chapter.id}`,
      kind: 'chapter',
      id: chapter.id,
      label: mapLabel(chapter.name),
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
    const inner = CENTRE_RING + 34;
    const outer = CENTRE_RING + AXIS_LENGTH - 16;
    const span = outer - inner;
    entries.forEach((entry, entryIndex) => {
      const t = entries.length === 1 ? 0.5 : entryIndex / (entries.length - 1);
      const radius = entries.length === 1 ? inner + span / 2 : inner + t * span;
      // A slight, deterministic fan keeps dense runs readable without random
      // jitter: neighbours alternate either side of the axis by a few degrees.
      const fan = entries.length > 2 ? (entryIndex % 2 === 0 ? -1 : 1) * 0.055 : 0;
      const point = polar(angle + fan, radius, cx, cy);
      const key = `experience:${entry.id}`;
      if (!nodes.some((node) => node.key === key)) {
        nodes.push({
          key,
          kind: 'experience',
          id: entry.id,
          label: mapLabel(entryLabel(entry)),
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
    const ringRadius = CENTRE_RING + AXIS_LENGTH + CENTRE_RING + (chapters.length > 0 ? 44 : 0);
    const sorted = [...unassigned].sort((a, b) => compareDates(entryDate(a), entryDate(b)));
    sorted.forEach((entry, index) => {
      const angle = startAngle + (index / Math.max(sorted.length, 1)) * TAU;
      const point = polar(angle, ringRadius, cx, cy);
      const key = `experience:${entry.id}`;
      if (!nodes.some((node) => node.key === key)) {
        nodes.push({
          key,
          kind: 'experience',
          id: entry.id,
          label: mapLabel(entryLabel(entry)),
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

  /** Place a record as an arc off its chapter axis (or the outer ring). */
  const placeOrbit = (
    kind: 'place' | 'person' | 'trip' | 'collection',
    record: Place | Person | Trip | Collection,
    index: number,
    total: number
  ): LifeNode => {
    const chapterId = chapterForRecord(kind, record.id);
    const anchor = chapterId ? (chapterAngle.get(chapterId) ?? startAngle) : startAngle;
    // Each orbit of a chapter is offset a little further round, so a chapter
    // with several kinds of relationship reads as a branching tree rather
    // than a starburst.
    const laneBase = chapterId ? CENTRE_RING + 120 : CENTRE_RING + AXIS_LENGTH + 104;
    const lane = laneBase + Math.min(index, 6) * 0;
    const spread = total > 1 ? (index / (total - 1) - 0.5) * (axisCount >= 4 ? 0.36 : 0.5) : 0;
    const radius = lane + (kind === 'person' ? 36 : kind === 'place' ? 0 : kind === 'trip' ? 18 : 54);
    const point = polar(anchor + spread, radius, cx, cy);
    const label =
      'name' in record ? mapLabel(record.name) : mapLabel((record as Path).title);
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
    .forEach((path, index, all) => {
      const chapterId = chapterForRecord('path', path.id);
      const anchor = chapterId ? (chapterAngle.get(chapterId) ?? startAngle) : startAngle;
      const spread = all.length > 1 ? (index / (all.length - 1) - 0.5) * 0.7 : 0;
      // A path is a line, not a dot: it runs alongside the chapter it belongs
      // to, which is what "the direction this era was heading" looks like.
      const inner = polar(anchor + spread, CENTRE_RING + 40, cx, cy);
      const outer = polar(anchor + spread, CENTRE_RING + AXIS_LENGTH + 24, cx, cy);
      const node: LifeNode = {
        key: `path:${path.id}`,
        kind: 'path',
        id: path.id,
        label: mapLabel(path.title),
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
        endRadius: CENTRE_RING + AXIS_LENGTH + 24,
        undated: !path.start_date
      });
      edges.push({
        id: `path-spine:${path.id}`,
        from: 'self',
        to: node.key,
        kind: 'spine',
        label: `Path: ${path.title}`,
        ...(inner ? {} : {})
      });
    });

  const places = input.places.filter((place) => !place.deleted_at);
  places.forEach((place, index) => {
    placeNode.set(place.id, placeOrbit('place', place, index, Math.max(places.length, 1)));
  });
  const people = input.people.filter((person) => !person.deleted_at);
  people.forEach((person, index) => {
    personNode.set(person.id, placeOrbit('person', person, index, Math.max(people.length, 1)));
  });
  const trips = input.trips.filter((trip) => !trip.deleted_at);
  trips.forEach((trip, index) => {
    tripNode.set(trip.id, placeOrbit('trip', trip, index, Math.max(trips.length, 1)));
  });
  const collections = input.collections.filter((collection) => !collection.deleted_at);
  collections.forEach((collection, index) => {
    collectionNode.set(collection.id, placeOrbit('collection', collection, index, Math.max(collections.length, 1)));
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

  /* -- bounds ------------------------------------------------------- */
  const bounds = computeBounds(nodes, width, height);

  return {
    nodes,
    edges: uniqueEdges,
    axes,
    approvedLinks: approved,
    suggestedLinks: suggested,
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

function computeBounds(nodes: LifeNode[], width: number, height: number): LifeMapLayout['bounds'] {
  if (nodes.length === 0) return { x: 0, y: 0, width, height };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.r);
    minY = Math.min(minY, node.y - node.r);
    maxX = Math.max(maxX, node.x + node.r);
    maxY = Math.max(maxY, node.y + node.r);
  }
  const padding = 28;
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
