/**
 * Maze grid data structure and shared direction conventions.
 *
 * Cell (x, y): x → world +X, y → world +Z. Directions 0..3 = N(−Z), E(+X), S(+Z), W(−X).
 * Each cell stores a wall bitmask (N=1, E=2, S=4, W=8); a set bit means "wall present".
 */

export const N = 0, E = 1, S = 2, W = 3;
export const DIRS = Object.freeze([
  Object.freeze({ dx: 0, dy: -1 }),
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: 0, dy: 1 }),
  Object.freeze({ dx: -1, dy: 0 }),
]);
export const OPPOSITE = Object.freeze([2, 3, 0, 1]);
export const WALL_BITS = Object.freeze([1, 2, 4, 8]);

export const turnLeft = (h) => (h + 3) & 3;
export const turnRight = (h) => (h + 1) & 3;
export const turnBack = (h) => (h + 2) & 3;
/** Yaw (radians about +Y) that makes a three.js camera look along heading `h`. */
export const yawForHeading = (h) => -h * Math.PI / 2;

export class Maze {
  constructor(width, height) {
    if (!(width >= 1 && height >= 1)) throw new Error(`Invalid maze size ${width}×${height}`);
    this.width = width | 0;
    this.height = height | 0;
    this.cells = new Uint8Array(this.width * this.height).fill(15);
    this.start = { x: 0, y: 0, heading: S };
    this.finish = { x: this.width - 1, y: this.height - 1 };
  }

  index(x, y) { return y * this.width + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  hasWall(x, y, dir) { return (this.cells[this.index(x, y)] & WALL_BITS[dir]) !== 0; }

  /** True when you can walk from (x, y) in `dir`: no wall and the neighbour is inside the maze. */
  canStep(x, y, dir) {
    const d = DIRS[dir];
    return !this.hasWall(x, y, dir) && this.inBounds(x + d.dx, y + d.dy);
  }

  neighbor(x, y, dir) {
    const nx = x + DIRS[dir].dx, ny = y + DIRS[dir].dy;
    return this.inBounds(nx, ny) ? { x: nx, y: ny } : null;
  }

  /** Set or clear the wall on side `dir` of (x, y), keeping the neighbour consistent. */
  setWall(x, y, dir, present) {
    const i = this.index(x, y);
    if (present) this.cells[i] |= WALL_BITS[dir]; else this.cells[i] &= ~WALL_BITS[dir];
    const n = this.neighbor(x, y, dir);
    if (n) {
      const j = this.index(n.x, n.y);
      const bit = WALL_BITS[OPPOSITE[dir]];
      if (present) this.cells[j] |= bit; else this.cells[j] &= ~bit;
    }
  }

  /** Remove the wall between (x, y) and its neighbour in `dir`. Outer walls are never carved. */
  carve(x, y, dir) {
    if (!this.neighbor(x, y, dir)) return false;
    this.setWall(x, y, dir, false);
    return true;
  }

  /** Directions you can walk from (x, y): no wall and in bounds. */
  openDirs(x, y) {
    const out = [];
    for (let d = 0; d < 4; d++) if (this.canStep(x, y, d)) out.push(d);
    return out;
  }

  isDeadEnd(x, y) { return this.openDirs(x, y).length === 1; }

  deadEnds() {
    const out = [];
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++)
        if (this.isDeadEnd(x, y)) out.push({ x, y });
    return out;
  }

  isEdge(x, y) { return x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1; }

  /** Breadth-first distances from `from`; -1 where unreachable. */
  bfs(from) {
    const dist = new Int32Array(this.width * this.height).fill(-1);
    const queue = new Int32Array(this.width * this.height);
    let head = 0, tail = 0;
    const s = this.index(from.x, from.y);
    dist[s] = 0;
    queue[tail++] = s;
    while (head < tail) {
      const i = queue[head++];
      const x = i % this.width, y = (i / this.width) | 0;
      const d = dist[i] + 1;
      for (let dir = 0; dir < 4; dir++) {
        if (this.hasWall(x, y, dir)) continue;
        const nx = x + DIRS[dir].dx, ny = y + DIRS[dir].dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.index(nx, ny);
        if (dist[j] !== -1) continue;
        dist[j] = d;
        queue[tail++] = j;
      }
    }
    return dist;
  }

  /** Shortest path (list of {x,y}, inclusive) or [] if unreachable. */
  shortestPath(from, to) {
    const dist = this.bfs(to);
    if (dist[this.index(from.x, from.y)] === -1) return [];
    const path = [{ x: from.x, y: from.y }];
    let { x, y } = from;
    while (!(x === to.x && y === to.y)) {
      const here = dist[this.index(x, y)];
      let moved = false;
      for (let dir = 0; dir < 4; dir++) {
        if (this.hasWall(x, y, dir)) continue;
        const n = this.neighbor(x, y, dir);
        if (n && dist[this.index(n.x, n.y)] === here - 1) {
          x = n.x; y = n.y; path.push({ x, y }); moved = true; break;
        }
      }
      if (!moved) return [];
    }
    return path;
  }

  farthestCellFrom(from) {
    const dist = this.bfs(from);
    let best = -1, bx = from.x, by = from.y;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] > best) { best = dist[i]; bx = i % this.width; by = (i / this.width) | 0; }
    }
    return { x: bx, y: by, distance: best };
  }

  /** Number of carved passages (a perfect maze has width*height - 1). */
  countPassages() {
    let n = 0;
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        if (!this.hasWall(x, y, E) && x + 1 < this.width) n++;
        if (!this.hasWall(x, y, S) && y + 1 < this.height) n++;
      }
    return n;
  }

  /** True when every cell is reachable from (0,0). */
  isConnected() {
    const d = this.bfs({ x: 0, y: 0 });
    for (let i = 0; i < d.length; i++) if (d[i] === -1) return false;
    return true;
  }

  clone() {
    const m = new Maze(this.width, this.height);
    m.cells.set(this.cells);
    m.start = { ...this.start };
    m.finish = { ...this.finish };
    return m;
  }

  /** ASCII rendering for debugging/tests. */
  toString() {
    const lines = ['+' + '---+'.repeat(this.width)];
    for (let y = 0; y < this.height; y++) {
      let row = '|', bottom = '+';
      for (let x = 0; x < this.width; x++) {
        const mark = (x === this.start.x && y === this.start.y) ? ' S ' : (x === this.finish.x && y === this.finish.y) ? ' F ' : '   ';
        row += mark + (this.hasWall(x, y, E) ? '|' : ' ');
        bottom += (this.hasWall(x, y, S) ? '---' : '   ') + '+';
      }
      lines.push(row, bottom);
    }
    return lines.join('\n');
  }
}
