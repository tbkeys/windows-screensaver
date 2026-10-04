/**
 * Scene lighting, fog and background for the maze.
 *
 * Owns an AmbientLight, a HemisphereLight, a DirectionalLight "sun" (aimed from
 * elevation/azimuth), a PointLight headlamp parented to the camera, `scene.fog` and
 * `scene.background`. `apply(config)` is idempotent and cheap so app.js can call it on
 * every `lighting.*` change. In 'classic' mode (MeshBasicMaterial) the lights have no
 * visual effect, which is the intended fullbright look.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
/** Headlamp sits a little below the eye so wall bases pick up more light than ceilings. */
const HEADLAMP_OFFSET = Object.freeze({ x: 0, y: -0.08, z: 0 });

/**
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera   must be part of the scene graph for the headlamp to render
 * @returns {{ apply(config: object): void, dispose(): void }}
 */
export function createLighting(scene, camera) {
  const ambient = new THREE.AmbientLight(0xffffff, 1);
  const hemisphere = new THREE.HemisphereLight(0xbfd4ff, 0x3a2a1a, 0.6);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  const headlamp = new THREE.PointLight(0xffe9c4, 2, 7, 1.5);
  const background = new THREE.Color(0x000000);

  ambient.name = 'ambient';
  hemisphere.name = 'hemisphere';
  sun.name = 'sun';
  headlamp.name = 'headlamp';
  headlamp.position.set(HEADLAMP_OFFSET.x, HEADLAMP_OFFSET.y, HEADLAMP_OFFSET.z);

  scene.add(ambient, hemisphere, sun);
  camera.add(headlamp);
  scene.background = background;

  /** Point the sun *from* (elevation, azimuth); azimuth 0 = north (−Z), 90 = east (+X). */
  function aimSun(elevationDeg, azimuthDeg) {
    const el = elevationDeg * DEG;
    const az = azimuthDeg * DEG;
    const horizontal = Math.cos(el);
    sun.position.set(Math.sin(az) * horizontal, Math.sin(el), -Math.cos(az) * horizontal);
    // sun.target stays at the origin; only the direction matters for a DirectionalLight.
  }

  function applyFog(L) {
    if (!L.fogEnabled) {
      scene.fog = null;
      return;
    }
    if (L.fogType === 'exp2') {
      if (!scene.fog?.isFogExp2) scene.fog = new THREE.FogExp2(L.fogColor, L.fogDensity);
      scene.fog.color.set(L.fogColor);
      scene.fog.density = Math.max(0, L.fogDensity);
    } else {
      if (!scene.fog?.isFog) scene.fog = new THREE.Fog(L.fogColor, L.fogNear, L.fogFar);
      scene.fog.color.set(L.fogColor);
      scene.fog.near = Math.max(0, L.fogNear);
      scene.fog.far = Math.max(scene.fog.near + 0.01, L.fogFar);
    }
  }

  /** Push every `config.lighting.*` value into the lights, fog and background. */
  function apply(config) {
    const L = config.lighting;

    ambient.color.set(L.ambientColor);
    ambient.intensity = Math.max(0, L.ambientIntensity);

    hemisphere.visible = !!L.hemisphereEnabled;
    hemisphere.color.set(L.hemisphereSky);
    hemisphere.groundColor.set(L.hemisphereGround);
    hemisphere.intensity = Math.max(0, L.hemisphereIntensity);

    sun.visible = !!L.sunEnabled;
    sun.color.set(L.sunColor);
    sun.intensity = Math.max(0, L.sunIntensity);
    aimSun(L.sunElevation, L.sunAzimuth);

    headlamp.visible = !!L.headlampEnabled;
    headlamp.color.set(L.headlampColor);
    headlamp.intensity = Math.max(0, L.headlampIntensity);
    headlamp.distance = Math.max(0, L.headlampDistance);
    headlamp.decay = Math.max(0, L.headlampDecay);

    applyFog(L);
    background.set(L.backgroundColor);
    scene.background = background;
  }

  function dispose() {
    scene.remove(ambient, hemisphere, sun);
    camera.remove(headlamp);
    for (const light of [ambient, hemisphere, sun, headlamp]) light.dispose();
    scene.fog = null;
  }

  return { apply, dispose };
}
