/**
 * The map's glyph classes must be *drawn*, not merely named.
 *
 * A whole family of faults hid here, because they were invisible in dark mode:
 * `.lifemap__ring`, `.lifemap__shape-detail` and `.lifemap__shape-detail` on the
 * path/person/trip/experience glyphs had no CSS rule at all. SVG's default
 * `fill: black` then painted solid black shapes — a black disc over the warm
 * canvas in light mode, and black dots where the experience discs should be.
 * Nothing failed; the dark theme simply hid it.
 *
 * Two kinds of check, because the fault had two shapes:
 *  1. every `lifemap__*` class used in the canvas has a rule in the stylesheet;
 *  2. every node kind's glyph names a fill token (class) rather than relying on
 *     an SVG default.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const canvas = read('./LifeMapCanvas.tsx');
const css = read('../../styles/global.css');

describe('map glyph styling', () => {
  it('gives every map class used in the canvas a rule in the stylesheet', () => {
    const used = new Set<string>();
    for (const match of canvas.matchAll(/className="([^"]+)"/g)) {
      for (const name of match[1]!.split(/\s+/)) {
        if (name.startsWith('lifemap__')) used.add(name);
      }
    }
    // Also catch `className: '...'` inside object literals (the `common` spread).
    for (const match of canvas.matchAll(/className: '([^']+)'/g)) {
      for (const name of match[1]!.split(/\s+/)) {
        if (name.startsWith('lifemap__')) used.add(name);
      }
    }

    expect(used.size).toBeGreaterThan(5);
    const unstyled = [...used].filter((name) => !css.includes(`.${name}`));
    expect(unstyled, `these map classes have no CSS rule: ${unstyled.join(', ')}`).toEqual([]);
  });

  it('gives every SVG-drawing class in the map an explicit fill or stroke', () => {
    // The check above catches a class with no rule. This one catches a rule that
    // styles the box but forgets the paint, which is the same defect one step
    // later: `.lifemap__self` is a bare container and is allowed, but anything
    // drawn must say what colour it is.
    // Only classes on SVG drawing elements matter here. `lifemap__controls` is
    // an HTML button stack and takes no paint; containers are groups whose
    // children carry their own paint.
    const containers = new Set(['lifemap__self', 'lifemap__shape-wrap', 'lifemap__canvas']);
    const used = new Set<string>();
    for (const match of canvas.matchAll(/<(circle|path|rect|line|polyline|text)\b[^>]*className="([^"]+)"/g)) {
      for (const name of match[2]!.split(/\s+/)) {
        if (name.startsWith('lifemap__') && !containers.has(name)) used.add(name);
      }
    }
    // Glyph classes reach their circles through the `common` spread.
    for (const match of canvas.matchAll(/className: '([^']+)'/g)) used.add(match[1]!);
    used.delete('lifemap__shape');
    for (const name of used) {
      // Find the *base* rule — a selector that opens at the start of a line —
      // not a modifier such as `.lifemap__node.is-active .lifemap__x`.
      const start = css.search(new RegExp(`^\\.${name}\\s*\\{`, 'm'));
      expect(start, `.${name} has no base rule`).toBeGreaterThan(-1);
      const rule = css.slice(start, css.indexOf('}', start));
      expect(rule, `.${name} declares no fill or stroke`).toMatch(/(fill|stroke):/);
    }
  });

  it('gives every node kind a fill token instead of an SVG default', () => {
    // Each glyph branch must name a `lifemap__shape--<kind>` class, which is
    // where the fill and stroke come from. A bare `<circle>` renders black.
    for (const kind of ['chapter', 'experience', 'path', 'place', 'person', 'trip', 'collection']) {
      expect(css, `${kind} has no fill rule`).toContain(`.lifemap__shape--${kind}`);
    }
    // And the plain-circle fallback (experience) must actually carry it.
    const fallback = canvas.slice(canvas.indexOf('default:'));
    expect(fallback).toContain('lifemap__shape--experience');
  });
});
