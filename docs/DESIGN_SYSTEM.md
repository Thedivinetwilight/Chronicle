# Design system — Chronicle

The visual language is deliberately small. Everything derives from
`src/styles/tokens.css`; component styles in `src/styles/global.css` reference
tokens only, never raw values.

## 1. Voice

Paper and ink. Warm neutral surfaces, one ink-blue accent, no gradients, no
glass, no decorative colour. Colour carries meaning: accent = action, green =
achieved/success, amber = caution or pending, red = destructive.

## 2. Tokens

### Colour (verified by `npm run contrast`)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-bg` | `#FBFAF8` | `#131316` | page |
| `--color-surface` | `#FFFFFF` | `#1A1A1F` | cards, sheets |
| `--color-surface-subtle` | `#F5F3EF` | `#212128` | wells, hovers |
| `--color-text` | `#1C1917` | `#F2F0ED` | body (16.8:1 / 16.3:1) |
| `--color-text-muted` | `#57534E` | `#B8B3AB` | secondary (7.3:1 / 8.9:1) |
| `--color-text-faint` | `#6F6A64` | `#99938B` | meta (5.1:1 / 6.1:1) |
| `--color-accent` | `#3D5A80` | `#8FB0D9` | links, actions (6.8:1 / 8.3:1) |
| `--color-on-accent` | `#FFFFFF` | `#14202E` | labels on accent |
| `--color-success/warning/danger` | `#3F7D58` / `#8A5F27` / `#A34A3F` | `#7FBF9A` / `#D9A85C` / `#E08A7C` | meaning |

Borders: `--color-border` is a decorative hairline (10 % neutral).
`--color-border-strong` is a solid control outline that clears 3:1 against the
page (WCAG 1.4.11) — `scripts/check-contrast.mjs` enforces all of the above and
fails the build on regression.

### Type

Scale: 11 / 12 / 13 / 15 / 17 / 20 / 24 / 30 px. System font stack (no webfont
download). Body line-height 1.55; reading views 1.7 with a 45 rem measure.

### Space & shape

4 px base scale (4–64). Radii 6 / 10 / 14 / pill. One shadow per elevation
level (`--shadow-sm/md/lg`), never stacked.

### Motion

120–200 ms ease-out for state changes; sheets rise, dialogs fade-scale.
`prefers-reduced-motion` and the `reduce_motion` setting both collapse all
durations to 0 via tokens.

## 3. Layout

- The shell is an explicit CSS grid with named areas: sidebar (≥ 1024 px),
  sticky header, and main. Grid placement is declared per region, never left
  to auto-flow — a regression here once pushed main content below the fold.
- < 640 px: single column, bottom tab bar (five destinations + capture),
  dialogs are bottom sheets with a grip; the header carries the brand.
- 640–1023 px: same, centred dialogs.
- ≥ 1024 px: persistent 260 px sidebar with the capture action; tab bar hidden;
  the header names the current section instead of repeating the brand.
- Reading views cap at 45 rem; lists cap at 64 rem.
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
