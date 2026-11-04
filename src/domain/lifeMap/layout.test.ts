/**
 * Life Map layout tests.
 *
 * The map is the signature surface, so its geometry is tested as domain logic:
 * it must reflect real records, invent nothing, keep suggestions off the
 * drawing, stay readable with one record, and be deterministic.
 */

import { describe, expect, it } from 'vitest';
import {
  buildLifeMap,
  filterNodes,
  fitTransform,
  hitTest,
  mapLabel,
  nodeMatchesChapter,
  placeLabel,
  resolveLabelCollisions
} from './layout';
import { suggestMemoryLinks } from './suggestions';
import { createChapter, createCollection, createEntry, createMemoryLink, createPath, createPlace, createTrip } from '../factories';

const TZ = 'UTC';
const context = { timezone: TZ, now: () => '2026-03-01T09:00:00.000Z' };

function emptyInput() {
  return {
    entries: [],
    chapters: [],
    paths: [],
    places: [],
    people: [],
    trips: [],
    collections: [],
    links: []
  };
}

function entryOn(day: string, extra: Parameters<typeof createEntry>[0] = {}) {
  return createEntry(
    {
      title: `Entry ${day}`,
      body: 'Something happened.',
      occurred_at: `${day}T12:00:00.000Z`,
      occurred_precision: 'day',
      occurred_source: 'user',
      ...extra
    },
    context
  );
}

describe('empty and minimal maps', () => {
  it('returns no nodes for an empty archive rather than inventing a skeleton', () => {
    const map = buildLifeMap(emptyInput());
    expect(map.nodes).toEqual([]);
    expect(map.edges).toEqual([]);
    expect(map.counts.experiences).toBe(0);
  });

  it('draws a single experience without a chapter at a finite position', () => {
    const entry = entryOn('2026-01-02');
    const map = buildLifeMap({ ...emptyInput(), entries: [entry] });
    expect(map.nodes).toHaveLength(1);
    const node = map.nodes[0]!;
    expect(node.kind).toBe('experience');
    expect(Number.isFinite(node.x)).toBe(true);
    expect(Number.isFinite(node.y)).toBe(true);
    expect(node.chapterId).toBeNull();
    // Filed under nothing: the edge says so in words instead of guessing.
    expect(map.edges[0]!.label).toMatch(/not filed in a chapter/i);
  });

  it('draws one chapter axis for one chapter, not a decorated ring', () => {
    const chapter = createChapter({ name: 'First year', start_date: '2024-06-01' }, context);
    const entry = entryOn('2024-07-01', { links: { chapter_ids: [chapter.id], path_ids: [] } });
    const map = buildLifeMap({ ...emptyInput(), chapters: [chapter], entries: [entry] });
    expect(map.axes.filter((axis) => axis.chapterId === chapter.id)).toHaveLength(1);
    const experience = map.nodes.find((node) => node.kind === 'experience')!;
    expect(experience.chapterId).toBe(chapter.id);
    expect(map.edges.some((edge) => edge.label === 'Part of First year')).toBe(true);
  });
});

describe('structure from real records', () => {
  it('places every chapter on its own axis in date order', () => {
    const late = createChapter({ name: 'Later', start_date: '2025-01-01' }, context);
    const early = createChapter({ name: 'Earlier', start_date: '2020-01-01' }, context);
    const map = buildLifeMap({ ...emptyInput(), chapters: [late, early] });
    const axes = map.axes.filter((axis) => axis.chapterId === early.id || axis.chapterId === late.id);
    expect(axes.map((axis) => axis.chapterId)).toEqual([early.id, late.id]);
  });

  it('marks a chapter with no dates as undated instead of giving it one', () => {
    const chapter = createChapter({ name: 'Somewhere in the 2010s' }, context);
    const map = buildLifeMap({ ...emptyInput(), chapters: [chapter] });
    const axis = map.axes.find((candidate) => candidate.chapterId === chapter.id)!;
    expect(axis.undated).toBe(true);
    const node = map.nodes.find((candidate) => candidate.key === `chapter:${chapter.id}`)!;
    expect(node.description).toContain('chapter');
    expect(node.date).toBeNull();
  });

  it('positions experiences along their chapter axis in date order', () => {
    const chapter = createChapter({ name: 'College', start_date: '2023-01-01', end_date: '2026-01-01' }, context);
    const first = entryOn('2023-02-01', { links: { chapter_ids: [chapter.id], path_ids: [] } });
    const second = entryOn('2024-02-01', { links: { chapter_ids: [chapter.id], path_ids: [] } });
    const map = buildLifeMap({ ...emptyInput(), chapters: [chapter], entries: [second, first] });
    const a = map.nodes.find((node) => node.id === first.id)!;
    const b = map.nodes.find((node) => node.id === second.id)!;
    const distance = (node: { x: number; y: number }) => Math.hypot(node.x - map.width / 2, node.y - map.height / 2);
    expect(distance(a)).toBeLessThan(distance(b));
  });

  it('shows a second chapter membership rather than hiding one', () => {
    const one = createChapter({ name: 'One', start_date: '2024-01-01' }, context);
    const two = createChapter({ name: 'Two', start_date: '2024-06-01' }, context);
    const entry = entryOn('2024-03-01', { links: { chapter_ids: [one.id, two.id], path_ids: [] } });
    const map = buildLifeMap({ ...emptyInput(), chapters: [one, two], entries: [entry] });
    // The same experience appears under both eras it belongs to; it is one record.
    const drawn = map.nodes.filter((node) => node.kind === 'experience' && node.id === entry.id);
    expect(drawn).toHaveLength(1);
    expect(map.edges.filter((edge) => edge.to === `experience:${entry.id}`)).toHaveLength(2);
  });

  it('does not draw a place or person node when no such record exists', () => {
    const chapter = createChapter({ name: 'Travel', start_date: '2024-01-01' }, context);
    const place = createPlace({ name: 'Kyoto', region: 'Japan' }, context);
    const map = buildLifeMap({ ...emptyInput(), chapters: [chapter], places: [place] });
    const kinds = new Set(map.nodes.map((node) => node.kind));
    expect(kinds.has('place')).toBe(true);
    expect(kinds.has('person')).toBe(false);
    expect(kinds.has('trip')).toBe(false);
  });

  it('links a trip to its places only through recorded membership', () => {
    const place = createPlace({ name: 'Kyoto' }, context);
    const trip = createTrip({ name: 'Japan 2025', start_date: '2025-04-01', place_ids: [place.id] }, context);
    const map = buildLifeMap({ ...emptyInput(), places: [place], trips: [trip] });
    const membership = map.edges.find((edge) => edge.kind === 'link' && edge.label.includes('Japan 2025'));
    expect(membership).toBeDefined();
    expect(membership!.label).toMatch(/Place visited on Japan 2025/);
  });

  it('draws approved links and keeps suggestions out of the drawing', () => {
    const a = entryOn('2026-01-01');
    const b = entryOn('2026-01-02');
    const approved = createMemoryLink(
      { from_kind: 'entry', from_id: a.id, to_kind: 'entry', to_id: b.id, origin: 'user', role: 'follows on from' },
      context
    );
    const suggested = createMemoryLink(
      { from_kind: 'entry', from_id: a.id, to_kind: 'entry', to_id: b.id, origin: 'suggested', role: 'looks related to' },
      context
    );
    const map = buildLifeMap({ ...emptyInput(), entries: [a, b], links: [approved, suggested] });
    expect(map.edges.filter((edge) => edge.kind === 'link')).toHaveLength(1);
    expect(map.approvedLinks).toHaveLength(1);
    expect(map.suggestedLinks).toHaveLength(1);
    expect(map.counts.suggestedLinks).toBe(1);
  });

  it('ignores tombstoned records entirely', () => {
    const chapter = createChapter({ name: 'Hidden', start_date: '2024-01-01' }, context);
    const deletedChapter = { ...chapter, deleted_at: '2026-01-01T00:00:00.000Z' };
    const entry = entryOn('2024-02-01', { links: { chapter_ids: [chapter.id], path_ids: [] } });
    const map = buildLifeMap({ ...emptyInput(), chapters: [deletedChapter], entries: [entry] });
    expect(map.nodes.some((node) => node.kind === 'chapter')).toBe(false);
    // The experience survives and is honestly shown as unfiled.
    expect(map.nodes.find((node) => node.id === entry.id)?.chapterId).toBeNull();
  });

  it('joins a path to the chapter of the experience it is connected to', () => {
    const chapter = createChapter({ name: 'Learning guitar', start_date: '2024-01-01' }, context);
    const entry = entryOn('2024-02-01', { links: { chapter_ids: [chapter.id], path_ids: [] } });
    const path = createPath({ title: 'Learn guitar', start_date: '2024-01-05' }, context);
    const link = createMemoryLink(
      { from_kind: 'entry', from_id: entry.id, to_kind: 'path', to_id: path.id, origin: 'user', role: 'part of' },
      context
    );
    const map = buildLifeMap({ ...emptyInput(), chapters: [chapter], entries: [entry], paths: [path], links: [link] });
    const pathNode = map.nodes.find((node) => node.kind === 'path')!;
    expect(pathNode.chapterId).toBe(chapter.id);
    expect(pathNode.label).toBe('Learn guitar');
  });
});

describe('labels and text equivalents', () => {
  it('trims long labels at a word boundary', () => {
    const label = mapLabel('A very long experience title that would run across the whole map and then some more words');
    expect(label.length).toBeLessThanOrEqual(34);
    expect(label.endsWith('…')).toBe(true);
    expect(label).not.toContain('  ');
  });

  it('gives every node a non-empty description', () => {
    const chapter = createChapter({ name: 'Chapter' }, context);
    const entry = entryOn('2026-01-01', { body: 'Body text', links: { chapter_ids: [chapter.id], path_ids: [] } });
    const map = buildLifeMap({ ...emptyInput(), chapters: [chapter], entries: [entry] });
    for (const node of map.nodes) {
      expect(node.description.trim().length).toBeGreaterThan(0);
      expect(node.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('marks uncertain and captured dates rather than presenting them as exact', () => {
    const entry = createEntry(
      { body: 'A vague memory', occurred_at: '2024-05-15T12:00:00.000Z', occurred_precision: 'month', occurred_source: 'text' },
      context
    );
    const map = buildLifeMap({ ...emptyInput(), entries: [entry] });
    const node = map.nodes[0]!;
    expect(node.uncertain).toBe(true);
    expect(node.description).toMatch(/approximate|read from your words/);
  });
});

describe('interaction helpers', () => {
  it('hits the nearest node within a generous tolerance', () => {
    const map = buildLifeMap({ ...emptyInput(), entries: [entryOn('2026-01-01')] });
    const node = map.nodes[0]!;
    // 16 units away: outside the drawn radius, inside a finger's reach.
    expect(hitTest(map.nodes, node.x + 16, node.y)?.key).toBe(node.key);
    expect(hitTest(map.nodes, node.x + 400, node.y)).toBeNull();
  });

  it('filters by chapter without losing the chapter node itself', () => {
    const chapter = createChapter({ name: 'Era', start_date: '2024-01-01' }, context);
    const inside = entryOn('2024-02-01', { links: { chapter_ids: [chapter.id], path_ids: [] } });
    const outside = entryOn('2025-02-01');
    const map = buildLifeMap({ ...emptyInput(), chapters: [chapter], entries: [inside, outside] });
    const focus = map.nodes.filter((node) => nodeMatchesChapter(node, chapter.id));
    expect(focus.some((node) => node.id === chapter.id)).toBe(true);
    expect(focus.some((node) => node.id === inside.id)).toBe(true);
    expect(focus.some((node) => node.id === outside.id)).toBe(false);
  });

  it('searches labels and descriptions case-insensitively', () => {
    const place = createPlace({ name: 'Kyoto', region: 'Japan' }, context);
    const map = buildLifeMap({ ...emptyInput(), places: [place] });
    expect(filterNodes(map.nodes, 'kyo')).toHaveLength(1);
    expect(filterNodes(map.nodes, 'japan')).toHaveLength(1);
    expect(filterNodes(map.nodes, 'kyoto', )).toHaveLength(1);
    expect(filterNodes(map.nodes, 'nothing')).toHaveLength(0);
  });

  it('fits bounds into a viewport without exceeding the max scale', () => {
    const transform = fitTransform({ x: -100, y: -100, width: 200, height: 200 }, { width: 400, height: 400 }, 1.6);
    expect(transform.scale).toBeCloseTo(1.6, 5);
    const wide = fitTransform({ x: -1000, y: -500, width: 2000, height: 1000 }, { width: 400, height: 400 });
    expect(wide.scale).toBeCloseTo(0.2, 5);
  });

  it('is deterministic: the same records produce the same everywhere', () => {
    const chapter = createChapter({ name: 'Era', start_date: '2024-01-01' }, context);
    const place = createPlace({ name: 'Kyoto' }, context);
    const entry = entryOn('2024-02-01', { links: { chapter_ids: [chapter.id], path_ids: [] } });
    const trip = createTrip({ name: 'Japan', place_ids: [place.id], start_date: '2024-02-01' }, context);
    const collection = createCollection({ name: 'Best days', entry_ids: [entry.id] }, context);
    const input = { ...emptyInput(), chapters: [chapter], entries: [entry], places: [place], trips: [trip], collections: [collection] };
    const first = buildLifeMap(input);
    const second = buildLifeMap(input);
    expect(second.nodes.map((node) => [node.key, node.x, node.y])).toEqual(first.nodes.map((node) => [node.key, node.x, node.y]));
  });
});

describe('suggestions never become facts on their own', () => {
  it('proposes a place mentioned in an entry and a trip, as a suggestion only', () => {
    const place = createPlace({ name: 'Kyoto' }, context);
    const trip = createTrip({ name: 'Japan', place_ids: [place.id], start_date: '2025-04-01' }, context);
    const entry = entryOn('2025-04-03', { title: 'Walking in Kyoto', body: 'Went to the bamboo grove in Kyoto today.' });
    const suggestions = suggestMemoryLinks({
      entries: [entry],
      chapters: [],
      paths: [],
      places: [place],
      people: [],
      trips: [trip],
      collections: [],
      links: [],
      timezone: TZ
    });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) expect(suggestion.status).toBe('suggested');
    expect(suggestions[0]!.origin).toBe('suggested');
    expect(suggestions[0]!.rationale).toMatch(/Kyoto/);
  });

  it('never re-proposes a pair the user already decided on', () => {
    const place = createPlace({ name: 'Kyoto' }, context);
    const trip = createTrip({ name: 'Japan', place_ids: [place.id], start_date: '2025-04-01' }, context);
    const entry = entryOn('2025-04-03', { body: 'Kyoto again.' });
    const rejected = createMemoryLink(
      { from_kind: 'entry', from_id: entry.id, to_kind: 'trip', to_id: trip.id, status: 'rejected', origin: 'suggested' },
      context
    );
    const suggestions = suggestMemoryLinks({
      entries: [entry],
      chapters: [],
      paths: [],
      places: [place],
      people: [],
      trips: [trip],
      collections: [],
      links: [rejected],
      timezone: TZ
    });
    expect(suggestions).toEqual([]);
  });

  it('suggests an experience dated inside a chapter but not filed in it', () => {
    const chapter = createChapter({ name: 'College', start_date: '2023-01-01', end_date: '2025-12-31' }, context);
    const entry = entryOn('2024-05-01');
    const suggestions = suggestMemoryLinks({
      entries: [entry],
      chapters: [chapter],
      paths: [],
      places: [],
      people: [],
      trips: [],
      collections: [],
      links: [],
      timezone: TZ
    });
    expect(suggestions.some((suggestion) => suggestion.to_kind === 'chapter')).toBe(true);
  });

  it('proposes nothing for an empty archive', () => {
    expect(
      suggestMemoryLinks({
        entries: [],
        chapters: [],
        paths: [],
        places: [],
        people: [],
        trips: [],
        collections: [],
        links: [],
        timezone: TZ
      })
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Label layout — the map is only readable if its labels are
 * ------------------------------------------------------------------ */

describe('label layout', () => {
  it('grows a label outward from the centre so it points at its own node', () => {
    const right = placeLabel({ x: 900, y: 360, r: 8, label: 'Kerala coast' }, 920, 720);
    expect(right.anchor).toBe('start');
    expect(right.x).toBeGreaterThan(900);

    const left = placeLabel({ x: 20, y: 360, r: 8, label: 'Chennai' }, 920, 720);
    expect(left.anchor).toBe('end');
    expect(left.x).toBeLessThan(20);
  });

  it('keeps the self node centred rather than flinging its label sideways', () => {
    const self = placeLabel({ x: 460, y: 360, r: 11, label: 'You' }, 920, 720);
    expect(self.anchor).toBe('middle');
    expect(Math.abs(self.x - 460)).toBeLessThan(1);
  });

  it('never leaves two labels in the same place, however crowded the archive', () => {
    const chapter = createChapter({ name: 'Kerala', start_date: '2025-01-01' }, context);
    const entries = [
      entryOn('2025-02-01', { title: 'Late night', links: { chapter_ids: [chapter.id], path_ids: [] } }),
      entryOn('2025-03-01', { title: 'Coast road', links: { chapter_ids: [chapter.id], path_ids: [] } }),
      entryOn('2025-04-01', { title: 'Marina', links: { chapter_ids: [chapter.id], path_ids: [] } })
    ];
    const map = buildLifeMap({ ...emptyInput(), chapters: [chapter], entries });
    const boxes = [...map.labels.values()].map((label) => label.box);
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const first = boxes[a]!;
        const second = boxes[b]!;
        const overlap =
          first.x < second.x + second.width &&
          second.x < first.x + first.width &&
          first.y < second.y + second.height &&
          second.y < first.y + first.height;
        expect(overlap).toBe(false);
      }
    }
  });

  it('reserves room in the bounds for the labels it actually draws', () => {
    const chapter = createChapter({ name: 'A very long chapter name indeed', start_date: '2025-01-01' }, context);
    const map = buildLifeMap({ ...emptyInput(), chapters: [chapter] }, { width: 920, height: 720 });
    for (const label of map.labels.values()) {
      expect(label.box.x).toBeGreaterThanOrEqual(map.bounds.x);
      expect(label.box.x + label.box.width).toBeLessThanOrEqual(map.bounds.x + map.bounds.width);
      expect(label.box.y).toBeGreaterThanOrEqual(map.bounds.y);
      expect(label.box.y + label.box.height).toBeLessThanOrEqual(map.bounds.y + map.bounds.height);
    }
  });

  it('gives every node a label, including the self node', () => {
    const chapter = createChapter({ name: 'College', start_date: '2023-01-01' }, context);
    const map = buildLifeMap({ ...emptyInput(), chapters: [chapter] });
    expect(map.labels.size).toBe(map.nodes.length);
  });

  it('is deterministic, like the rest of the layout', () => {
    const chapter = createChapter({ name: 'College', start_date: '2023-01-01' }, context);
    const input = { ...emptyInput(), chapters: [chapter] };
    const first = [...resolveLabelCollisions(buildLifeMap(input).nodes, 920, 720).values()];
    const second = [...resolveLabelCollisions(buildLifeMap(input).nodes, 920, 720).values()];
    expect(first).toEqual(second);
  });
});
