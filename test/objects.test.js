import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/config/defaults.js';
import { generateMaze } from '../src/maze/generator.js';
import { createRng } from '../src/maze/rng.js';
import { OPPOSITE } from '../src/maze/grid.js';
import { placeDecorations, teleportTarget, POLYHEDRON_SHAPE_IDS } from '../src/render/objects.js';

/** Assert every structural rule of a decoration set for `maze` under `config`. */
function validate(maze, config, deco) {
  const O = config.objects;
  const key = (c) => maze.index(c.x, c.y);
  const sIdx = key(maze.start), fIdx = key(maze.finish);
  const faces = new Set();
  for (const p of deco.posters) {
    assert.ok(maze.inBounds(p.x, p.y) && maze.hasWall(p.x, p.y, p.dir), `poster ${JSON.stringify(p)} must sit on a closed wall`);
    const face = key(p) * 4 + p.dir;
    assert.ok(!faces.has(face), 'no two posters on one face');
    faces.add(face);
    if (p.kind === 'start') assert.equal(key(p), sIdx, 'START sits in the start cell');
    else if (p.kind === 'finish') assert.equal(key(p), fIdx, 'FINISH sits in the finish cell');
    else assert.ok(p.kind === 'poster' && key(p) !== sIdx && key(p) !== fIdx, 'random posters avoid start/finish cells');
  }
  const kinds = deco.posters.map((p) => p.kind);
  if (O.posters.startFinish) {
    assert.equal(kinds.filter((k) => k === 'start').length, 1, 'exactly one START');
    assert.equal(kinds.filter((k) => k === 'finish').length, 1, 'exactly one FINISH');
    const startPoster = deco.posters.find((p) => p.kind === 'start');
    if (maze.hasWall(maze.start.x, maze.start.y, maze.start.heading)) assert.equal(startPoster.dir, maze.start.heading, 'START faces the start heading');
    const open = maze.openDirs(maze.finish.x, maze.finish.y);
    const finishPoster = deco.posters.find((p) => p.kind === 'finish');
    if (open.length === 1) assert.equal(finishPoster.dir, OPPOSITE[open[0]], 'FINISH opposite the single opening');
  } else {
    assert.ok(!kinds.includes('start') && !kinds.includes('finish'), 'no signs when startFinish is off');
  }
  const randomPosters = kinds.filter((k) => k === 'poster').length;
  let availableFaces = 0;
  for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
    if ((x === maze.start.x && y === maze.start.y) || (x === maze.finish.x && y === maze.finish.y)) continue;
    for (let d = 0; d < 4; d++) if (maze.hasWall(x, y, d)) availableFaces++;
  }
  assert.equal(randomPosters, Math.min(Math.max(0, Math.floor(O.posters.randomCount)), availableFaces), 'random poster count');

  const cells = new Set([sIdx, fIdx]);
  const free = maze.width * maze.height - 2;
  const wantPoly = O.polyhedra.enabled ? Math.max(0, Math.floor(O.polyhedra.count)) : 0;
  assert.equal(deco.polyhedra.length, Math.min(wantPoly, free), `polyhedra count (wanted ${wantPoly})`);
  for (const p of deco.polyhedra) {
    assert.ok(maze.inBounds(p.x, p.y), 'polyhedron in bounds');
    assert.ok(!cells.has(key(p)), 'polyhedron on an unused cell');
    cells.add(key(p));
    assert.ok(POLYHEDRON_SHAPE_IDS.includes(p.shape), `known shape ${p.shape}`);
    if (O.polyhedra.shape !== 'random') assert.equal(p.shape, O.polyhedra.shape, 'fixed shape honoured');
  }
  const wantSmiley = O.smiley.enabled ? Math.max(0, Math.floor(O.smiley.count)) : 0;
  assert.equal(deco.smileys.length, Math.min(wantSmiley, Math.max(0, free - deco.polyhedra.length)), 'smiley count');
  for (const s of deco.smileys) {
    assert.ok(maze.inBounds(s.x, s.y), 'smiley in bounds');
    assert.ok(!cells.has(key(s)), 'smiley on an unused cell');
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

describe('placeDecorations', () => {
  for (const sc of scenarios) {
    test(`${sc.name}: valid, deterministic and rng-sensitive`, () => {
      const config = createConfig({ maze: sc.maze, objects: sc.objects });
      const maze = generateMaze({ ...config.maze, seed: `check-${sc.name}` });
      const deco = placeDecorations(maze, config, createRng('deco'));
      validate(maze, config, deco);
      const again = placeDecorations(maze, config, createRng('deco'));
      assert.deepEqual(again, deco, 'deterministic for the same rng');
      const other = placeDecorations(maze, config, createRng('deco-2'));
      if (deco.polyhedra.length > 2) assert.notDeepEqual(other.polyhedra, deco.polyhedra, 'the rng matters');
    });
  }

  test('placement preferences bite when enough matching cells exist', () => {
    const config = createConfig({ maze: { width: 20, height: 20, algorithm: 'prim' }, objects: { polyhedra: { placement: 'deadEnds', count: 6 }, smiley: { placement: 'corridors', count: 4 } } });
    const maze = generateMaze({ ...config.maze, seed: 'pref' });
    const deco = placeDecorations(maze, config, createRng('x'));
    assert.equal(placementHitRate(maze, deco.polyhedra, 'deadEnds'), 1, 'all polyhedra in dead ends');
    assert.equal(placementHitRate(maze, deco.smileys, 'corridors'), 1, 'all smileys in corridors');
  });

  test('one decoration type does not reshuffle another', () => {
    const base = createConfig({ maze: { width: 20, height: 20, algorithm: 'prim' }, objects: { polyhedra: { placement: 'deadEnds', count: 6 }, smiley: { placement: 'corridors', count: 4 } } });
    const maze = generateMaze({ ...base.maze, seed: 'pref' });
    const deco = placeDecorations(maze, base, createRng('x'));
    const morePosters = createConfig({ maze: base.maze, objects: { ...base.objects, posters: { randomCount: 9 } } });
    const deco2 = placeDecorations(maze, morePosters, createRng('x'));
    assert.deepEqual(deco2.polyhedra, deco.polyhedra, 'poster count does not move polyhedra');
    assert.deepEqual(deco2.smileys, deco.smileys, 'poster count does not move smileys');
    const noPolyhedra = createConfig({ maze: base.maze, objects: { ...base.objects, polyhedra: { enabled: false } } });
    const deco3 = placeDecorations(maze, noPolyhedra, createRng('x'));
    assert.deepEqual(deco3.smileys, deco.smileys, 'removing the polyhedra does not move the smileys');
    const fewerSmileys = createConfig({ maze: base.maze, objects: { ...base.objects, smiley: { placement: 'corridors', count: 1 } } });
    const deco4 = placeDecorations(maze, fewerSmileys, createRng('x'));
    assert.deepEqual(deco4.polyhedra, deco.polyhedra, 'smiley count does not move polyhedra');
  });

  test('random posters prefer walls at the end of straight runs', () => {
    const config = createConfig({ maze: { width: 20, height: 20, algorithm: 'prim' }, objects: { posters: { randomCount: 9 } } });
    const maze = generateMaze({ ...config.maze, seed: 'pref' });
    const deco = placeDecorations(maze, config, createRng('x'));
    const approach = (x, y, dir) => {
      let n = 0;
      const back = OPPOSITE[dir];
      while (!maze.hasWall(x, y, back)) { x += [0, 1, 0, -1][back]; y += [-1, 0, 1, 0][back]; n++; }
      return n;
    };
    let all = 0, allN = 0;
    for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) for (let d = 0; d < 4; d++) {
      if (maze.hasWall(x, y, d)) { all += approach(x, y, d); allN++; }
    }
    const picked = deco.posters.filter((p) => p.kind === 'poster');
    const pickedAvg = picked.reduce((s, p) => s + approach(p.x, p.y, p.dir), 0) / picked.length;
    assert.ok(pickedAvg > all / allN, `picked approach ${pickedAvg} should beat the all-walls average ${all / allN}`);
  });
});

describe('teleportTarget', () => {
  test('stays in bounds, respects exclusions, faces an open side and spreads over the maze', () => {
    const maze = generateMaze({ width: 8, height: 8, seed: 'tp' });
    const rng = createRng('tp');
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const t = teleportTarget(maze, rng, [maze.start, maze.finish, { x: 3, y: 3 }]);
      assert.ok(maze.inBounds(t.x, t.y), 'in bounds');
      assert.ok(!(t.x === maze.start.x && t.y === maze.start.y) && !(t.x === maze.finish.x && t.y === maze.finish.y) && !(t.x === 3 && t.y === 3), 'exclusions respected');
      assert.ok(maze.openDirs(t.x, t.y).includes(t.heading), 'heading faces an open side');
      seen.add(maze.index(t.x, t.y));
    }
    assert.ok(seen.size > 30, `spreads over the maze (${seen.size} distinct cells)`);
  });

  test('degenerate inputs: a 1×1 maze falls back to its only cell and bogus exclusions are ignored', () => {
    const rng = createRng('tp');
    const tiny = generateMaze({ width: 1, height: 1, seed: 'one' });
    const t = teleportTarget(tiny, rng, [{ x: 0, y: 0 }]);
    assert.deepEqual(t, { x: 0, y: 0, heading: 0 });
    const maze = generateMaze({ width: 8, height: 8, seed: 'tp' });
    const bad = teleportTarget(maze, rng, [null, { x: 99, y: 99 }]);
    assert.ok(maze.inBounds(bad.x, bad.y));
  });
});
