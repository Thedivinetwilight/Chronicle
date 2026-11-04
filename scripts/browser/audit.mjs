/**
 * Route audit — real-browser screenshots and layout checks for every route.
 *
 * Not part of `npm run verify`: it needs `playwright-core` and a Chromium
 * binary on the machine, so it is opt-in tooling rather than a CI gate.
 *
 *   npm install --no-save playwright-core @sparticuz/chromium
 *   npm run preview            # or a dev server on :4173
 *   node scripts/browser/audit.mjs [dark|light] [d|mobile] [routeFilter]
 *
 * Seeding uses realistic entries, chapters, paths, places and a trip — the
 * point is to see the layout with a plausible archive, not a blank state.
 * Screenshots land in /tmp/audit/.
 */
import { chromium } from 'playwright-core';
import sparticuz from '@sparticuz/chromium';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4173';
const exe = await sparticuz.executablePath();
const browser = await chromium.launch({ executablePath: exe, args: sparticuz.args, headless: true });

const ROUTES = [
  ['/', 'today'], ['/map', 'map'], ['/journal', 'journal'], ['/journal/new', 'editor'],
  ['/chapters', 'chapters'], ['/paths', 'paths'], ['/trips', 'trips'], ['/places', 'places'],
  ['/collections', 'collections'], ['/share-preview', 'share'], ['/roadmap', 'roadmap'],
  ['/timeline', 'timeline'], ['/search', 'search'], ['/projects', 'projects'], ['/settings', 'settings']
];

/** Seed a realistic (not fake-looking) archive straight into IndexedDB. */
async function seed(page) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const now = Date.now();
    const iso = (daysAgo, h = 10) => new Date(now - daysAgo * 864e5 + h * 36e5).toISOString();
    const entry = (id, title, body, daysAgo, extra = {}) => ({
      id, title, body, type: 'reflection', occurred_at: iso(daysAgo), occurred_precision: 'day',
      occurred_source: 'user', tags: [], evidence_level: 'concept', evidence: [], related_entry_ids: [],
      private: true, pinned: false, created_at: iso(daysAgo), updated_at: iso(daysAgo), rev: 1,
      links: { chapter_ids: [], path_ids: [] }, visibility: 'private',
      source: { kind: 'manual' }, ...extra
    });
    const base = { created_at: iso(30), updated_at: iso(2), rev: 1, visibility: 'private', source: { kind: 'manual' } };
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('chronicle');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(['entries','chapters','paths','places','people','trips','collections','links'], 'readwrite');
    tx.objectStore('chapters').put({ ...base, id: 'ch1', name: 'The year I moved south', description: 'A slower city, a smaller room, a lot of walking.', start_date: '2025-03-01', end_date: '2026-01-20', date_precision: 'month', accent: 'ink', status: 'open', visibility: 'private' });
    tx.objectStore('chapters').put({ ...base, id: 'ch2', name: 'Learning to sail', description: 'Weekends on the water, badly at first.', start_date: '2026-02-01', end_date: null, date_precision: 'month', accent: 'moss', status: 'open', visibility: 'private' });
    tx.objectStore('paths').put({ ...base, id: 'p1', title: 'Learn to sail properly', description: 'Not just fair-weather afternoons.', start_date: '2026-02-01', desired_date: '2027-06-01', state: 'active', state_note: 'Two lessons in.', tags: ['sea'], visibility: 'private' });
    tx.objectStore('paths').put({ ...base, id: 'p2', title: 'Read more Tamil literature', start_date: null, desired_date: null, state: 'paused', state_note: 'Paused while work is heavy.', tags: [], visibility: 'private' });
    tx.objectStore('places').put({ ...base, id: 'pl1', name: 'Chennai', region: 'Tamil Nadu', kind: 'city', visibility: 'private' });
    tx.objectStore('places').put({ ...base, id: 'pl2', name: 'Kovalam', region: 'Kerala', kind: 'city', visibility: 'private' });
    tx.objectStore('people').put({ ...base, id: 'pe1', name: 'Meera', relationship: 'sister', visibility: 'private' });
    tx.objectStore('trips').put({ ...base, id: 't1', name: 'Kerala coast', description: 'Four days, two towns, one very long bus.', start_date: '2026-01-02', end_date: '2026-01-06', date_precision: 'day', place_ids: ['pl2'], sensitive_notes: 'PNR 4417 2290 331', visibility: 'private' });
    tx.objectStore('collections').put({ ...base, id: 'c1', name: 'Best days of 2026', description: 'Days I would live again.', entry_ids: ['e1','e2'], visibility: 'private' });
    tx.objectStore('entries').put(entry('e1', 'Walked the whole marina at dusk', 'The fishing boats were coming in and the light went orange all at once. Sat on the wall until it was properly dark.', 1, { links: { chapter_ids: ['ch1'], path_ids: [] } }));
    tx.objectStore('entries').put(entry('e2', 'First proper sail without capsizing', 'Tacked twice on the way out. Still slow, but it held.', 3, { links: { chapter_ids: ['ch2'], path_ids: ['p1'] } }));
    tx.objectStore('entries').put(entry('e3', 'Bus to Kovalam, six hours', 'Window seat, mostly asleep. Ate banana chips the whole way like a child.', 6, { links: { chapter_ids: [], path_ids: [] } }));
    tx.objectStore('entries').put(entry('e4', '', 'Somewhere around the monsoon I stopped trying to keep the flat tidy and started liking it more.', 40, { occurred_precision: 'unknown' }));
    tx.objectStore('entries').put(entry('e5', 'Started reading Ponniyin Selvan again', 'Third attempt. This time it is sticking.', 12, { links: { chapter_ids: ['ch1'], path_ids: ['p2'] } }));
    tx.objectStore('entries').put(entry('e6', 'The drive down the coast road', 'Meera drove. I navigated badly and we still got there.', 8, { links: { chapter_ids: ['ch1'], path_ids: [] } }));
    tx.objectStore('links').put({ ...base, id: 'l1', from_kind: 'entry', from_id: 'e2', to_kind: 'place', to_id: 'pl2', status: 'confirmed', origin: 'user', label: 'went to' });
    tx.objectStore('links').put({ ...base, id: 'l2', from_kind: 'entry', from_id: 'e1', to_kind: 'person', to_id: 'pe1', status: 'confirmed', origin: 'user', label: 'with' });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  });
}

const theme = process.argv[2] || 'dark';
const sizes = process.argv[3] === 'mobile' ? [[390, 844, 'm']] : [[1440, 950, 'd']];
const only = process.argv[4];
mkdirSync('/tmp/audit', { recursive: true });

const ctx = await browser.newContext({
  viewport: { width: sizes[0][0], height: sizes[0][1] },
  deviceScaleFactor: 2,
  colorScheme: theme,
  reducedMotion: 'no-preference'
});
const page = await ctx.newPage();
await seed(page);

for (const [route, name] of ROUTES) {
  if (only && !name.includes(only)) continue;
  for (const [w, h, tag] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const out = `/tmp/audit/${theme}-${tag}-${name}.png`;
    await page.screenshot({ path: out, fullPage: false });
    const info = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
      h1: document.querySelector('h1')?.textContent?.slice(0, 50) ?? null
    }));
    console.log(`${theme}/${tag} ${route.padEnd(16)} overflow=${info.overflow} (${info.scrollW}/${info.innerW}) h1="${info.h1}"`);
  }
}
await browser.close();
