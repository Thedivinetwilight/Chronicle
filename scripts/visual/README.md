# Visual & interaction verification (real browser)

`harness.mjs` drives a real headless Chromium against a running Chronicle
build. It is development tooling — it never ships in the app bundle and adds
no runtime dependency.

## What it does

- **Screenshots** (`SUITE=shots`): every route × viewport × theme, plus the
  capture composer and the review-before-save sheet.
  Viewports: 390×844 and 360×740 (phones), 834×1112 (tablet), 1440×900 and
  1680×1000 (desktop). Themes: light and dark.
- **Layout / touch audit** (with every screenshot): horizontal overflow,
  elements clipped outside the viewport, and touch-target sizes on coarse
  pointers. Primary targets must be ≥ 44 px; compact secondary targets
  (chips, row checks, small buttons) must be ≥ 32 px, which still exceeds
  WCAG 2.2 AA (24 px).
- **Interactions** (`SUITE=interactions`): capture → review → save → visible
  in journal; undo from the toast (soft delete); visible keyboard focus ring;
  theme switch from Settings; search highlighting; project delete impact
  preview; and rendering with the network cut (service worker).

The harness seeds a small fictional demo archive (project “Orbital Telemetry”
etc.) directly into IndexedDB so screenshots show a lived-in app. The seed is
created only inside the test browser profile and is never part of the app or
its data.

## Running it

```bash
npm run build && npm run preview -- --host 127.0.0.1 --port 4173 &

# a local Chrome/Chromium:
CHROME_PATH=$(which chromium) SUITE=shots SHOT_DIR=/tmp/shots node scripts/visual/harness.mjs

# or the serverless Chromium bundle (needs its shared libraries available):
npm i -D puppeteer-core @sparticuz/chromium
SUITE=interactions node scripts/visual/harness.mjs
```

Environment variables: `BASE_URL` (default `http://127.0.0.1:4173`),
`SHOT_DIR`, `SUITE` (`shots` | `interactions`), `VIEWS`, `THEMES`,
`CHROME_PATH`.

Results are written to `$SHOT_DIR/report.json` alongside the PNGs. Screenshots
are verification artefacts and are intentionally **not** committed to Git.
