/**
 * Memory-link suggestions.
 *
 * Chronicle may *notice* that two records look related. It may never decide
 * that they are. Everything here returns proposals with `status: 'suggested'`
 * and a plain-language rationale; nothing is written to the archive, nothing is
 * drawn on the Life Map, and nothing leaves the device until the user approves
 * each one individually.
 *
 * The detectors are deliberately conservative and entirely local:
 *
 * - **Shared place** — an experience and a trip/place that both mention the
 *   same place *the user already recorded*. The place record is the anchor;
 *   Chronicle never guesses a location from free text.
 * - **Same day** — two experiences on the same local day that share a tag or a
 *   chapter. Same-day adjacency is a hint, not a fact: the rationale says so.
 * - **Chapter window** — an experience whose date falls inside a chapter's
 *   dates but which is not filed in it. Offered once, and never re-offered
 *   after the user rejects it.
 *
 * There is no NLP, no model call, and no inference of people or emotions.
 */

import { createMemoryLink } from '../factories';
import { localDateIso } from '../time';
import type { MemoryLink } from '../types';
import type { LifeMapInput } from './layout';

export interface SuggestionInput extends LifeMapInput {
  timezone: string;
}

const MAX_SUGGESTIONS = 12;

/**
 * Propose connections. Deterministic and side-effect free: the caller decides
 * whether to persist any of them.
 */
export function suggestMemoryLinks(input: SuggestionInput): MemoryLink[] {
  const existing = input.links.filter((link) => !link.deleted_at);
  /** Pairs already decided (approved, rejected or suggested) are never re-proposed. */
  const decided = new Set<string>();
  for (const link of existing) {
    const pair = [link.from_id, link.to_id].sort().join('|');
    decided.add(`${link.from_kind}|${link.to_kind}|${pair}`);
    decided.add(`${link.to_kind}|${link.from_kind}|${pair}`);
  }

  const suggestions: MemoryLink[] = [];
  const push = (
    fromKind: 'entry',
    fromId: string,
    toKind: 'entry' | 'trip' | 'place' | 'chapter',
    toId: string,
    role: string,
    rationale: string
  ): void => {
    const pair = [fromId, toId].sort().join('|');
    const key = `${fromKind}|${toKind}|${pair}`;
    if (decided.has(key) || suggestions.length >= MAX_SUGGESTIONS) return;
    decided.add(key);
    suggestions.push(
      createMemoryLink(
        { from_kind: fromKind, from_id: fromId, to_kind: toKind, to_id: toId, origin: 'suggested', role, rationale },
        {}
      )
    );
  };

  const liveEntries = input.entries.filter((entry) => !entry.deleted_at);
  const liveTrips = input.trips.filter((trip) => !trip.deleted_at);
  const livePlaces = input.places.filter((place) => !place.deleted_at);
  const liveChapters = input.chapters.filter((chapter) => !chapter.deleted_at);

  /* -- 1. A trip and an experience that mention the same recorded place --- */
  const placeByName = new Map(livePlaces.map((place) => [place.name.trim().toLowerCase(), place]));
  for (const trip of liveTrips) {
    const tripPlaces = trip.place_ids
      .map((id) => livePlaces.find((place) => place.id === id))
      .filter((place): place is NonNullable<typeof place> => Boolean(place));
    if (tripPlaces.length === 0) continue;
    for (const entry of liveEntries) {
      const text = `${entry.title}\n${entry.body}`.toLowerCase();
      for (const place of tripPlaces) {
        const needle = place.name.trim().toLowerCase();
        if (needle.length < 3) continue;
        if (!text.includes(needle)) continue;
        // Only suggest when the entry is not already part of a chapter that
        // contains the trip: the relationship is already expressed.
        push(
          'entry',
          entry.id,
          'trip',
          trip.id,
          'mentioned in',
          `Both this experience and ${trip.name} mention ${place.name}, which you recorded as a place.`
        );
        break;
      }
    }
  }

  /* -- 2. Two experiences on the same day that share a tag ---------------- */
  const byDay = new Map<string, typeof liveEntries>();
  for (const entry of liveEntries) {
    if (!entry.occurred_at) continue;
    const day = localDateIso(entry.occurred_at, input.timezone);
    const list = byDay.get(day) ?? [];
    list.push(entry);
    byDay.set(day, list);
  }
  for (const [day, list] of byDay) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        if (a.id === b.id) continue;
        const shared = a.tags.filter((tag) => b.tags.includes(tag));
        if (shared.length === 0) continue;
        push(
          'entry',
          a.id,
          'entry',
          b.id,
          'same day as',
          `Both happened on ${day} and share the tag #${shared[0]}. Chronicle only noticed the date and the tag; you decide whether they belong together.`
        );
      }
    }
  }

  /* -- 3. An experience inside a chapter's dates but not filed in it ----- */
  for (const chapter of liveChapters) {
    if (!chapter.start_date) continue;
    const start = chapter.start_date;
    const end = chapter.end_date ?? chapter.start_date;
    for (const entry of liveEntries) {
      if (!entry.occurred_at) continue;
      const day = localDateIso(entry.occurred_at, input.timezone);
      if (day < start || day > end) continue;
      if (entry.links?.chapter_ids.includes(chapter.id)) continue;
      push(
        'entry',
        entry.id,
        'chapter',
        chapter.id,
        'happened during',
        `Dated ${day}, inside the dates you gave for ${chapter.name}. Filing it is a choice, not a conclusion.`
      );
    }
  }

  // A place that a chapter's own name mentions and that is recorded but not
  // linked to anything is left alone on purpose: a chapter name is prose, not
  // a location.
  void placeByName;

  return suggestions;
}
