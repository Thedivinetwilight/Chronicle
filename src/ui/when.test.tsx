/**
 * A record that does not know when it happened still carries a real timestamp:
 * Chronicle stores the moment of writing so the archive has an order. Rendering
 * that timestamp next to the phrase "date unknown" produced rows that read
 * "26 Sep 2026 · date unknown" on Today, in the Journal and in Chapters.
 *
 * These tests pin the rule at the component boundary rather than in each page,
 * because the contradiction had already been re-introduced in four places.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WhenExactly, WhenItHappened } from './format';

const AT = '2026-09-26T09:30:00.000Z';
const TZ = 'Asia/Kolkata' as const;

describe('WhenItHappened', () => {
  it('prints a time for a dated record', () => {
    const html = renderToStaticMarkup(<WhenItHappened at={AT} precision="day" timezone={TZ} />);
    expect(html).not.toMatch(/date not recorded/i);
    expect(html).toMatch(/<time/);
  });

  it('replaces the timestamp for an unknown date instead of contradicting it', () => {
    const html = renderToStaticMarkup(<WhenItHappened at={AT} precision="unknown" timezone={TZ} />);
    expect(html).toMatch(/date not recorded/i);
    expect(html).not.toMatch(/<time/);
  });
});

describe('WhenExactly', () => {
  it('prints the full timestamp for a dated record', () => {
    const html = renderToStaticMarkup(<WhenExactly at={AT} precision="exact" timezone={TZ} />);
    expect(html).toMatch(/<time/);
    expect(html).toMatch(/2026/);
  });

  it('never prints a timestamp for an unknown date', () => {
    const html = renderToStaticMarkup(<WhenExactly at={AT} precision="unknown" timezone={TZ} />);
    expect(html).not.toMatch(/<time/);
    expect(html).not.toMatch(/2026/);
  });

  it('keeps the caller able to name the reason', () => {
    const html = renderToStaticMarkup(
      <WhenExactly at={AT} precision="unknown" timezone={TZ} unknownLabel="No date given" />
    );
    expect(html).toContain('No date given');
  });
});

describe('unknown dates across the app', () => {
  it('no page can print a raw ISO date next to a record', async () => {
    /* Guards the specific regression that shipped: a `.slice(0, 10)` on
       `occurred_at` printed "2026-09-26" for a record whose precision was
       `unknown`. Any future list that formats a date by slicing the instant
       will reintroduce it, so this reads the source, not the output. */
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    const offenders = walk('src/features')
      .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
      .filter((file) => /occurred_at\.slice\(\s*0\s*,\s*10\s*\)/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
