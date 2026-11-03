/**
 * Chronicle visual verification harness (development tooling, not part of the
 * app bundle). Launches a real headless Chromium, seeds the on-device store
 * through the raw IndexedDB API, then captures screenshots and runs layout /
 * a11y audits at representative viewports in both themes.
 *
 * Usage:
 *   SHOT_DIR=/home/user/shots/before SUITE=shots node harness.mjs
 *   SUITE=interactions node harness.mjs
 */
let puppeteer; let chromium = null;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('Visual harness needs a browser driver: npm i -D puppeteer-core (and optionally @sparticuz/chromium), or point CHROME_PATH at a Chrome/Chromium binary.');
  process.exit(1);
}
try {
  chromium = (await import('@sparticuz/chromium')).default;
} catch {
  chromium = null;
}

import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const OUT = process.env.SHOT_DIR || '/home/user/shots/before';
const SUITE = process.env.SUITE || 'shots';
mkdirSync(OUT, { recursive: true });

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const day = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const H = 3600000;
const D = 24 * H;

/* ------------------------------------------------------------------ seed -- */

function demoRecords() {
  const projects = [
    {
      id: 'proj-orbital',
      created_at: iso(40 * D),
      updated_at: iso(6 * H),
      rev: 4,
      deleted_at: null,
      name: 'Orbital Telemetry',
      summary: 'A small ground station that listens to weather satellites and turns the noise into pictures.',
      objectives: '- Decode APT from NOAA-19\n- Publish a nightly image\n- Keep the whole rig under 40 W',
      status: 'development',
      stage: 'implemented',
      started_on: day(-40),
      target_date: day(30),
      tags: ['sdr', 'embedded'],
      aliases: ['OT'],
      linked_project_ids: [],
      privacy: 'shareable',
      source: { kind: 'manual' }
    },
    {
      id: 'proj-morning',
      created_at: iso(90 * D),
      updated_at: iso(2 * D),
      rev: 2,
      deleted_at: null,
      name: 'Morning Pages',
      summary: 'Three handwritten pages before the phone. Private by default.',
      status: 'operational',
      stage: 'tested',
      started_on: day(-90),
      target_date: null,
      tags: ['habit'],
      aliases: [],
      linked_project_ids: [],
      privacy: 'private',
      source: { kind: 'manual' }
    }
  ];

  const entries = [
    {
      id: 'entry-apt',
      created_at: iso(5 * H),
      updated_at: iso(5 * H),
      rev: 1,
      deleted_at: null,
      title: 'NOAA-19 pass decoded cleanly at last',
      body:
        'Swapped the LNA to the mast head and the noise floor dropped 6 dB.\n\n' +
        '- First full-frame image with no tearing\n' + '- Sync lock held for the whole 12 minute pass\n\n' +
        'The remaining artefacts are all in the **de modulation** step, not the RF chain.',
      summary: 'Mast-head LNA fixed the tearing; remaining artefacts are in demodulation.',
      type: 'progress',
      occurred_at: iso(5 * H),
      occurred_precision: 'exact',
      occurred_source: 'text',
      project_id: 'proj-orbital',
      tags: ['sdr', 'antenna'],
      evidence_level: 'tested',
      evidence: [
        {
          id: 'ev-1',
          kind: 'measurement',
          location: 'noise-floor-2026-10-16.csv',
          description: '6 dB drop after moving the LNA',
          verification: 'supported',
          created_at: iso(5 * H)
        }
      ],
      related_entry_ids: [],
      milestone_id: null,
      private: false,
      pinned: false,
      source: {
        kind: 'capture',
        original_input:
          'Finally got a clean NOAA-19 pass this evening after moving the LNA to the mast; tearing is gone, next I need to look at the demod step.',
        analyzer: 'local',
        capture_id: 'cap-demo-0001',
        captured_at: iso(5 * H)
      }
    },
    {
      id: 'entry-decision',
      created_at: iso(1 * D + 3 * H),
      updated_at: iso(1 * D + 3 * H),
      rev: 1,
      deleted_at: null,
      title: 'Decision: keep the scheduler dumb',
      body:
        'Considered a queue with retries for pass scheduling. Rejected it.\n\n' +
        'A cron line plus a lock file is easier to reason about and impossible to half-fail.\n' +
        '> The simplest thing that cannot lose a pass wins.',
      summary: 'Cron + lock file instead of a retry queue.',
      type: 'decision',
      occurred_at: iso(1 * D + 3 * H),
      occurred_precision: 'day',
      occurred_source: 'text',
      project_id: 'proj-orbital',
      tags: ['architecture'],
      evidence_level: 'concept',
      evidence: [],
      related_entry_ids: [],
      milestone_id: null,
      private: false,
      pinned: true,
      source: { kind: 'manual' }
    },
    {
      id: 'entry-pages',
      created_at: iso(2 * D),
      updated_at: iso(2 * D),
      rev: 1,
      deleted_at: null,
      title: 'Ninety days of morning pages',
      body: 'The practice is holding. The pages from week one are unrecognisable from this week’s.',
      summary: 'Ninety-day reflection on the writing habit.',
      type: 'reflection',
      occurred_at: iso(2 * D),
      occurred_precision: 'day',
      occurred_source: 'user',
      project_id: 'proj-morning',
      tags: ['habit', 'writing'],
      evidence_level: 'concept',
      evidence: [],
      related_entry_ids: [],
      milestone_id: null,
      private: true,
      pinned: false,
      source: { kind: 'manual' }
    },
    {
      id: 'entry-failure',
      created_at: iso(4 * D),
      updated_at: iso(4 * D),
      rev: 2,
      deleted_at: null,
      title: 'The 3 D-printed bracket snapped again',
      body:
        'Second failure at the same layer line. Printing at 30 % infill with the load across the layers was the mistake.\n' +
        'Reprinted with the load along the layers; watching it now.',
      summary: 'Layer orientation, not infill, was the failure mode.',
      type: 'failure',
      occurred_at: iso(4 * D),
      occurred_precision: 'day',
      occurred_source: 'text',
      project_id: 'proj-orbital',
      tags: ['materials'],
      evidence_level: 'researched',
      evidence: [],
      related_entry_ids: [],
      milestone_id: null,
      private: false,
      pinned: false,
      source: { kind: 'manual' }
    }
  ];

  const tasks = [
    {
      id: 'task-demod',
      created_at: iso(5 * H),
      updated_at: iso(5 * H),
      rev: 1,
      deleted_at: null,
      title: 'Profile the demodulation step',
      description: '',
      project_id: 'proj-orbital',
      status: 'todo',
      priority: 'normal',
      due_on: day(1),
      due_precision: 'day',
      completed_at: null,
      tags: ['sdr'],
      source_entry_id: 'entry-apt',
      source: { kind: 'capture', capture_id: 'cap-demo-0001' }
    },
    {
      id: 'task-cal',
      created_at: iso(3 * D),
      updated_at: iso(3 * D),
      rev: 1,
      deleted_at: null,
      title: 'Calibrate the power meter against the dummy load',
      description: '',
      project_id: 'proj-orbital',
      status: 'doing',
      priority: 'high',
      due_on: day(-1),
      due_precision: 'day',
      completed_at: null,
      tags: [],
      source_entry_id: null,
      source: { kind: 'manual' }
    },
    {
      id: 'task-notebook',
      created_at: iso(2 * D),
      updated_at: iso(2 * D),
      rev: 1,
      deleted_at: null,
      title: 'Buy a second notebook for travel weeks',
      description: '',
      project_id: 'proj-morning',
      status: 'todo',
      priority: 'low',
      due_on: null,
      due_precision: 'unknown',
      completed_at: null,
      tags: [],
      source_entry_id: null,
      source: { kind: 'manual' }
    }
  ];

  const milestones = [
    {
      id: 'ms-first-image',
      created_at: iso(9 * D),
      updated_at: iso(9 * D),
      rev: 1,
      deleted_at: null,
      title: 'First complete satellite image',
      description: 'A whole NOAA-19 frame, start to finish, without manual intervention.',
      date: day(-9),
      date_precision: 'day',
      project_id: 'proj-orbital',
      status: 'achieved',
      verification: 'claimed',
      evidence: [],
      entry_ids: [],
      tags: [],
      source: { kind: 'manual' }
    },
    {
      id: 'ms-nightly',
      created_at: iso(6 * H),
      updated_at: iso(6 * H),
      rev: 1,
      deleted_at: null,
      title: 'Nightly image published automatically',
      description: '',
      date: day(12),
      date_precision: 'day',
      project_id: 'proj-orbital',
      status: 'planned',
      verification: 'claimed',
      evidence: [],
      entry_ids: [],
      tags: [],
      source: { kind: 'manual' }
    }
  ];

  const tokensFor = (title, extra = '') =>
    [...`${title} ${extra}`.toLowerCase().split(/[^a-z0-9]+/)].filter((t) => t.length > 2);

  const searchIndex = [...projects, ...entries, ...tasks, ...milestones].map((record, index) => ({
    id: `${['projects', 'entries', 'tasks', 'milestones'][index < 2 ? 0 : index < 6 ? 1 : index < 9 ? 2 : 3]}:${record.id}`,
    kind: index < 2 ? 'projects' : index < 6 ? 'entries' : index < 9 ? 'tasks' : 'milestones',
    record_id: record.id,
    tokens: tokensFor(record.title, record.summary ?? ''),
    title: record.title ?? record.name,
    project_id: record.project_id ?? null,
    occurred_at: record.occurred_at ?? record.date ? `${(record.occurred_at ?? `${record.date}T12:00:00.000Z`)}` : iso(0),
    updated_at: record.updated_at,
    deleted_at: null
  }));

  const settings = {
    key: 'settings',
    updated_at: iso(0),
    value: {
      schema_version: 1,
      theme: 'light',
      capture_mode: 'quick',
      timezone: 'device',
      reduce_motion: false,
      sidebar_pinned: true,
      ai: {
        enabled: false,
        provider: 'none',
        endpoint: '',
        model: '',
        allow_private: false,
        disclosure_acknowledged_at: null
      },
      onboarded: true,
      app_version: '0.1.0'
    }
  };

  return { projects, entries, tasks, milestones, searchIndex, settings };
}

async function seed(page) {
  const data = demoRecords();
  await page.evaluate(async (payload) => {
    const request = indexedDB.open('chronicle');
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(
      ['projects', 'entries', 'tasks', 'milestones', 'searchIndex', 'meta'],
      'readwrite'
    );
    for (const record of payload.projects) tx.objectStore('projects').put(record);
    for (const record of payload.entries) tx.objectStore('entries').put(record);
    for (const record of payload.tasks) tx.objectStore('tasks').put(record);
    for (const record of payload.milestones) tx.objectStore('milestones').put(record);
    for (const record of payload.searchIndex) tx.objectStore('searchIndex').put(record);
    tx.objectStore('meta').put(payload.settings);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, data);
}

async function setTheme(page, theme) {
  await page.evaluate(async (next) => {
    const request = indexedDB.open('chronicle');
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(['meta'], 'readwrite');
    const store = tx.objectStore('meta');
    const row = await new Promise((resolve) => {
      const get = store.get('settings');
      get.onsuccess = () => resolve(get.result);
    });
    if (row) {
      row.value = { ...row.value, theme: next };
      row.updated_at = new Date().toISOString();
      store.put(row);
    }
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
    db.close();
  }, theme);
}

/* ----------------------------------------------------------------- audit -- */

const AUDIT_FN = `(() => {
  const doc = document.documentElement;
  const overflow = doc.scrollWidth - doc.clientWidth;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const COMPACT = '.tagchip, .row-check, .btn--sm, .badge, .toast .iconbtn';
  const small = [];
  const compact = [];
  document.querySelectorAll('a, button, input, select, textarea, [role="button"], summary').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (el.classList.contains('sr-only') || el.closest('.sr-only')) return;
    if (el.classList.contains('switch') === false && el.matches('.switch input')) return;
    const info = { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 44), h: Math.round(r.height), w: Math.round(r.width), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28) };
    if (!coarse) return;
    if (el.matches(COMPACT)) {
      if (r.height < 31.5) compact.push(info);
    } else if (r.height < 43.5) {
      small.push(info);
    }
  });
  const clipped = [];
  document.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > doc.clientWidth + 1 || r.left < -1)) {
      const style = getComputedStyle(el);
      if (style.position === 'fixed') return;
      clipped.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 44), right: Math.round(r.right), left: Math.round(r.left) });
    }
  });
  return { overflow, small, compact, clipped: clipped.slice(0, 8), coarse };
})()`;

/* ---------------------------------------------------------------- screens -- */

const ROUTES = [
  ['home', '/'],
  ['projects', '/projects'],
  ['project-detail', '/projects/proj-orbital'],
  ['journal', '/journal'],
  ['entry', '/journal/entry-apt'],
  ['timeline', '/timeline'],
  ['search', '/search'],
  ['settings', '/settings']
];

const VIEWPORTS = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phoneSm: { width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { width: 834, height: 1112, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  desktopWide: { width: 1680, height: 1000, deviceScaleFactor: 1, isMobile: false, hasTouch: false }
};

async function waitSettled(page, ms = 420) {
  await page.waitForSelector('.shell', { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function shoot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  return `${OUT}/${name}.png`;
}

async function main() {
  const executablePath = process.env.CHROME_PATH || (chromium ? await chromium.executablePath() : undefined);
  if (!executablePath) {
    console.error('No browser found: set CHROME_PATH or install @sparticuz/chromium.');
    process.exit(1);
  }
  const browser = await puppeteer.launch({
    executablePath,
    args: [...(chromium?.args ?? ['--no-sandbox']), '--force-color-profile=srgb', '--hide-scrollbars'],
    headless: true
  });
  const report = { shots: [], audits: [], interactions: [] };
  const problems = [];

  const page = await browser.newPage();
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 160)}`);
  });

  await page.setViewport(VIEWPORTS.desktop);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await waitSettled(page);
  await seed(page);

  if (SUITE === 'interactions') {
    report.interactions = await runInteractions(page, browser);
  } else {
    const viewNames = process.env.VIEWS ? process.env.VIEWS.split(',') : ['phone', 'desktop'];
    const themes = process.env.THEMES ? process.env.THEMES.split(',') : ['light', 'dark'];
    for (const viewName of viewNames) {
      await page.setViewport(VIEWPORTS[viewName]);
      for (const theme of themes) {
        await setTheme(page, theme);
        for (const [label, route] of ROUTES) {
          await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle0' });
          await waitSettled(page);
          const name = `${viewName}-${theme}-${label}`;
          await shoot(page, name);
          report.shots.push(name);
          const audit = await page.evaluate(AUDIT_FN);
          report.audits.push({ view: viewName, theme, screen: label, ...audit });
        }
        // capture composer + review sheet on the home screen
        await page.goto(BASE, { waitUntil: 'networkidle0' });
        await waitSettled(page);
        await openCapture(page, viewName);
        await new Promise((r) => setTimeout(r, 350));
        await shoot(page, `${viewName}-${theme}-capture-compose`);
        report.shots.push(`${viewName}-${theme}-capture-compose`);
        await page.type('#capture-input', SAMPLE_CAPTURE, { delay: 4 });
        await clickByText(page, 'button.segmented__option', 'Review');
        await clickByText(page, '.dialog__footer button', 'Review');
        await page.waitForFunction(() => document.querySelector('.dialog__body')?.textContent?.includes('kept verbatim'), { timeout: 8000 });
        await new Promise((r) => setTimeout(r, 250));
        await shoot(page, `${viewName}-${theme}-capture-review`);
        report.shots.push(`${viewName}-${theme}-capture-review`);
        await page.keyboard.press('Escape');
      }
    }
  }

  report.problems = [...new Set(problems)];
  for (const check of report.interactions) console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();

  const bad = report.audits.filter((a) => a.overflow > 0 || a.small.length > 0 || a.compact.length > 0 || a.clipped.length > 0);
  console.log(`shots: ${report.shots.length}`);
  console.log(`audit flags: ${bad.length}`);
  for (const item of bad) {
    console.log(
      ` - ${item.view}/${item.theme}/${item.screen} overflow=${item.overflow} small=${item.small.length} compact=${item.compact.length} clipped=${item.clipped.length}`,
      item.small.slice(0, 3),
      item.clipped.slice(0, 2)
    );
  }
  if (report.problems.length) console.log('console/page errors:\n' + report.problems.join('\n'));
  for (const check of report.interactions) console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
}

const SAMPLE_CAPTURE =
  'Spent the afternoon on Orbital Telemetry yesterday: the demod step still drops frames on weak passes, so I need to profile it before Friday. First complete image from the new antenna was a genuine milestone though.';

async function openCapture(page, viewName) {
  if (viewName === 'desktop' || viewName === 'desktopWide') {
    await page.click('.shell__sidebar-capture');
  } else {
    await page.click('.tabbar__capture');
  }
  await page.waitForSelector('#capture-input', { timeout: 8000 });
}

async function clickByText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, txt) => [...document.querySelectorAll(sel)].find((el) => el.textContent.trim() === txt),
    selector,
    text
  );
  const element = handle.asElement();
  if (!element) throw new Error(`no ${selector} with text ${text}`);
  await element.click();
}

/* ------------------------------------------------------- interaction tests -- */

async function runInteractions(page, browser) {
  const checks = [];
  const ok = (name, pass, detail = '') => checks.push({ name, ok: pass, detail });

  // 1. capture -> review -> save -> appears in journal
  await page.setViewport(VIEWPORTS.phone);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await waitSettled(page);
  await openCapture(page, 'phone');
  await page.type('#capture-input', SAMPLE_CAPTURE, { delay: 3 });
  await clickByText(page, 'button.segmented__option', 'Review');
  await clickByText(page, '.dialog__footer button', 'Review');
  await page.waitForFunction(() => document.querySelector('.dialog__body')?.textContent?.includes('kept verbatim'), { timeout: 8000 });
  const reviewShowsEntry = await page.evaluate(() =>
    Boolean([...document.querySelectorAll('.dialog h3')].find((h) => h.textContent.includes('Journal entry')))
  );
  ok('review sheet proposes a journal entry', reviewShowsEntry);
  const reviewShowsTask = await page.evaluate(() =>
    Boolean([...document.querySelectorAll('.dialog h3')].find((h) => h.textContent.includes('Tasks')))
  );
  ok('review sheet proposes tasks', reviewShowsTask);
  await clickByText(page, '.dialog__footer button', 'Save to archive');
  await page.waitForFunction(() => document.querySelector('.dialog__body')?.textContent?.includes('Correct this capture'), { timeout: 8000 });
  const savedPanel = true;
  ok('saved panel with correction box appears', savedPanel);
  await page.keyboard.press('Escape');
  await page.goto(`${BASE}/journal`, { waitUntil: 'networkidle0' });
  await waitSettled(page);
  const journalHasNew = await page.evaluate(() => document.body.textContent.includes('demod step still drops frames') || document.body.textContent.includes('Spent the afternoon on Orbital Telemetry'));
  ok('captured entry appears in journal', journalHasNew);

  // 2. undo via toast on home
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await waitSettled(page);
  await openCapture(page, 'phone');
  await page.type('#capture-input', 'Quick note: the bench PSU fan is rattling again.', { delay: 2 });
  await clickByText(page, '.dialog__footer button', 'Save');
  await page.waitForSelector('.toast', { timeout: 8000 });
  const toastVisible = await page.evaluate(() => Boolean(document.querySelector('.toast')));
  ok('save toast with undo appears', toastVisible);
  await clickByText(page, '.toast button', 'Undo');
  await new Promise((r) => setTimeout(r, 700));
  const undone = await page.evaluate(async () => {
    const request = indexedDB.open('chronicle');
    const db = await new Promise((res) => (request.onsuccess = () => res(request.result)));
    const tx = db.transaction(['entries'], 'readonly');
    const all = await new Promise((res) => {
      const get = tx.objectStore('entries').getAll();
      get.onsuccess = () => res(get.result);
    });
    db.close();
    return !all.some((entry) => entry.title?.includes('bench PSU fan') && !entry.deleted_at);
  });
  ok('undo removes the captured record', undone);

  // 3. keyboard: focus ring visible on first tab stop
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await waitSettled(page);
  await page.keyboard.press('Tab');
  const focusInfo = await page.evaluate(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return { tag: el.tagName, outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle };
  });
  ok('keyboard focus shows an outline', focusInfo.outlineStyle !== 'none' && parseFloat(focusInfo.outlineWidth) >= 2, JSON.stringify(focusInfo));

  // 4. theme switch from settings applies instantly
  await page.setViewport(VIEWPORTS.desktop);
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle0' });
  await waitSettled(page);
  await clickByText(page, 'button.segmented__option', 'Dark');
  await new Promise((r) => setTimeout(r, 300));
  const darkApplied = await page.evaluate(() => document.documentElement.dataset.theme === 'dark');
  ok('settings switches to dark theme', darkApplied);
  await clickByText(page, 'button.segmented__option', 'Light');
  await new Promise((r) => setTimeout(r, 300));

  // 5. search returns seeded hits and marks terms
  await page.goto(`${BASE}/search`, { waitUntil: 'networkidle0' });
  await waitSettled(page);
  await page.type('.input', 'telemetry', { delay: 4 });
  await new Promise((r) => setTimeout(r, 700));
  const searchHits = await page.evaluate(() => document.querySelectorAll('mark.searchmark').length);
  ok('search highlights matches', searchHits > 0, `${searchHits} marks`);

  // 6. safe delete of a project shows impact preview
  await page.goto(`${BASE}/projects/proj-morning`, { waitUntil: 'networkidle0' });
  await waitSettled(page);
  try {
    await page.waitForSelector('button[aria-label="Delete project"]', { timeout: 6000 });
    const box = await page.$eval('button[aria-label="Delete project"]', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const atPoint = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el ? `${el.tagName}.${String(el.className).slice(0, 30)}` : 'none';
      },
      box
    );
    await page.click('button[aria-label="Delete project"]');
    const dialogOpened = await page
      .waitForSelector('.dialog', { timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    await new Promise((r) => setTimeout(r, 900));
    const impact = await page.evaluate(() => document.querySelector('.dialog__body')?.textContent ?? '');
    ok('delete dialog opened', dialogOpened, dialogOpened ? '' : `elementAtPoint=${atPoint}`);
    ok('delete dialog previews impact', /entr|task|milestone/i.test(impact), impact.slice(0, 70));
  } catch (cause) {
    const where = await page.evaluate(() => ({
      path: location.pathname,
      main: document.querySelector('main')?.textContent?.slice(0, 140) ?? ''
    }));
    ok('delete flow reachable', false, `${cause.message.slice(0, 60)} @${where.path} :: ${where.main}`);
  }
  await page.keyboard.press('Escape');

  // 7. offline: cut the network and reload, app still renders from cache/SW
  const client = await page.target().createCDPSession();
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1200));
  const offlineRendered = await page.evaluate(() => Boolean(document.querySelector('.shell'))).catch(() => false);
  ok('app shell renders with network cut', offlineRendered);
  await client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });

  return checks;
}

main().catch((error) => {
  console.error('HARNESS FAILURE', error.message?.slice(0, 120));
  process.exit(1);
});
