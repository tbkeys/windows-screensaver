# 3D Maze — a Windows 95 screensaver in WebGL

A faithful, self-hostable recreation of the Windows 95 **3D Maze** screensaver as a
single-page WebGL app. The camera walks a red-brick maze cell by cell with the same
grid-locked turn-and-step cadence as the 1995 original, bumps into spinning grey
polyhedra that teleport it, walks through a smiley that flips the world upside down,
shares the corridors with a rat, and spins into a brand-new maze when it reaches the
end. Every parameter — maze size and algorithm, step timing, textures, lighting, fog,
post-effects, easter eggs — is exposed in a Win95-styled settings dialog. It is built
with [three.js](https://threejs.org) and [lil-gui](https://lil-gui.georgealways.com),
ships as plain static files, makes no network requests after load, and runs from
Nginx, Caddy, Docker or GitHub Pages.

## Features

* **Faithful movement.** Grid-locked turn-and-step walker: the camera always sits on a
  cell centre, turns 90° (or 180°) in place, then steps exactly one cell. Linear easing
  and an optional progress *quantize* reproduce the chunky original cadence even at high
  frame rates. Left-hand wall follower by default; right-hand, random, explorer, BFS
  solver and drunk-walk strategies are available, plus manual WASD driving.
* **30 FPS by design.** Separate render cap and simulation tick rate (both adjustable,
  cap `0` = vsync), interpolation between ticks, time scale, and a *fixed timestep*
  mode that advances one tick per frame the way the original slowed down with the CPU.
* **Textures.** Fifteen procedural surface textures (red brick, grey brick, wood, stone,
  cobble, ceiling tile, checker, marble, plaster, concrete, hedge, carpet, metal,
  Windows 95 teal, solid colour) and poster images drawn on the fly — no image files —
  plus custom image upload for the wall, floor, ceiling and poster slots. Per-slot
  repeat, offset, tint and brightness; bilinear / trilinear / nearest filtering;
  64–1024 px resolution; anisotropy.
* **Every parameter in a Win95 dialog.** The "3D Maze Setup" window mirrors the whole
  config tree (see [Settings reference](#settings-reference)): maze, movement, camera,
  timing, textures, lighting, objects, effects, screensaver.
* **Eleven maze algorithms with seeds.** Recursive backtracker, Prim, Kruskal, Wilson,
  Aldous–Broder, hunt-and-kill, growing tree, binary tree, sidewinder, recursive
  division (with rooms) and Eller's. Braiding opens dead ends into loops; four start and
  four finish placements. Same seed + settings = the same maze in every browser.
* **Easter eggs.** Spinning polyhedra that teleport you (with the white flash), the
  smiley that flips the view upside down, the grey rat with its own navigator,
  START / FINISH signs, wall posters (WebGL badge as the OpenGL-logo homage, waving
  flag, smiley, custom), and six finish transitions (spin & fade, fade, zoom, drop,
  swirl, instant). Each one can be switched off.
* **Retro post-FX.** Internal render scale, 16-bit / 256 / 16-colour / monochrome
  quantisation with 4×4 Bayer dithering, scanlines, vignette, CRT barrel curvature,
  pixelation, film noise, brightness / contrast / saturation / gamma. All off by
  default, which skips the post pass entirely.
* **Presets, share URLs, persistence.** Six presets (Classic Windows 95, Potato PC,
  Hedge garden, Dungeon, Neon night, Smooth & modern), settings export / import as
  JSON, "Copy share URL" to link a configuration (the non-default settings travel in
  the URL hash, so no server is involved), and automatic localStorage persistence
  (optional).
* **Screensaver / kiosk mode.** Hides the UI and cursor, exits on any input, can start
  itself after a period of inactivity; fullscreen and aspect-ratio letterboxing (4:3
  CRT, 5:4, 16:9, 16:10).
* **Zero server dependencies.** Static `dist/` with relative asset paths: works from a
  domain root, a sub-path, or offline.

## Quick start

Requires Node 22 (20.19+ also works) and a browser with WebGL 2 (every current browser).

```sh
npm install
npm run dev        # http://localhost:5173 with hot reload
npm run build      # static site in dist/
npm run preview    # serve dist/ locally on http://localhost:4173
npm test           # unit tests (node --test): maze, rng, navigator, walker, loop, config sanitiser, maze mesh, decorations
npm run smoke      # headless Chromium against dist/: fails on console errors, saves screenshots to scripts/out/
                   # (needs a Chromium: `npx playwright install chromium` once, or set CHROMIUM_PATH)
```

Press `H` to toggle the settings dialog, `Tab` for the status window, `F` for fullscreen.

## Self-hosting

`npm run build` produces `dist/`: one `index.html`, hashed files under `dist/assets/`
and `favicon.svg`. The build uses `base: './'`, so the same output works at
`https://example.com/`, `https://example.com/maze/` or from a local directory. Nothing
is fetched at runtime, there are no cookies, and no server-side code is involved.

### Any static host

Copy the contents of `dist/` to the web root (or a sub-folder) of any static host:
S3/CloudFront, Netlify, Cloudflare Pages, Vercel, a shared-hosting `public_html`, an
old laptop running `python3 -m http.server`. Two headers are worth setting if the host
lets you: `Cache-Control: public, max-age=31536000, immutable` for `/assets/*` (the
file names are content-hashed) and `Cache-Control: no-cache` for `index.html`.

### Nginx

With Docker (multi-stage build; nginx 1.28 serving on port 8080 as a non-root user,
gzip, immutable asset caching, security headers, health check at `/healthz`):

```sh
docker build -t win95-3d-maze .
docker run --rm -p 8080:8080 win95-3d-maze
# → http://localhost:8080
```

On a bare host, copy `dist/` to e.g. `/var/www/maze` and add a server block:

```nginx
server {
    listen 80;
    server_name maze.example.com;
    root /var/www/maze;            # the contents of dist/
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location /assets/ {            # hashed file names → cache forever
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }
    location / {                   # no client-side routes: unknown paths are real 404s
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ =404;
    }
}
```

To serve it below an existing site use `location /maze/ { alias /var/www/maze/; try_files $uri $uri/ =404; }`.
The complete hardened configuration (security headers, non-root, temp paths) is in
[`deploy/nginx.conf`](deploy/nginx.conf).

### Caddy

[`deploy/Caddyfile`](deploy/Caddyfile) serves `dist/` with `encode zstd gzip`, the same
cache and security headers, and contains commented sub-path and reverse-proxy variants:

```sh
npm run build
caddy run --config deploy/Caddyfile      # http://localhost:8080
```

Replace `:8080` in the Caddyfile with a host name and Caddy provisions TLS automatically.

### Docker Compose

```sh
docker compose up --build -d             # http://localhost:8080
docker compose logs -f maze
```

[`docker-compose.yml`](docker-compose.yml) builds the image above, publishes port 8080,
restarts it unless stopped and drops privilege escalation; an optional read-only
root filesystem is commented in.

### GitHub Pages

[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) builds and
deploys `dist/` on every push to `main` (and on manual dispatch). One-time setup:

1. In the repository go to **Settings → Pages → Build and deployment** and set
   **Source** to **GitHub Actions**.
2. Push to `main` (or run the workflow from the **Actions** tab).
3. The site appears at `https://<user>.github.io/<repo>/`. The relative base path means
   no configuration change is needed for a project site.

If your default branch is not `main`, edit the `branches:` list in the workflow.

### Notes

* **No COOP/COEP.** The app does not use `SharedArrayBuffer`, workers or any API that
  needs cross-origin isolation, so no special headers are required. The CSP shipped in
  the nginx/Caddy configs is the strictest one that works; if you embed the maze in an
  `<iframe>` on another site, relax `frame-ancestors`.
* **Offline / `file://`.** After the first load the page makes no further requests and
  keeps working offline. Opening `dist/index.html` straight from disk is not
  supported: browsers block ES-module scripts on `file://`, so serve the folder with
  `npm run preview`, `npx serve dist`, or any static server (or, for a one-off, launch
  Chrome with `--allow-file-access-from-files`).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `H` | Toggle the settings dialog |
| `Tab` | Toggle the status window (HUD) |
| `F` | Fullscreen |
| `Space` | Pause / resume |
| `R` | Regenerate the maze (same seed) |
| `N` | New random seed |
| `M` | Manual drive on / off |
| `W` `A` `S` `D` / arrow keys | Drive (manual mode) |
| `T` | Random teleport |
| `U` | Flip the view |
| `P` | Screenshot |
| `Esc` | Exit screensaver mode |

The Start button on the fake taskbar also opens the settings dialog.

## Settings reference

Every leaf of `src/config/defaults.js` is a control in the "3D Maze Setup" window;
folders mirror the config tree. Dotted names below are the config paths used by share
URLs and exported JSON.

### Presets & Tools

| Control | What it does |
| --- | --- |
| Preset | Apply one of `classic95`, `pixelPotato`, `hedgeGarden`, `dungeon`, `neonNight`, `smoothModern` (partial configs from `src/config/presets.js`) |
| Fullscreen / Screenshot | Toggle fullscreen; save the current frame as PNG |
| Pause / Resume, Teleport, Flip view | Same as `Space`, `T`, `U` |
| Export / Import settings | Download or load the settings as JSON |
| Copy share URL | Put the settings that differ from the defaults into the link's `#s=` hash (base64url JSON) |
| Reset to defaults | Restore `DEFAULTS` |

### Maze (`maze.*`)

| Setting | Default | Description |
| --- | --- | --- |
| `width`, `height` | 20 × 20 | Grid size in cells (2–80 each) |
| `algorithm` | `backtracker` | Generator: `backtracker`, `prim`, `kruskal`, `wilson`, `aldousBroder`, `huntAndKill`, `growingTree`, `binaryTree`, `sidewinder`, `recursiveDivision`, `ellers` |
| `seed` | `windows95` | Any text; identical seed + settings gives the identical maze everywhere |
| `braid` | 0 | Fraction of dead ends opened into loops (0 = perfect maze) |
| `growingTreeMix` | 0.5 | Growing tree only: 0 ≈ backtracker, 1 ≈ Prim |
| `roomChance` | 0 | Recursive division only: chance to leave a small chamber undivided (rooms) |
| `startPlacement` | `deadEnd` | `deadEnd` (edge dead end, classic), `edge`, `corner`, `random` |
| `finishPlacement` | `farthest` | `farthest`, `deadEnd` (farthest dead end), `opposite` edge, `random` |
| `cellSize` | 1 | World units per cell |
| `wallHeight` | 1 | Wall height in world units |
| `ceiling` | on | Draw the ceiling; off leaves the maze open to the sky (the background colour shows) |
| `autoRegenerate` | on | Rebuild as soon as a maze setting changes |

Buttons: **Randomize seed**, **Regenerate**.

### Movement (`movement.*`)

| Setting | Default | Description |
| --- | --- | --- |
| `strategy` | `leftHand` | `leftHand`, `rightHand`, `random` (no reversing), `explorer` (prefers unvisited), `solver` (BFS shortest path), `drunk` |
| `stepDuration` | 0.55 s | Time to walk one cell |
| `turnDuration` | 0.45 s | Time for a 90° turn (180° takes twice as long) |
| `stepEasing`, `turnEasing` | `linear` | `linear` (original), `smooth`, `easeInOut`, `easeOut`, `easeIn`, `snap` |
| `pauseBeforeTurn`, `pauseAfterTurn` | 0 s | Extra waits around turns |
| `pauseAtDeadEnd` | 0.15 s | Wait before the about-turn in a dead end |
| `pauseAtStart` | 1 s | Dwell facing the START sign before the first decision (also after each new maze) |
| `quantize` | 0 | Snap eased progress to N sub-steps per phase (chunky original feel at any FPS; 0 = off) |
| `headBob`, `headBobSpeed` | 0, 2 | Vertical bob amplitude (world units) and rate while stepping |
| `manual` | off | Drive with WASD / arrows instead of the navigator (session state, never saved) |
| `paused` | off | Freeze the walker, the rats and the finish sequence (session state, never saved) |

### Camera (`camera.*`)

| Setting | Default | Description |
| --- | --- | --- |
| `fov` | 70° | Field of view (30–140) along the longer screen axis: vertical in landscape, horizontal in portrait |
| `height` | 0.5 | Eye height as a fraction of `wallHeight` (0.5 = the classic look; polyhedra and smileys float at eye level) |
| `pitch` | 0° | Look up / down (−45…45) |
| `near`, `far` | 0.05, 100 | Clip planes |
| `aspectMode` | `window` | Fill window, or letterbox to `4:3`, `5:4`, `16:9`, `16:10` |
| `renderScale` | 1 | Internal resolution multiplier (0.1–2); below 1 upscales with nearest-neighbour |

### Timing (`timing.*`)

| Setting | Default | Description |
| --- | --- | --- |
| `fpsCap` | 30 | Rendered frames per second; 0 = uncapped (vsync) |
| `tickRate` | 30 Hz | Simulation ticks per second |
| `interpolate` | on | Interpolate the camera between ticks when rendering faster than ticking |
| `timeScale` | 1 | Simulation speed multiplier (0 freezes) |
| `fixedTimestep` | off | Exactly one tick per rendered frame regardless of real time |
| `showFps` | on | FPS row in the status window |

### Textures (`textures.*`)

Per slot — `wall`, `floor`, `ceiling`, `poster` (each its own sub-folder):

| Setting | Defaults (wall / floor / ceiling / poster) | Description |
| --- | --- | --- |
| `kind` | `brick` / `stone` / `tile` / `webglBadge` | Surface kinds: `brick`, `greyBrick`, `wood`, `stone`, `cobble`, `tile`, `checker`, `marble`, `plaster`, `concrete`, `hedge`, `carpet`, `metal`, `win95Teal`, `solid`, `custom`. Poster kinds: `webglBadge`, `flag`, `smileyPoster`, `start`, `finish`, `custom` |
| `repeatU`, `repeatV` | 1 | Tiling repeats per cell (0.1–8) |
| `offsetU`, `offsetV` | 0 | UV offset (−1…1) |
| `tint` | `#ffffff` | Multiplied colour (also the colour of `solid`) |
| `brightness` | 1 | Multiplier 0–3 |
| `custom` | none | Uploaded image (buttons **Upload image…** / **Clear image**), kept at its own aspect ratio; the `custom` kind uses it |

All surfaces:

| Setting | Default | Description |
| --- | --- | --- |
| `filtering` | `smooth` | `smooth` (bilinear, original OpenGL look), `trilinear` (mipmaps), `pixelated` (nearest) |
| `anisotropy` | 1 | Anisotropic filtering samples (1–16); it needs mipmaps, so values above 1 switch `smooth` to mipmapped filtering |
| `resolution` | 256 | Procedural texture size: 64, 128, 256, 512 or 1024 px |
| `textureSeed` | 0 | Perturbs procedural noise; 0 derives it from the maze seed |

### Lighting (`lighting.*`)

| Setting | Default | Description |
| --- | --- | --- |
| `mode` | `classic` | `classic` = unlit, fullbright materials (lights have no effect); `lit` = Lambert shading |
| `ambientColor`, `ambientIntensity` | `#ffffff`, 1 | Ambient light (1 = as bright as classic mode; the same scale applies to the hemisphere and sun lights) |
| `hemisphereEnabled`, `hemisphereSky`, `hemisphereGround`, `hemisphereIntensity` | off, `#bfd4ff`, `#3a2a1a`, 0.6 | Hemisphere light |
| `sunEnabled`, `sunColor`, `sunIntensity`, `sunElevation`, `sunAzimuth` | off, `#ffffff`, 0.8, 60°, 30° | Directional light aimed by elevation / azimuth |
| `headlampEnabled`, `headlampColor`, `headlampIntensity`, `headlampDistance`, `headlampDecay` | off, `#ffe9c4`, 2, 7, 1.5 | Point light carried by the camera |
| `faceShading` | 0 | Fake light from the north, works in classic mode too: N-facing walls stay full, S-facing lose ½× and E/W-facing 1× this value |
| `floorShade`, `ceilingShade` | 1, 1 | Brightness multipliers for floor and ceiling |
| `fogEnabled`, `fogType`, `fogColor` | off, `linear`, `#000000` | Scene fog, `linear` or `exp2` |
| `fogNear`, `fogFar` | 3, 14 | Linear fog range (world units) |
| `fogDensity` | 0.07 | Exponential fog density |
| `backgroundColor` | `#000000` | Clear colour behind the maze |

### Objects (`objects.*`)

| Setting | Default | Description |
| --- | --- | --- |
| `polyhedra.enabled`, `count` | on, 6 | Spinning solids |
| `polyhedra.shape` | `random` | `random`, `tetrahedron`, `octahedron`, `icosahedron`, `dodecahedron`, `cube` |
| `polyhedra.size`, `color` | 0.32, `#9c9c9c` | Size (world units) and colour |
| `polyhedra.spinSpeed`, `bob` | 1, 0.04 | Rotation speed and vertical bob amplitude |
| `polyhedra.flatShading`, `wireframe` | on, off | Look |
| `polyhedra.placement` | `anywhere` | `deadEnds`, `corridors`, `anywhere` |
| `polyhedra.teleportOnTouch`, `flashOnTeleport` | on, on | Classic: touching one drops you in a random cell, with a white flash |
| `smiley.enabled`, `count` | on, 2 | Floating smiley faces |
| `smiley.size`, `spinSpeed`, `bob` | 0.42, 0.8, 0.03 | Look and motion |
| `smiley.flipOnTouch`, `flipDuration` | on, 1.2 s | Classic: walking through one rolls the view upside down (and back on the next) |
| `smiley.placement` | `corridors` | `deadEnds`, `corridors`, `anywhere` |
| `rat.enabled`, `count` | on, 1 | The grey rat |
| `rat.speed` | 3 cells/s | Rat walking speed |
| `rat.color`, `size` | `#8a8a8a`, 1 | Look |
| `rat.strategy` | `random` | Any walker strategy |
| `posters.startFinish` | on | START sign on the start wall, FINISH sign at the goal |
| `posters.randomCount` | 4 | Extra wall posters using the `poster` texture slot |
| `posters.size`, `elevation` | 0.6, 0.5 | Poster width as a fraction of the wall; centre height as a fraction of the wall height |
| `finish.transition` | `spin` | `spin` (spin & fade, classic), `fade`, `zoom`, `drop`, `swirl`, `none` |
| `finish.duration`, `pauseBefore` | 2.2 s, 0.4 s | Transition length and the pause at the finish cell |
| `finish.newSeedOnFinish` | on | Pick a new random seed for the next maze after the transition |

### Effects (`effects.*`)

| Setting | Default | Description |
| --- | --- | --- |
| `colorDepth` | `full` | `full`, `16bit`, `256`, `16`, `mono` quantisation |
| `dither`, `ditherStrength` | off, 1 | 4×4 ordered (Bayer) dithering before quantisation |
| `scanlines`, `scanlineDensity` | 0, 1 | Scanline darkness (0–1) and spacing (lines per output pixel) |
| `vignette` | 0 | Corner darkening |
| `curvature` | 0 | CRT barrel distortion |
| `pixelate` | 1 | Output pixel block size in px (1 = off) |
| `brightness`, `contrast`, `saturation`, `gamma` | 1, 1, 1, 1 | Colour grading |
| `noise` | 0 | Animated film grain |

With every effect at its default and `camera.renderScale = 1` the scene renders
straight to the canvas; otherwise it goes through one full-screen shader pass.

### Screensaver (`screensaver.*`)

| Setting | Default | Description |
| --- | --- | --- |
| `showGui`, `showHud`, `showTaskbar` | on, on, on | Visibility of the settings dialog, status window and taskbar |
| `hideCursorAfter` | 3 s | Hide the mouse cursor after this much inactivity (0 = never) |
| `screensaverMode` | off | Hide all UI; any key, click, wheel turn or mouse movement over a few pixels exits the mode (session state, never saved) |
| `idleStart` | 0 s | Enter screensaver mode after this much inactivity (0 = off) |
| `exitFullscreenOnInput` | off | Also leave fullscreen when input exits screensaver mode |
| `persistSettings` | on | Save settings that differ from the defaults to localStorage (`win95maze.settings.v1`) and restore them on load; uploaded images are stored too unless they exceed 700 KB, in which case they stay in memory for the session |

## Project structure

```
.
├── index.html                  Entry page: one <canvas> and the module script
├── vite.config.js              Vite build (base './', three and lil-gui split into their own chunks)
├── public/favicon.svg
├── src/
│   ├── main.js                 Entry point: boots app.js (retries with defaults if a saved config fails)
│   ├── app.js                  Integration: renderer, camera rig, config-path → action table,
│   │                           walker ↔ decoration wiring, shortcuts, screensaver mode
│   ├── app/
│   │   ├── settings.js         localStorage persistence, #s= share hash, JSON export/import, validation
│   │   └── activity.js         Idle detection: cursor auto-hide, idle start, exit on input
│   ├── config/
│   │   ├── defaults.js         DEFAULTS, ENUMS, createConfig(), deepMerge(), diffFromDefaults()
│   │   └── presets.js          Named partial configs
│   ├── maze/
│   │   ├── grid.js             Maze class (wall bitmasks, BFS, dead ends) and direction helpers
│   │   ├── rng.js              Seeded sfc32 RNG: hashSeed(), createRng(), randomSeedString()
│   │   ├── generator.js        Eleven generation algorithms, braiding, start/finish placement
│   │   └── navigator.js        Walking strategies: left/right-hand, random, explorer, solver, drunk
│   ├── sim/
│   │   ├── walker.js           Grid-locked turn-and-step state machine (camera and rat)
│   │   ├── loop.js             requestAnimationFrame loop: fixed-timestep ticks + FPS cap
│   │   ├── easing.js           Easing curves, quantize(), angle helpers
│   │   └── transitions.js      Finish transitions, teleport flash, smiley flip
│   ├── render/
│   │   ├── textures.js         Procedural canvas textures, uploads, filtering, TextureCache
│   │   ├── materials.js        Classic (unlit) and lit material sets, poster materials
│   │   ├── mazeMesh.js         One merged geometry for all walls + floor + ceiling + posters
│   │   ├── objects.js          Decoration placement, polyhedra, smileys, the rat
│   │   ├── lighting.js         Ambient / hemisphere / sun / headlamp, fog, background
│   │   └── post.js             Post pipeline: render scale, colour depth, dither, scanlines, CRT
│   └── ui/
│       ├── gui.js              lil-gui settings window generated from DEFAULTS ("3D Maze Setup")
│       ├── hud.js              Status window, taskbar with Start button, fade overlay, toasts
│       └── win95.css           Grey bevels, navy title bars
├── test/                       node --test unit tests for the pure modules
├── scripts/
│   ├── smoke.mjs               Headless Chromium smoke test against dist/
│   └── dev/                    Stand-alone pages and scripts to exercise one module at a time
├── deploy/
│   ├── nginx.conf              Hardened nginx config used by the Dockerfile
│   └── Caddyfile               Caddy equivalent (+ sub-path and reverse-proxy variants)
├── Dockerfile · docker-compose.yml · .dockerignore
├── .github/workflows/deploy-pages.yml
├── docs/ARCHITECTURE.md        Module contracts and coordinate conventions
└── LICENSE-THIRD-PARTY.md      three.js and lil-gui MIT notices
```

## Authenticity notes

What the 1995 screensaver did, and what this recreation does about it:

| Original | Here |
| --- | --- |
| The camera follows the **left-hand wall rule**: it hugs the wall on its left, so it visits dead ends and eventually finds the exit. | `movement.strategy = leftHand` (default). Right-hand, random, explorer, BFS solver and drunk walk are extras; in braided mazes a wall follower that loops too long falls back to the solver so it always finishes. |
| **In-place turns, then a step.** Nothing happens diagonally; turns are 90° (180° in dead ends) at a cell centre, movement is one cell at a time at constant speed, and the motion is visibly stepped because the machine rendered a handful of frames per second. | The `Walker` state machine does exactly this (`idle → turning → stepping`). Linear easing is the default; `quantize` reproduces the stepped look at any frame rate; the 30 FPS cap and 30 Hz tick rate are the defaults; `fixedTimestep` ties one tick to one frame like the original. |
| **Fullbright textures** — no lighting, no fog, no shadows. Red brick walls, a grey floor, a white ceiling tile, bilinear filtering from the software OpenGL renderer. | `lighting.mode = classic` uses unlit `MeshBasicMaterial`s with the `brick` / `stone` / `tile` kinds and bilinear filtering. All lights, fog and `faceShading` are modern extras that are off by default. |
| An **OpenGL logo** hung on walls, a sign at the **start**, and the end of the maze marked. | Posters are baked into the maze mesh: a WebGL badge drawn in the style of the OpenGL logo (`webglBadge`), START and FINISH signs, a waving four-pane flag and a smiley poster. The number and image of the extra posters are adjustable; `custom` accepts your own picture. |
| **Grey spinning polyhedra** floating in corridors; walking into one teleports you to a random spot with a flash. | `objects.polyhedra` (six by default, random shapes); `teleportOnTouch` and `flashOnTeleport` reproduce the behaviour. |
| A floating **smiley face**; passing through it turns the view upside down until the next one flips it back. | `objects.smiley` with `flipOnTouch` and a configurable roll duration. |
| A **grey rat** scurrying through the corridors. | `objects.rat`: a low-poly rat driven by its own `Walker` and navigator (random by default, any strategy allowed). |
| At the finish the view **spins and fades**, and a new maze is generated. | `objects.finish.transition = spin` with `newSeedOnFinish`; fade, zoom, drop, swirl and instant are extras. |
| A small **3D Maze Setup** dialog with a resolution slider and a few wall/floor/ceiling texture choices, including custom bitmaps. | The same idea, pushed as far as it goes: every parameter of this build is in the dialog, custom images can be uploaded per slot, and `camera.renderScale` plays the part of the resolution slider. |

Deliberately modern (and off by default): lit mode with sun / headlamp / hemisphere
lights, fog, braided mazes and the ten non-backtracker algorithms, head bob and easing
curves, the retro post-effects (the original ran at the desktop's colour depth; the
8-bit/dither/scanline/CRT options are a nod to the hardware of the time rather than
to the screensaver), manual driving, presets, share URLs and persistence.

## Performance tips

The classic look is cheap: a 20×20 maze is a handful of draw calls (one merged wall
geometry, one floor, one ceiling, one mesh per poster kind, the decorations) at 30 FPS.
If a machine still struggles:

* Lower `camera.renderScale` (0.5 renders a quarter of the pixels; the "Potato PC"
  preset uses 0.4 with nearest-neighbour upscaling, which looks right for the era).
* Keep `timing.fpsCap` at 30 (or lower); the original did not run faster.
* Leave every `effects.*` value at its default so the post pass is skipped, or if you
  want effects, keep `renderScale` low since the pass costs per output pixel.
* Use `lighting.mode = classic`. Lit mode with the headlamp is the most expensive
  combination; the hemisphere and sun lights are cheaper than the point light.
* Reduce `textures.resolution` (128 is indistinguishable at 320×240) and
  `textures.anisotropy`; `pixelated` filtering skips mipmaps.
* Smaller mazes and fewer `objects.polyhedra.count` / `objects.posters.randomCount`
  reduce geometry; disabling the rat removes a second walker.
* Large custom textures are downscaled to 2048 px per side on upload; smaller sources
  save memory on integrated GPUs.
* In a tab that is hidden the simulation pauses rather than catching up.

## Credits

* Rendering: [three.js](https://threejs.org) (MIT). Settings panel:
  [lil-gui](https://lil-gui.georgealways.com) (MIT). See
  [`LICENSE-THIRD-PARTY.md`](LICENSE-THIRD-PARTY.md) for the full notices.
* All textures, posters, the rat and the UI chrome are drawn procedurally by this
  project; no asset was extracted from any Microsoft product.
* This is an independent fan recreation. It is not affiliated with, endorsed by, or
  sponsored by Microsoft. "Windows" is a trademark of Microsoft Corporation.

## License

MIT – see [`LICENSE`](LICENSE). Third-party notices for three.js and lil-gui are in
[`LICENSE-THIRD-PARTY.md`](LICENSE-THIRD-PARTY.md).
