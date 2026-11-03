#!/usr/bin/env node
/**
 * Chronicle icon generator.
 *
 * Produces the PWA icons from the brand mark without any image dependency: the
 * drawing is computed per pixel (signed-distance fields + 4x supersampling) and
 * the PNG is encoded by hand (IHDR/IDAT/IEND with a CRC-32 and zlib deflate).
 *
 * Why no `sharp`/`canvas`: they are native modules. Chronicle must install and
 * build on an Android Termux shell, a Windows PC and a CI container alike, so
 * the toolchain stays pure JavaScript.
 *
 * Usage: node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'icons');

/* ------------------------------------------------------------------ *
 * Brand colours — keep in sync with src/styles/tokens.css
 * ------------------------------------------------------------------ */

const PAPER = [251, 250, 248]; // --color-bg (light)
const PAPER_SUBTLE = [245, 243, 239]; // --color-surface-subtle (light)
const INK = [61, 90, 128]; // --color-accent (light)
const INK_SOFT = [28, 25, 23]; // --color-text (light)

/* ------------------------------------------------------------------ *
 * Geometry helpers (all coordinates are in a 0..1 box)
 * ------------------------------------------------------------------ */

function length(x, y) {
  return Math.sqrt(x * x + y * y);
}

/** Distance from a point to a line segment. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const span = dx * dx + dy * dy;
  const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / span));
  return length(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance to a rounded rectangle centred at (cx, cy) with half-size (hx, hy). */
function roundedRectDistance(px, py, cx, cy, hx, hy, radius) {
  const dx = Math.abs(px - cx) - hx + radius;
  const dy = Math.abs(py - cy) - hy + radius;
  const outside = length(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0) - radius;
  return outside + inside;
}

/**
 * Coverage of a shape at a pixel: 1 = fully inside, 0 = fully outside.
 * `distance` is in box units; `pixel` is the size of one pixel in box units.
 */
function coverage(distance, pixel) {
  const half = pixel / 2;
  if (distance <= -half) return 1;
  if (distance >= half) return 0;
  return 0.5 - distance / (2 * half);
}

/* ------------------------------------------------------------------ *
 * The mark: a ledger of lines with a clock over the last one.
 * ------------------------------------------------------------------ */

/**
 * @param {number} size     pixel size of the output
 * @param {object} options
 * @param {boolean} options.maskable  full-bleed background, mark at 66%
 * @param {boolean} options.apple     no transparent corners, mark at 78%
 */
function renderIcon(size, options = {}) {
  const maskable = Boolean(options.maskable);
  const background = maskable ? PAPER_SUBTLE : PAPER;
  const scale = maskable ? 0.66 : options.apple ? 0.78 : 0.8;
  const samples = 4; // 4x4 supersampling per pixel
  const pixel = 1 / size;
  const rgba = new Uint8Array(size * size * 4);

  const cornerRadius = maskable ? 0 : 0.22;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let inkAmount = 0;
      let softAmount = 0;
      let insideTile = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const weight = 1 / (samples * samples);
          // Map the sample to the 0..1 tile box, then into mark space.
          const bx = (x + (sx + 0.5) / samples) / size;
          const by = (y + (sy + 0.5) / samples) / size;

          if (cornerRadius > 0) {
            insideTile +=
              coverage(roundedRectDistance(bx, by, 0.5, 0.5, 0.5, 0.5, cornerRadius), pixel / samples) * weight;
          } else {
            insideTile += weight;
          }

          // Mark space: centred, occupying `scale` of the tile.
          const mx = (bx - 0.5) / scale;
          const my = (by - 0.5) / scale;

          let ink = 0;
          let soft = 0;

          // Three ledger lines; the shortest leaves room for the clock.
          const bars = [
            { y: -0.26, half: 0.3 },
            { y: -0.02, half: 0.3 },
            { y: 0.22, half: 0.16 }
          ];
          for (const bar of bars) {
            const distance = segmentDistance(mx, my, -0.32, bar.y, -0.32 + bar.half * 2, bar.y) - 0.035;
            ink += coverage(distance, pixel / samples) * weight;
          }

          // The clock face is paper: it erases any ledger line behind it.
          const cx = 0.2;
          const cy = 0.2;
          const faceDistance = length(mx - cx, my - cy) - 0.17;
          ink *= 1 - coverage(faceDistance, pixel / samples);

          // Ring and hands in the accent colour.
          const ringDistance = Math.abs(length(mx - cx, my - cy) - 0.2) - 0.032;
          soft += coverage(ringDistance, pixel / samples) * weight;
          const handMinute = segmentDistance(mx, my, cx, cy, cx, cy - 0.12) - 0.016;
          const handHour = segmentDistance(mx, my, cx, cy, cx + 0.085, cy + 0.03) - 0.016;
          soft += (coverage(handMinute, pixel / samples) + coverage(handHour, pixel / samples)) * weight;

          inkAmount += ink;
          softAmount += soft;
        }
      }

      inkAmount = Math.min(1, inkAmount);
      softAmount = Math.min(1, softAmount);

      // Composite: paper tile, ink ledger lines, then the accent clock on top.
      let color = background;
      color = mix(color, INK_SOFT, inkAmount * 0.9);
      color = mix(color, INK, softAmount);

      const index = (y * size + x) * 4;
      rgba[index] = color[0];
      rgba[index + 1] = color[1];
      rgba[index + 2] = color[2];
      rgba[index + 3] = Math.round(insideTile * 255);
    }
  }

  return rgba;
}

function mix(base, overlay, amount) {
  const t = Math.max(0, Math.min(1, amount));
  return [
    Math.round(base[0] + (overlay[0] - base[0]) * t),
    Math.round(base[1] + (overlay[1] - base[1]) * t),
    Math.round(base[2] + (overlay[2] - base[2]) * t)
  ];
}

/* ------------------------------------------------------------------ *
 * Minimal PNG encoder
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // One filter byte (0 = none) per scanline, then the raw pixels.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.subarray(y * size * 4, (y + 1) * size * 4).forEach((value, index) => {
      raw[rowStart + 1 + index] = value;
    });
  }

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------------ *
 * The vector mark (used for the favicon and the "any size" manifest icon)
 * ------------------------------------------------------------------ */

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Chronicle">
  <rect x="1" y="1" width="62" height="62" rx="14" fill="#fbfaf8" stroke="#1c1917" stroke-opacity="0.1"/>
  <g stroke="#1c1917" stroke-opacity="0.85" stroke-width="4.2" stroke-linecap="round">
    <path d="M15 22h27"/>
    <path d="M15 33h27"/>
    <path d="M15 44h11"/>
  </g>
  <circle cx="41" cy="43" r="12" fill="#fbfaf8" stroke="#3d5a80" stroke-width="4"/>
  <path d="M41 36.5V43l4.8 3.2" fill="none" stroke="#3d5a80" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const targets = [
    { file: 'icon-192.png', size: 192 },
    { file: 'icon-512.png', size: 512 },
    { file: 'icon-maskable-512.png', size: 512, maskable: true },
    { file: 'apple-touch-icon.png', size: 180, apple: true }
  ];

  for (const target of targets) {
    const started = Date.now();
    const rgba = renderIcon(target.size, target);
    const png = encodePng(target.size, rgba);
    writeFileSync(join(OUT_DIR, target.file), png);
    process.stdout.write(
      `  icons  ${target.file.padEnd(24)} ${target.size}x${target.size}  ${(png.length / 1024).toFixed(1)} KiB  ${
        Date.now() - started
      }ms\n`
    );
  }

  writeFileSync(join(OUT_DIR, 'icon.svg'), ICON_SVG);
  process.stdout.write(`  icons  ${'icon.svg'.padEnd(24)} vector\n`);
  process.stdout.write(`icons written to public/icons\n`);
}

main();
