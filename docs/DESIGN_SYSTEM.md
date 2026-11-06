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

### Copy rules (applied across the V0.3 sweep)

Every visible sentence has to earn its place. The rules that removed the most
text:

1. **Privacy is stated once per context, not once per screen.** The archive
   never leaves the device; repeating that on Today, in the entry editor, on
   Settings and again on the share preview turned a fact into a nervous tic. It
   now appears where a user would actually ask the question: the first-run
   panel, the private toggle, Settings' storage line, and the share preview's
   "nothing is published" notice.
2. **Hint, don't repeat.** A control's hint says what will happen; it does not
   restate the label. "Private" now reads "Kept out of share previews. Nothing
   is published either way." rather than explaining the build's architecture
   inside a switch.
3. **A masthead is a date, not a greeting.** Today's `h1` is `4 Nov 2026`, with
   a time-of-day eyebrow above it (`Morning` / `Afternoon` / `Evening`, and
   `Late. Worth writing down.` after midnight). "Good afternoon" is the software
   being cheerful at you, and it is wrong more often than it is right.
4. **Teach the shortcut where the shortcut is.** The composer's hint is now
   `Ctrl or ⌘ + Enter to save` instead of repeating where the text is stored.
5. **No error string explains the device.** "It may have been deleted." not
   "…deleted on this device." Nothing else could have happened to it.

### Honest labels

`autonomous` (a stored capture-mode value) is labelled **Silent** in the UI. The
engine is a local rule-based parser; "Autonomous" implied an agent making
decisions on the user's behalf. The stored value is unchanged, so no migration
was needed, and the mode still behaves exactly as before: files without asking,
corrections available afterwards.

**Dates the record does not claim.** `occurred_precision` is
`exact | day | week | month | year | unknown`. Only `week`, `month` and `year`
are approximations; `day` is exact to the day and `unknown` is the opposite of a
guess. `unknown` records are stored at the moment of writing so lists have an
order, which means **the stored instant is never printed for them**. Use the
helpers in `src/ui/format.tsx`:

- `WhenItHappened` — relative time for lists.
- `WhenExactly` — full timestamp for detail views.
- `precisionNote` — `week only` / `month only` / `year only`, and `null` for
  `exact`, `day` and `unknown` (those two helpers already speak for `unknown`).

Both `When*` components render `Date not recorded` in place of a timestamp when
the precision is `unknown`, so a date and a disclaimer can never disagree. Never
slice `occurred_at` to ten characters — `when.test.tsx` fails the build if a page
does.

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

## 4b. Artwork (V0.3)

All artwork is hand-authored SVG in this repository — no icon packs, no stock
vectors, no generated imagery, no emoji as icons. Two families:

### Marks — `src/ui/art/Mark.tsx`

A single closed set of 14 line marks on a **24×24 grid, `stroke-width: 1.5`,
round caps and joins, `fill="none"`, `currentColor`**: `sprig`, `frond`, `moon`,
`sun`, `wave`, `ridge`, `compass`, `feather`, `shell`, `seed`, `star`, `route`,
`quill`, `leaf-cluster`.

**Nine are wired** — one per sidebar destination, via `SECTION_MARKS`, shown in
the nav and again in that section's empty state. The remaining five (`frond`,
`moon`, `wave`, `seed`, `star`) are drawn but unused. That is a deliberate reserve
rather than a finished set: they exist so a future destination can be given a
mark in the same hand without inventing a new style, and `art.test.ts` keeps them
held to the same grid and stroke rules. Do not present the family as "in use"
until it is.

`nav.ts` is the single source of the navigation model so the mark/data pairing can
be asserted directly — including that no destination reuses a glyph another
destination already claims (`art.test.ts`, "art direction consistency"). That
test exists because the Life map's mark and Roadmap's icon were both a compass.

| Section | Mark | Reads as |
| --- | --- | --- |
| Today | `sun` | the day itself |
| Life map | `compass` | orientation, not distance |
| Journal | `quill` | the written record |
| Chapters | `sprig` | something that grew over a season |
| Paths | `route` | a direction with a turn in it |
| Trips | `ridge` | ground crossed |
| Places & people | `shell` | something found and kept |
| Collections | `leaf-cluster` | gathered by hand |
| Share preview | `feather` | a light impression, not a post |

`SECTION_MARKS` maps each destination to its mark so the shell and the page
cannot drift apart. A mark is **decorative by default** (`aria-hidden="true"`,
no `<title>`); pass `title` and it becomes `role="img"` with a real `<title>`. A
mark next to a visible text label always stays decorative — the label already
names the thing, and a duplicate announcement is noise.

`EmptyState` takes either a `mark` (a section, which gets the same drawing as its
nav entry) or an `icon` (a utility state such as search or a failed import, which
has no section and keeps the icon set).

`DayPlate` is a second, finer plate (**56×36, `stroke-width: 0.9`**) drawn for
the Today masthead: a sun behind a sea horizon that is deliberately broken where
the disc crosses it, three water lines, two reeds in the right margin. The break
matters — a centred disc on a continuous horizon reads as a face, not a
landscape. It is hidden below 560 px, where it would render under 1 px per unit
and become noise; the date carries the mobile masthead alone.

### Cover plates — `src/ui/art/Cover.tsx`

Records get a printed-plate cover rather than a thumbnail. `buildCover(kind, id,
name)` is **deterministic**: the same record always produces the same plate, and
a rename visibly shifts it. It hashes `kind:id:name` into a motif and a wash
pair, so plates differ without storing anything and without inventing imagery
that pretends to depict the record.

- Kinds: `chapter | path | collection | trip` (120×84 view box).
- Motifs: contour, strata, hachure, orbit, ripple, grid-cut.
- Ink `#b9b4a9` dark / `#8a8479` light; washes from `--art-wash-a/b/c`.
- Ripple rings are clamped by `maxRw` to the origin's distance to each edge —
  without the clamp the view box silently clips them and it reads as a render
  fault rather than a drawing.
- Contour rings **drift** and every other ring is left open. Perfectly nested
  closed loops around one centre read as a ball of yarn: the eye follows the
  loops instead of the landform, and two chapters that both drew `contour` were
  indistinguishable. Real contours walk downhill and run open off the plate.

**Proportion is a contract.** The plate's box is always 120:84 —

- the SVG declares `aspect-ratio: 120 / 84` and carries no height prop, so it
  fills whatever box its container gives it;
- `.coverframe` declares the same ratio, because the frame is what a grid or
  flex track actually sizes;
- `preserveAspectRatio="xMidYMid slice"` then has nothing to crop.

Both failure modes were shipped and both are now guarded. With a *fixed* height
prop and a fluid width the boxes came out 1.9–3.1:1 around a 1.43:1 drawing, so
`slice` silently cropped a quarter to half of every plate. Switching to `meet`
without fixing the box was worse: the wash letterboxed into a bare strip down
one side, because a plate is a filled rectangle, not a floating drawing.
`art.test.ts` asserts the markup contract and `flows.mjs` measures the result in
a real browser (ratio within 0.02 of 1.43, wash within 1.5 px of the box).

Shelf density follows from this: tracks at `min(100%, 190px)` and a `250px`
cap when a shelf holds one item, so a plate sits around 200×140 rather than
dominating the page at 318×224.

`art.test.ts` enforces the invariants above, including one stroke weight per
family and the absence of `<image>`, `<filter>` and `<linearGradient>`.

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

### Edge weights and the legend (V0.3)

The map draws two kinds of line, and they used to differ only in colour — which
failed for everyone who cannot separate two greys. In V0.3 the distinction is
structural:

| Line | Token / rule | Weight | Style |
| --- | --- | --- | --- |
| Spine (chronological path) | `--map-edge` | 1.4 | solid |
| Link (associative connection) | `--map-edge` | 1.1 @ 0.85 | dashed `4 5` |
| Selected | `--map-edge-strong` | 1.8 | solid |
| Dimmed (filtered out) | — | — | opacity 0.12 |

`--map-edge` was lifted to `#8d8f98` (dark) and `#6a655c` (light) so the spine
stops disappearing into the canvas at the faint end of the range.

The page carries a **shape legend** under the canvas — two columns of glyph +
name, then a one-line note that links are dashed and that position means time,
not importance. It replaced a paragraph of prose that explained the same thing
in the abstract; a reader should not have to be taught a diagram in words.

### Every drawn shape names its fill

The map's most serious bug was a styling omission that only one theme revealed.
`.lifemap__ring`, `.lifemap__shape-ring`, `.lifemap__shape-detail` and
`.lifemap__uncertain` were used in the JSX but had **no CSS rule**, and neither
did the bare `<circle>` glyphs for experience, path, person and trip. SVG
defaults to `fill: black`, so:

- in **light** mode three concentric black circles covered the warm canvas — the
  whole map read as a black disc on paper;
- in **dark** mode the same default made every experience a hollow ring on a
  near-black field, i.e. invisible.

Neither showed up in a measurement. Both are now enforced:

1. **A shape names its filled/stroked class.** `.lifemap__shape--<kind>` carries
   `fill` and `stroke` from `--map-fill-*` / `--map-ink-*`; a bare `<circle>` is
   no longer acceptable.
2. **Detail marks inherit their own kind's ink.** The person's head-and-shoulders
   and the trip's cross previously shared one hard-coded person-blue.
3. **Annotations are their own style.** `date not exact` is 9.5 px, in
   `--map-uncertain`, haloed against the canvas — an annotation, not a name.
4. `mapStyles.test.ts` reads the canvas source for every `lifemap__*` class and
   fails if the stylesheet lacks a rule for it. A class name is not a style.

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

The resolver's rules, all of which were learned from shipped defects:

- **Widths are estimates and must over-estimate.** `CHAR_WIDTH` is the measured
  advance of the label face, not a guess. Under-measuring is how labels came to
  overlap and to run off the canvas.
- **A character budget is not a pixel ceiling.** Text is never clipped in the
  SVG, so a long label draws every character it was given. Convert the cap to a
  character count and multiply back out.
- **Annotations reserve space.** A node with `uncertain` or `undated` draws a
  second line of text 13px from its label; `noteBox` reserves that band so no
  other label is placed across it.
- **Clearance, not mere non-intersection.** Two 11px text runs 0.5px apart read
  as touching; placement requires 3px.
- **Elide before overflowing.** If the text still cannot fit at its anchor, the
  resolver shortens it and exposes the result as `placement.text`. The renderer
  draws that; the accessible name and the outline keep the full title.

`uncertain` and `undated` are different claims and carry different words —
"date not exact" versus "undated" — and only `uncertain` is an approximation.
