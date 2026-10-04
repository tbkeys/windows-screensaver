# Contributing

Thanks for helping keep the maze faithful. This is a small project with a strict shape;
the notes below are everything you need to fit in.

## Setup

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # node --test over test/*.test.js (pure modules, no browser)
npm run build      # dist/
npm run smoke      # headless Chromium against dist/, fails on console errors
```

Node 22+ is required. There is no lint step; match the style of the surrounding file.

## Ground rules

* **`docs/ARCHITECTURE.md` is the contract.** Module boundaries, exported names,
  coordinate conventions (cell `(x, y)` → world `+X/+Z`, headings `0..3 = N E S W`,
  wall bits `N=1 E=2 S=4 W=8`) and the config-change flow are defined there. Change the
  document in the same pull request as the code when a contract has to move.
* **Plain ES modules, no TypeScript, no new runtime dependencies.** `three` and
  `lil-gui` are the whole runtime; the built site must keep working as static files
  with zero network calls.
* **One config object.** Every tweakable lives in `src/config/defaults.js`. The GUI is
  generated from `DEFAULTS`, so a new leaf shows up automatically; add a range or
  dropdown for it in `SPECS` in `src/ui/gui.js`, and map its dotted path to an action in
  `src/app.js` if changing it needs a rebuild. Read config values live rather than
  caching them, unless the architecture says the thing is rebuilt on change.
* **Deterministic randomness.** Anything random goes through `createRng(seed)` or a
  labelled `rng.fork()`. The same seed must produce the same maze, decorations and
  textures in every browser and in Node.
* **GPU hygiene.** Everything that creates geometries, materials, textures or render
  targets has a `dispose()` that frees them. No per-frame allocations in `update()`
  and `render()` paths; share materials; keep the maze one merged geometry.
* **Short JSDoc on every export**, small pure helpers, no dead code or placeholder
  comments.

## Adding things

| To add… | Touch |
| --- | --- |
| a maze algorithm | `ENUMS.mazeAlgorithms` in `defaults.js`, a carver in `src/maze/generator.js` (must yield a perfect maze before braiding), a case in `test/generator.test.js` |
| a walking strategy | `ENUMS.strategies`, a builder in `src/maze/navigator.js`, `test/navigator.test.js` |
| a texture kind | `ENUMS.surfaceTextures` or `posterTextures`, a painter in `src/render/textures.js` (must tile seamlessly; `scripts/dev/check-textures.mjs` measures the seam) |
| a finish transition | `ENUMS.finishTransitions`, a kind in `src/sim/transitions.js` |
| a preset | `ENUMS.presets` and `src/config/presets.js` (partial config merged over defaults) |
| a post effect | a uniform + shader branch in `src/render/post.js`, a leaf under `effects` in `defaults.js` |

## Pull requests

* Keep them focused; one feature or fix per PR.
* `npm test` and `npm run smoke` must pass. Add or extend a `test/*.test.js` for pure
  logic; for anything visual, attach a screenshot (the pages under `scripts/dev/` are
  the quickest way to isolate a module).
* Describe how the change relates to the 1995 original: is it restoring authentic
  behaviour, or an optional modern extra? Extras must default to the classic look.
