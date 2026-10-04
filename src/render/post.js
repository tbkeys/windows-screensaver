/**
 * Post-processing pipeline: internal-resolution rendering plus retro screen effects.
 *
 * With every effect off and `renderScale === 1` the scene is rendered straight to the
 * canvas. Otherwise it is rendered into a WebGLRenderTarget and a full-screen triangle
 * applies, in order: CRT barrel curvature, pixelation, brightness / contrast / saturation /
 * gamma, colour-depth quantisation with optional 4×4 ordered (Bayer) dithering, scanlines,
 * animated film noise and a vignette.
 *
 * The target holds linear (working-space) colour, so the shader converts to sRGB itself
 * before the perceptual effects and writes the final value without three's colour-space
 * chunk. Width/height given to `setSize` are the output viewport size in device pixels.
 */
import * as THREE from 'three';

const COLOR_DEPTH_IDS = Object.freeze({ full: 0, '16bit': 1, 256: 2, 16: 3, mono: 4 });

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
uniform float uGamma;
uniform int uColorDepth;
uniform float uDither;
uniform float uScanlines;
uniform float uScanlineDensity;
uniform float uVignette;
uniform float uCurvature;
uniform float uPixelate;
uniform float uNoise;
varying vec2 vUv;

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

// Barrel distortion normalised so the edge midpoints stay put and the corners bulge out.
vec2 barrel(vec2 uv, float k) {
  vec2 c = uv * 2.0 - 1.0;
  c *= (1.0 + k * dot(c, c)) / (1.0 + k);
  return c * 0.5 + 0.5;
}

// 4x4 Bayer threshold in [0, 15/16], built from the 2x2 matrix recursively.
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x * 0.5 + a.y * a.y * 0.75);
}
float bayer4(vec2 a) {
  return bayer2(0.5 * a) * 0.25 + bayer2(a);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Quantise to the selected palette; d is the dither offset in units of one level step.
vec3 quantise(vec3 c, int depth, float d) {
  if (depth == 1 || depth == 2) {
    vec3 steps = depth == 1 ? vec3(31.0, 63.0, 31.0) : vec3(7.0, 7.0, 3.0);
    return floor(c * steps + d + 0.5) / steps;
  }
  if (depth == 3) {
    // 16 colours: each channel on/off, in a bright (1.0) or dark (0.5) variant.
    float value = max(c.r, max(c.g, c.b));
    float intensity = 0.5 + 0.5 * step(0.5, value + d * 0.5);
    return step(intensity * 0.5, c + d * intensity) * intensity;
  }
  if (depth == 4) {
    return vec3(step(0.5, dot(c, LUMA) + d));
  }
  return c;
}

void main() {
  vec2 uv = uCurvature > 0.0 ? barrel(vUv, uCurvature) : vUv;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 screenUv = uv;
  if (uPixelate > 1.0) {
    vec2 p = uv * uResolution;
    uv = (floor(p / uPixelate) + 0.5) * uPixelate / uResolution;
  }

  vec3 col = linearToSrgb(texture2D(tDiffuse, uv).rgb);

  col *= uBrightness;
  col = (col - 0.5) * uContrast + 0.5;
  col = mix(vec3(dot(col, LUMA)), col, uSaturation);
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / uGamma));

  float d = (bayer4(gl_FragCoord.xy) - 0.46875) * uDither;
  col = clamp(quantise(col, uColorDepth, d), 0.0, 1.0);

  float darkRow = step(1.0, mod(gl_FragCoord.y * uScanlineDensity, 2.0));
  col *= 1.0 - uScanlines * darkRow;

  vec2 grain = gl_FragCoord.xy + vec2(fract(uTime * 7.31) * 913.0, fract(uTime * 3.17) * 571.0);
  col += (hash(grain) - 0.5) * uNoise;

  float radius = length(screenUv - 0.5) * 1.41421356;
  col *= 1.0 - uVignette * smoothstep(0.35, 1.05, radius);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** True when `effects` (config.effects) or the render scale require the off-screen pass. */
export function effectsActive(effects, renderScale = 1) {
  return renderScale !== 1
    || (effects.colorDepth ?? 'full') !== 'full'
    || effects.scanlines > 0
    || effects.vignette > 0
    || effects.curvature > 0
    || effects.pixelate > 1
    || effects.brightness !== 1
    || effects.contrast !== 1
    || effects.saturation !== 1
    || effects.gamma !== 1
    || effects.noise > 0;
}

/** Geometry of one triangle covering clip space, with uv = (clip + 1) / 2 across the screen. */
function fullscreenTriangle() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return geometry;
}

export class PostPipeline {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.width = 1;
    this.height = 1;
    this.renderScale = 1;
    this._nearest = false;

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.target.texture.name = 'PostPipeline.color';

    this.material = new THREE.ShaderMaterial({
      name: 'PostPipeline',
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uBrightness: { value: 1 },
        uContrast: { value: 1 },
        uSaturation: { value: 1 },
        uGamma: { value: 1 },
        uColorDepth: { value: 0 },
        uDither: { value: 0 },
        uScanlines: { value: 0 },
        uScanlineDensity: { value: 1 },
        uVignette: { value: 0 },
        uCurvature: { value: 0 },
        uPixelate: { value: 1 },
        uNoise: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      fog: false,
      lights: false,
      toneMapped: false,
    });

    this.quad = new THREE.Mesh(fullscreenTriangle(), this.material);
    this.quad.frustumCulled = false;
    this.quad.matrixAutoUpdate = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /**
   * Resize for an output viewport of `width × height` device pixels; the scene is rendered at
   * `renderScale` times that size (0.1..2) and resampled.
   */
  setSize(width, height, renderScale = 1) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.renderScale = Math.min(2, Math.max(0.1, Number(renderScale) || 1));
    this.target.setSize(
      Math.max(1, Math.round(this.width * this.renderScale)),
      Math.max(1, Math.round(this.height * this.renderScale)),
    );
    this.material.uniforms.uResolution.value.set(this.width, this.height);
  }

  /** Time in seconds, drives the film-noise animation. */
  setTime(seconds) {
    this.material.uniforms.uTime.value = seconds;
  }

  /**
   * Nearest sampling keeps upscaled low-resolution frames crisp; linear is used for
   * supersampling. Render-target textures only pick up parameter changes after a dispose.
   */
  _setNearest(nearest) {
    if (nearest === this._nearest) return;
    this._nearest = nearest;
    const filter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
    this.target.texture.minFilter = filter;
    this.target.texture.magFilter = filter;
    this.target.dispose();
  }

  _updateUniforms(effects) {
    const u = this.material.uniforms;
    u.uBrightness.value = effects.brightness;
    u.uContrast.value = effects.contrast;
    u.uSaturation.value = effects.saturation;
    u.uGamma.value = Math.max(0.05, effects.gamma);
    u.uColorDepth.value = COLOR_DEPTH_IDS[effects.colorDepth] ?? 0;
    u.uDither.value = effects.dither ? Math.max(0, effects.ditherStrength) : 0;
    u.uScanlines.value = Math.min(1, Math.max(0, effects.scanlines));
    u.uScanlineDensity.value = Math.max(0.01, effects.scanlineDensity);
    u.uVignette.value = Math.min(1, Math.max(0, effects.vignette));
    u.uCurvature.value = Math.min(1, Math.max(0, effects.curvature));
    u.uPixelate.value = Math.max(1, Math.floor(effects.pixelate));
    u.uNoise.value = Math.max(0, effects.noise);
  }

  /**
   * Render `scene` from `camera`, applying `effects` (config.effects). Falls back to a direct
   * render when nothing would change the image.
   */
  render(scene, camera, effects) {
    const renderer = this.renderer;
    if (!effectsActive(effects, this.renderScale)) {
      renderer.render(scene, camera);
      return;
    }
    this._setNearest(this.renderScale < 1 || effects.pixelate > 1);
    this._updateUniforms(effects);

    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previousTarget);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.scene.remove(this.quad);
  }
}
