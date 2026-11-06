#!/usr/bin/env node
/**
 * Chronicle contrast checker.
 *
 * Reads the design tokens straight out of `src/styles/tokens.css` and verifies
 * every colour pairing the interface actually uses against WCAG 2.1:
 *   - 4.5:1 for body text and small UI labels
 *   - 3.0:1 for large text and non-text UI boundaries
 *
 * `rgba()` borders are composited over the background they sit on, exactly as
 * a browser paints them. The script exits non-zero when any pair fails, so it
 * can guard the build (`npm run contrast`, wired into `npm run verify`).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_PATH = join(ROOT, 'src', 'styles', 'tokens.css');

/* ------------------------------------------------------------------ *
 * Colour parsing & WCAG maths
 * ------------------------------------------------------------------ */

function parseColor(value) {
  const text = value.trim();

  let match = /^#([0-9a-f]{6})$/i.exec(text);
  if (match) {
    const hex = match[1];
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
  }
  match = /^#([0-9a-f]{3})$/i.exec(text);
  if (match) {
    const hex = match[1];
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: 1
    };
  }
  match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(text);
  if (match) {
    const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alpha };
  }
  throw new Error(`Unparseable colour: ${text}`);
}

/** Composite a semi-transparent colour over an opaque backdrop. */
function composite(foreground, backdrop) {
  const alpha = foreground.a + backdrop.a * (1 - foreground.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (foreground.r * foreground.a + backdrop.r * backdrop.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + backdrop.g * backdrop.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + backdrop.b * backdrop.a * (1 - foreground.a)) / alpha,
    a: alpha
  };
}

function channel(value) {
  const linear = value / 255;
  return linear <= 0.03928 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
}

function luminance(color) {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

/* ------------------------------------------------------------------ *
 * Token extraction
 * ------------------------------------------------------------------ */

function readThemes() {
  const css = readFileSync(TOKENS_PATH, 'utf8');
  const themes = {};
  const blockPattern = /:root\[data-theme='(light|dark)'\]\s*\{([^}]*)\}/g;
  let block;
  while ((block = blockPattern.exec(css)) !== null) {
    const theme = block[1];
    const declarations = {};
    const declarationPattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let declaration;
    while ((declaration = declarationPattern.exec(block[2])) !== null) {
      declarations[declaration[1]] = declaration[2].trim();
    }
    themes[theme] = declarations;
  }
  if (!themes.light || !themes.dark) {
    throw new Error('tokens.css must declare :root[data-theme=\'light\'] and [data-theme=\'dark\'] blocks');
  }
  return themes;
}

/* ------------------------------------------------------------------ *
 * Required pairings — every one the UI actually paints
 * ------------------------------------------------------------------ */

const TEXT_MIN = 4.5;
const UI_MIN = 3.0;

const PAIRS = [
  // ---- body & metadata text on every surface level ----------------------
  { fg: '--color-text', bg: '--color-bg', min: TEXT_MIN, use: 'body text on page' },
  { fg: '--color-text', bg: '--color-surface', min: TEXT_MIN, use: 'body text on card' },
  { fg: '--color-text', bg: '--color-surface-subtle', min: TEXT_MIN, use: 'body text on subtle surface' },
  { fg: '--color-text', bg: '--color-surface-raised', min: TEXT_MIN, use: 'body text on raised surface' },
  { fg: '--color-text', bg: '--color-surface-hover', min: TEXT_MIN, use: 'body text on hover surface' },
  { fg: '--color-text', bg: '--color-nav', min: TEXT_MIN, use: 'body text on navigation' },
  { fg: '--color-text-muted', bg: '--color-bg', min: TEXT_MIN, use: 'secondary text on page' },
  { fg: '--color-text-muted', bg: '--color-surface', min: TEXT_MIN, use: 'secondary text on card' },
  { fg: '--color-text-muted', bg: '--color-surface-subtle', min: TEXT_MIN, use: 'secondary text on subtle surface' },
  { fg: '--color-text-muted', bg: '--color-surface-raised', min: TEXT_MIN, use: 'secondary text on raised surface' },
  { fg: '--color-text-faint', bg: '--color-bg', min: TEXT_MIN, use: 'meta text on page' },
  { fg: '--color-text-faint', bg: '--color-surface', min: TEXT_MIN, use: 'meta text on card' },
  { fg: '--color-text-faint', bg: '--color-surface-subtle', min: TEXT_MIN, use: 'meta text on subtle surface' },
  { fg: '--color-text-faint', bg: '--color-surface-raised', min: TEXT_MIN, use: 'meta text on raised surface' },

  // ---- actions & links ---------------------------------------------------
  { fg: '--color-accent', bg: '--color-bg', min: TEXT_MIN, use: 'link on page' },
  { fg: '--color-accent', bg: '--color-surface', min: TEXT_MIN, use: 'link on card' },
  { fg: '--color-accent', bg: '--color-surface-subtle', min: TEXT_MIN, use: 'link on subtle surface' },
  { fg: '--color-accent', bg: '--color-surface-raised', min: TEXT_MIN, use: 'link on raised surface' },
  { fg: '--color-accent-hover', bg: '--color-bg', min: TEXT_MIN, use: 'hovered link on page' },
  { fg: '--color-accent-hover', bg: '--color-surface', min: TEXT_MIN, use: 'hovered link on card' },
  { fg: '--color-on-accent', bg: '--color-accent', min: TEXT_MIN, use: 'filled button label' },
  { fg: '--color-on-accent', bg: '--color-accent-hover', min: TEXT_MIN, use: 'hovered button label' },
  { fg: '--color-accent', bg: '--color-accent-subtle', over: '--color-surface', min: TEXT_MIN, use: 'accent text on accent tint' },
  { fg: '--color-accent', bg: '--color-surface-hover', min: TEXT_MIN, use: 'active nav label' },

  // ---- meaning: text, and text on its own tint ---------------------------
  { fg: '--color-success', bg: '--color-bg', min: TEXT_MIN, use: 'success text' },
  { fg: '--color-success', bg: '--color-surface', min: TEXT_MIN, use: 'success text on card' },
  { fg: '--color-success', bg: '--color-success-subtle', over: '--color-surface', min: TEXT_MIN, use: 'success text on its tint' },
  { fg: '--color-warning', bg: '--color-bg', min: TEXT_MIN, use: 'warning text' },
  { fg: '--color-warning', bg: '--color-surface', min: TEXT_MIN, use: 'warning text on card' },
  { fg: '--color-warning', bg: '--color-warning-subtle', over: '--color-surface', min: TEXT_MIN, use: 'warning text on its tint' },
  { fg: '--color-danger', bg: '--color-bg', min: TEXT_MIN, use: 'danger text' },
  { fg: '--color-danger', bg: '--color-surface', min: TEXT_MIN, use: 'danger text on card' },
  { fg: '--color-danger', bg: '--color-danger-subtle', over: '--color-surface', min: TEXT_MIN, use: 'danger text on its tint' },
  { fg: '--color-info', bg: '--color-bg', min: TEXT_MIN, use: 'info text' },
  { fg: '--color-info', bg: '--color-surface', min: TEXT_MIN, use: 'info text on card' },

  // ---- non-text UI: borders, focus rings, tints --------------------------
  { fg: '--color-border-strong', bg: '--color-bg', min: UI_MIN, use: 'strong border (control outline)' },
  { fg: '--color-border-strong', bg: '--color-surface', min: UI_MIN, use: 'strong border on card' },
  { fg: '--color-border-focus', bg: '--color-bg', min: UI_MIN, use: 'focus ring on page' },
  { fg: '--color-border-focus', bg: '--color-surface', min: UI_MIN, use: 'focus ring on card' },
  { fg: '--color-border-focus', bg: '--color-surface-subtle', min: UI_MIN, use: 'focus ring on subtle surface' },

  // ---- life map: labels sit on their own fill; edges/rings are UI --------
  { fg: '--map-ink-chapter', bg: '--map-fill-chapter', min: TEXT_MIN, use: 'map chapter label' },
  { fg: '--map-ink-experience', bg: '--map-fill-experience', min: TEXT_MIN, use: 'map experience label' },
  { fg: '--map-ink-path', bg: '--map-fill-path', min: TEXT_MIN, use: 'map path label' },
  { fg: '--map-ink-place', bg: '--map-fill-place', min: TEXT_MIN, use: 'map place label' },
  { fg: '--map-ink-person', bg: '--map-fill-person', min: TEXT_MIN, use: 'map person label' },
  { fg: '--map-ink-trip', bg: '--map-fill-trip', min: TEXT_MIN, use: 'map trip label' },
  { fg: '--map-ink-collection', bg: '--map-fill-collection', min: TEXT_MIN, use: 'map collection label' },
  { fg: '--color-text', bg: '--map-canvas', min: TEXT_MIN, use: 'map text on canvas' },
  { fg: '--color-text-muted', bg: '--map-canvas', min: TEXT_MIN, use: 'map secondary text on canvas' },
  { fg: '--map-uncertain', bg: '--map-canvas', min: TEXT_MIN, use: 'map "date not exact" annotation' },
  { fg: '--map-edge', bg: '--map-canvas', min: UI_MIN, use: 'map edge line' },
  { fg: '--map-edge-strong', bg: '--map-canvas', min: UI_MIN, use: 'selected map edge' },
  { fg: '--map-self', bg: '--map-fill-experience', min: TEXT_MIN, use: 'map centre label' },
  { fg: '--map-self', bg: '--map-canvas', min: TEXT_MIN, use: 'map centre accent on canvas' }
];

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function main() {
  const themes = readThemes();
  const failures = [];
  let checked = 0;

  for (const themeName of ['light', 'dark']) {
    const tokens = themes[themeName];
    const resolve = (name) => {
      const raw = tokens[name];
      if (!raw) throw new Error(`${themeName}: missing token ${name}`);
      return parseColor(raw);
    };

    for (const pair of PAIRS) {
      const foreground = resolve(pair.fg);
      // A tinted background (`rgba()`) must be composited over the surface it
      // is painted on before measuring, exactly as a browser paints it.
      // Without this, every "text on its own tint" pairing silently measured
      // against transparent black and reported nonsense.
      const backdrop = resolve(pair.over ?? '--color-bg');
      const rawBackground = resolve(pair.bg);
      const background =
        rawBackground.a < 1 ? composite(rawBackground, backdrop) : rawBackground;
      const ratio = contrastRatio(
        foreground.a < 1 ? composite(foreground, background) : foreground,
        background
      );
      checked += 1;
      const pass = ratio >= pair.min - 0.005;
      if (!pass) {
        failures.push({ themeName, pair, ratio });
      }
      const label = `${themeName.padEnd(5)} ${pair.fg.replace('--color-', '').padEnd(14)} on ${pair.bg
        .replace('--color-', '')
        .padEnd(16)} ${ratio.toFixed(2).padStart(6)}  (min ${pair.min})  ${pass ? 'ok' : 'FAIL'}`;
      process.stdout.write(`  ${label}\n`);
    }
    process.stdout.write('\n');
  }

  if (failures.length > 0) {
    process.stdout.write(`contrast: ${failures.length} of ${checked} pairings fail WCAG\n`);
    for (const failure of failures) {
      process.stdout.write(
        `  ${failure.themeName}: ${failure.pair.fg} on ${failure.pair.bg} = ${failure.ratio.toFixed(
          2
        )} (${failure.pair.use}) needs ${failure.pair.min}\n`
      );
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`contrast: all ${checked} pairings meet WCAG 2.1 (text ${TEXT_MIN}, UI ${UI_MIN})\n`);
}

main();
