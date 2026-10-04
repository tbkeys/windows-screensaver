/**
 * Deterministic, seedable pseudo-random numbers (sfc32 seeded via xmur3).
 * Identical seeds give identical mazes in every browser and in Node.
 */

/** Hash any string/number to a 32-bit unsigned int (xmur3). */
export function hashSeed(seed) {
  const str = String(seed ?? '');
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * Create a seeded RNG. The returned function yields floats in [0, 1) and carries
 * helper methods (`int`, `range`, `pick`, `shuffle`, `chance`, `fork`).
 */
export function createRng(seed) {
  const seedStr = String(seed ?? '');
  const gen = xmur3(seedStr);
  const rng = sfc32(gen(), gen(), gen(), gen());
  for (let i = 0; i < 12; i++) rng(); // discard warm-up values

  rng.seed = seedStr;
  rng.int = (n) => Math.floor(rng() * n);
  rng.range = (a, b) => a + rng() * (b - a);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  };
  /** Independent stream derived from this seed and a label (same seed+label ⇒ same stream). */
  rng.fork = (label) => createRng(`${seedStr}::${label}`);
  return rng;
}

const ADJECTIVES = ['dusty', 'teal', 'beige', 'pixel', 'cosmic', 'neon', 'retro', 'brick', 'plush', 'dizzy', 'rusty', 'glossy'];
const NOUNS = ['maze', 'rat', 'smiley', 'poster', 'corridor', 'floppy', 'modem', 'desktop', 'bevel', 'clippy', 'pentium', 'cdrom'];

/** Human-friendly random seed, e.g. "dusty-modem-4f21". Uses Math.random on purpose. */
export function randomSeedString() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const hex = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${a}-${n}-${hex}`;
}
