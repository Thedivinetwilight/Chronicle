/**
 * Interactive flow checks — capture, persistence, edit, search, map selection,
 * share-preview privacy, reduced motion and 200% text scaling.
 *
 * Real browser, real IndexedDB, real clicks. Same opt-in requirement as
 * `audit.mjs`; run against a server on :4173.
 *
 *   node scripts/browser/flows.mjs
 *
 * Exits non-zero if any flow fails.
 */
// Exercises the interactive flows in a real browser and reports pass/fail.
// Scratch verification harness — deleted before commit.
import { chromium } from 'playwright-core';
import sparticuz from '@sparticuz/chromium';

const BASE = 'http://127.0.0.1:4173';
const exe = await sparticuz.executablePath();
const browser = await chromium.launch({
  executablePath: exe,
  args: [...sparticuz.args.filter((a) => a !== '--single-process'), '--no-sandbox'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/chrome-libs/lib' }
});

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const errors = [];
/* One context, one page: @sparticuz/chromium runs `--single-process`, which
   does not survive several concurrent browser contexts. Emulated settings are
   changed on the same context instead. */
const context = await browser.newContext({
  viewport: { width: 1440, height: 950 },
  colorScheme: 'dark'
});
const page = await context.newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

/* ---------------- 1. capture & persistence ---------------- */
{
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const box = page.locator('.composer textarea').first();
  await box.waitFor({ timeout: 10000 });
  const marker = `Flow capture ${Date.now()}`;
  await box.fill(marker + ' — wrote this in a browser test.');
  await page.getByRole('button', { name: /^save$/i }).first().click();
  await page.waitForTimeout(1400);

  /* Poll instead of sleeping: a fixed wait races the re-render and produces a
     false failure. */
  const waitForText = async (text, timeout = 5000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if ((await page.getByText(text).count()) > 0) return Date.now() - started;
      await page.waitForTimeout(150);
    }
    return -1;
  };
  const appearedIn = await waitForText(marker);
  record('capture saves and appears immediately', appearedIn >= 0, `${appearedIn}ms`);

  /* The reload is the real persistence test: the browser profile on disk is
     thrown away between runs, so anything still here came from IndexedDB. */
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const afterReload = await page.getByText(marker).count();
  record('capture persists across reload (IndexedDB)', afterReload > 0, `${afterReload} match(es)`);

  /* ---------------- 2. edit round-trip ---------------- */
  await page.getByText(marker).first().click();
  await page.waitForTimeout(1200);
  const url = new URL(page.url());
  const onDetail = /\/journal\//.test(url.pathname);
  record('opening an entry navigates to its detail route', onDetail, url.pathname);

  if (onDetail) {
    const editBtn = page.getByRole('button', { name: /edit/i }).first();
    if (await editBtn.count()) {
      await editBtn.click();
      await page.waitForTimeout(600);
      const edited = `${marker} EDITED`;
      const bodyBox = page.locator('textarea').first();
      await bodyBox.fill(edited + ' — and then edited.');
      await page.getByRole('button', { name: /^save/i }).first().click();
      await page.waitForTimeout(1400);
      const shown = await page.getByText(/EDITED/).count();
      record('editing an entry persists the change', shown > 0, `${shown} match(es)`);
    } else {
      record('editing an entry persists the change', false, 'no edit button found');
    }
  }

  /* ---------------- 3. search ---------------- */
  await page.goto(BASE + '/search', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const searchBox = page
    .locator('input[type="search"], input[type="text"], input:not([type])')
    .first();
  if (await searchBox.count()) {
    await searchBox.fill('marina');
    await page.waitForTimeout(900);
    const found = await page.getByText(/marina/i).count();
    record('search finds a matching experience', found > 0, `${found} match(es)`);
    await searchBox.fill('zzzznotarealthing');
    await page.waitForTimeout(900);
    const none = await page.getByText(/no (results|matches)|nothing/i).count();
    record('search shows an empty state for no matches', none > 0, `${none} message(s)`);
  } else {
    record('search finds a matching experience', false, 'no searchbox');
  }

  /* ---------------- 4. map node selection ---------------- */
  await page.goto(BASE + '/map', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const nodes = page.locator('[data-node="true"]');
  const nodeCount = await nodes.count();
  record('map renders nodes as focusable buttons', nodeCount > 0, `${nodeCount} nodes`);
  if (nodeCount > 0) {
    await nodes.first().click();
    await page.waitForTimeout(700);
    const selected = await page.locator('[data-node="true"][aria-pressed="true"]').count();
    record('selecting a node marks it selected', selected > 0, `${selected} selected`);
  }
  // Keyboard path — the accessible route to map content.
  await page.goto(BASE + '/map', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const firstNode = page.locator('[data-node="true"]').first();
  await firstNode.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const kbdSelected = await page.locator('[data-node="true"][aria-pressed="true"]').count();
  record('map node is selectable by keyboard', kbdSelected > 0, `${kbdSelected} selected`);

  /* ---------------- 5. outline alternative ---------------- */
  const outline = page.getByRole('button', { name: /outline/i }).first();
  if (await outline.count()) {
    await outline.click();
    await page.waitForTimeout(700);
    const headings = await page.locator('.outline, [data-outline], .lifemap-outline').count();
    record('outline view offers a text route to map content', headings > 0, `${headings} outline block(s)`);
  }
}

/* ---------------- 6. share preview privacy ---------------- */
{
  await page.goto(BASE + '/share-preview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);

  const privateToggle = page.getByRole('switch').or(page.locator('input[type="checkbox"]')).first();
  const beforeChecked = await privateToggle.isChecked().catch(() => false);
  record('private records are excluded from the share preview by default', beforeChecked === false, `checked=${beforeChecked}`);

  const publish = page.getByRole('button', { name: /publish|post|share now/i });
  record('no publish control exists (nothing can be sent)', (await publish.count()) === 0, `${await publish.count()} found`);
}

/* ---------------- 7. reduced motion ---------------- */
{
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const durations = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'card';
    document.body.appendChild(probe);
    const values = {
      card: getComputedStyle(probe).transitionDuration,
      root: getComputedStyle(document.documentElement).getPropertyValue('--duration-base').trim(),
      dialog: getComputedStyle(document.documentElement).getPropertyValue('--duration-enter').trim()
    };
    probe.remove();
    return values;
  });
  const zeroed = [durations.root, durations.dialog].every((v) => v === '0ms' || v === '0s' || v === '');
  record('reduced motion zeroes the transition tokens', zeroed, JSON.stringify(durations));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

/* ---------------- 8. zoom / text scaling ---------------- */
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  // 200% text scaling is the WCAG 1.4.4 equivalent for a text-heavy app.
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  record('no horizontal overflow at 200% text size (390px)', !overflow);
  await page.evaluate(() => (document.documentElement.style.fontSize = ''));
}

console.log('\nconsole/page errors:', errors.length === 0 ? 'none' : errors.slice(0, 6));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} flow checks passed`);
await browser.close();
process.exit(failed.length > 0 ? 1 : 0);
