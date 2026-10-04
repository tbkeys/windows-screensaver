// Node checks for the pure parts of src/render/objects.js (placeDecorations, teleportTarget).
// usage: node scripts/dev/check-objects.mjs
import assert from 'node:assert/strict';
import { createConfig } from '../../src/config/defaults.js';
import { generateMaze } from '../../src/maze/generator.js';
import { createRng } from '../../src/maze/rng.js';
import { OPPOSITE } from '../../src/maze/grid.js';
import { placeDecorations, teleportTarget, POLYHEDRON_SHAPE_IDS } from '../../src/render/objects.js';

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

function validate(maze, config, deco) {
  const O = config.objects;
  const key = (c) => maze.index(c.x, c.y);
  const sIdx = key(maze.start), fIdx = key(maze.finish);
  const faces = new Set();
  for (const p of deco.posters) {
    ok(maze.inBounds(p.x, p.y) && maze.hasWall(p.x, p.y, p.dir), `poster ${JSON.stringify(p)} must sit on a closed wall`);
    const face = key(p) * 4 + p.dir;
    ok(!faces.has(face), 'no two posters on one face');
    faces.add(face);
    if (p.kind === 'start') ok(key(p) === sIdx, 'START sits in the start cell');
    else if (p.kind === 'finish') ok(key(p) === fIdx, 'FINISH sits in the finish cell');
    else ok(p.kind === 'poster' && key(p) !== sIdx && key(p) !== fIdx, 'random posters avoid start/finish cells');
  }
  const kinds = deco.posters.map((p) => p.kind);
  if (O.posters.startFinish) {
    ok(kinds.filter((k) => k === 'start').length === 1, 'exactly one START');
    ok(kinds.filter((k) => k === 'finish').length === 1, 'exactly one FINISH');
    const startPoster = deco.posters.find((p) => p.kind === 'start');
    if (maze.hasWall(maze.start.x, maze.start.y, maze.start.heading)) ok(startPoster.dir === maze.start.heading, 'START faces the start heading');
    const open = maze.openDirs(maze.finish.x, maze.finish.y);
    const finishPoster = deco.posters.find((p) => p.kind === 'finish');
    if (open.length === 1) ok(finishPoster.dir === OPPOSITE[open[0]], 'FINISH opposite the single opening');
  } else {
    ok(!kinds.includes('start') && !kinds.includes('finish'), 'no signs when startFinish is off');
  }
  const randomPosters = kinds.filter((k) => k === 'poster').length;
  const availableFaces = (() => {
    let n = 0;
    for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
      if ((x === maze.start.x && y === maze.start.y) || (x === maze.finish.x && y === maze.finish.y)) continue;
      for (let d = 0; d < 4; d++) if (maze.hasWall(x, y, d)) n++;
    }
    return n;
  })();
  ok(randomPosters === Math.min(Math.max(0, Math.floor(O.posters.randomCount)), availableFaces), `random poster count ${randomPosters}`);

  const cells = new Set([sIdx, fIdx]);
  const free = maze.width * maze.height - 2;
  const wantPoly = O.polyhedra.enabled ? Math.max(0, Math.floor(O.polyhedra.count)) : 0;
  ok(deco.polyhedra.length === Math.min(wantPoly, free), `polyhedra count ${deco.polyhedra.length} (wanted ${wantPoly})`);
  for (const p of deco.polyhedra) {
    ok(maze.inBounds(p.x, p.y), 'polyhedron in bounds');
    ok(!cells.has(key(p)), 'polyhedron on an unused cell');
    cells.add(key(p));
    ok(POLYHEDRON_SHAPE_IDS.includes(p.shape), `known shape ${p.shape}`);
    if (O.polyhedra.shape !== 'random') ok(p.shape === O.polyhedra.shape, 'fixed shape honoured');
  }
  const wantSmiley = O.smiley.enabled ? Math.max(0, Math.floor(O.smiley.count)) : 0;
  ok(deco.smileys.length === Math.min(wantSmiley, Math.max(0, free - deco.polyhedra.length)), `smiley count ${deco.smileys.length}`);
  for (const s of deco.smileys) {
    ok(maze.inBounds(s.x, s.y), 'smiley in bounds');
    ok(!cells.has(key(s)), 'smiley on an unused cell');
    cells.add(key(s));
  }
}

/** Fraction of placed cells that match the placement preference (must be 1 when enough exist). */
function placementHitRate(maze, list, placement) {
  if (!list.length) return 1;
  const want = placement === 'deadEnds' ? 1 : placement === 'corridors' ? 2 : -1;
  if (want < 0) return 1;
  return list.filter((c) => maze.openDirs(c.x, c.y).length === want).length / list.length;
}

const scenarios = [
  { name: 'defaults 20x20', maze: { width: 20, height: 20 }, objects: {} },
  { name: 'deadEnds + corridors', maze: { width: 16, height: 12, algorithm: 'prim' }, objects: { polyhedra: { placement: 'deadEnds', count: 5, shape: 'cube' }, smiley: { placement: 'corridors', count: 3 } } },
  { name: 'overflowing counts 3x3', maze: { width: 3, height: 3 }, objects: { polyhedra: { count: 20 }, smiley: { count: 20 }, posters: { randomCount: 50 } } },
  { name: 'disabled objects', maze: { width: 10, height: 10 }, objects: { polyhedra: { enabled: false }, smiley: { enabled: false }, posters: { startFinish: false, randomCount: 0 } } },
  { name: 'braided (finish may have >1 opening)', maze: { width: 14, height: 14, algorithm: 'kruskal', braid: 1 }, objects: { posters: { randomCount: 12 } } },
  { name: '1x2 maze', maze: { width: 1, height: 2 }, objects: {} },
  { name: '2x1 maze', maze: { width: 2, height: 1 }, objects: { posters: { randomCount: 3 } } },
];

for (const sc of scenarios) {
  const config = createConfig({ maze: sc.maze, objects: sc.objects });
  const maze = generateMaze({ ...config.maze, seed: `check-${sc.name}` });
  const deco = placeDecorations(maze, config, createRng('deco'));
  validate(maze, config, deco);
  const again = placeDecorations(maze, config, createRng('deco'));
  ok(JSON.stringify(again) === JSON.stringify(deco), `${sc.name}: deterministic`);
  const other = placeDecorations(maze, config, createRng('deco-2'));
  if (deco.polyhedra.length > 2) ok(JSON.stringify(other.polyhedra) !== JSON.stringify(deco.polyhedra), `${sc.name}: rng matters`);
  const polyHit = placementHitRate(maze, deco.polyhedra, config.objects.polyhedra.placement);
  const smileyHit = placementHitRate(maze, deco.smileys, config.objects.smiley.placement);
  console.log(`${sc.name}: posters=${deco.posters.length} polyhedra=${deco.polyhedra.length} (placement hit ${polyHit.toFixed(2)}) smileys=${deco.smileys.length} (hit ${smileyHit.toFixed(2)})`);
}

// Placement preference actually bites when there are enough matching cells.
{
  const config = createConfig({ maze: { width: 20, height: 20, algorithm: 'prim' }, objects: { polyhedra: { placement: 'deadEnds', count: 6 }, smiley: { placement: 'corridors', count: 4 } } });
  const maze = generateMaze({ ...config.maze, seed: 'pref' });
  const deco = placeDecorations(maze, config, createRng('x'));
  ok(placementHitRate(maze, deco.polyhedra, 'deadEnds') === 1, 'all polyhedra in dead ends when enough exist');
  ok(placementHitRate(maze, deco.smileys, 'corridors') === 1, 'all smileys in corridors when enough exist');
  // Independence: changing the poster count must not move the polyhedra or smileys.
  const config2 = createConfig({ maze: config.maze, objects: { ...config.objects, posters: { randomCount: 9 } } });
  const deco2 = placeDecorations(maze, config2, createRng('x'));
  ok(JSON.stringify(deco2.polyhedra) === JSON.stringify(deco.polyhedra), 'poster count does not reshuffle polyhedra');
  ok(JSON.stringify(deco2.smileys) === JSON.stringify(deco.smileys), 'poster count does not reshuffle smileys');
  // Posters prefer corridor-end walls: average approach length well above the uniform baseline.
  const approach = (x, y, dir) => { let n = 0; const back = OPPOSITE[dir]; while (!maze.hasWall(x, y, back)) { x += [0, 1, 0, -1][back]; y += [-1, 0, 1, 0][back]; n++; } return n; };
  let all = 0, allN = 0;
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) for (let d = 0; d < 4; d++) if (maze.hasWall(x, y, d)) { all += approach(x, y, d); allN++; }
  const picked = deco2.posters.filter((p) => p.kind === 'poster');
  const pickedAvg = picked.reduce((s, p) => s + approach(p.x, p.y, p.dir), 0) / picked.length;
  console.log(`poster approach length: picked avg ${pickedAvg.toFixed(2)} vs all-walls avg ${(all / allN).toFixed(2)}`);
  ok(pickedAvg > all / allN, 'random posters prefer walls at the end of straight runs');
}

// teleportTarget
{
  const maze = generateMaze({ width: 8, height: 8, seed: 'tp' });
  const rng = createRng('tp');
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const t = teleportTarget(maze, rng, [maze.start, maze.finish, { x: 3, y: 3 }]);
    ok(maze.inBounds(t.x, t.y), 'teleport target in bounds');
    ok(!(t.x === maze.start.x && t.y === maze.start.y) && !(t.x === maze.finish.x && t.y === maze.finish.y) && !(t.x === 3 && t.y === 3), 'teleport target excluded cells respected');
    ok(maze.openDirs(t.x, t.y).includes(t.heading), 'teleport heading faces an open side');
    seen.add(maze.index(t.x, t.y));
  }
  ok(seen.size > 30, `teleport spreads over the maze (${seen.size} distinct cells)`);
  const tiny = generateMaze({ width: 1, height: 1, seed: 'one' });
  const t = teleportTarget(tiny, rng, [{ x: 0, y: 0 }]);
  ok(t.x === 0 && t.y === 0 && t.heading === 0, '1x1 maze falls back to the start cell');
  const bad = teleportTarget(maze, rng, [null, { x: 99, y: 99 }]);
  ok(maze.inBounds(bad.x, bad.y), 'bogus exclusions are ignored');
}

console.log(`OK: ${checks} checks passed`);
