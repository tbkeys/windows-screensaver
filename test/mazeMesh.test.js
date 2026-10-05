import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createConfig } from '../src/config/defaults.js';
import { generateMaze } from '../src/maze/generator.js';
import { Maze, DIRS, OPPOSITE } from '../src/maze/grid.js';
import { buildMazeGroup, wallGeometryStats } from '../src/render/mazeMesh.js';

/** Minimal material set stand-in: distinct objects so material wiring can be asserted. */
function stubMaterials() {
  const posters = new Map();
  return {
    wall: { name: 'wall' }, floor: { name: 'floor' }, ceiling: { name: 'ceiling' },
    poster(kind) { if (!posters.has(kind)) posters.set(kind, { name: `poster:${kind}` }); return posters.get(kind); },
    refresh() { return false; }, dispose() {},
  };
}

/** Every triangle's geometric normal must match its stored vertex normal (CCW winding ⇒ FrontSide visible). */
function checkWinding(geometry, label) {
  const pos = geometry.attributes.position, nor = geometry.attributes.normal, idx = geometry.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), stored = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i), ib = idx.getX(i + 1), ic = idx.getX(i + 2);
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    stored.fromBufferAttribute(nor, ia);
    assert.ok(n.dot(stored) > 0.999, `${label}: triangle ${i / 3} winds against its normal (${n.toArray()} vs ${stored.toArray()})`);
  }
}

const config = createConfig();
const maze = generateMaze({ width: 12, height: 12, seed: 'windows95' });
const stats = wallGeometryStats(maze);
const posters = [
  { x: maze.start.x, y: maze.start.y, dir: maze.start.heading, kind: 'start' },
  { x: 3, y: 3, dir: [0, 1, 2, 3].find((d) => maze.hasWall(3, 3, d)), kind: 'poster' },
  { x: 99, y: 99, dir: 0, kind: 'finish' }, // out of bounds → skipped
];
const materials = stubMaterials();
const built = buildMazeGroup(maze, config, materials, { posters });
const byName = Object.fromEntries(built.group.children.map((m) => [m.name, m]));

describe('mazeMesh', () => {
  test('wall statistics count every wall once and interior walls twice as faces', () => {
    assert.equal(stats.vertices, stats.faces * 4);
    assert.equal(stats.triangles, stats.faces * 2);
    assert.equal(stats.indexType, 'uint16');
    let interiorSides = 0;
    for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) for (let d = 0; d < 4; d++) {
      if (maze.hasWall(x, y, d) && maze.neighbor(x, y, d)) interiorSides++;
    }
    const boundary = 2 * (maze.width + maze.height);
    assert.equal(stats.walls, boundary + interiorSides / 2, 'each wall counted exactly once');
    assert.equal(stats.faces, boundary + interiorSides, 'boundary walls get one face, interior walls two');
  });

  test('group holds merged walls, floor, ceiling and one mesh per poster kind, wired to the material set', () => {
    assert.equal(built.group.matrixAutoUpdate, false);
    assert.ok(byName.walls && byName.floor && byName.ceiling, 'walls/floor/ceiling meshes present');
    assert.ok(byName['posters:start'] && byName['posters:poster'], 'one mesh per poster kind');
    assert.equal(byName['posters:finish'], undefined, 'posters off the grid are dropped');
    assert.equal(byName.walls.geometry.attributes.position.count, stats.vertices);
    assert.equal(byName.walls.geometry.index.count, stats.triangles * 3);
    assert.ok(byName.walls.geometry.attributes.color, 'walls carry vertex colours');
    assert.equal(byName.walls.material, materials.wall);
    assert.equal(byName['posters:start'].material, materials.poster('start'));
  });

  test('every face winds counter-clockwise around its normal', () => {
    for (const mesh of built.group.children) checkWinding(mesh.geometry, mesh.name);
  });

  test('wall UVs span one tile per wall and positions stay inside the maze box', () => {
    const uv = byName.walls.geometry.attributes.uv, pos = byName.walls.geometry.attributes.position;
    const vMax = config.maze.wallHeight / config.maze.cellSize;
    for (let i = 0; i < uv.count; i++) {
      assert.ok(uv.getX(i) === 0 || uv.getX(i) === 1, 'wall u is 0 or 1');
      assert.ok(uv.getY(i) === 0 || uv.getY(i) === vMax, 'wall v is 0 or wallHeight/cellSize');
      assert.ok(pos.getX(i) >= 0 && pos.getX(i) <= maze.width * config.maze.cellSize);
      assert.ok(pos.getZ(i) >= 0 && pos.getZ(i) <= maze.height * config.maze.cellSize);
      assert.ok(pos.getY(i) === 0 || pos.getY(i) === config.maze.wallHeight);
    }
  });

  test('floor and ceiling UVs span one unit per cell; floor faces up, ceiling faces down', () => {
    const fuv = byName.floor.geometry.attributes.uv;
    const us = [...Array(fuv.count)].map((_, i) => fuv.getX(i)), vs = [...Array(fuv.count)].map((_, i) => fuv.getY(i));
    assert.equal(Math.max(...us), maze.width);
    assert.equal(Math.max(...vs), maze.height);
    assert.ok(byName.floor.geometry.attributes.normal.getY(0) > 0.999);
    assert.ok(byName.ceiling.geometry.attributes.normal.getY(0) < -0.999);
    assert.equal(byName.ceiling.geometry.attributes.position.getY(0), config.maze.wallHeight);
  });

  test('maze.ceiling = false leaves the maze open to the sky', () => {
    const open = buildMazeGroup(maze, createConfig({ maze: { ceiling: false } }), stubMaterials(), { posters });
    const names = open.group.children.map((m) => m.name);
    assert.ok(names.includes('walls') && names.includes('floor') && !names.includes('ceiling'));
    open.refreshMaterials(); // must not touch a missing ceiling
    open.dispose();
  });

  test('posters face into their cell, sit 2 mm inside the wall plane and are sized/centred from config', () => {
    const p = posters[0];
    const geo = byName['posters:start'].geometry;
    const expectN = DIRS[OPPOSITE[p.dir]];
    assert.ok(geo.attributes.normal.getX(0) === expectN.dx && geo.attributes.normal.getZ(0) === expectN.dy, 'poster normal points into the cell');
    const centreOnWall = { x: (p.x + 0.5 + DIRS[p.dir].dx * 0.5), z: (p.y + 0.5 + DIRS[p.dir].dy * 0.5) };
    const along = p.dir === 0 || p.dir === 2 ? 'z' : 'x';
    const coord = along === 'z' ? geo.attributes.position.getZ(0) : geo.attributes.position.getX(0);
    const expected = centreOnWall[along] + (along === 'z' ? expectN.dy : expectN.dx) * 0.002;
    assert.ok(Math.abs(coord - expected) < 1e-6, `poster offset: ${coord} vs ${expected}`);
    const size = config.objects.posters.size * config.maze.cellSize;
    const ys = [0, 1, 2, 3].map((i) => geo.attributes.position.getY(i));
    assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - size) < 1e-6, 'poster is size*cellSize tall');
    assert.ok(Math.abs((Math.max(...ys) + Math.min(...ys)) / 2 - config.objects.posters.elevation * config.maze.wallHeight) < 1e-6, 'poster centred at elevation');
  });

  test('face shading: N-facing 1, S-facing 1 − s/2, E/W-facing 1 − s, updatable in place', () => {
    const col = byName.walls.geometry.attributes.color, nor = byName.walls.geometry.attributes.normal;
    const versionBefore = col.version;
    built.setFaceShading(0.4);
    const seen = new Set();
    for (let i = 0; i < col.count; i++) {
      const nx = nor.getX(i), nz = nor.getZ(i);
      const want = nz < -0.5 ? 1 : nz > 0.5 ? 0.8 : 0.6;
      assert.ok(Math.abs(col.getX(i) - want) < 1e-6, `shade for normal (${nx},${nz}) = ${col.getX(i)}, want ${want}`);
      seen.add(want);
    }
    assert.equal(seen.size, 3, 'all three shade classes occur');
    assert.ok(col.version > versionBefore, 'the colour attribute is flagged for upload');
  });

  test('refreshMaterials picks up replaced material instances and dispose empties the group', () => {
    const own = stubMaterials();
    const rebound = buildMazeGroup(maze, config, own, { posters });
    const names = Object.fromEntries(rebound.group.children.map((m) => [m.name, m]));
    const next = stubMaterials();
    own.wall = next.wall;
    rebound.refreshMaterials();
    assert.equal(names.walls.material, next.wall);
    rebound.dispose();
    assert.equal(rebound.group.children.length, 0);
  });

  test('big mazes switch to a Uint32 index; a 1×1 maze still builds', () => {
    const big = new Maze(130, 130); // all walls closed: 130*131*2 walls, ~67k faces
    assert.equal(wallGeometryStats(big).indexType, 'uint32');
    const bigBuilt = buildMazeGroup(big, config, stubMaterials());
    assert.ok(bigBuilt.group.getObjectByName('walls').geometry.index.array instanceof Uint32Array);
    bigBuilt.dispose();
    const tiny = buildMazeGroup(new Maze(1, 1), config, stubMaterials());
    assert.equal(tiny.stats.faces, 4);
    tiny.dispose();
  });
});
