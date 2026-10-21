// Final mobile verification for the capture-hang fix: exact user repro at a
// phone viewport, then Journal navigation and a real page reload.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const SHOT_DIR = '/home/user/shots/bugfix';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chromium = (await import('@sparticuz/chromium')).default;
const executablePath = process.env.CHROME_PATH ?? (await chromium.executablePath());

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setUserAgent(
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
);
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const log = (...a) => console.log(...a);

await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));

// Exact repro: Capture → Quick → "Testing Chronicle" → Save.
await page.click('.tabbar__capture');
await page.waitForSelector('#capture-input', { visible: true, timeout: 5000 });
await page.type('#capture-input', 'Testing Chronicle', { delay: 20 });
const quickPressed = await page.$eval(
  'button.segmented__option[aria-pressed="true"]',
  (el) => el.textContent?.trim()
);
log('mode:', quickPressed);

const t0 = Date.now();
await page.click('.dialog__footer button.btn--primary');
await page.waitForFunction(
  () => {
    const h = document.querySelector('.dialog__header h2');
    return h && /Saved/i.test(h.textContent ?? '');
  },
  { timeout: 15000 }
);
const saveMs = Date.now() - t0;
log(`SAVE COMPLETED in ${saveMs}ms`);
await page.screenshot({ path: `${SHOT_DIR}/01-saved.png` });

// Done → Journal via the tab bar.
await page.click('.dialog__footer button.btn--primary'); // Done
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const links = [...document.querySelectorAll('a[href="/journal"]')];
  const visible = links.find((a) => a.offsetParent !== null);
  (visible ?? links[0]).click();
});
await page.waitForFunction(
  () => document.body.textContent?.includes('Testing Chronicle'),
  { timeout: 8000 }
);
log('JOURNAL: entry visible after navigation');
await page.screenshot({ path: `${SHOT_DIR}/02-journal.png` });

// Hard reload: persistence must survive.
await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForFunction(
  () => document.body.textContent?.includes('Testing Chronicle'),
  { timeout: 8000 }
);
log('RELOAD: entry still visible after page reload');
await page.screenshot({ path: `${SHOT_DIR}/03-after-reload.png` });

// Direct IndexedDB confirmation.
const db = await page.evaluate(async () => {
  const open = indexedDB.open('chronicle');
  const d = await new Promise((res, rej) => {
    open.onsuccess = () => res(open.result);
    open.onerror = () => rej(open.error);
  });
  const tx = d.transaction('entries', 'readonly');
  const all = tx.objectStore('entries').getAll();
  const rows = await new Promise((res, rej) => {
    all.onsuccess = () => res(all.result);
    all.onerror = () => rej(all.error);
  });
  d.close();
  return rows.map((r) => r.title);
});
log('IDB entries:', JSON.stringify(db));
log('console errors:', consoleErrors.length ? consoleErrors : '(none)');

const pass =
  saveMs < 15000 &&
  db.includes('Testing Chronicle') &&
  db.length === 1 &&
  consoleErrors.length === 0;
log(pass ? 'RESULT: PASS' : 'RESULT: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
