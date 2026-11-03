/**
 * Share preview tests — the privacy boundary, expressed as assertions.
 *
 * The preview is the only place in V0.2 that could conceivably leak archive
 * content, so it is tested as a security boundary rather than a formatting
 * helper: private records cannot enter it by accident, sensitive travel
 * details are removed rather than hidden, and nothing claims to be published.
 */

import { describe, expect, it } from 'vitest';
import { audienceLabel, buildSharePreview, stripSensitiveText } from './preview';
import { createChapter, createCollection, createEntry, createPath, createPerson, createPlace, createTrip } from '../factories';

const TZ = 'UTC';
const context = { timezone: TZ, now: () => '2026-03-01T09:00:00.000Z' };

function archive(overrides: Partial<Parameters<typeof buildSharePreview>[0]> = {}) {
  return {
    entries: [],
    chapters: [],
    paths: [],
    places: [],
    people: [],
    trips: [],
    collections: [],
    timezone: TZ,
    ...overrides
  };
}

describe('private by default', () => {
  it('excludes a private experience unless the user deliberately includes private records', () => {
    const entry = createEntry({ title: 'A hard day', body: 'Private thoughts.' }, context);
    const preview = buildSharePreview(archive({ entries: [entry] }), { entryIds: [entry.id] });
    expect(preview.items).toEqual([]);
    expect(preview.excluded[0]!.id).toBe(entry.id);
    expect(preview.excluded[0]!.reason).toMatch(/private/i);
    expect(preview.plainText).not.toContain('Private thoughts');
  });

  it('includes a private experience only on an explicit opt-in, and still says it is local-only', () => {
    const entry = createEntry({ title: 'A hard day', body: 'Private thoughts.', visibility: 'public' }, context);
    const preview = buildSharePreview(archive({ entries: [entry] }), { entryIds: [entry.id], includePrivate: true });
    expect(preview.items).toHaveLength(1);
    expect(preview.published).toBe(false);
    expect(preview.localOnly).toBe(true);
  });

  it('never publishes anything and says so in the preview', () => {
    const entry = createEntry({ title: 'A day', body: 'A day out.', visibility: 'public' }, context);
    const preview = buildSharePreview(archive({ entries: [entry] }), { entryIds: [entry.id] });
    expect(preview.published).toBe(false);
    expect(preview.warnings.some((warning) => /nothing has been published/i.test(warning.message))).toBe(true);
  });

  it('describes every audience honestly as unimplemented', () => {
    expect(audienceLabel('public')).toMatch(/not implemented/i);
    expect(audienceLabel('circles')).toMatch(/not implemented/i);
    expect(audienceLabel('private')).toBe('Only you');
  });
});

describe('sensitive travel details', () => {
  it('never includes a trip confirmation number', () => {
    const trip = createTrip(
      {
        name: 'Japan 2025',
        start_date: '2025-04-01',
        sensitive_notes: 'Booking confirmation ABC123456, PNR X9Q4RT. Hotel ref: 88213.',
        visibility: 'circles'
      },
      context
    );
    const preview = buildSharePreview(archive({ trips: [trip] }), { tripIds: [trip.id] });
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain('ABC123456');
    expect(serialized).not.toContain('X9Q4RT');
    expect(serialized).not.toContain('88213');
    expect(preview.items[0]!.omitted.join(' ')).toMatch(/booking references/i);
  });

  it('strips booking-looking text out of an experience body and records the omission', () => {
    const entry = createEntry(
      {
        title: 'Train to Kyoto',
        body: 'Took the shinkansen. Confirmation number: ABC12345. Sat by the window.',
        visibility: 'public'
      },
      context
    );
    const preview = buildSharePreview(archive({ entries: [entry] }), { entryIds: [entry.id] });
    const item = preview.items[0]!;
    expect(item.body).not.toContain('ABC12345');
    expect(item.body).toContain('Sat by the window');
    expect(item.omitted.length).toBeGreaterThan(0);
  });

  it('strips exact coordinates', () => {
    const result = stripSensitiveText('Met at 35.011636, 135.768029 after the walk.');
    expect(result.text).not.toContain('35.011636');
    expect(result.omitted.join(' ')).toMatch(/coordinates/i);
  });

  it('lists places by name only — never coordinates', () => {
    const place = createPlace({ name: 'Kyoto', region: 'Japan', visibility: 'public' }, context);
    const trip = createTrip({ name: 'Japan', place_ids: [place.id], visibility: 'public' }, context);
    const preview = buildSharePreview(archive({ places: [place], trips: [trip] }), { tripIds: [trip.id] });
    expect(preview.items[0]!.placeNames).toEqual(['Kyoto']);
    // Item content carries names and dates only — no coordinate pairs. The
    // envelope's own timestamps are not archive content and are excluded here.
    expect(JSON.stringify(preview.items)).not.toMatch(/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/);
  });

  it('withholds the name of a private place even when the trip is shareable', () => {
    // A place name is private information in its own right: a home town, a
    // clinic, a street. A public trip must not carry a private place into the
    // preview, and the withholding must be visible to the user.
    const privatePlace = createPlace({ name: 'The clinic on Mount Road' }, context);
    const publicPlace = createPlace({ name: 'Kyoto', visibility: 'public' }, context);
    const trip = createTrip(
      { name: 'Japan', place_ids: [privatePlace.id, publicPlace.id], visibility: 'public' },
      context
    );

    const preview = buildSharePreview(archive({ places: [privatePlace, publicPlace], trips: [trip] }), {
      tripIds: [trip.id]
    });
    const item = preview.items[0]!;
    expect(item.placeNames).toEqual(['Kyoto']);
    expect(JSON.stringify(preview.items)).not.toContain('Mount Road');
    expect(item.omitted.join(' ')).toMatch(/place you keep private/i);
  });

  it('removes identity- and bank-looking tags', () => {
    const entry = createEntry(
      { title: 'Docs', body: 'Submitted forms.', tags: ['travel', 'passport', 'bank'], visibility: 'public' },
      context
    );
    const preview = buildSharePreview(archive({ entries: [entry] }), { entryIds: [entry.id] });
    expect(preview.items[0]!.tags).toEqual(['travel']);
    expect(preview.items[0]!.omitted.join(' ')).toMatch(/identity or banking/i);
  });
});

describe('selection is a curated projection', () => {
  it('ignores ids for records that are not live', () => {
    const entry = createEntry({ title: 'Gone', body: 'Old', visibility: 'public' }, context);
    const deleted = { ...entry, deleted_at: '2026-02-01T00:00:00.000Z' };
    const preview = buildSharePreview(archive({ entries: [deleted] }), { entryIds: [entry.id] });
    expect(preview.items).toEqual([]);
  });

  it('never includes an unselected experience, even in the same chapter', () => {
    const chapter = createChapter({ name: 'Era', start_date: '2024-01-01', visibility: 'public' }, context);
    const selected = createEntry({ title: 'Selected', body: 'Included.', visibility: 'public' }, context);
    const other = createEntry({ title: 'Not selected', body: 'Secret.', visibility: 'public' }, context);
    const preview = buildSharePreview(archive({ chapters: [chapter], entries: [selected, other] }), {
      entryIds: [selected.id],
      chapterIds: [chapter.id]
    });
    expect(preview.items.map((item) => item.title)).toEqual(['Selected', 'Era']);
    expect(preview.plainText).not.toContain('Secret.');
  });

  it('describes a collection as a collection, not as its members', () => {
    const entry = createEntry({ title: 'Inside', body: 'Member text.', visibility: 'public' }, context);
    const collection = createCollection({ name: 'Best days', entry_ids: [entry.id], visibility: 'public' }, context);
    const preview = buildSharePreview(archive({ entries: [entry], collections: [collection] }), {
      collectionIds: [collection.id]
    });
    expect(preview.items).toHaveLength(1);
    expect(preview.plainText).not.toContain('Member text.');
    expect(preview.items[0]!.omitted.join(' ')).toMatch(/not every experience/i);
  });

  it('supports a path and a chapter as first-class preview items', () => {
    const path = createPath({ title: 'Learn guitar', visibility: 'public' }, context);
    const chapter = createChapter({ name: 'Era', start_date: '2024-01-01', visibility: 'circles' }, context);
    const preview = buildSharePreview(archive({ paths: [path], chapters: [chapter] }), {
      pathIds: [path.id],
      chapterIds: [chapter.id]
    });
    expect(preview.counts.paths).toBe(1);
    expect(preview.counts.chapters).toBe(1);
    expect(preview.audience).toBe('circles');
  });

  it('does not claim a date for a trip whose dates are unknown', () => {
    const trip = createTrip({ name: 'Somewhere', visibility: 'public', date_precision: 'unknown' }, context);
    const preview = buildSharePreview(archive({ trips: [trip] }), { tripIds: [trip.id] });
    expect(preview.items[0]!.date).toBeNull();
    expect(preview.warnings.some((warning) => /no known dates/i.test(warning.message))).toBe(true);
  });

  it('produces an empty, honest preview when nothing is selected', () => {
    const preview = buildSharePreview(archive({ entries: [createEntry({ body: 'x' }, context)] }), {});
    expect(preview.items).toEqual([]);
    expect(preview.title).toBe('Nothing selected yet');
    expect(preview.plainText).toBe('Nothing selected yet.');
  });

  it('does not include people the user did not name', () => {
    const alice = createPerson({ name: 'Alice' }, context);
    const entry = createEntry({ title: 'Trip', body: 'Went with Alice.', visibility: 'public' }, context);
    const preview = buildSharePreview(archive({ entries: [entry], people: [alice] }), { entryIds: [entry.id] });
    // Chronicle does not scan text for names: nothing is inferred.
    expect(preview.items[0]!.peopleNames).toEqual([]);
  });
});
