/**
 * Dev page for src/render/textures.js: renders every texture kind on its own plane
 * (2×2 repeats for surfaces so seams would show as a cross in the middle), plus a few
 * extra cases (low-res pixelated brick, tints, a TextureCache slot clone and an upload).
 */
import * as THREE from 'three';
import {
  TEXTURE_KINDS, SURFACE_KIND_IDS, POSTER_KIND_IDS,
  createTexture, applyFiltering, textureFromImage, TextureCache,
} from '../../src/render/textures.js';

const SEED = 'windows95';
const grid = document.getElementById('grid');
const status = document.getElementById('status');

/** A small synthetic "upload" so the custom path is exercised without any image files. */
function makeUploadDataUrl() {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 96, 64);
  g.addColorStop(0, '#ff8800'); g.addColorStop(1, '#0044ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 96, 64);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('UP', 48, 32);
  return c.toDataURL('image/png');
}

const cases = [
  ...SURFACE_KIND_IDS.map((kind) => ({ label: `${kind} · 256 · 2×2`, kind, repeat: 2 })),
  ...POSTER_KIND_IDS.map((kind) => ({ label: `${kind} · poster`, kind, repeat: 1 })),
  { label: 'brick · 64 · pixelated', kind: 'brick', repeat: 2, resolution: 64, filtering: 'pixelated' },
  { label: 'brick · 64 · smooth', kind: 'brick', repeat: 2, resolution: 64, filtering: 'smooth' },
  { label: 'checker · tint #ff66cc', kind: 'checker', repeat: 2, tint: '#ff66cc' },
  { label: 'metal · tint #80e0ff · 0.8', kind: 'metal', repeat: 2, tint: '#80e0ff', brightness: 0.8 },
  { label: 'cache: wall slot (brick 128, 2×2)', cache: true },
  { label: 'custom · textureFromImage', upload: true },
  { label: 'stone · 1024', kind: 'stone', repeat: 1, resolution: 1024 },
  { label: 'wood · 512 · trilinear · aniso 8', kind: 'wood', repeat: 2, resolution: 512, filtering: 'trilinear', anisotropy: 8 },
];

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: false });
renderer.setPixelRatio(1);
renderer.setClearColor(0x1b1b1b, 1);
const views = [];

function addView(label, texture) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  const view = document.createElement('div');
  view.className = 'view';
  const tag = document.createElement('label');
  tag.textContent = label;
  cell.append(view, tag);
  grid.append(cell);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: texture })));
  views.push({ el: view, scene, camera, texture });
}

function render() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.setScissorTest(true);
  for (const { el, scene, camera } of views) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) continue;
    const vw = r.right - r.left, vh = r.bottom - r.top;
    renderer.setViewport(r.left, h - r.bottom, vw, vh);
    renderer.setScissor(r.left, h - r.bottom, vw, vh);
    renderer.render(scene, camera);
  }
}

async function main() {
  const globalTex = { resolution: 128, filtering: 'smooth', anisotropy: 1, textureSeed: 0 };
  const cache = new TextureCache({ seed: SEED });
  const timings = [];
  for (const c of cases) {
    const t0 = performance.now();
    let texture;
    if (c.cache) {
      texture = cache.getForSlot('wall', { kind: 'brick', repeatU: 2, repeatV: 2, tint: '#ffffff', brightness: 1 }, globalTex);
    } else if (c.upload) {
      const uploaded = await textureFromImage(makeUploadDataUrl());
      cache.setCustomImage('poster', uploaded);
      texture = cache.getForSlot('poster', { kind: 'custom', repeatU: 1, repeatV: 1 }, globalTex);
    } else {
      texture = createTexture(c.kind, {
        resolution: c.resolution ?? 256, tint: c.tint, brightness: c.brightness, seed: SEED,
      });
      applyFiltering(texture, c.filtering ?? 'smooth', c.anisotropy ?? 1);
      texture.repeat.set(c.repeat, c.repeat);
    }
    timings.push(`${c.label}: ${(performance.now() - t0).toFixed(1)}ms`);
    addView(c.label, texture);
  }
  // sanity checks that would be bugs if they failed
  const ids = TEXTURE_KINDS.map((k) => k.id);
  console.assert(new Set(ids).size === ids.length, 'duplicate kind ids');
  console.assert([...SURFACE_KIND_IDS, ...POSTER_KIND_IDS].every((id) => ids.includes(id)), 'missing kind');
  const sameA = cache.getForSlot('wall', { kind: 'brick', repeatU: 3, repeatV: 1 }, globalTex);
  console.assert(sameA === views.find((v) => v.texture.name === 'brick@128').texture, 'slot clone should be reused');
  console.assert(sameA.repeat.x === 3, 'repeat should be refreshed on the reused clone');
  console.assert(cache.get({ kind: 'brick' }, globalTex) === cache.get({ kind: 'brick' }, globalTex), 'base should be cached');
  cache.invalidate('poster');
  console.table(timings);
  render();
  status.textContent = `${views.length} textures · ${SEED}`;
  window.__texturesDev = { views, cache, done: true };
}

window.addEventListener('resize', render);
main().catch((err) => { console.error(err); status.textContent = String(err); });
