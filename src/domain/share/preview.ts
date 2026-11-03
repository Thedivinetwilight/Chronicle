/**
 * Share preview — what *would* be visible, computed locally and never sent.
 *
 * Chronicle V0.2 has no accounts, no sync and no server. This module therefore
 * produces a **preview only**: a curated projection of the records the user
 * explicitly selected, with sensitive fields removed. Nothing here publishes,
 * uploads, logs or caches anything, and nothing here can read the archive by
 * default — the caller must pass the exact record ids it wants reviewed.
 *
 * The privacy rules are encoded, not documented:
 *
 * 1. A record that is not `private`-only cannot be included by accident:
 *    `visibility` is carried into the preview and displayed, and every
 *    included record is listed by id so the user can see the exact set.
 * 2. Selections are filtered against the archive: an id that is not a live
 *    record is dropped, so a stale selection cannot expose a deleted record.
 * 3. Sensitive material is removed, not merely hidden: trip confirmation
 *    numbers, booking references, ticket barcodes and exact coordinates never
 *    enter the projection. Photo metadata is not part of the model at all
 *    (attachments are a roadmap item), so there is no EXIF to strip yet —
 *    `omitted` says so honestly.
 * 4. Private experiences can never appear, even if a caller passes their ids
 *    with `includePrivate: false`; the guard is in the function, not the UI.
 */

import type {
  Chapter,
  Collection,
  JournalEntry,
  Path,
  Person,
  Place,
  Trip,
  Visibility
} from '../types';
import { localDateIso } from '../time';

export interface SharePreviewInput {
  entries: JournalEntry[];
  chapters: Chapter[];
  paths: Path[];
  places: Place[];
  people: Person[];
  trips: Trip[];
  collections: Collection[];
  timezone: string;
}

export interface SharePreviewSelection {
  entryIds?: string[];
  chapterIds?: string[];
  pathIds?: string[];
  tripIds?: string[];
  collectionIds?: string[];
  /**
   * Defaults to `false`. Only a deliberate, acknowledged choice may include
   * experiences the user marked private.
   */
  includePrivate?: boolean;
}

export interface SharePreviewItem {
  kind: 'experience' | 'chapter' | 'path' | 'trip' | 'collection';
  id: string;
  title: string;
  /** The body text, exactly as the user wrote it (never rewritten). */
  body?: string;
  date: string | null;
  datePrecision?: string;
  visibility: Visibility;
  /** Tags, minus any that describe sensitive material. */
  tags: string[];
  /** Places, as names only. Never coordinates. */
  placeNames: string[];
  /** People who agreed… meaning: who the user chose to name. */
  peopleNames: string[];
  /** Fields deliberately removed from this item, in plain words. */
  omitted: string[];
}

export interface SharePreviewWarning {
  level: 'info' | 'warning';
  message: string;
}

export interface SharePreview {
  /** Always false in V0.2: nothing has been published. */
  published: false;
  /** Always true: this projection is produced and read on this device only. */
  localOnly: true;
  generatedAt: string;
  title: string;
  audience: Visibility;
  items: SharePreviewItem[];
  warnings: SharePreviewWarning[];
  /** What is deliberately not in the preview, and why. */
  excluded: { kind: string; id: string; reason: string }[];
  /** A plain-text version, for copy/paste study. Never emailed or uploaded. */
  plainText: string;
  counts: { experiences: number; chapters: number; paths: number; trips: number; collections: number };
}

const SENSITIVE_NOTE_PATTERNS: { pattern: RegExp; label: string }[] = [
  // A label such as "Confirmation number" followed by an identifier: both the
  // label and the value go, because "[removed]: ABC12345" would defeat itself.
  {
    pattern: /\b(booking|confirmation|reservation|pnr|ticket|itinerary|reference|ref)\b[^\n.:]{0,20}(?:number|no\.?|#)?\s*[:#-]?\s*[A-Z0-9]{5,}\b/gi,
    label: 'a booking reference'
  },
  // A bare identifier next to a travel word in the same sentence.
  {
    pattern: /\b(?:booking|confirmation|reservation|pnr|ticket|itinerary)\b[^\n]{0,24}\b[A-Z0-9]{6,}\b/gi,
    label: 'a booking reference'
  },
  { pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/g, label: 'a long number that could be a ticket or card' },
  { pattern: /-?\d{1,2}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, label: 'exact coordinates' }
];

/** Remove patterns that look like travel or contact details, and say so. */
export function stripSensitiveText(text: string): { text: string; omitted: string[] } {
  let cleaned = text;
  const omitted: string[] = [];
  for (const { pattern, label } of SENSITIVE_NOTE_PATTERNS) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, '[removed]');
      if (!omitted.includes(`A ${label} was removed from this text.`)) {
        omitted.push(`A ${label} was removed from this text.`);
      }
    }
    pattern.lastIndex = 0;
  }
  return { text: cleaned, omitted };
}

/**
 * Build the preview. The result is a value the UI renders; it is not persisted
 * anywhere and has no side effects.
 */
export function buildSharePreview(input: SharePreviewInput, selection: SharePreviewSelection): SharePreview {
  const includePrivate = selection.includePrivate ?? false;
  const excluded: SharePreview['excluded'] = [];
  const warnings: SharePreviewWarning[] = [];
  const items: SharePreviewItem[] = [];

  const liveEntries = input.entries.filter((entry) => !entry.deleted_at);
  const placeName = (id: string): string | null => input.places.find((place) => place.id === id && !place.deleted_at)?.name ?? null;

  const wants = (ids: string[] | undefined, id: string): boolean => Boolean(ids?.includes(id));

  const admitted = (kind: string, id: string, isPrivate: boolean): boolean => {
    if (isPrivate && !includePrivate) {
      excluded.push({
        kind,
        id,
        reason: 'Marked private. Private experiences never enter a share preview unless you deliberately include them.'
      });
      return false;
    }
    return true;
  };

  /* -- experiences -------------------------------------------------- */
  if (selection.entryIds && selection.entryIds.length > 0) {
    for (const entry of liveEntries) {
      if (!wants(selection.entryIds, entry.id)) continue;
      const isPrivate = entry.private || (entry.visibility ?? 'private') !== 'public';
      const visible = entry.visibility ?? 'private';
      // A selected experience that is private-to-the-user is only admitted on
      // an explicit opt-in; anything else is excluded and explained.
      if (isPrivate && !includePrivate) {
        admitted('experience', entry.id, true);
        continue;
      }
      const body = stripSensitiveText(entry.body);
      const tags = entry.tags.filter((tag) => !/passport|aadhaar|bank|otp|password/i.test(tag));
      const omitted = [...body.omitted];
      if (tags.length !== entry.tags.length) {
        omitted.push('Tag(s) that look like identity or banking details were removed.');
      }
      items.push({
        kind: 'experience',
        id: entry.id,
        title: entry.title.trim() || firstLine(entry.body) || 'Untitled experience',
        body: body.text,
        date: entry.occurred_at ? localDateIso(entry.occurred_at, input.timezone) : null,
        ...(entry.occurred_precision !== 'exact' ? { datePrecision: entry.occurred_precision } : {}),
        visibility: visible,
        tags,
        placeNames: [],
        peopleNames: [],
        omitted
      });
    }
  }

  /* -- chapters (as headings, never as a dump of their experiences) --- */
  if (selection.chapterIds && selection.chapterIds.length > 0) {
    for (const chapter of input.chapters) {
      if (chapter.deleted_at || !wants(selection.chapterIds, chapter.id)) continue;
      const visible = chapter.visibility ?? 'private';
      if (chapter.visibility === 'private' && !includePrivate) {
        excluded.push({
          kind: 'chapter',
          id: chapter.id,
          reason: 'This chapter is private to you, so its title is not in the preview.'
        });
        continue;
      }
      items.push({
        kind: 'chapter',
        id: chapter.id,
        title: chapter.name,
        ...(chapter.description ? { body: stripSensitiveText(chapter.description).text } : {}),
        date: chapter.start_date ?? null,
        datePrecision: chapter.date_precision,
        visibility: visible,
        tags: [],
        placeNames: [],
        peopleNames: [],
        omitted: []
      });
    }
  }

  /* -- trips: the most sensitive record kind ------------------------- */
  if (selection.tripIds && selection.tripIds.length > 0) {
    for (const trip of input.trips) {
      if (trip.deleted_at || !wants(selection.tripIds, trip.id)) continue;
      const visible = trip.visibility ?? 'private';
      if (trip.visibility === 'private' && !includePrivate) {
        excluded.push({ kind: 'trip', id: trip.id, reason: 'This trip is private, so it is not in the preview.' });
        continue;
      }
      const omitted: string[] = [
        'Booking references, confirmation numbers and ticket details are never included in a share preview.'
      ];
      if (trip.date_precision === 'unknown') {
        warnings.push({
          level: 'info',
          message: `${trip.name} has no known dates, so the preview will not claim any.`
        });
      }
      items.push({
        kind: 'trip',
        id: trip.id,
        title: trip.name,
        ...(trip.description ? { body: stripSensitiveText(trip.description).text } : {}),
        date: trip.start_date ?? null,
        datePrecision: trip.date_precision,
        visibility: visible,
        tags: [],
        placeNames: trip.place_ids.map((id) => placeName(id)).filter((name): name is string => Boolean(name)),
        peopleNames: [],
        omitted
      });
    }
  }

  /* -- paths --------------------------------------------------------- */
  if (selection.pathIds && selection.pathIds.length > 0) {
    for (const path of input.paths) {
      if (path.deleted_at || !wants(selection.pathIds, path.id)) continue;
      const visible = path.visibility ?? 'private';
      if (path.visibility === 'private' && !includePrivate) {
        excluded.push({ kind: 'path', id: path.id, reason: 'This path is private, so it is not in the preview.' });
        continue;
      }
      items.push({
        kind: 'path',
        id: path.id,
        title: path.title,
        ...(path.description ? { body: stripSensitiveText(path.description).text } : {}),
        date: path.start_date ?? null,
        visibility: visible,
        tags: path.tags,
        placeNames: [],
        peopleNames: [],
        omitted: []
      });
    }
  }

  /* -- collections: the collection itself, not its members ----------- */
  if (selection.collectionIds && selection.collectionIds.length > 0) {
    for (const collection of input.collections) {
      if (collection.deleted_at || !wants(selection.collectionIds, collection.id)) continue;
      const visible = collection.visibility ?? 'private';
      if (collection.visibility === 'private' && !includePrivate) {
        excluded.push({
          kind: 'collection',
          id: collection.id,
          reason: 'This collection is private, so it is not in the preview.'
        });
        continue;
      }
      items.push({
        kind: 'collection',
        id: collection.id,
        title: collection.name,
        ...(collection.description ? { body: stripSensitiveText(collection.description).text } : {}),
        date: null,
        visibility: visible,
        tags: [],
        placeNames: [],
        peopleNames: [],
        omitted: ['A collection preview lists the collection, not every experience inside it.']
      });
    }
  }

  /* -- audience & warnings ------------------------------------------ */
  // The audience is the *narrowest* visibility among the selected records: a
  // preview cannot be broader than its most protected item.
  const audiences = new Set(items.map((item) => item.visibility));
  const audience: Visibility = audiences.size === 0 || audiences.has('private')
    ? 'private'
    : audiences.has('circles')
      ? 'circles'
      : 'public';

  if (items.length > 0) {
    warnings.push({
      level: 'warning',
      message:
        'Nothing has been published. Chronicle stores no accounts and has no server, so this preview exists only on this device.'
    });
  }

  const counts = {
    experiences: items.filter((item) => item.kind === 'experience').length,
    chapters: items.filter((item) => item.kind === 'chapter').length,
    paths: items.filter((item) => item.kind === 'path').length,
    trips: items.filter((item) => item.kind === 'trip').length,
    collections: items.filter((item) => item.kind === 'collection').length
  };

  return {
    published: false,
    localOnly: true,
    generatedAt: new Date().toISOString(),
    title: titleFor(items),
    audience,
    items,
    warnings,
    excluded,
    plainText: renderPlainText(items),
    counts
  };
}

function titleFor(items: SharePreviewItem[]): string {
  if (items.length === 0) return 'Nothing selected yet';
  if (items.length === 1) return items[0]!.title;
  return `${items.length} memories`;
}

function renderPlainText(items: SharePreviewItem[]): string {
  if (items.length === 0) return 'Nothing selected yet.';
  const lines: string[] = [];
  for (const item of items) {
    lines.push(item.title);
    if (item.date) lines.push(`  ${item.date}${item.datePrecision ? ` (${item.datePrecision})` : ''}`);
    if (item.placeNames.length > 0) lines.push(`  ${item.placeNames.join(', ')}`);
    if (item.body) lines.push(`  ${item.body.replace(/\s+/g, ' ').slice(0, 280)}`);
    if (item.tags.length > 0) lines.push(`  #${item.tags.join(' #')}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function firstLine(body: string): string {
  return body.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
}

/** Human label for the audience line under the preview. */
export function audienceLabel(audience: Visibility): string {
  if (audience === 'public') return 'Anyone (not implemented — nothing can be published in this build)';
  if (audience === 'circles') return 'Selected people (not implemented — no accounts exist yet)';
  return 'Only you';
}
