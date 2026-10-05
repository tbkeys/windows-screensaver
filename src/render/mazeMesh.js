/**
 * Static maze geometry.
 *
 * Builds ONE merged, indexed BufferGeometry (position / normal / uv / color) for every
 * wall face, one plane each for the floor and the ceiling, and one merged geometry per
 * poster kind. Walls have zero thickness: an interior wall gets two single-sided quads
 * with opposite normals, a boundary wall only its inside face. All transforms are baked
 * into the geometry, so the returned group is fully static.
 *
 * Coordinates follow docs/ARCHITECTURE.md: cell (x, y) spans world x ∈ [x·cs, (x+1)·cs],
 * z ∈ [y·cs, (y+1)·cs]; floor at y = 0, ceiling at y = wallHeight.
 */
import * as THREE from 'three';
import { N, E, S, W, DIRS, OPPOSITE } from '../maze/grid.js';

/** Posters float this far off their wall, toward the inside of the cell. */
const POSTER_INSET = 0.002;

/**
 * A face orientation `f ∈ 0..3` means "outward normal = DIRS[f]" (0: −Z, 1: +X, 2: +Z, 3: −X).
 * RIGHT[f] is the direction texture `u` grows on such a face. It satisfies
 * cross(right, up) = normal, so quads wind counter-clockwise for a viewer in front of
 * them (FrontSide culling keeps them) and poster text reads left to right.
 */
const NORMAL = Object.freeze(DIRS.map(({ dx, dy }) => Object.freeze([dx, 0, dy])));
const RIGHT = Object.freeze([
  Object.freeze([-1, 0, 0]), // normal −Z: viewer stands north, looks south, their right is −X
  Object.freeze([0, 0, -1]), // normal +X
  Object.freeze([1, 0, 0]), // normal +Z
  Object.freeze([0, 0, 1]), // normal −X
]);

/**
 * Vertex-colour multiplier for a face orientation. Fakes a light from the north: north-facing
 * walls (−Z) are fully lit, south-facing ones slightly darker, east/west-facing darkest.
 */
function faceShade(f, shading) {
  if (f === N) return 1;
  if (f === S) return 1 - shading * 0.5;
  return 1 - shading;
}

/**
 * Visit every wall exactly once: N and W of every cell, plus E on the last column and S on
 * the last row. `fn(x, y, side, isBoundary)`.
 */
function forEachWall(maze, fn) {
  const lastX = maze.width - 1;
  const lastY = maze.height - 1;
  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      if (maze.hasWall(x, y, N)) fn(x, y, N, y === 0);
      if (maze.hasWall(x, y, W)) fn(x, y, W, x === 0);
      if (x === lastX && maze.hasWall(x, y, E)) fn(x, y, E, true);
      if (y === lastY && maze.hasWall(x, y, S)) fn(x, y, S, true);
    }
  }
}

/** Counts used both by the builder (to pre-size buffers) and by the HUD. */
function countWalls(maze) {
  let walls = 0;
  let faces = 0;
  forEachWall(maze, (x, y, side, boundary) => {
    walls++;
    faces += boundary ? 1 : 2;
  });
  return { walls, faces };
}

/**
 * Geometry statistics for a maze's wall mesh, for the HUD / debugging.
 * @returns {{ walls: number, faces: number, vertices: number, triangles: number, indexType: 'uint16'|'uint32' }}
 */
export function wallGeometryStats(maze) {
  const { walls, faces } = countWalls(maze);
  const vertices = faces * 4;
  return { walls, faces, vertices, triangles: faces * 2, indexType: vertices > 65535 ? 'uint32' : 'uint16' };
}

/** Fills pre-sized typed arrays with quads and turns them into an indexed BufferGeometry. */
class QuadWriter {
  constructor(quadCount, withColor) {
    const vertices = quadCount * 4;
    this.position = new Float32Array(vertices * 3);
    this.normal = new Float32Array(vertices * 3);
    this.uv = new Float32Array(vertices * 2);
    this.color = withColor ? new Float32Array(vertices * 3) : null;
    this.face = withColor ? new Uint8Array(vertices) : null;
    this.index = vertices > 65535 ? new Uint32Array(quadCount * 6) : new Uint16Array(quadCount * 6);
    this.vertex = 0;
    this.cursor = 0;
  }

  /**
   * Emit one quad: corner `o`, edge vectors `r` (along u) and `u` (along v), outward normal
   * `n` (unit, plain array). Winding is o → o+r → o+r+u → o+u, counter-clockwise when
   * cross(r, u) points toward the viewer.
   */
  quad(ox, oy, oz, rx, ry, rz, ux, uy, uz, n, uMax, vMax, shade, face) {
    const v = this.vertex;
    const p = this.position;
    let i = v * 3;
    p[i++] = ox; p[i++] = oy; p[i++] = oz;
    p[i++] = ox + rx; p[i++] = oy + ry; p[i++] = oz + rz;
    p[i++] = ox + rx + ux; p[i++] = oy + ry + uy; p[i++] = oz + rz + uz;
    p[i++] = ox + ux; p[i++] = oy + uy; p[i] = oz + uz;

    const t = this.uv;
    i = v * 2;
    t[i++] = 0; t[i++] = 0;
    t[i++] = uMax; t[i++] = 0;
    t[i++] = uMax; t[i++] = vMax;
    t[i++] = 0; t[i] = vMax;

    for (let k = 0; k < 4; k++) {
      const j = (v + k) * 3;
      this.normal[j] = n[0]; this.normal[j + 1] = n[1]; this.normal[j + 2] = n[2];
      if (this.color) {
        this.color[j] = this.color[j + 1] = this.color[j + 2] = shade;
        this.face[v + k] = face;
      }
    }

    const idx = this.index;
    let c = this.cursor;
    idx[c++] = v; idx[c++] = v + 1; idx[c++] = v + 2;
    idx[c++] = v; idx[c++] = v + 2; idx[c++] = v + 3;
    this.cursor = c;
    this.vertex += 4;
  }

  toGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    if (this.color) geometry.setAttribute('color', new THREE.BufferAttribute(this.color, 3));
    geometry.setIndex(new THREE.BufferAttribute(this.index, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** World-space centre of the wall on `side` of cell (x, y), at floor level. */
function wallCentre(x, y, side, cellSize, out) {
  out[0] = (x + 0.5 + DIRS[side].dx * 0.5) * cellSize;
  out[1] = (y + 0.5 + DIRS[side].dy * 0.5) * cellSize;
  return out;
}

/** Emit the wall face with orientation `f` for a wall segment centred at (cx, cz). */
function writeWallFace(writer, cx, cz, f, cellSize, wallHeight, shading) {
  const r = RIGHT[f];
  const half = cellSize * 0.5;
  writer.quad(
    cx - r[0] * half, 0, cz - r[2] * half,
    r[0] * cellSize, 0, r[2] * cellSize,
    0, wallHeight, 0,
    NORMAL[f], 1, wallHeight / cellSize, faceShade(f, shading), f,
  );
}

/** All wall faces in one geometry, plus the face orientation of every vertex (for re-shading). */
function buildWallGeometry(maze, cellSize, wallHeight, shading) {
  const writer = new QuadWriter(countWalls(maze).faces, true);
  const centre = [0, 0];
  forEachWall(maze, (x, y, side, boundary) => {
    wallCentre(x, y, side, cellSize, centre);
    writeWallFace(writer, centre[0], centre[1], OPPOSITE[side], cellSize, wallHeight, shading); // faces into the cell
    if (!boundary) writeWallFace(writer, centre[0], centre[1], side, cellSize, wallHeight, shading); // faces the neighbour
  });
  return { geometry: writer.toGeometry(), faceIds: writer.face };
}

/** Floor (facingUp) or ceiling plane covering the maze; UVs span one unit per cell. */
function buildSurfaceGeometry(maze, cellSize, elevation, facingUp) {
  const w = maze.width * cellSize;
  const h = maze.height * cellSize;
  const geometry = new THREE.PlaneGeometry(w, h);
  geometry.rotateX(facingUp ? -Math.PI / 2 : Math.PI / 2);
  geometry.translate(w / 2, elevation, h / 2);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * maze.width, uv.getY(i) * maze.height);
  return geometry;
}

/** Posters that sit on an existing wall of an in-bounds cell, grouped by kind. */
function groupPosters(maze, posters) {
  const byKind = new Map();
  for (const poster of posters) {
    const { x, y, dir } = poster;
    if (!maze.inBounds(x, y) || !maze.hasWall(x, y, dir)) continue;
    const kind = poster.kind ?? 'poster';
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(poster);
  }
  return byKind;
}

function buildPosterGeometry(maze, posters, cellSize, wallHeight, size, elevation) {
  const writer = new QuadWriter(posters.length, false);
  const side = Math.min(size * cellSize, wallHeight);
  const half = side * 0.5;
  const centreY = Math.min(Math.max(elevation * wallHeight, half), wallHeight - half);
  const centre = [0, 0];
  for (const { x, y, dir } of posters) {
    const f = OPPOSITE[dir]; // faces into the cell, toward the walker
    const n = NORMAL[f];
    const r = RIGHT[f];
    wallCentre(x, y, dir, cellSize, centre);
    writer.quad(
      centre[0] + n[0] * POSTER_INSET - r[0] * half, centreY - half, centre[1] + n[2] * POSTER_INSET - r[2] * half,
      r[0] * side, 0, r[2] * side,
      0, side, 0,
      n, 1, 1, 1, f,
    );
  }
  return writer.toGeometry();
}

function staticMesh(geometry, material, name) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * Build the static maze group: walls, floor, ceiling and posters.
 *
 * Reads `config.maze.cellSize / wallHeight`, `config.lighting.faceShading` and
 * `config.objects.posters.size / elevation`; all of them are baked into the geometry, so
 * rebuild when they change (face shading alone can be updated with `setFaceShading`).
 *
 * @param {import('../maze/grid.js').Maze} maze
 * @param {object} config
 * @param {ReturnType<import('./materials.js').createMaterialSet>} materials
 * @param {{ posters?: { x: number, y: number, dir: number, kind: string }[] }} [decorations]
 * @returns {{
 *   group: THREE.Group,
 *   stats: ReturnType<typeof wallGeometryStats>,
 *   refreshMaterials(): void,
 *   setFaceShading(value: number): void,
 *   dispose(): void }}
 *   `refreshMaterials()` re-reads the material set (call it after `materials.refresh()`
 *   returned true). `dispose()` frees the geometries only; materials belong to the set.
 */
export function buildMazeGroup(maze, config, materials, decorations = {}) {
  const cellSize = config.maze.cellSize;
  const wallHeight = config.maze.wallHeight;
  const shading = Math.min(1, Math.max(0, config.lighting.faceShading));

  const group = new THREE.Group();
  group.name = 'maze';
  group.matrixAutoUpdate = false;

  const wallData = buildWallGeometry(maze, cellSize, wallHeight, shading);
  const walls = staticMesh(wallData.geometry, materials.wall, 'walls');
  const floor = staticMesh(buildSurfaceGeometry(maze, cellSize, 0, true), materials.floor, 'floor');
  // `maze.ceiling === false` leaves the maze open to the sky (the scene background shows).
  const ceiling = config.maze.ceiling === false
    ? null
    : staticMesh(buildSurfaceGeometry(maze, cellSize, wallHeight, false), materials.ceiling, 'ceiling');
  group.add(walls, floor);
  if (ceiling) group.add(ceiling);

  /** @type {Map<string, THREE.Mesh>} */
  const posterMeshes = new Map();
  const { size, elevation } = config.objects.posters;
  for (const [kind, posters] of groupPosters(maze, decorations.posters ?? [])) {
    const geometry = buildPosterGeometry(maze, posters, cellSize, wallHeight, size, elevation);
    const mesh = staticMesh(geometry, materials.poster(kind), `posters:${kind}`);
    posterMeshes.set(kind, mesh);
    group.add(mesh);
  }

  return {
    group,
    stats: wallGeometryStats(maze),
    refreshMaterials() {
      walls.material = materials.wall;
      floor.material = materials.floor;
      if (ceiling) ceiling.material = materials.ceiling;
      for (const [kind, mesh] of posterMeshes) mesh.material = materials.poster(kind);
    },
    setFaceShading(value) {
      const s = Math.min(1, Math.max(0, value));
      const colorAttr = wallData.geometry.attributes.color;
      const array = colorAttr.array;
      const faceIds = wallData.faceIds;
      for (let i = 0; i < faceIds.length; i++) {
        const shade = faceShade(faceIds[i], s);
        array[i * 3] = array[i * 3 + 1] = array[i * 3 + 2] = shade;
      }
      colorAttr.needsUpdate = true;
    },
    dispose() {
      for (const mesh of group.children) mesh.geometry.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
