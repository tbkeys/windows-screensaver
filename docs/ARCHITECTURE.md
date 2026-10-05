# Architecture & Module Contracts

This document is the source of truth for how the modules of the Win95 3D Maze
recreation fit together. Every module is a plain ES module under `src/`, bundled by
Vite. `three` and `lil-gui` are the only runtime dependencies; everything is served
as static files (no server-side code, no CDN calls).

## Coordinate conventions (used everywhere)

* The maze is a grid of `width × height` cells. Cell `(x, y)` with `0 ≤ x < width`,
  `0 ≤ y < height`. `x` grows to world **+X**, `y` grows to world **+Z**.
* `cellSize` world units per cell (default 1). Cell `(x, y)` is centred at world
  `(( x + 0.5) * cellSize, _, (y + 0.5) * cellSize)`. Floor is at `y = 0`, ceiling at
  `y = wallHeight`.
* **Headings / wall directions** are integers `0..3`:
  `0 = N (−Z)`, `1 = E (+X)`, `2 = S (+Z)`, `3 = W (−X)`.
  `DIRS = [{dx:0,dy:-1},{dx:1,dy:0},{dx:0,dy:1},{dx:-1,dy:0}]`, `OPPOSITE = [2,3,0,1]`.
  Turning **right** = `(h + 1) & 3`, turning **left** = `(h + 3) & 3`.
* **Yaw** in radians for heading `h` is `yawForHeading(h) = -h * Math.PI / 2`
  (three.js cameras look down −Z at yaw 0; rotating by −90° about +Y looks down +X).
* Wall bitmask per cell: `N = 1, E = 2, S = 4, W = 8` (bit set = wall present).

These helpers live in `src/maze/grid.js` and are exported: `DIRS`, `OPPOSITE`,
`WALL_BITS`, `yawForHeading`, `turnLeft`, `turnRight`.

## Config

`src/config/defaults.js` exports `DEFAULTS` (the template), `ENUMS`
(option lists for every dropdown), `createConfig()` (deep clone of defaults) and
`deepMerge(target, partial)`. The whole app shares **one mutable config object**
(the result of `createConfig()`), and lil-gui binds directly to its leaves. Nothing
caches config values across frames unless the contract below says it is rebuilt on
change – read `config.x.y` live.

It also exports `RANGES` (`path → [min, max, step]` for every numeric leaf) and
`ENUM_FIELDS` (`path → ENUMS list name` for every dropdown). The GUI builds its sliders and
dropdowns from these two tables and `sanitizeConfig()` (src/app/settings.js) clamps and
validates every value that arrives from storage, a share URL or an import against them,
so the two can never disagree. `deepMerge` ignores unknown and prototype keys and never
swaps a sub-tree for a scalar. `SESSION_PATHS` (`movement.paused`, `movement.manual`,
`screensaver.screensaverMode`) are session state: never persisted, shared or imported.

Change propagation: the GUI calls `onChange(path, value, finished)` with a dotted path
such as `'textures.wall.kind'`; `finished` is false while a slider or colour is still
being dragged (app.js debounces expensive rebuilds until it is true). `src/app.js` owns a table mapping path prefixes → actions
(rebuild maze, rebuild materials, update lighting, resize, …). Modules never import
the GUI.

## Modules

### `src/maze/rng.js`
```js
export function hashSeed(seed: string|number): number     // 32-bit, deterministic (xmur3/FNV)
export function createRng(seed: string|number): Rng
// Rng = () => number in [0,1)   plus methods:
//   rng.int(n)            integer in [0, n)
//   rng.range(a, b)       float in [a, b)
//   rng.pick(array)       element
//   rng.shuffle(array)    in-place Fisher-Yates, returns array
//   rng.chance(p)         boolean
//   rng.fork(label)       new independent Rng derived from this seed + label
export function randomSeedString(): string                  // e.g. 'dusty-modem-4f21'
```
Implementation: sfc32 or mulberry32 – deterministic across browsers.

### `src/maze/grid.js`
```js
export class Maze {
  constructor(width, height)
  width; height; cells: Uint8Array /* wall bitmask per cell, all walls initially */
  start: {x, y, heading}   // heading = initial camera heading (faces START poster wall if any)
  finish: {x, y}
  index(x, y) → number
  inBounds(x, y) → boolean
  hasWall(x, y, dir) → boolean
  canStep(x, y, dir) → boolean      // no wall AND neighbour in bounds (the one walkability test)
  setWall(x, y, dir, present)      // keeps neighbour consistent
  carve(x, y, dir)                  // remove wall between (x,y) and neighbour
  openDirs(x, y) → number[]         // dirs with no wall AND in bounds
  neighbor(x, y, dir) → {x,y}|null
  isDeadEnd(x, y) → boolean         // exactly one open dir
  deadEnds() → {x,y}[]
  bfs(from:{x,y}) → Int32Array      // distances, -1 unreachable
  shortestPath(from, to) → {x,y}[]  // inclusive both ends
  farthestCellFrom(from) → {x,y}
  countPassages() → number
  clone() → Maze
}
```

### `src/maze/generator.js`
```js
export function generateMaze(opts: {
  width, height, algorithm, seed, braid /*0..1*/,
  startPlacement /* 'edge'|'corner'|'random'|'deadEnd' */,
  finishPlacement /* 'farthest'|'random'|'opposite'|'deadEnd' */,
  growingTreeMix /* 0..1, only for 'growingTree' */,
  roomChance /* 0..1, only for 'recursiveDivision'-ish variants */ }) → Maze
```
Algorithms (ids are stable, used by `ENUMS.mazeAlgorithms`): `backtracker`, `prim`,
`kruskal`, `wilson`, `aldousBroder`, `huntAndKill`, `growingTree`, `binaryTree`,
`sidewinder`, `recursiveDivision`, `ellers`. All produce a *perfect* maze (spanning
tree, every cell reachable) before `braid` optionally removes dead ends. Same
`seed` + options ⇒ identical maze on every run. Start/finish are never the same cell;
`maze.start.heading` faces a closed wall of the start cell when one exists (that wall
gets the START poster) otherwise the first open dir.

### `src/maze/navigator.js`
```js
export function createNavigator(strategyId, maze, rng) → {
  next(cell:{x,y}, heading:number) → 'forward'|'left'|'right'|'back',
  reset()
}
```
Strategies (`ENUMS.strategies`): `leftHand` (classic default), `rightHand`,
`random` (random open dir, avoids reversing unless dead end), `solver` (follows BFS
shortest path to `maze.finish`), `explorer` (Trémaux-like: prefers unvisited, falls
back to least-visited), `drunk` (random including reversals). `forward` is only
returned when there is no wall ahead. `back` means a 180° in-place turn. Wall
followers must fall back to `solver` after `4 * width * height` decisions without
reaching the finish (braided mazes can trap them).

### `src/sim/walker.js` – grid-locked movement state machine
```js
export class Walker {
  constructor({ maze, navigator, movement /* config.movement */, cellSize })
  // public read-only state
  cell: {x, y}; heading: 0..3; state: 'idle'|'turning'|'stepping'|'waiting'|'finished'
  pose: { x, z, yaw, bob }          // world units/radians, current tick
  prevPose                          // previous tick (for interpolation)
  on(event, fn) / off(event, fn)    // events: 'enterCell' {x,y,heading}, 'leaveCell',
                                    //   'turnStart' {from,to}, 'stepStart', 'finish'
  update(dt)                        // advance exactly one simulation tick of dt seconds
  interpolatedPose(alpha) → pose    // lerp prevPose→pose (shortest-arc yaw)
  setMaze(maze)                     // reset to maze.start
  teleport({x,y}, heading)          // instant relocation (prevPose = pose)
  enqueue(action)                   // manual mode input: 'forward'|'left'|'right'|'back'
  setNavigator(nav)
}
```
Behaviour: at a cell centre in `idle` the walker asks the navigator (or the manual
queue when `movement.manual`) for an action. `left/right/back` ⇒ `turning` for
`turnDuration` (× 2 for back) using `turnEasing`; `forward` ⇒ `stepping` for
`stepDuration` using `stepEasing`. `pauseBeforeTurn`, `pauseAfterTurn`,
`pauseAtDeadEnd` insert `waiting`; `pauseAtStart` makes `setMaze()` begin with a `waiting`
dwell on the START sign (not after `teleport`). `quantize > 0` snaps the eased progress to
`floor(p * quantize) / quantize` (reproduces chunky original motion even at high FPS).
`headBob` adds `sin()` vertical offset while stepping. When `movement.paused` the
walker does nothing. Entering `maze.finish` emits `finish` and sets `state='finished'`
until `setMaze` is called. The rat reuses this class with its own navigator.

### `src/sim/loop.js`
```js
export function createLoop({ tick(dt), render(alpha, dt), getTickRate(), getFpsCap(), getTimeScale(), getFixedTimestep() })
  → { start(), stop(), running, fps, frameTime }   // raf/caf/now/doc are injectable for tests
```
Fixed-timestep accumulator for `tick` (clamps dt to 0.25 s to avoid spiral of death);
`render` runs at most `fpsCap` times per second (`0` = uncapped / vsync), with
`alpha` = accumulator fraction for interpolation. Uses `requestAnimationFrame`.

### `src/render/textures.js`
```js
export const TEXTURE_KINDS: { id, name, slots: ('wall'|'floor'|'ceiling'|'poster')[] }[]
export function createTexture(kind, { resolution, tint, brightness, seed, text }) → THREE.CanvasTexture
export function applyFiltering(texture, filtering /* 'pixelated'|'smooth'|'trilinear' */, anisotropy)
export function textureFromImage(imgOrDataUrl) → Promise<THREE.Texture>
export class TextureCache {
  constructor({ seed, maxBytes })            // LRU budget on unreferenced canvases
  get(slotConfig, globalTexConfig, extra) → THREE.Texture        // cached base: kind/tint/brightness/custom × resolution/seed
  getForSlot(slot, slotConfig, globalTexConfig) → THREE.Texture  // per-slot clone with repeat/offset + filtering applied
  setSeed(seed); setCustomImage(slot, texture|null); loadCustomImage(slot, src); invalidate(slot?); dispose()
}
```
Kinds (all drawn procedurally on a canvas – no image files): `brick` (red brick with
mortar; the Win95 default), `greyBrick`, `wood`, `stone`, `cobble`, `tile` (ceiling
default), `checker`, `marble`, `plaster`, `concrete`, `hedge`, `carpet`, `metal`,
`win95Teal` (flat #008080), `solid` (uses tint), plus poster kinds `start`, `finish`,
`webglBadge` (the "OpenGL-logo" homage), `flag` (four-pane waving flag homage),
`smileyPoster`, `custom` (uploaded image). Textures must tile seamlessly.

### `src/render/materials.js`
```js
export function createMaterialSet(config, textureCache) → {
  wall, floor, ceiling: THREE.Material, poster(kind) → THREE.Material, dispose(), refresh() }
```
`lighting.mode === 'classic'` ⇒ `MeshBasicMaterial` (fullbright, like the original);
`'lit'` ⇒ `MeshLambertMaterial`. Walls use `vertexColors: true` for per-orientation
fake shading (`lighting.faceShading`). Posters use `polygonOffset` so they do not
z-fight with walls.

### `src/render/mazeMesh.js`
```js
export function buildMazeGroup(maze, config, materials, decorations) → { group: THREE.Group, dispose() }
```
Builds **one merged BufferGeometry** for all wall faces (both sides of each
zero-thickness wall, UV `u` along the wall, `v` up, repeated by `textures.wall.repeatU/V`),
one plane for the floor and one for the ceiling (omitted when `maze.ceiling` is false;
repeat = width/height × repeat),
and one merged geometry for posters (`decorations.posters`). Also draws the outer
boundary. No per-wall meshes.

### `src/render/objects.js`
```js
export function placeDecorations(maze, config, rng) → {
  posters: { x, y, dir, kind }[],            // START/FINISH + random posters
  polyhedra: { x, y, shape }[],
  smileys: { x, y }[] }
export class DecorationLayer {
  constructor(maze, config, decorations)
  group: THREE.Group
  update(dt, time)                     // spin/bob animations
  objectAt(x, y) → { type:'polyhedron'|'smiley', ... } | null
  dispose()
}
export class Rat {
  constructor(maze, config, rng); group; walker
  sync()        // re-read live config (speed, strategy, colour, size, lighting mode) – every frame
  advance(dt)   // move + animate – skipped while paused
  update(dt)    // sync() + advance(dt)
  dispose()
}
export function teleportTarget(maze, rng, exclude) → { x, y, heading }   // random cell facing an open side
export const eyeHeight = (config) => config.camera.height * config.maze.wallHeight
```

### `src/render/lighting.js`
```js
export function createLighting(scene, camera) → { apply(config), dispose() }
```
Owns ambient / hemisphere / directional "sun" / headlamp (PointLight parented to the
camera), scene fog (linear or exp2) and background colour.

### `src/render/post.js`
```js
export class PostPipeline {
  constructor(renderer)
  setSize(width, height, renderScale)
  render(scene, camera, effects /* config.effects */)
  dispose()
}
```
When every effect is off and `renderScale === 1` it renders directly. Otherwise it
renders to a `WebGLRenderTarget` and draws a full-screen quad with a shader that
implements: nearest-neighbour upscaling, colour depth quantisation
(`'full'|'16bit'|'256'|'16'|'mono'`) with optional 4×4 Bayer dithering, scanlines,
vignette and CRT barrel curvature.

### `src/sim/transitions.js`
```js
export function createFinishTransition(kind, duration) → {
  kind, progress, update(dt) → boolean /* done */,
  cameraOffset: { yaw, pitch, roll, dolly, fovScale, drop }, overlayAlpha: number, color: string }
export function createTeleportFlash(duration, color = '#ffffff') → { update(dt) → done, overlayAlpha, color }
export function createRollAnimator() → { setTarget(roll, duration), toggle(duration), update(dt), roll }
```
Kinds: `none`, `fade`, `spin`, `zoom`, `drop`, `swirl`.

### `src/ui/gui.js`
```js
export function createGui(config, { onChange(path, value, finished), actions, container }) → {
  gui /* lil-gui */, refresh(), show(), hide(), toggle(), setVisible(bool), destroy() }
```
`actions`: `regenerate()`, `randomizeSeed()`, `uploadTexture(slot)`, `clearTexture(slot)`,
`applyPreset(id)`, `exportSettings()`, `importSettings()`, `copyShareUrl()`,
`resetDefaults()`, `fullscreen()`, `screenshot()`, `togglePause()`, `teleportRandom()`,
`flipView()`. **Every** leaf in `DEFAULTS` must be exposed (folders mirror the config
tree). Styled with `src/ui/win95.css` (grey bevels, navy title bars).

### `src/ui/hud.js`
```js
export function createHud(container) → {
  setStats({ fps, seed, algorithm, size, steps, state, strategy }), setVisible(bool),
  flash(color, duration), setOverlayAlpha(a), showToast(text, ms), destroy() }
```
Win95-styled status window + a fake taskbar (Start button opens the GUI) + full-screen
fade overlay used by transitions/teleports.

### `src/app.js` (integration) & `src/main.js` (entry)
Creates renderer/scene/camera rig, instantiates everything above, maps config paths to
rebuild actions, wires walker events to decorations (teleport, flip, finish), handles
keyboard shortcuts, resize/aspect/letterbox, settings persistence (localStorage +
share URL), screensaver mode (hide UI/cursor, exit on input) and idle start.

Camera rig: `rig` (Object3D, position + yaw) → `tilt` (pitch) → `camera` (roll). The eye
sits at `camera.height × wallHeight`; `camera.fov` spans the longer screen axis (vertical
in landscape, converted for portrait). Lighting intensities for ambient/hemisphere/sun are
multiplied by π in lighting.js so that 1 means "as bright as classic mode" under three's
physically based lights. `main.js` wraps `createApp` in a try/catch that clears saved
settings and boots again with defaults if construction throws.

## Keyboard shortcuts
`H` toggle settings, `Tab` toggle HUD, `F` fullscreen, `Space` pause, `R` regenerate,
`N` new random seed, `M` manual drive, `W/A/S/D` or arrows (manual), `T` random
teleport, `U` flip view, `P` screenshot, `Esc` exit screensaver mode.

## Testing
`npm test` runs `node --test` over `test/*.test.js` (no browser: rng, grid, generator,
navigator, easing, walker, loop, config/sanitiser, maze mesh geometry, decorations;
three.js runs fine in Node for the geometry checks). `npm run smoke` launches headless
Chromium via Playwright (through `scripts/lib/chromium.mjs`; `CHROMIUM_PATH` overrides the
browser) against a built `dist/`, fails on console errors, and saves screenshots to
`scripts/out/`.
