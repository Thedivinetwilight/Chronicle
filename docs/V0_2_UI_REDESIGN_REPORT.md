# Chronicle V0.2 — UI Redesign Report

Branch `arena/2470f197-chronicle`, based on `d35a0b3` (V0.1 + Milestone 1).
Nothing here is merged, published or released.

---

## 1. What this was for

A complete visual and interaction redesign of the Chronicle app: a private,
offline-first life archive with an interactive Life Map and optional social
storytelling. The brief asked for a calm, premium, personal identity in both a
dark and a light theme, one accent, a deliberate type scale, a coherent
component system, short and consistent motion, and an accessible responsive
layout — without changing data, domain behaviour, routes or privacy guarantees.

Everything below is a *presentation* change unless it says otherwise. No record,
route, store schema, capture path, privacy rule or domain function was removed
or renamed.

---

## 2. Visual direction and palette — "obsidian & amethyst"

**Direction.** Obsidian, not black: deep graphite surfaces that read as a
material rather than a void, warm off-white text (never `#fff`), and restrained
silver-grey hairlines in place of shadows. One accent — amethyst — carries
interaction; everything else is neutral so that a personal archive stays quiet.

**Why amethyst (≈248°).** A warm gold/amber was the first choice and was
rejected: it landed too close to the warning colour's hue to be distinguishable
at small sizes, and "attention" should not be the dominant note in a journal.
Amethyst sits ≈107° from success (green), ≈151° from warning (amber) and ≈117°
from danger (red), so every semantic colour stays separable by hue *and* by
lightness, and the accent never reads as an alert.

**Two deliberate palettes, not one inverted.** Dark is the default block;
light is a companion palette worked out on its own warm paper (`#f7f5f1`) rather
than a mechanical inversion. Both keep the same semantic roles, and
`prefers-color-scheme` plus the in-app switch still work exactly as before.

### Tokens

Dark (default): page `#0b0c0e`, deep `#08090b`, surface `#15161a`, subtle
`#1b1d22`, raised `#22242a`, nav `#0e0f12`; text `#f0eee9` / muted `#adaba5` /
faint `#918f87`; accent `#a9a0e8` (hover `#bdb5ef`, on-accent `#14102b`).

Light: page `#f7f5f1`, surface `#fffefc`, subtle `#f1eee8`, nav `#fbf9f5`;
text `#1a1917` / muted `#5a5750` / faint `#6e6a62`; accent `#4a3e9c` (hover
`#3b3080`, on-accent `#fff`).

Semantic: success, warning, danger and info each have a solid, a `-subtle`
(≈0.13 dark / 0.09 light) and a `-border` (≈0.34 / 0.28) variant, so no state is
ever signalled by colour alone.

**No pure black, and that is checked.** `#0b0c0e` measures 1.073:1 against
`#000000` — deliberately lifted so large dark fields do not crush on OLED or
band on cheap panels.

**Measured contrast** (`npm run contrast`, 106 pairings, WCAG 2.1 — text 4.5:1,
UI 3:1): all pass, up from 72 pairings before the redesign. Selected values:
dark text 16.88 on page, 15.59 on card, 14.38 on subtle; muted 8.45 / 7.81 /
7.20; faint 5.51 / 5.09 / 4.70; accent 8.28 dark, 7.84 light; label-on-accent
7.80 dark, 8.54 light; `--color-border-strong` 4.08 dark / 3.31 light as a
non-text boundary.

The gate composites `rgba()` backgrounds over their parent surface before
measuring — without that step translucent fills resolved to transparent black
and every ratio falsely read 1.00.

---

## 3. Typography, spacing and layout

**Scale.** 11 / 12 / 13.5 / 15 / 17 / 21 / 26 / 32, plus a display step of
`clamp(30px, 6.5vw, 40px)` for page titles. Body is 15px at 1.72 line-height;
long-form reading uses `--line-height-reading` at a `68ch` measure. Uppercase is
reserved for section eyebrows at 11px with `0.08em` tracking — never for
content.

**Spacing.** One scale (`4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96`) drives every
gap, pad and margin. Content is capped at `68rem` (wide `84rem`) so a 1440px
screen does not stretch a paragraph to 150 characters.

**Shell.** A 248px sticky rail with grouped navigation (ARCHIVE / GATHER /
MORE), a 56px header carrying the current section, and a centred `68rem`
content column. Below 1024px the rail becomes a fixed tab bar with a centred
capture button and a "More" sheet. Capture is reachable from the rail, the tab
bar, Today's hero composer, and the Journal.

**Reading measure, fixed.** `.markdown` — the rendered output that entry bodies
actually use — had been inheriting only a link colour, so a body ran the full
1064px at roughly 150 characters per line. It now shares one set of prose rules
with `.text-block`; measured in-browser on an entry page, the body column is
649px at ≈87 characters and 25.8px leading.

---

## 4. Component system

One system, used everywhere: buttons (primary / quiet / danger / icon), inputs,
selects, segmented controls, chips and tag chips, cards, list rows, dialogs and
the mobile sheet, toasts, empty/error/loading states, badges, and the Life Map
node vocabulary. Depth is a hairline plus at most one soft shadow; there are no
gradient interactive surfaces.

Three state signals are structural rather than colour-only:

- the active nav item gets a **left rule** as well as accent colour;
- the active tab gets a **top bar** as well as colour;
- every map node kind has a **different glyph geometry** (diamond, square,
  circle, pin, plane, layered square) so a shape is never ambiguous in
  greyscale.

**Two real component bugs were found and fixed while reviewing screenshots:**

1. `.tabbar` declared **six** grid columns for **seven** children. "More"
   silently wrapped onto a second grid row *inside a fixed-height bar* — it
   rendered outside the viewport and could not be tapped on a phone at all.
   Horizontal-overflow checks never saw it because the bar is `position: fixed`.
   Now `repeat(3, 1fr) auto repeat(3, 1fr)`; all seven items sit on one row at
   390px (measured 8→382px), every target ≥50×50.
2. `.shell__sidebar-item` was defined **only inside the ≥1024px media query**,
   but the mobile "More" sheet reuses it. The sheet therefore rendered as
   unstyled text — every icon on its own line above its label, and the "share
   preview" hint overlapping its own label. Hoisted to a global rule.

Disabled buttons also changed: `opacity: 0.45` left the label genuinely hard to
read (and made the primary button look like a rendering fault rather than a
state). Disabled now uses `--color-text-faint` on `--color-surface-subtle`,
which is an already-verified 4.5:1 pairing.

---

## 5. Motion and reduced motion

Transitions are short and consistent: 80ms for press feedback, 130ms for hover,
200ms for state, 280ms for entrances. Dialogs and sheets rise 8px and fade;
menus fade; map node selection grows the glyph slightly and thickens its ring
with no movement of neighbouring nodes; toasts slide in and fade out. There is
no parallax, no bounce, no looping decorative animation, and nothing animates
layout properties that could shift content.

`prefers-reduced-motion: reduce` — and the in-app "Reduce motion" switch —
zero every duration token. Verified in a real browser with `reducedMotion:
'reduce'`: `--duration-base` and `--duration-enter` both compute to `0ms`, and a
`.card` probe reports `transition-duration: 0s, 0s`.

---

## 6. The Life Map — the signature screen

The map was the worst-affected screen before this work, and fixing it was the
largest single change. It was drawing as a **vertical line**: one axis per
chapter with a fixed `TAU / chapterCount` step meant that with two chapters every
node sat on the 12 o'clock / 6 o'clock spine, and fixed radii (344 map units on a
720-unit canvas) pushed chapter nodes off the bottom edge. Labels were
centre-anchored under every node, so they piled into an unreadable column.

What changed:

- **Canvas-relative geometry.** Radii derive from the measured canvas instead of
  fixed constants, so one layout serves a 350px phone and a 1064px desktop.
- **Axis spreading.** Chapters never sit closer than 100° apart, so a small
  archive branches instead of collapsing to a spine.
- **Angular slots for owned records.** Paths, places, people, trips and
  collections each get a distinct slot, allocated round-robin *by chapter* so
  edges stay short while labels never coincide. Slots are offset by half a
  chapter step so nothing lands on a spine.
- **Two-ring stagger** for owned records, doubling effective label separation.
- **Radial label placement.** Labels extend outward along their own radius
  (right side reads left-to-right, left side right-to-left) instead of being
  centred underneath.
- **A deterministic collision resolver.** Walks labels in a stable
  priority order (chapters → paths → places → people → trips → collections →
  experiences), slides each outward/diagonally/sideways until clear, and treats
  glyphs as obstacles so a label can never cover another node's marker. It is
  deterministic — the same archive always draws the same map — and it is covered
  by tests that assert pairwise non-overlap.
- **Bounds now include labels**, using the same `placeLabel()` the renderer uses,
  so the fit transform can never clip text at the canvas edge.
- **The layout rebuilds at the measured size.** It is no longer built once at
  920×720 and scaled — which had shrunk labels to 38% on a phone.
- **Narrow canvases label the structure only** (chapters and paths), plus
  whatever is selected. Eleven ~120px labels cannot fit legibly in 350px; rather
  than shrink type below the legibility floor, the map keeps every node's shape,
  position and tap target, and one tap names it. The hint line says so. The
  outline view remains the complete non-map route to every record.

Accessibility of the map is unchanged and still complete: each node is a real
`role="button"` with `tabIndex={0}`, `aria-label` carrying kind + label +
description, `aria-pressed` for selection, Enter/Space activation, and an
`aria-live` status announcing the selection. The outline view lists the same
records as text.

---

## 7. Every area redesigned

App shell and navigation (rail, header, tab bar, More sheet, capture), Today,
Capture, Journal and entry detail, Life Map (canvas and outline), Chapters,
Paths, Trips, Collections, Places & People, Share preview and privacy,
Projects, Timeline, Search, Roadmap, Settings.

Two behaviours were changed on purpose, and both are reported here rather than
silently applied:

- **The repeated "private" badge is gone from lists.** New records are private
  by default, so a badge on every row carried no information — it trained you to
  ignore a privacy signal. It now appears only when a list *mixes* private and
  shareable records, which is exactly when the distinction matters. No privacy
  semantics changed; the Share preview still excludes private records by default
  and says so.
- **The sticky header and tab bar are opaque, not translucent.** A blurred
  sticky header over the page wash smeared it into grey patches, clearly visible
  in light mode, and the brief rules out decorative blur. The dialog scrim keeps
  its blur, where it is functional and sits over nothing that competes.

---

## 8. Verification — what was actually done

### Automated, in `npm run verify` (the documented command)

```
npm run typecheck && npm run test && npm run contrast && npm run build
```

- **typecheck** — clean.
- **tests** — **442 passing across 19 files**, up from 433. The 9 new tests
  cover map label placement, pairwise label non-overlap, bounds reserving label
  space, resolver determinism, and tab-bar/More-sheet navigation coverage.
- **contrast** — 106/106 pairings meet WCAG 2.1.
- **build** — clean; CSS 45.37 kB (8.47 kB gzip), main 367.14 kB (99.78 kB
  gzip), precache 20 entries (781.71 KiB).

### Real browser — Desktop and mobile, both themes

Chromium was run headlessly in this environment (via `playwright-core` +
`@sparticuz/chromium`; see `scripts/browser/`). **This is real-browser testing,
not jsdom** — which supersedes the "no real browser" limitation recorded in
`docs/MILESTONE_1_REPORT.md`. That report is left as the historical record of
what was true when it was written; `docs/TESTING.md` has been updated to the
current state. All 15 routes were rendered and screenshotted at **1440×950** and
**390×844**, in **both light and dark**:

| theme | viewport | routes | horizontal overflow |
| --- | --- | --- | --- |
| dark | 1440×950 | 15/15 | none |
| dark | 390×844 | 15/15 | none |
| light | 1440×950 | 15/15 | none |
| light | 390×844 | 15/15 | none |

Each route reported `scrollWidth == innerWidth`, a correct single `h1`, and — in
the flow run — zero console and page errors.

### Interactive flows — 14/14 pass, zero console errors

`node scripts/browser/flows.mjs`:

| check | result |
| --- | --- |
| capture saves and appears immediately | pass (873ms) |
| capture persists across reload (IndexedDB) | pass |
| opening an entry navigates to its detail route | pass |
| editing an entry persists the change | pass |
| search finds a matching experience | pass |
| search shows an empty state for no matches | pass |
| map renders nodes as focusable buttons | pass |
| selecting a node marks it selected (pointer) | pass |
| map node is selectable by keyboard | pass |
| outline view offers a text route to map content | pass |
| private records excluded from share preview by default | pass |
| no publish control exists | pass (0 found) |
| reduced motion zeroes the transition tokens | pass (`0ms`) |
| no horizontal overflow at 200% text size, 390px | pass |

### Also measured in-browser

- Desktop shell: rail 248px, header and main at x=248, content 1064px,
  document `scrollWidth` 1440 — no overflow.
- Mobile tab bar: seven items on one row, 8→382px inside 390px, all tap targets
  ≥50×50 (Today/Map/Journal/Chapters/Paths/More 52×60, capture 50×50).
- "More" sheet: `aria-modal="true"`, named "Everything else", lists every
  destination.
- Entry body reading measure: 649px, ≈87 characters per line, 25.8px leading.
- Light mode: `rgb(247, 245, 241)` page background confirmed from computed style.

### Screenshots

At the time of this release, `docs/screenshots/` held `dark-d-today`,
`light-d-today`, `dark-m-today`, `dark-m-journal`, `dark-d-map`, `dark-m-map`,
`m-more`, `dark-d-share`, `dark-d-entry` (desktop `d` = 1440×950, mobile `m` =
390×844).

> **That set has since been replaced.** `docs/screenshots/` now holds the V0.3
> captures, which no longer show the V0.2 interface. This report is kept as the
> historical record of what shipped at `aefb3fc`; for current stills see
> [V0_3_UI_REDESIGN_REPORT.md](V0_3_UI_REDESIGN_REPORT.md).

### What was *not* tested, stated plainly

- **No physical devices.** No iOS Safari, no Android Chrome, no real touch
  input, no notched-device safe-area check on hardware. The mobile results come
  from Chromium with desktop-class emulation at 390×844, which exercises layout
  and tap-target sizing but not real mobile rendering, momentum scrolling or
  virtual-keyboard behaviour.
- **No Safari or Firefox.** Chromium only.
- **No screen-reader sweep.** Accessible names, roles, focus order and
  `aria-*` state were verified structurally (in the DOM, and by keyboard
  interaction), not by listening to VoiceOver, Narrator or TalkBack.
- **No automated axe/WAVE run.** Semantics were checked by inspection and by
  test assertions, not a third-party audit tool.
- **Zoom was tested as 200% root font size at 390px,** not as browser
  page-zoom on a real device.
- **Performance was not profiled.** No Lighthouse, no CPU throttling, no
  measurement of animation frame cost on a low-end phone.

---

## 9. Remaining gaps

- **Map label density on phones is a deliberate trade-off, not a solved
  problem.** Structure and selection are labelled; other nodes are named on tap.
  A real improvement would be a settled label-steering or clustering pass, and it
  would need testing with genuinely large archives (100+ nodes), which this
  archive was not.
- **The collision resolver is O(n²) in label count.** Fine for tens of nodes;
  an archive with hundreds would want a spatial index.
- **Canvas-size rebuild re-runs layout on every resize.** It is memoised on the
  measured size, but there is no debounce, so a slow device dragging a window
  edge could feel it.
- **Settings still frames bordered inputs inside bordered card rows.** It reads
  as a double frame and is on my list, but I left it rather than change the
  settings layout late without re-verifying the whole screen.
- **No dark/light-specific illustrations or empty states** — the same artwork
  serves both, which is fine but not ideal.
- **Contrast is verified against tokens, not against every rendered pixel.** A
  `color-mix()` used somewhere untested could fall below threshold; the gate
  covers the 106 defined pairings only.

---

## 10. How to reproduce

```bash
npm ci
npm run verify                 # typecheck + 442 tests + contrast + build
npm run preview                # serve the build

# Real-browser audit (opt-in; needs a Chromium binary)
npm install --no-save playwright-core @sparticuz/chromium
node scripts/browser/audit.mjs dark d       # 1440×950, dark
node scripts/browser/audit.mjs light mobile # 390×844, light
node scripts/browser/flows.mjs              # 14 interactive checks
```

Screenshots are written to `/tmp/audit/`.

---

## 11. Conflicts with the request, reported rather than assumed

- **"Redesign every area" vs. "don't replace working architecture."** The Life
  Map's *layout algorithm* had to change — it was producing an unreadable draw.
  Its public shape (`buildLifeMap`, node/edge types, selection helpers) and every
  domain and privacy behaviour are unchanged, and all 24 of its original tests
  still pass alongside 6 new ones (30 total in `layout.test.ts`). I treated the drawing algorithm as presentation.
- **"Accessible outline alternative" vs. mobile label density.** Hiding most
  labels on a phone could be read as withholding map content. It is not: the
  outline lists every record in text, every node keeps its accessible name and
  tap target, and one tap names any node. The label change is visual only.
- **"Preserve privacy guarantees" vs. the repeated private badge.** The badge
  was redundant rather than protective. Privacy is unchanged — only its
  *display* now flags the exception instead of the rule.
