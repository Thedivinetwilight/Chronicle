# Design system — Chronicle

The visual language is deliberately small. Everything derives from
`src/styles/tokens.css`; component styles in `src/styles/global.css` reference
tokens only, never raw values.

## 1. Voice

Obsidian and amethyst. Deep graphite surfaces, warm off-white text, restrained
silver-grey hairlines in place of shadows, and exactly one accent. No pure
black, no glass, no decorative colour, no gradient on an interactive surface.

Colour carries meaning: accent = action and current position, green =
achieved/success, amber = caution or pending, red = destructive, blue-grey =
informational. Amethyst (≈248°) was chosen over a warm gold because gold sat
too close to the warning hue to stay separable at small sizes, and because
"attention" should not be the dominant note in a personal archive. The four
semantic hues are 107°/151°/117° apart from the accent.

The palette is two deliberate schemes, not one inverted: dark is the default
block, light is a companion worked out on its own warm paper.

## 2. Tokens

### Colour (verified by `npm run contrast`)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-bg` | `#f7f5f1` | `#0b0c0e` | page |
| `--color-bg-deep` | `#f2efea` | `#08090b` | map canvas, recesses |
| `--color-surface` | `#fffefc` | `#15161a` | cards, sheets |
| `--color-surface-subtle` | `#f1eee8` | `#1b1d22` | wells, hovers |
| `--color-surface-raised` | `#ffffff` | `#22242a` | menus, popovers |
| `--color-nav` | `#fbf9f5` | `#0e0f12` | rail, header, tab bar |
| `--color-text` | `#1a1917` | `#f0eee9` | body (16.88:1 dark) |
| `--color-text-muted` | `#5a5750` | `#adaba5` | secondary (8.45:1 dark) |
| `--color-text-faint` | `#6e6a62` | `#918f87` | meta (5.51:1 dark) |
| `--color-accent` | `#4a3e9c` | `#a9a0e8` | actions, current position (7.84:1 / 8.28:1) |
| `--color-on-accent` | `#ffffff` | `#14102b` | labels on accent (8.54:1 / 7.80:1) |
| `--color-success` | `#2e6b47` | `#8fc9a3` | achieved / positive |
| `--color-warning` | `#7a5410` | `#d9b26a` | caution / pending |
| `--color-danger` | `#9c3b2e` | `#e58f87` | destructive, errors |
| `--color-info` | `#24505f` | `#9dc0d9` | informational |

`#0b0c0e` is 1.073:1 against `#000000` — deliberately not pure black, so large
dark fields do not crush on OLED or band on cheap panels. Each semantic colour
also has `-subtle` (≈0.13 dark / 0.09 light) and `-border` (≈0.34 / 0.28)
variants, so state is never signalled by colour alone.

Borders: `--color-border` is a decorative hairline (10 % neutral).
`--color-border-strong` is a solid control outline that clears 3:1 against the
page (WCAG 1.4.11) — `scripts/check-contrast.mjs` enforces all of the above and
fails the build on regression.

### Type

Scale: 11 / 12 / 13.5 / 15 / 17 / 21 / 26 / 32 px, plus a display step of
`clamp(30px, 6.5vw, 40px)` for page titles. System font stack (no webfont
download). Body line-height 1.72; long-form reading uses
`--line-height-reading` at a `68ch` measure (`--measure`). Uppercase is reserved
for section eyebrows at 11 px with 0.08em tracking — never for content.

`.text-block` (hand-authored prose) and `.markdown` (rendered Markdown, used by
entry bodies) share one set of prose rules, so long-form reading is consistent
wherever it appears.

### Space & shape

4 px base scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96. Radii
5 / 7 / 11 / 16 / 22 / pill. Depth is a hairline plus at most one soft shadow
per elevation (`--shadow-sm/md/lg`), never stacked.

### Motion

80 ms for press feedback, 130 ms for hover, 200 ms for state, 280 ms for
entrances. Sheets and dialogs rise 8 px and fade; menus fade; map selection grows
the glyph and thickens its ring without moving neighbours. No parallax, no
bounce, no looping decoration. `prefers-reduced-motion` and the `reduce_motion`
setting both collapse every duration token to 0 — verified in a real browser
(`--duration-base` and `--duration-enter` compute to `0ms`).

## 3. Layout

- The shell is an explicit CSS grid with named areas: sidebar (≥ 1024 px),
  sticky header, and main. Grid placement is declared per region, never left
  to auto-flow — a regression here once pushed main content below the fold.
- < 640 px: single column, bottom tab bar (five destinations, a centred capture
  button, and "More"), dialogs are bottom sheets with a grip; the header carries
  the brand. The tab bar declares seven grid tracks for its seven children — a
  six-track declaration once wrapped "More" out of the fixed bar entirely, which
  no horizontal-overflow check could catch.
- 640–1023 px: same, centred dialogs.
- ≥ 1024 px: persistent 248 px sidebar with the capture action; tab bar hidden;
  the header names the current section instead of repeating the brand.
- Reading views cap at `--measure` (68ch); content caps at 68 rem, wide 84 rem.
- Safe-area insets respected top and bottom (installed PWA).
- Touch targets are tiered: primary controls ≥ 44 px on coarse pointers;
  compact secondary targets (tag chips, row checks, small buttons) ≥ 32 px,
  above WCAG 2.2 AA (24 px). The visual harness enforces both tiers.

## 4. Components

Buttons (default/primary/quiet/danger, two sizes), icon buttons, fields with
visible labels and hints, selects, switches, segmented controls, cards with
header/body, lists, badges, tag chips, dialogs (focus-trapped, scroll-locked,
Escape closes), toasts with optional action, empty/loading/error states,
skeletons, and the rendered-Markdown view.

Distinctive surfaces, all token-driven:

- **Composer** (home): a borderless writing surface that gains an accent ring
  on focus; the action and a quiet hint share its footer row.
- **Section head**: uppercase 12 px label with an optional trailing link,
  used by every list section on every page.
- **Proposal** (capture review): head + body panels per proposed record, with
  the verbatim original in a quoted **provenance** block.
- **Row check**: circular complete-toggle at the start of task rows.
- **State halo**: soft circle behind empty/error icons.
- **Sheet grip**: 36×4 px bar that marks dismissible bottom sheets.

## 5. Accessibility rules (enforced in code and review)

1. Every control has a visible label or `aria-label`; dialogs are labelled.
2. Focus is visible everywhere (`:focus-visible` ring, 2 px, offset 2 px) and
   returns to the opener when a dialog closes.
3. Touch targets ≥ 44 px on coarse pointers.
4. Text contrast ≥ 4.5:1; UI boundaries ≥ 3:1 (checked mechanically).
5. Motion is optional; nothing depends on animation to convey state.
6. Colour is never the only carrier of meaning (badges carry text).
7. Headings form a hierarchy per page; landmarks (`nav`, `main`, `aside`) are
   labelled.

---

## 6. The Life Map palette and shape system (V0.2)

The map needed a second palette: it draws records as *kinds*, and a kind must be
readable at a glance without becoming decoration. The rules were:

1. **Two tokens per kind.** Every kind owns an `--map-ink-*` (the label and the
   stroke) and a `--map-fill-*` (the node body). Both themes define the full
   set; no kind falls back to a generic colour.
2. **Contrast is part of the contract.** All seven ink-on-own-fill pairs are in
   `scripts/check-contrast.mjs` alongside `--map-edge` and the canvas text, so a
   future palette tweak that looks fine but reads badly fails `npm run contrast`
   before it ships. Two of the first twelve draft pairings failed exactly this
   way (edges at 2.3:1) and were darkened rather than waved through.
3. **Kind is never colour alone.** Each kind also has a distinct silhouette —
   chapter = diamond, experience = circle, path = circle with a ring, place =
   pin, person = circle with head and shoulders, trip = circle with a cross,
   collection = square — and every node renders a text label on the canvas.
4. **Warm, calm canvas.** `--map-canvas` / `--map-canvas-deep` sit close to the
   page background with a faint `--map-grid`, so the map reads as a quieter
   surface rather than a dashboard. There are no scores, ranks or progress bars
   anywhere in the palette.
5. **Uncertainty has its own token.** `--map-uncertain` marks a node whose date
   or place is unknown; it is used with a text note, never as the sole signal.

### Map interaction contract (implemented in `LifeMapCanvas.tsx`)

| Input | Behaviour |
| --- | --- |
| Drag (mouse or one finger) | pans |
| Wheel | pans (page scroll is preserved by not hijacking without a modifier) |
| Ctrl/⌘ + wheel | zooms |
| Two-finger pinch | zooms |
| Arrow keys | pan; Shift+arrows pan further |
| `+` / `-` / `0` | zoom in, zoom out, reset |
| Escape | clears the selection |
| Buttons | zoom in/out, fit to content, reset — always on screen, ≥ 44 px |

The map fits its content on first measure and on resize, but stops doing so
once the user has moved the view — re-fitting under someone's hands is the
classic map annoyance. With `prefers-reduced-motion` (or the app's own
reduce-motion setting) all transitions are removed; position changes still
apply instantly.

## 4. State is never colour-only

Three structural signals sit alongside colour:

- the active sidebar item carries a **left rule**;
- the active tab carries a **top bar**;
- every Life Map node kind has a **different glyph geometry** (diamond, square,
  circle, pin, plane, layered square), so shapes stay distinguishable in
  greyscale.

Disabled controls use `--color-text-faint` on `--color-surface-subtle` — an
already-verified 4.5:1 pairing — rather than reduced opacity, which had left
labels genuinely hard to read.

## 5. Life Map label rules

The map is drawn in map space and fitted to the canvas. Two rules keep it
readable at every size:

- **Geometry derives from the measured canvas**, not fixed constants, and the
  layout is rebuilt when the canvas resizes. A fixed 920×720 design scaled to a
  350 px phone had shrunk labels to roughly 40 %.
- **Labels extend outward along their own radius** and are then de-collided by a
  deterministic resolver (`placeLabel` / `resolveLabelCollisions` in
  `src/domain/lifeMap/layout.ts`). Bounds are computed from the same placements,
  so the fit transform cannot clip text. On canvases narrower than 640 px only
  the structural nodes (chapters, paths) and the selected node are labelled;
  every node keeps its shape, position, accessible name and tap target, and the
  outline view remains the complete text route to the same records.
