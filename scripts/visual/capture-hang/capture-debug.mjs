/**
 * Capture-hang debugger: real headless Chromium, production build.
 * Instruments IndexedDB transactions, service worker lifecycle, fetches,
 * unhandled rejections and module-chunk network activity, then replays the
 * exact user reproduction ("Testing Chronicle", Quick mode, Save) and reports
 * which awaited stage fails to settle.
 *
 * MODE: M1 baseline | M2 SW-controlled | M3 offline at tap | M4 double tap
 *       M5 cpu-throttled SW | M6 offline reload (SW serves everything)
 */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const MODE = process.env.MODE || 'M1';
const TEXT = process.env.CAPTURE_TEXT || 'Testing Chronicle';

const INJECT = `
window.__trace = [];
window.__t0 = performance.now();
window.__log = (msg) => {
  const line = Math.round(performance.now() - window.__t0) + 'ms ' + msg;
  window.__trace.push(line);
};
window.addEventListener('unhandledrejection', (e) => window.__log('UNHANDLED REJECTION: ' + ((e.reason && (e.reason.message || e.reason.name)) || e.reason)));
window.addEventListener('error', (e) => window.__log('WINDOW ERROR: ' + e.message));
(() => {
  const openOrig = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (name, version) {
    const req = openOrig.call(this, name, version);
    req.addEventListener('blocked', () => window.__log('idb.open BLOCKED ' + name + ' v' + version));
    req.addEventListener('error', () => window.__log('idb.open ERROR ' + name + ' ' + (req.error && req.error.name)));
    return req;
  };
  window.__txid = 0;
  const txOrig = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (stores, mode, opts) {
    const names = (Array.isArray(stores) ? stores : [stores]).join(',');
    const tx = txOrig.call(this, stores, mode, opts);
    const id = ++window.__txid;
    window.__log('tx#' + id + ' START ' + mode + ' [' + names + ']');
    tx.addEventListener('complete', () => window.__log('tx#' + id + ' COMPLETE'));
    tx.addEventListener('abort', () => window.__log('tx#' + id + ' ABORT ' + (tx.error && tx.error.name)));
    return tx;
  };
  const reqProto = IDBRequest.prototype;
  for (const kind of ['put', 'add', 'get', 'getAll', 'delete', 'clear', 'openCursor', 'count']) {
    const orig = IDBObjectStore.prototype[kind] || IDBIndex.prototype[kind];
  }
  const fetchOrig = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = String((args[0] && args[0].url) || args[0]);
    const started = performance.now();
    window.__log('fetch START ' + url);
    try {
      const res = await fetchOrig(...args);
      window.__log('fetch DONE ' + url + ' ' + res.status + ' ' + Math.round(performance.now() - started) + 'ms');
      return res;
    } catch (error) {
      window.__log('fetch FAIL ' + url + ' ' + error.name);
      throw error;
    }
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.__log('sw CONTROLLERCHANGE'));
    navigator.serviceWorker.ready.then(() => window.__log('sw READY controller=' + Boolean(navigator.serviceWorker.controller)));
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      const note = (slot) => window.__log('sw STATE ' + slot + '=' + (reg[slot] ? reg[slot].state : 'none'));
      note('installing'); note('waiting'); note('active');
      reg.addEventListener('updatefound', () => {
        window.__log('sw UPDATEFOUND');
        const inst = reg.installing;
        inst.addEventListener('statechange', () => window.__log('sw installing state=' + inst.state));
      });
    });
  }
})();
`;

async function state(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('.dialog');
    const primary = document.querySelector('.dialog__footer button.btn--primary');
    return {
      dialogOpen: Boolean(dialog),
      dialogTitle: document.querySelector('.dialog__header h2')?.textContent ?? null,
      spinner: Boolean(document.querySelector('.dialog__footer .spinner')),
      primaryLabel: primary?.textContent?.trim() ?? null,
      primaryDisabled: primary?.disabled ?? null,
      errorNotice: document.querySelector('.notice--danger')?.textContent?.trim().slice(0, 120) ?? null,
      toast: document.querySelector('.toast')?.textContent?.trim().slice(0, 80) ?? null
    };
  });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: [...chromium.args, '--hide-scrollbars'],
    headless: true
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  const network = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleErrors.push(`${message.type()}: ${message.text().slice(0, 200)}`);
    }
  });
  page.on('pageerror', (error) => consoleErrors.push('pageerror: ' + error.message.slice(0, 200)));

  const client = await page.target().createCDPSession();
  await client.send('Network.enable');
  const pending = new Map();
  client.on('Network.requestWillBeSent', (event) => {
    if (event.request.url.includes('/assets/') || event.request.url.endsWith('.js')) {
      pending.set(event.requestId, event.request.url.split('/').pop());
      network.push(`req ${pending.get(event.requestId)}`);
    }
  });
  client.on('Network.loadingFinished', (event) => {
    if (pending.has(event.requestId)) network.push(`done ${pending.get(event.requestId)}`);
    pending.delete(event.requestId);
  });
  client.on('Network.loadingFailed', (event) => {
    if (pending.has(event.requestId)) network.push(`FAILED ${pending.get(event.requestId)} ${event.errorText}`);
    pending.delete(event.requestId);
  });

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(INJECT);

  const load = async () => {
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.shell', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 600));
  };

  await load();
  if (MODE === 'M1') {
    /* fresh page, SW registered but not controlling */
  } else {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.shell', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 600));
  }
  if (MODE === 'M3' || MODE === 'M6') {
    await client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    if (MODE === 'M6') {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.shell', { timeout: 15000 });
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  if (MODE === 'M5') await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });

  const swState = await page.evaluate(() => ({
    controller: Boolean(navigator.serviceWorker.controller),
    ready: navigator.serviceWorker.controller ? 'controlled' : 'uncontrolled'
  }));

  // --- exact reproduction ---
  await page.click('.tabbar__capture');
  await page.waitForSelector('#capture-input', { timeout: 8000 });
  await page.type('#capture-input', TEXT, { delay: 8 });
  const quickPressed = await page.$eval(
    'button.segmented__option[aria-pressed="true"]',
    (el) => el.textContent.trim()
  );
  await page.click('.dialog__footer button.btn--primary');
  if (MODE === 'M4') {
    await new Promise((r) => setTimeout(r, 120));
    await page.click('.dialog__footer button.btn--primary').catch(() => undefined);
  }

  const timeline = [];
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    timeline.push({ t: (i + 1) * 2 + 's', ...(await state(page)) });
    const last = timeline[timeline.length - 1];
    if (!last.spinner && !last.dialogOpen) break;
    if (!last.spinner && last.dialogTitle === 'Saved') break;
  }

  const trace = await page.evaluate(() => window.__trace);
  const entries = await page.evaluate(async () => {
    const req = indexedDB.open('chronicle');
    const db = await new Promise((res) => (req.onsuccess = () => res(req.result)));
    const tx = db.transaction(['entries', 'meta'], 'readonly');
    const all = await new Promise((res) => {
      const get = tx.objectStore('entries').getAll();
      get.onsuccess = () => res(get.result);
    });
    const meta = await new Promise((res) => {
      const get = tx.objectStore('meta').get('capture:last');
      get.onsuccess = () => res(get.result);
    });
    db.close();
    return {
      count: all.length,
      titles: all.map((entry) => entry.title).slice(0, 6),
      lastCommit: meta ? 'present' : 'absent'
    };
  });

  console.log(`\n===== MODE ${MODE} =====`);
  console.log('sw:', JSON.stringify(swState), 'quickPressed:', quickPressed);
  console.log('--- ui timeline ---');
  for (const row of timeline) console.log(JSON.stringify(row));
  console.log('--- trace ---');
  console.log(trace.join('\n'));
  console.log('--- chunk network ---');
  console.log(network.join('\n') || '(no chunk requests)');
  console.log('--- console errors ---');
  console.log(consoleErrors.join('\n') || '(none)');
  console.log('--- db ---');
  console.log(JSON.stringify(entries));
  await browser.close();
}

main().catch((error) => {
  console.error('DEBUG HARNESS FAILURE', error.message?.slice(0, 200));
  process.exit(1);
});
