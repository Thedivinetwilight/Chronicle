/**
 * The artwork's contract.
 *
 * Illustration is easy to leave unverified, and then it silently drifts: a cover
 * reshuffles between renders, a plate goes missing for one kind, a mark loses its
 * accessible treatment. These tests pin the properties that make the art
 * trustworthy rather than merely present.
 */

import { describe, expect, it } from 'vitest';
import { buildCover, Cover, type CoverKind } from './Cover';
import { Mark, SECTION_MARKS, type MarkName } from './Mark';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const KINDS: CoverKind[] = ['chapter', 'path', 'collection', 'trip'];

describe('chapter, path, collection and trip plates', () => {
  it('gives the same record the same plate every time', () => {
    const first = buildCover('chapter', 'chap_1', 'The Chennai years');
    const second = buildCover('chapter', 'chap_1', 'The Chennai years');
    expect(first).toEqual(second);
  });

  it('gives different records different plates', () => {
    const a = buildCover('chapter', 'chap_1', 'The Chennai years');
    const b = buildCover('chapter', 'chap_2', 'Learning to sail');
    // Not a uniqueness guarantee — a collision would be fine aesthetically — but
    // a shelf where every plate matched would mean the hash is not reaching the
    // motif or wash at all.
    expect(`${a.motif}${a.wash}`).not.toBe(`${b.motif}${b.wash}`);
  });

  it('shifts the plate when the record is renamed', () => {
    const before = buildCover('path', 'path_1', 'Learn to sail');
    const after = buildCover('path', 'path_1', 'Learn to sail properly');
    expect(`${before.motif}${before.rotate}`).not.toBe(`${after.motif}${after.rotate}`);
  });

  it('always produces drawable geometry for every kind', () => {
    for (const kind of KINDS) {
      for (let i = 0; i < 40; i += 1) {
        const spec = buildCover(kind, `id_${i}`, `Record ${i}`);
        expect(spec.paths.length).toBeGreaterThan(0);
        for (const d of spec.paths) {
          expect(d.startsWith('M')).toBe(true);
          // No NaN or Infinity: a malformed path renders as nothing at all.
          expect(d).not.toMatch(/NaN|Infinity|undefined/);
        }
      }
    }
  });

  it('starts every stroke inside the plate', () => {
    /* Only the first absolute point of each path is checked here. Everything
       after a `M` is either an absolute segment or a *relative* one (the ripple
       motif closes its rings with `a…-rw 0`), and a naive scan of every number
       reads those relative offsets as off-canvas coordinates. This asserts the
       invariant that actually matters and can be checked without a path parser:
       each stroke begins on the plate, on its 120×84 grid.
       Whether a whole plate is clipped is verified by eye in the contact sheet
       described in the report, not by arithmetic here. */
    for (const kind of KINDS) {
      for (let i = 0; i < 40; i += 1) {
        const spec = buildCover(kind, `${kind}_${i}`, `Record ${i}`);
        for (const d of spec.paths) {
          const start = d.match(/^M\s*(-?[\d.]+)\s+(-?[\d.]+)/);
          expect(start).not.toBeNull();
          const x = Number(start![1]);
          const y = Number(start![2]);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(120);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(84);
        }
      }
    }
  });

});

describe('the mark set', () => {
  it('every section signpost resolves to a real mark', () => {
    const names = Object.values(SECTION_MARKS) as MarkName[];
    expect(names.length).toBe(9);
    for (const name of names) {
      const html = renderToStaticMarkup(createElement(Mark, { name, title: name }));
      expect(html).toContain('<svg');
      expect(html).toContain('<path');
    }
  });

  it('is decorative by default and labelled only on request', () => {
    const decorative = renderToStaticMarkup(createElement(Mark, { name: 'sprig' }));
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain('<title>');
    expect(decorative).not.toContain('role="img"');

    const labelled = renderToStaticMarkup(createElement(Mark, { name: 'sprig', title: 'A young plant' }));
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('<title>A young plant</title>');
  });

  it('draws every mark on the same 24-unit grid, with no stray geometry', () => {
    for (const name of Object.values(SECTION_MARKS) as MarkName[]) {
      const html = renderToStaticMarkup(createElement(Mark, { name }));
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).not.toMatch(/NaN|Infinity|undefined/);
      // Every mark is authored as absolute moves; a relative `m` from a stray
      // origin would put a mark somewhere unpredictable.
      expect(html).toContain('d="M');
    }
  });

  it('uses one stroke weight and no filters, so the set reads as one hand', () => {
    for (const name of Object.values(SECTION_MARKS) as MarkName[]) {
      const html = renderToStaticMarkup(createElement(Mark, { name }));
      expect(html).toContain('stroke-width="1.5"');
      // Decorative effects are exactly what makes generated art look generated.
      expect(html).not.toContain('<image');
      expect(html).not.toContain('filter');
      expect(html).not.toContain('gradient');
    }
  });
});

describe('cover variety', () => {
  it('makes two records of the same kind visibly different plates', () => {
    // Two chapters that both drew `contour` produced two near-identical balls of
    // yarn: perfectly nested closed loops are a family resemblance, not a
    // variation. Plates must differ in more than their random seed.
    const a = buildCover('chapter', 'ch1', 'The year I moved south');
    const b = buildCover('chapter', 'ch1', 'Learning to sail');

    const sameMotif = a.motif === b.motif;
    const sameWash = a.wash === b.wash;
    expect(sameMotif && sameWash).toBe(false);

    // And when they do share a motif, the drawings themselves must diverge.
    const shape = (paths: string[]) => paths.join(' ').replace(/[0-9.]+/g, '#');
    expect(shape(a.paths)).not.toBe(shape(b.paths));
  });

  it('spreads the motif and wash rather than collapsing onto one', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const spec = buildCover('chapter', `chapter-${i}`, `Chapter number ${i}`);
      seen.add(`${spec.motif}/${spec.wash}`);
    }
    // 6 motifs × 3 washes = 18 combinations; sixty draws must not land on a
    // handful of them, which is how two adjacent cards ended up twins.
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });
});

describe('cover proportion', () => {
  it('keeps the drawing proportion instead of cropping it', async () => {
    // Plates were rendered into boxes of 1.9–3.1:1 around a 1.43:1 viewBox with
    // preserveAspectRatio="slice", so a quarter to half of every drawing was
    // clipped away. jsdom has no layout engine, so this asserts the *contract*
    // in markup: the plate declares its own aspect ratio and never slices.
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');

    for (const kind of ['chapter', 'path', 'collection', 'trip'] as CoverKind[]) {
      const html = renderToStaticMarkup(createElement(Cover, { kind, id: 'x1', name: 'A record' }));
      expect(html).toContain('viewBox="0 0 120 84"');
      // A plate is a filled rectangle: if the box is the shape of the drawing,
      // slice has nothing to crop and never letterboxes the wash into a strip.
      expect(html).toContain('preserveAspectRatio="xMidYMid slice"');
      // 120 / 84, held by the element rather than by the container's luck.
      expect(html).toMatch(/aspect-ratio:120\s*\/\s*84/);
    }
  });
});

describe('art direction consistency', () => {
  it('never gives one destination a glyph its neighbour already uses', async () => {
    // The Life map's mark is a compass and Roadmap's icon was also a compass, so
    // two different destinations in the same sidebar drew the same
    // needle-in-a-circle. The two families are rendered at different weights and
    // share no path data, so markup cannot catch this: the collision is in the
    // *concept*, and the concept is the name. A name may live in one family only
    // while it is in use in navigation.
    const { PRIMARY_NAV, SECONDARY_NAV } = await import('../../features/layout/nav');

    const claimed = new Map<string, string>();
    for (const item of PRIMARY_NAV) {
      if (!item.mark) continue;
      const previous = claimed.get(item.mark);
      expect(previous, `${item.mark} is drawn for both ${previous} and ${item.label}`).toBeUndefined();
      claimed.set(item.mark, item.label);
    }

    for (const item of SECONDARY_NAV) {
      const clash = claimed.get(item.icon);
      expect(clash, `${item.label} reuses ${item.icon}, already drawn for ${clash}`).toBeUndefined();
    }
  });
});
