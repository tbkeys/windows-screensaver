/**
 * Procedural textures for the Win95 3D Maze.
 *
 * Every texture is painted on an HTMLCanvasElement (no image files, no network) and
 * wrapped in a THREE.CanvasTexture. Surface kinds tile seamlessly: noise is sampled from
 * wrap-around lattices and brick/tile/plank patterns are aligned to the canvas size.
 * All randomness goes through `createRng(seed)` so the same seed yields the same pixels.
 */
import * as THREE from 'three';
import { createRng, hashSeed } from '../maze/rng.js';
import { ENUMS } from '../config/defaults.js';

const TAU = Math.PI * 2;
const SURFACE_SLOTS = Object.freeze(['wall', 'floor', 'ceiling']);
const POSTER_SLOTS = Object.freeze(['poster']);
/** Uploaded images larger than this (per side) are downscaled before upload. */
const MAX_IMAGE_SIZE = 2048;

/** Ids of every surface (wall/floor/ceiling) texture kind, in ENUMS order. */
export const SURFACE_KIND_IDS = Object.freeze(ENUMS.surfaceTextures.map(([id]) => id));
/** Ids of every poster texture kind, in ENUMS order. */
export const POSTER_KIND_IDS = Object.freeze(ENUMS.posterTextures.map(([id]) => id));

/** Every texture kind with its label and the slots it may be used in. */
export const TEXTURE_KINDS = Object.freeze((() => {
  const byId = new Map();
  const add = (list, slots) => {
    for (const [id, name] of list) {
      const entry = byId.get(id);
      if (entry) entry.slots.push(...slots.filter((s) => !entry.slots.includes(s)));
      else byId.set(id, { id, name, slots: [...slots] });
    }
  };
  add(ENUMS.surfaceTextures, SURFACE_SLOTS);
  add(ENUMS.posterTextures, POSTER_SLOTS);
  return [...byId.values()].map((k) => Object.freeze({ ...k, slots: Object.freeze(k.slots) }));
})());

/* ------------------------------------------------------------------------------------ */
/* Small maths / colour helpers                                                          */
/* ------------------------------------------------------------------------------------ */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, t) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const fade = (t) => t * t * (3 - 2 * t);
const fract = (v) => v - Math.floor(v);

/** '#rgb' / '#rrggbb' → [r, g, b] (0..255). Invalid input → white. */
function hexToRgb(hex) {
  let s = String(hex ?? '').trim().replace('#', '');
  if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  const n = parseInt(s, 16);
  if (s.length !== 6 || Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const luminance = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

/* ------------------------------------------------------------------------------------ */
/* Tiling noise                                                                          */
/* ------------------------------------------------------------------------------------ */

/** Accumulate one octave of tiling value noise (fx × fy lattice) into `out` with weight `amp`. */
function addValueNoise(rng, size, fx, fy, out, amp) {
  const lattice = new Float32Array(fx * fy);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  const sx = fx / size, sy = fy / size;
  for (let y = 0, k = 0; y < size; y++) {
    const gy = y * sy, y0 = gy | 0, y1 = (y0 + 1) % fy, ty = fade(gy - y0);
    const row0 = y0 * fx, row1 = y1 * fx;
    for (let x = 0; x < size; x++, k++) {
      const gx = x * sx, x0 = gx | 0, x1 = (x0 + 1) % fx, tx = fade(gx - x0);
      const top = lattice[row0 + x0] + (lattice[row0 + x1] - lattice[row0 + x0]) * tx;
      const bottom = lattice[row1 + x0] + (lattice[row1 + x1] - lattice[row1 + x0]) * tx;
      out[k] += amp * (top + (bottom - top) * ty);
    }
  }
}

/** Stretch an array to [0, 1] in place. */
function normalize(arr) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < arr.length; i++) { if (arr[i] < lo) lo = arr[i]; if (arr[i] > hi) hi = arr[i]; }
  const inv = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - lo) * inv;
  return arr;
}

/**
 * Tiling fractal (fBm) value noise in [0, 1] over a size × size tile.
 * `fx`/`fy` = lattice cells across the tile for the first octave (fx ≠ fy stretches the noise).
 */
function fbm(rng, size, { fx = 4, fy = fx, octaves = 4, gain = 0.5 } = {}) {
  const out = new Float32Array(size * size);
  let amp = 1;
  for (let o = 0; o < octaves; o++, amp *= gain) {
    addValueNoise(rng, size, Math.min(size, fx << o), Math.min(size, fy << o), out, amp);
  }
  return normalize(out);
}

/**
 * Tiling jittered-grid Voronoi (n × n feature points). Per pixel: nearest feature `id`,
 * distance `f1` (cell units), edge proximity `edge` = F2 − F1, and the offset (`dx`, `dy`)
 * from the pixel to its feature point (cell units) for fake lighting.
 */
function voronoi(rng, size, n, jitter = 0.45) {
  const px = new Float32Array(n * n), py = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      px[j * n + i] = i + 0.5 + (rng() - 0.5) * 2 * jitter;
      py[j * n + i] = j + 0.5 + (rng() - 0.5) * 2 * jitter;
    }
  }
  const total = size * size;
  const id = new Int32Array(total), f1 = new Float32Array(total), edge = new Float32Array(total);
  const dx = new Float32Array(total), dy = new Float32Array(total);
  const s = n / size;
  for (let y = 0, k = 0; y < size; y++) {
    const gy = y * s, cj = gy | 0;
    for (let x = 0; x < size; x++, k++) {
      const gx = x * s, ci = gx | 0;
      let best = Infinity, second = Infinity, bestId = 0, bdx = 0, bdy = 0;
      for (let oj = -1; oj <= 1; oj++) {
        const j = cj + oj, wj = (j + n) % n;
        for (let oi = -1; oi <= 1; oi++) {
          const i = ci + oi, wi = (i + n) % n;
          const ddx = px[wj * n + wi] + (i - wi) - gx;
          const ddy = py[wj * n + wi] + (j - wj) - gy;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < best) { second = best; best = d; bestId = wj * n + wi; bdx = ddx; bdy = ddy; }
          else if (d < second) second = d;
        }
      }
      id[k] = bestId; f1[k] = best; edge[k] = second - best; dx[k] = bdx; dy[k] = bdy;
    }
  }
  return { id, f1, edge, dx, dy, count: n * n };
}

/* ------------------------------------------------------------------------------------ */
/* Canvas helpers                                                                        */
/* ------------------------------------------------------------------------------------ */

/** Run `fn(data, i, x, y, k)` for every pixel (i = byte index, k = pixel index), then write back. */
function forEachPixel(ctx, size, fn) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0, k = 0, i = 0; y < size; y++) {
    for (let x = 0; x < size; x++, k++, i += 4) fn(d, i, x, y, k);
  }
  ctx.putImageData(img, 0, 0);
}

/** Multiply the RGB of pixel `i` by `k` (Uint8ClampedArray clamps for us). */
function scalePixel(d, i, k) { d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }

/** Write an RGB triple to pixel `i`. */
function setPixel(d, i, c) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }

/** Fill the whole canvas with a colour. */
function fill(ctx, size, c) { ctx.fillStyle = css(c); ctx.fillRect(0, 0, size, size); }

/** Call `draw(ox, oy)` for every tile offset needed so a shape of `radius` near an edge wraps around. */
function drawWrapped(size, x, y, radius, draw) {
  const xs = [0], ys = [0];
  if (x - radius < 0) xs.push(size);
  if (x + radius > size) xs.push(-size);
  if (y - radius < 0) ys.push(size);
  if (y + radius > size) ys.push(-size);
  for (const ox of xs) for (const oy of ys) draw(ox, oy);
}

/** fillRect that wraps horizontally around the tile. */
function fillRectWrapX(ctx, size, x, y, w, h) {
  x = ((x % size) + size) % size;
  ctx.fillRect(x, y, w, h);
  if (x + w > size) ctx.fillRect(x - size, y, w, h);
}

/** Set ctx.font to `fontFor(size)`, shrinking the size until `text` fits `maxWidth`. */
function fitFont(ctx, text, maxWidth, fontFor, startSize) {
  let fs = startSize;
  ctx.font = fontFor(fs);
  while (fs > 4 && ctx.measureText(text).width > maxWidth) {
    fs *= 0.92;
    ctx.font = fontFor(fs);
  }
}

const SANS = '"Arial Black", "Liberation Sans", Arial, Helvetica, sans-serif';
const boldFont = (fs) => `bold ${fs}px ${SANS}`;
const italicFont = (fs) => `italic 900 ${fs}px ${SANS}`;

/* ------------------------------------------------------------------------------------ */
/* Surface drawers. Each receives p = { ctx, size, px, rng, tint, text, customImage }     */
/* ------------------------------------------------------------------------------------ */

/** Running-bond bricks: `courses` rows × `perCourse` bricks per row, mortar lines aligned to the tile. */
function drawBricks(p, { brickA, brickB, mortar, courses = 4, perCourse = 2, speckle = 0.14 }) {
  const { ctx, size, rng } = p;
  const courseH = size / courses, brickW = size / perCourse;
  const m = Math.max(1, Math.round(size / 56));
  const inset = Math.floor(m / 2);
  fill(ctx, size, mortar);
  for (let c = 0; c < courses; c++) {
    const y0 = c * courseH + inset;
    const shift = c & 1 ? brickW / 2 : 0;
    for (let b = 0; b < perCourse; b++) {
      ctx.fillStyle = css(shade(mix(brickA, brickB, rng()), 0.93 + rng() * 0.14));
      fillRectWrapX(ctx, size, b * brickW + shift + inset, y0, brickW - m, courseH - m);
    }
  }
  const tone = fbm(rng.fork('tone'), size, { fx: 3, octaves: 3 });
  const grain = rng.fork('grain');
  forEachPixel(ctx, size, (d, i, x, y, k) => scalePixel(d, i, 0.9 + 0.14 * tone[k] + (grain() - 0.5) * speckle));
}

const RED_BRICK = { brickA: [154, 59, 36], brickB: [176, 82, 58], mortar: [200, 196, 188] };
const GREY_BRICK = { brickA: [104, 104, 106], brickB: [142, 140, 138], mortar: [196, 196, 192], speckle: 0.1 };

/** Classic ceiling: 4 × 4 pale blue-grey tiles with darker seams and fine speckles. */
function drawCeilingTile(p) {
  const { ctx, size, rng } = p;
  const n = 4, t = size / n;
  const seam = Math.max(1, Math.round(size / 128)), inset = Math.floor(seam / 2);
  fill(ctx, size, [166, 170, 178]);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = css(mix([196, 200, 207], [210, 213, 218], rng()));
      ctx.fillRect(i * t + inset, j * t + inset, t - seam, t - seam);
    }
  }
  const tone = fbm(rng.fork('tone'), size, { fx: 8, octaves: 3 });
  const grain = rng.fork('grain');
  forEachPixel(ctx, size, (d, i, x, y, k) => {
    const speck = grain() < 0.07 ? 0.82 + grain() * 0.1 : 0.985 + grain() * 0.03;
    scalePixel(d, i, (0.96 + 0.08 * tone[k]) * speck);
  });
}

/** Classic floor: mottled grey-brown flagstones separated by darker grout. */
function drawStone(p) {
  const { ctx, size, rng } = p;
  const v = voronoi(rng.fork('cells'), size, 4, 0.42);
  const tone = fbm(rng.fork('tone'), size, { fx: 6, octaves: 4 });
  const palette = rng.fork('palette');
  const slabs = Array.from({ length: v.count }, () =>
    shade(mix([112, 103, 90], [146, 136, 120], palette()), 0.9 + palette() * 0.2));
  const grout = [72, 66, 60];
  const grain = rng.fork('grain');
  forEachPixel(ctx, size, (d, i, x, y, k) => {
    const g = smoothstep(0.06, 0.13, v.edge[k]);
    const bevel = 1 - 0.18 * (1 - smoothstep(0.1, 0.4, v.edge[k]));
    const slab = shade(slabs[v.id[k]], (0.84 + 0.3 * tone[k]) * bevel);
    const c = mix(shade(grout, 0.85 + 0.3 * tone[k]), slab, g);
    setPixel(d, i, shade(c, 1 + (grain() - 0.5) * 0.1));
  });
}

/** Rounded cobblestones on a jittered grid, lit from the top-left, with dark grout. */
function drawCobble(p) {
  const { ctx, size, rng } = p;
  const v = voronoi(rng.fork('cells'), size, 6, 0.45);
  const tone = fbm(rng.fork('tone'), size, { fx: 8, octaves: 3 });
  const palette = rng.fork('palette');
  const stones = Array.from({ length: v.count }, () =>
    shade(mix([108, 106, 100], [158, 152, 140], palette()), 0.9 + palette() * 0.2));
  const grout = [58, 54, 50];
  const grain = rng.fork('grain');
  forEachPixel(ctx, size, (d, i, x, y, k) => {
    const f1 = v.f1[k], dome = smoothstep(0.08, 0.6, f1);
    const light = f1 > 1e-4 ? (0.6 * v.dx[k] + 0.8 * v.dy[k]) / f1 : 0;
    const shading = 1 - 0.4 * dome + 0.22 * light * dome;
    const stone = shade(stones[v.id[k]], shading * (0.9 + 0.2 * tone[k]));
    const g = smoothstep(0.07, 0.16, v.edge[k]);
    setPixel(d, i, shade(mix(grout, stone, g), 1 + (grain() - 0.5) * 0.12));
  });
}

/** Horizontal planks (4 per tile) with staggered joints, iso-line grain and a couple of knots. */
function drawWood(p) {
  const { ctx, size, rng, px } = p;
  const planks = 4, ph = size / planks;
  const lw = Math.max(1, Math.round(2 * px));
  const plankColour = () => css(shade(mix([138, 90, 43], [168, 116, 63], rng()), 0.92 + rng() * 0.16));
  const joints = [];
  for (let c = 0; c < planks; c++) {
    // each row is two plank segments meeting at joints j1 and j2 (staggered per row)
    const j1 = Math.round(rng() * size), j2 = Math.round(j1 + size / 2 + rng.range(-size / 6, size / 6)) % size;
    joints.push(j1, j2);
    ctx.fillStyle = plankColour();
    fillRectWrapX(ctx, size, 0, c * ph, size, ph);
    ctx.fillStyle = plankColour();
    fillRectWrapX(ctx, size, j1, c * ph, ((j2 - j1 + size) % size) || size, ph);
  }
  // knots (kept away from the edges so they never need wrapping)
  const knots = 1 + rng.int(2);
  for (let n = 0; n < knots; n++) {
    const kx = size * rng.range(0.15, 0.85), ky = (rng.int(planks) + 0.5) * ph + ph * rng.range(-0.2, 0.2);
    const rx = ph * rng.range(0.18, 0.28), ry = rx * rng.range(0.5, 0.7);
    for (let r = 1; r > 0.15; r -= 0.17) {
      ctx.beginPath();
      ctx.ellipse(kx, ky, rx * r, ry * r, 0, 0, TAU);
      ctx.fillStyle = css([70, 40, 18], 0.14 + 0.1 * (1 - r));
      ctx.fill();
    }
  }
  const grain = fbm(rng.fork('grain'), size, { fx: 2, fy: 32, octaves: 3, gain: 0.5 });
  const fine = rng.fork('fine');
  forEachPixel(ctx, size, (d, i, x, y, k) => {
    const g = grain[k];
    const line = 1 - 0.14 * (1 - smoothstep(0, 0.07, fract(g * 4)));
    scalePixel(d, i, (0.82 + 0.28 * g) * line * (1 + (fine() - 0.5) * 0.08));
  });
  // seams between plank rows, then the end joints where the two segments of a row meet
  ctx.fillStyle = css([44, 26, 10], 0.85);
  for (let c = 0; c <= planks; c++) ctx.fillRect(0, c * ph - lw / 2, size, lw);
  ctx.fillStyle = css([255, 220, 160], 0.14);
  for (let c = 0; c <= planks; c++) ctx.fillRect(0, c * ph + lw / 2, size, Math.max(1, lw / 2));
  ctx.fillStyle = css([44, 26, 10], 0.8);
  joints.forEach((jx, n) => {
    const c = n >> 1;
    drawWrapped(size, jx, c * ph, lw, (ox) => ctx.fillRect(jx + ox - lw / 2, c * ph, lw, ph));
  });
}

/** 8 × 8 checkerboard: tint for one colour, white or near-black for the other. */
function drawChecker(p) {
  const { ctx, size, tint } = p;
  const n = 8, s = size / n;
  const other = luminance(tint) > 0.5 ? [38, 38, 38] : [242, 242, 242];
  fill(ctx, size, other);
  ctx.fillStyle = css(tint);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if ((i + j) & 1) ctx.fillRect(i * s, j * s, s, s);
}

/** Veined marble: sine waves (integer wave counts, so periodic) perturbed by fBm turbulence. */
function drawMarble(p) {
  const { ctx, size, rng } = p;
  const turb = fbm(rng.fork('turb'), size, { fx: 2, octaves: 6, gain: 0.55 });
  const tone = fbm(rng.fork('tone'), size, { fx: 3, octaves: 3 });
  const base = [236, 234, 230], vein = [118, 116, 128], vein2 = [160, 170, 190];
  const inv = 1 / size;
  forEachPixel(ctx, size, (d, i, x, y, k) => {
    const t = turb[k];
    const v1 = Math.pow(1 - Math.abs(Math.sin((x * 2 + y) * inv * TAU + t * 6)), 7);
    const v2 = Math.pow(1 - Math.abs(Math.sin((x - y * 3) * inv * TAU + t * 4)), 12) * 0.6;
    const c = mix(mix(base, vein2, v2), vein, v1 * 0.85);
    setPixel(d, i, shade(c, 0.94 + 0.08 * tone[k]));
  });
}

/** Soft, slightly stippled plaster. */
function drawPlaster(p) {
  const { ctx, size, rng } = p;
  const tone = fbm(rng.fork('tone'), size, { fx: 5, octaves: 5 });
  const fine = fbm(rng.fork('fine'), size, { fx: 32, octaves: 2 });
  const grain = rng.fork('grain');
  const base = [221, 214, 200];
  forEachPixel(ctx, size, (d, i, x, y, k) =>
    setPixel(d, i, shade(base, 0.9 + 0.14 * tone[k] + 0.06 * (fine[k] - 0.5) + (grain() - 0.5) * 0.04)));
}

/** Grainy concrete with faint cracks and small pits. */
function drawConcrete(p) {
  const { ctx, size, rng, px } = p;
  const coarse = fbm(rng.fork('coarse'), size, { fx: 4, octaves: 3 });
  const fine = fbm(rng.fork('fine'), size, { fx: 24, octaves: 3 });
  const grain = rng.fork('grain');
  const base = [143, 143, 138];
  forEachPixel(ctx, size, (d, i, x, y, k) =>
    setPixel(d, i, shade(base, 0.86 + 0.14 * coarse[k] + 0.12 * (fine[k] - 0.5) + (grain() - 0.5) * 0.16)));
  // pits
  const pits = rng.fork('pits');
  for (let n = 0; n < 40; n++) {
    const x = pits() * size, y = pits() * size, r = Math.max(0.6, px * pits.range(0.6, 1.8));
    drawWrapped(size, x, y, r, (ox, oy) => {
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, TAU);
      ctx.fillStyle = css([40, 40, 38], 0.3);
      ctx.fill();
    });
  }
  // cracks: random walks that stop before leaving the tile, so nothing has to wrap
  const cracks = rng.fork('cracks');
  ctx.strokeStyle = css([38, 38, 36], 0.45);
  ctx.lineWidth = Math.max(1, Math.round(px));
  ctx.lineCap = 'round';
  for (let n = 0; n < 3; n++) {
    let x = cracks.range(0.2, 0.8) * size, y = cracks.range(0.2, 0.8) * size, a = cracks() * TAU;
    const step = size / 40;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 30; s++) {
      a += cracks.range(-0.7, 0.7);
      x += Math.cos(a) * step; y += Math.sin(a) * step;
      if (x < 1 || y < 1 || x > size - 1 || y > size - 1) break;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Leafy hedge: many wrapped leaf ellipses, darker ones first, on a dark green base. */
function drawHedge(p) {
  const { ctx, size, rng } = p;
  fill(ctx, size, [28, 58, 22]);
  const depth = fbm(rng.fork('depth'), size, { fx: 3, octaves: 3 });
  const leaves = [];
  for (let n = 0; n < 1000; n++) {
    const x = rng() * size, y = rng() * size;
    const k = 0.8 + 0.35 * depth[(y | 0) * size + (x | 0)];
    leaves.push({ x, y, r: size * rng.range(0.025, 0.055), a: rng() * TAU, t: rng() * k, k });
  }
  leaves.sort((a, b) => a.t - b.t);
  for (const leaf of leaves) {
    const c = shade(mix([34, 86, 30], [122, 178, 62], leaf.t), leaf.k);
    drawWrapped(size, leaf.x, leaf.y, leaf.r, (ox, oy) => {
      ctx.save();
      ctx.translate(leaf.x + ox, leaf.y + oy);
      ctx.rotate(leaf.a);
      ctx.beginPath();
      ctx.ellipse(0, 0, leaf.r, leaf.r * 0.55, 0, 0, TAU);
      ctx.fillStyle = css(c);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-leaf.r * 0.2, -leaf.r * 0.15, leaf.r * 0.5, leaf.r * 0.22, 0, 0, TAU);
      ctx.fillStyle = css([200, 240, 150], 0.22);
      ctx.fill();
      ctx.restore();
    });
  }
  const grain = rng.fork('grain');
  forEachPixel(ctx, size, (d, i) => scalePixel(d, i, 1 + (grain() - 0.5) * 0.08));
}

/** Warm, fibrous carpet pile. */
function drawCarpet(p) {
  const { ctx, size, rng } = p;
  const tone = fbm(rng.fork('tone'), size, { fx: 4, octaves: 3 });
  const fa = fbm(rng.fork('fa'), size, { fx: 64, fy: 16, octaves: 1 });
  const fb = fbm(rng.fork('fb'), size, { fx: 16, fy: 64, octaves: 1 });
  const grain = rng.fork('grain');
  const base = [142, 62, 46];
  forEachPixel(ctx, size, (d, i, x, y, k) =>
    setPixel(d, i, shade(base, 0.8 + 0.15 * tone[k] + 0.12 * (fa[k] - 0.5) + 0.12 * (fb[k] - 0.5) + (grain() - 0.5) * 0.22)));
}

/** Brushed metal plate with a bevelled edge and four inset rivets. */
function drawMetal(p) {
  const { ctx, size, rng, px } = p;
  const streak = fbm(rng.fork('streak'), size, { fx: 2, fy: 96, octaves: 2 });
  const rows = rng.fork('rows');
  const rowK = new Float32Array(size);
  for (let y = 0; y < size; y++) rowK[y] = 0.95 + 0.1 * rows();
  const grain = rng.fork('grain');
  const base = [134, 138, 144];
  forEachPixel(ctx, size, (d, i, x, y, k) =>
    setPixel(d, i, shade(base, 0.86 + 0.22 * streak[k] + (rowK[y] - 1) + (grain() - 0.5) * 0.05)));
  const b = Math.max(2, Math.round(size / 40));
  ctx.fillStyle = css([255, 255, 255], 0.22);
  ctx.fillRect(0, 0, size, b);
  ctx.fillRect(0, 0, b, size);
  ctx.fillStyle = css([0, 0, 0], 0.32);
  ctx.fillRect(0, size - b, size, b);
  ctx.fillRect(size - b, 0, b, size);
  const r = size * 0.035;
  for (const [cx, cy] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) {
    const x = cx * size, y = cy * size;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, css([214, 218, 224]));
    g.addColorStop(0.7, css([120, 124, 130]));
    g.addColorStop(1, css([56, 58, 64]));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, px);
    ctx.strokeStyle = css([30, 32, 36], 0.6);
    ctx.stroke();
  }
}

/** Uploaded image stretched over the tile, or a magenta/black "missing texture" checker. */
function drawCustom(p) {
  const { ctx, size, customImage } = p;
  if (customImage) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(customImage, 0, 0, size, size);
    return;
  }
  const n = 8, s = size / n;
  fill(ctx, size, [0, 0, 0]);
  ctx.fillStyle = css([255, 0, 255]);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if ((i + j) & 1) ctx.fillRect(i * s, j * s, s, s);
}

/* ------------------------------------------------------------------------------------ */
/* Poster drawers (square signs; content is inset so the outer pixels are plain panel)   */
/* ------------------------------------------------------------------------------------ */

/** Plain panel with an optional inset frame. Returns the frame inset in pixels. */
function drawPanel(p, colour, frame) {
  const { ctx, size, px } = p;
  fill(ctx, size, colour);
  if (!frame) return 0;
  const inset = Math.max(2, Math.round(size * 0.04)), lw = Math.max(1, Math.round(frame.width * px));
  ctx.lineWidth = lw;
  ctx.strokeStyle = css(frame.colour);
  ctx.strokeRect(inset + lw / 2, inset + lw / 2, size - 2 * inset - lw, size - 2 * inset - lw);
  return inset + lw;
}

function drawCenteredText(ctx, text, x, y, maxWidth, fontFor, startSize, colour) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, text, maxWidth, fontFor, startSize);
  ctx.fillStyle = css(colour);
  ctx.fillText(text, x, y);
}

/** White START sign: bold black word and a green right-pointing arrow. */
function drawStartSign(p) {
  const { ctx, size, px, text } = p;
  drawPanel(p, [248, 248, 248], { width: 5, colour: [20, 20, 20] });
  drawCenteredText(ctx, text || 'START', size / 2, size * 0.36, size * 0.76, boldFont, size * 0.26, [16, 16, 16]);
  const y = size * 0.7, x0 = size * 0.22, x1 = size * 0.8, t = size * 0.07, head = size * 0.16;
  ctx.beginPath();
  ctx.moveTo(x0, y - t); ctx.lineTo(x1 - head, y - t); ctx.lineTo(x1 - head, y - 2 * t); ctx.lineTo(x1, y);
  ctx.lineTo(x1 - head, y + 2 * t); ctx.lineTo(x1 - head, y + t); ctx.lineTo(x0, y + t);
  ctx.closePath();
  ctx.fillStyle = css([0, 150, 60]);
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, Math.round(2.5 * px));
  ctx.strokeStyle = css([10, 50, 20]);
  ctx.stroke();
}

/** FINISH sign: chequered-flag border around a white centre with the word. */
function drawFinishSign(p) {
  const { ctx, size, px, text } = p;
  fill(ctx, size, [250, 250, 250]);
  const margin = Math.max(1, Math.round(px)), n = 10, s = (size - 2 * margin) / n;
  ctx.fillStyle = css([18, 18, 18]);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ring = i === 0 || j === 0 || i === n - 1 || j === n - 1;
      if (ring && (i + j) % 2 === 0) ctx.fillRect(margin + i * s, margin + j * s, Math.ceil(s), Math.ceil(s));
    }
  }
  ctx.lineWidth = Math.max(1, Math.round(2 * px));
  ctx.strokeStyle = css([18, 18, 18]);
  ctx.strokeRect(margin + s, margin + s, size - 2 * (margin + s), size - 2 * (margin + s));
  drawCenteredText(ctx, text || 'FINISH', size / 2, size * 0.5, size * 0.68, boldFont, size * 0.2, [16, 16, 16]);
}

/** Homage to the old OpenGL-logo poster: bold italic word with a grey 3D extrusion on white. */
function drawWebglBadge(p) {
  const { ctx, size, px, text } = p;
  drawPanel(p, [250, 250, 250], { width: 1.5, colour: [180, 184, 190] });
  const word = text || 'WebGL';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, word, size * 0.78, italicFont, size * 0.3);
  const cx = size * 0.48, cy = size * 0.47, depth = size * 0.035, step = Math.max(1, px * 0.5);
  for (let d = depth; d >= 0.5; d -= step) {
    const t = d / depth;
    ctx.fillStyle = css(mix([168, 174, 186], [84, 90, 104], t));
    ctx.fillText(word, cx + d * 0.85, cy + d * 0.65);
  }
  ctx.fillStyle = css([26, 78, 168]);
  ctx.fillText(word, cx, cy);
  ctx.lineWidth = Math.max(1, Math.round(px));
  ctx.strokeStyle = css([255, 255, 255], 0.35);
  ctx.strokeText(word, cx, cy);
  ctx.fillStyle = css([26, 78, 168]);
  ctx.fillRect(size * 0.2, size * 0.655, size * 0.6, Math.max(1, Math.round(2 * px)));
  drawCenteredText(ctx, '3D Maze', size / 2, size * 0.76, size * 0.5, boldFont, size * 0.1, [70, 70, 76]);
}

/** Four-pane waving flag homage: red/green/blue/yellow panes with black outlines, sine-warped. */
function drawFlagPoster(p) {
  const { ctx, size, px } = p;
  drawPanel(p, [236, 236, 232], { width: 1.5, colour: [170, 170, 165] });
  const off = document.createElement('canvas');
  off.width = off.height = size;
  const o = off.getContext('2d');
  const fx0 = size * 0.2, fy0 = size * 0.27, fw = size * 0.6, fh = size * 0.46, gap = size * 0.035;
  const pw = (fw - gap) / 2, phh = (fh - gap) / 2;
  const panes = [[233, 36, 36], [40, 170, 60], [40, 90, 220], [250, 200, 30]];
  o.lineWidth = Math.max(1, Math.round(2.5 * px));
  o.strokeStyle = css([12, 12, 12]);
  o.lineJoin = 'round';
  panes.forEach((colour, idx) => {
    const x = fx0 + (idx % 2) * (pw + gap), y = fy0 + Math.floor(idx / 2) * (phh + gap);
    o.fillStyle = css(colour);
    o.fillRect(x, y, pw, phh);
    o.strokeRect(x, y, pw, phh);
  });
  const amp = size * 0.04;
  const margin = Math.ceil(o.lineWidth);
  for (let x = Math.floor(fx0 - margin); x <= Math.ceil(fx0 + fw + margin); x++) {
    const dy = amp * Math.sin(((x - fx0) / fw) * TAU * 1.25 + 0.4);
    ctx.drawImage(off, x, 0, 1, size, x, dy, 1, size);
  }
}

/** Yellow smiley face on a pale panel. */
function drawSmileyPoster(p) {
  const { ctx, size, px } = p;
  drawPanel(p, [232, 232, 226], { width: 1.5, colour: [170, 170, 165] });
  const cx = size / 2, cy = size / 2, r = size * 0.36;
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  g.addColorStop(0, css([255, 240, 120]));
  g.addColorStop(1, css([240, 186, 0]));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, Math.round(3.5 * px));
  ctx.strokeStyle = css([20, 20, 20]);
  ctx.stroke();
  ctx.fillStyle = css([20, 20, 20]);
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + sx * r * 0.36, cy - r * 0.3, r * 0.1, r * 0.17, 0, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.05, r * 0.6, Math.PI * 0.15, Math.PI * 0.85);
  ctx.lineWidth = Math.max(1, Math.round(4.5 * px));
  ctx.lineCap = 'round';
  ctx.stroke();
}

/* ------------------------------------------------------------------------------------ */
/* Registry                                                                              */
/* ------------------------------------------------------------------------------------ */

/** kind → { draw(p), usesTint } — `usesTint` kinds paint with the tint, so it is not multiplied in again. */
const DRAWERS = {
  brick: { draw: (p) => drawBricks(p, RED_BRICK) },
  greyBrick: { draw: (p) => drawBricks(p, GREY_BRICK) },
  wood: { draw: drawWood },
  stone: { draw: drawStone },
  cobble: { draw: drawCobble },
  tile: { draw: drawCeilingTile },
  checker: { draw: drawChecker, usesTint: true },
  marble: { draw: drawMarble },
  plaster: { draw: drawPlaster },
  concrete: { draw: drawConcrete },
  hedge: { draw: drawHedge },
  carpet: { draw: drawCarpet },
  metal: { draw: drawMetal },
  win95Teal: { draw: (p) => fill(p.ctx, p.size, [0, 128, 128]) },
  solid: { draw: (p) => fill(p.ctx, p.size, p.tint), usesTint: true },
  custom: { draw: drawCustom },
  start: { draw: drawStartSign },
  finish: { draw: drawFinishSign },
  webglBadge: { draw: drawWebglBadge },
  flag: { draw: drawFlagPoster },
  smileyPoster: { draw: drawSmileyPoster },
};

/** Multiply every pixel by the tint (when given) and the brightness factor. */
function applyTintBrightness(ctx, size, tint, brightness) {
  const t = tint ?? [255, 255, 255];
  const fr = (t[0] / 255) * brightness, fg = (t[1] / 255) * brightness, fb = (t[2] / 255) * brightness;
  if (fr === 1 && fg === 1 && fb === 1) return;
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] *= fr; d[i + 1] *= fg; d[i + 2] *= fb; }
  ctx.putImageData(img, 0, 0);
}

/** Anything drawImage() accepts: a THREE.Texture's image, an <img>/<canvas>/ImageBitmap, or null. */
function toDrawable(src) {
  const img = src && src.isTexture ? src.image : src;
  if (!img) return null;
  const w = img.naturalWidth ?? img.videoWidth ?? img.width;
  return w > 0 ? img : null;
}

const sanitizeResolution = (r) => clamp(Math.round(Number(r) || 256), 8, 4096);

/**
 * Paint a texture kind onto a fresh canvas and wrap it in a repeat-wrapped sRGB CanvasTexture.
 * `tint` multiplies colour, `brightness` scales it, `seed` drives all randomness, `text`
 * overrides the word on sign posters, `customImage` feeds the 'custom' kind.
 */
export function createTexture(kind, { resolution = 256, tint = '#ffffff', brightness = 1, seed = 0, text, customImage } = {}) {
  let drawer = DRAWERS[kind];
  if (!drawer) {
    console.warn(`[textures] unknown kind "${kind}", falling back to "solid"`);
    drawer = DRAWERS.solid;
  }
  const size = sanitizeResolution(resolution);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const p = {
    ctx, size, px: size / 256,
    rng: createRng(`texture:${kind}:${seed}`),
    tint: hexToRgb(tint), text, customImage: toDrawable(customImage),
  };
  drawer.draw(p);
  applyTintBrightness(ctx, size, drawer.usesTint ? null : p.tint, Math.max(0, Number(brightness) || 0));

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = `${kind}@${size}`;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Set min/mag filters: 'pixelated' = nearest, 'smooth' = flat bilinear without mipmaps
 * (the OpenGL 1.1 look), 'trilinear' = mipmapped. Returns the texture.
 */
export function applyFiltering(texture, filtering = 'smooth', anisotropy = 1) {
  if (!texture) return texture;
  if (filtering === 'pixelated') {
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
  } else if (filtering === 'trilinear') {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
  } else {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
  }
  texture.anisotropy = Math.max(1, Math.round(Number(anisotropy) || 1));
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------------------------ */
/* Image uploads                                                                         */
/* ------------------------------------------------------------------------------------ */

function loadImageElement(url, cors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`textureFromImage: could not load "${String(url).slice(0, 80)}"`));
    img.src = url;
  });
}

/** Resolve any supported source to something drawImage() accepts. */
async function decodeImage(src) {
  if (src == null) throw new TypeError('textureFromImage: no image source given');
  if (src.isTexture) src = src.image;
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) {
    if (!src.complete || !src.naturalWidth) await src.decode();
    return src;
  }
  if (typeof Blob !== 'undefined' && src instanceof Blob) {
    const url = URL.createObjectURL(src);
    try { return await loadImageElement(url, false); } finally { URL.revokeObjectURL(url); }
  }
  if (typeof src === 'string') return loadImageElement(src, !/^(data|blob):/i.test(src));
  if (toDrawable(src)) return src; // canvas, OffscreenCanvas, ImageBitmap, video frame …
  throw new TypeError('textureFromImage: unsupported image source');
}

/** Copy an image into a canvas no larger than `maxSize` per side (keeps aspect ratio). */
function imageToCanvas(image, maxSize) {
  const w = image.naturalWidth ?? image.videoWidth ?? image.width;
  const h = image.naturalHeight ?? image.videoHeight ?? image.height;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Decode an uploaded image (HTMLImageElement, data/blob/http URL, File/Blob, canvas or
 * ImageBitmap) into a repeat-wrapped sRGB texture that appears upright on walls.
 */
export async function textureFromImage(src) {
  const image = await decodeImage(src);
  const texture = new THREE.CanvasTexture(imageToCanvas(image, MAX_IMAGE_SIZE));
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.name = 'custom';
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------------------------ */
/* Cache                                                                                 */
/* ------------------------------------------------------------------------------------ */

/** Short stable fingerprint for a (possibly huge data-URL) string. */
const fingerprint = (s) => `${s.length}:${hashSeed(s).toString(16)}`;

/** Stable identity for an uploaded image: a texture's uuid, or a per-object id for raw images. */
const imageIds = new WeakMap();
let nextImageId = 1;
function imageId(img) {
  if (img.uuid) return img.uuid;
  if (!imageIds.has(img)) imageIds.set(img, `img${nextImageId++}`);
  return imageIds.get(img);
}

/**
 * Caches procedural textures by their generating parameters and hands out per-slot clones
 * that carry repeat/offset. Base textures never have repeat/offset baked in.
 *
 * Seed resolution: `globalTexConfig.textureSeed` when non-zero, else `extra.seed`, else the
 * cache's own seed (`setSeed`, meant to be the maze seed).
 */
export class TextureCache {
  constructor({ seed = 0, maxEntries = 32 } = {}) {
    this.seed = seed;
    this.maxEntries = maxEntries;
    this._base = new Map(); // key → { texture, used }
    this._slots = new Map(); // slotName → { base, texture }
    this._custom = new Map(); // slotName → THREE.Texture (decoded upload)
    this._tick = 0;
  }

  /** Fallback seed used when `textures.textureSeed` is 0 (pass the maze seed). */
  setSeed(seed) { this.seed = seed; }

  /** Register (or clear with null) the decoded upload for a slot; the cache owns and disposes it. */
  setCustomImage(slotName, texture) {
    const prev = this._custom.get(slotName) ?? null;
    if (prev === texture) return;
    if (prev) prev.dispose();
    if (texture) this._custom.set(slotName, texture); else this._custom.delete(slotName);
    this.invalidate(slotName);
  }

  getCustomImage(slotName) { return this._custom.get(slotName) ?? null; }

  /** Decode `src` with textureFromImage() and register it for `slotName`. */
  async loadCustomImage(slotName, src) {
    const texture = await textureFromImage(src);
    this.setCustomImage(slotName, texture);
    return texture;
  }

  _seedFor(globalTexConfig, extra) {
    const s = globalTexConfig.textureSeed;
    if (s !== undefined && s !== null && s !== 0 && s !== '0' && s !== '') return s;
    return extra.seed ?? this.seed ?? 0;
  }

  _key(slotConfig, globalTexConfig, extra) {
    const kind = slotConfig.kind;
    let custom = null;
    if (kind === 'custom') {
      custom = extra.customImage ? imageId(extra.customImage)
        : typeof slotConfig.custom === 'string' ? fingerprint(slotConfig.custom) : null;
    }
    return JSON.stringify([
      kind, slotConfig.tint ?? '#ffffff', slotConfig.brightness ?? 1, custom, extra.text ?? null,
      globalTexConfig.resolution ?? 256, globalTexConfig.filtering ?? 'smooth', globalTexConfig.anisotropy ?? 1,
      this._seedFor(globalTexConfig, extra),
    ]);
  }

  /**
   * Cached base texture for { kind, tint, brightness, custom } × { resolution, filtering,
   * anisotropy, textureSeed }. Do not set repeat/offset on it – use getForSlot().
   * `extra`: { seed, text, customImage: THREE.Texture } (customImage is required for 'custom').
   */
  get(slotConfig, globalTexConfig = {}, extra = {}) {
    const key = this._key(slotConfig, globalTexConfig, extra);
    let entry = this._base.get(key);
    if (!entry) {
      const texture = createTexture(slotConfig.kind, {
        resolution: globalTexConfig.resolution ?? 256,
        tint: slotConfig.tint ?? '#ffffff',
        brightness: slotConfig.brightness ?? 1,
        seed: this._seedFor(globalTexConfig, extra),
        text: extra.text,
        customImage: extra.customImage ?? null,
      });
      applyFiltering(texture, globalTexConfig.filtering ?? 'smooth', globalTexConfig.anisotropy ?? 1);
      entry = { texture, used: 0 };
      this._base.set(key, entry);
      this._evict();
    }
    entry.used = ++this._tick;
    return entry.texture;
  }

  /**
   * Per-slot clone of the base texture (shares the image / GPU upload) with
   * repeat/offset from slotConfig applied. The same clone is returned until the base changes.
   */
  getForSlot(slotName, slotConfig, globalTexConfig = {}, extra = {}) {
    const merged = { customImage: this._custom.get(slotName) ?? null, ...extra };
    const base = this.get(slotConfig, globalTexConfig, merged);
    let slot = this._slots.get(slotName);
    if (!slot || slot.base !== base) {
      if (slot) slot.texture.dispose();
      slot = { base, texture: base.clone() };
      this._slots.set(slotName, slot);
    }
    slot.texture.repeat.set(slotConfig.repeatU ?? 1, slotConfig.repeatV ?? 1);
    slot.texture.offset.set(slotConfig.offsetU ?? 0, slotConfig.offsetV ?? 0);
    return slot.texture;
  }

  _isReferenced(texture) {
    for (const slot of this._slots.values()) if (slot.base === texture) return true;
    return false;
  }

  _evict() {
    if (this._base.size <= this.maxEntries) return;
    const victims = [...this._base.entries()]
      .filter(([, e]) => !this._isReferenced(e.texture))
      .sort((a, b) => a[1].used - b[1].used);
    for (const [key, entry] of victims) {
      if (this._base.size <= this.maxEntries) break;
      entry.texture.dispose();
      this._base.delete(key);
    }
  }

  /** Drop one slot's clone (and its base if nothing else uses it), or everything when no slot is given. */
  invalidate(slotName) {
    if (slotName === undefined) {
      for (const slot of this._slots.values()) slot.texture.dispose();
      this._slots.clear();
      for (const entry of this._base.values()) entry.texture.dispose();
      this._base.clear();
      return;
    }
    const slot = this._slots.get(slotName);
    if (!slot) return;
    slot.texture.dispose();
    this._slots.delete(slotName);
    if (this._isReferenced(slot.base)) return;
    for (const [key, entry] of this._base) {
      if (entry.texture === slot.base) { entry.texture.dispose(); this._base.delete(key); }
    }
  }

  /** Release every cached texture, slot clone and uploaded image. */
  dispose() {
    this.invalidate();
    for (const texture of this._custom.values()) texture.dispose();
    this._custom.clear();
  }
}
