# Capture-hang reproduction & verification harness (ADR 0011)

Tools used to prove and fix the Android Chrome "save spins forever" defect.
Run them against a built app (`npm run build && npm run preview`).

- `capture-debug.mjs` — instrumented repro in headless Chromium (phone
  viewport): wraps IndexedDB open/transaction and fetch, logs the service
  worker lifecycle, polls the dialog UI for 20 s, and dumps the resulting
  records. Modes via `MODE`: `M1` fresh, `M2` SW-controlled reload,
  `M3` offline at tap, `M4` double tap, `M5` CPU throttled ×6,
  `M6` offline reload. Env: `BASE_URL` (default http://127.0.0.1:4173),
  `CAPTURE_TEXT` (default "Testing Chronicle").
- `blackhole-proxy.mjs` — forwards to `TARGET` (default :4173) but never
  answers requests matching `STALL` (default `/assets/analyzer-`). Reproduces
  the field failure: a module request that hangs without settling. On the
  pre-fix build this produced the endless spinner; the fixed build has no
  such request in its save path, so it is immune.
- `verify-fix.mjs` — final mobile verification: exact repro at 390×844,
  Journal navigation, real page reload, direct IndexedDB check, screenshots
  into `/home/user/shots/bugfix`-style dir (see `SHOT_DIR` in source).

These scripts resolve `puppeteer-core` / `@sparticuz/chromium` from a local
toolchain directory (`/home/user/.cache/shots/node_modules`) and need an NSS
library path (`LD_LIBRARY_PATH`) when using the bundled Chromium.
