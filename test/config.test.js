import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, ENUM_FIELDS, RANGES, createConfig, deepMerge, diffFromDefaults, enumIds, forEachLeaf, getPath,
} from '../src/config/defaults.js';
import { PRESETS } from '../src/config/presets.js';
import { SESSION_PATHS, TEXTURE_SLOTS, sanitizeConfig, shareableDiff, stripSessionState } from '../src/app/settings.js';

describe('deepMerge hardening', () => {
  test('ignores prototype keys from untrusted JSON', () => {
    const before = Object.prototype.toString;
    deepMerge(createConfig(), JSON.parse('{"__proto__":{"toString":"polluted"}}'));
    deepMerge(createConfig(), JSON.parse('{"constructor":{"prototype":{"hasOwnProperty":1}}}'));
    assert.equal(Object.prototype.toString, before);
    assert.equal(typeof Object.prototype.hasOwnProperty, 'function');
    assert.equal(typeof ({}).polluted, 'undefined');
  });

  test('never replaces a section with a scalar or a leaf with an object', () => {
    const config = createConfig();
    deepMerge(config, { maze: 5, textures: { wall: 'x', floor: null }, camera: { fov: { nested: true } } });
    assert.equal(typeof config.maze, 'object');
    assert.equal(config.maze.width, DEFAULTS.maze.width);
    assert.equal(config.textures.wall.kind, DEFAULTS.textures.wall.kind);
    assert.equal(config.camera.fov, DEFAULTS.camera.fov);
  });

  test('ignores unknown keys and copies arrays', () => {
    const config = createConfig();
    deepMerge(config, { bogus: 1, maze: { width: 7, nope: 2 } });
    assert.equal(config.bogus, undefined);
    assert.equal(config.maze.nope, undefined);
    assert.equal(config.maze.width, 7);
    assert.deepEqual(diffFromDefaults(config), { maze: { width: 7 } });
  });
});

describe('schema tables', () => {
  test('every RANGES path is a numeric leaf and contains its default', () => {
    for (const [path, [min, max, step]] of Object.entries(RANGES)) {
      const def = getPath(DEFAULTS, path);
      assert.equal(typeof def, 'number', path);
      assert.ok(min < max && step > 0, path);
      assert.ok(def >= min && def <= max, `${path} default ${def} outside [${min}, ${max}]`);
    }
  });

  test('every ENUM_FIELDS path has a default that is a valid id', () => {
    for (const [path, enumName] of Object.entries(ENUM_FIELDS)) {
      assert.ok(enumIds(enumName).includes(getPath(DEFAULTS, path)), path);
    }
  });

  test('presets only touch known leaves with valid enum ids', () => {
    for (const [id, preset] of Object.entries(PRESETS)) {
      const config = createConfig(preset);
      assert.equal(sanitizeConfig(config), 0, `preset ${id} needed repairs`);
      forEachLeaf(preset, (path, value) => assert.deepEqual(getPath(config, path), value, `${id}: ${path}`));
    }
  });
});

describe('sanitizeConfig', () => {
  test('repairs missing or non-object sections without throwing', () => {
    const config = createConfig();
    config.maze = 5;
    config.textures.wall = 'brick';
    config.lighting = null;
    assert.ok(sanitizeConfig(config) >= 3);
    assert.deepEqual(config.maze, DEFAULTS.maze);
    assert.deepEqual(config.textures.wall, DEFAULTS.textures.wall);
    assert.deepEqual(config.lighting, DEFAULTS.lighting);
  });

  test('clamps numbers to RANGES, rounds integer steps and resets non-finite values', () => {
    const config = createConfig();
    config.camera.near = 0;
    config.camera.fov = 1e6;
    config.objects.rat.count = 1e7;
    config.maze.width = 12.6;
    config.timing.fpsCap = NaN;
    config.movement.stepDuration = 'fast';
    sanitizeConfig(config);
    assert.equal(config.camera.near, RANGES['camera.near'][0]);
    assert.equal(config.camera.fov, RANGES['camera.fov'][1]);
    assert.equal(config.objects.rat.count, RANGES['objects.rat.count'][1]);
    assert.equal(config.maze.width, 13);
    assert.equal(config.timing.fpsCap, DEFAULTS.timing.fpsCap);
    assert.equal(config.movement.stepDuration, DEFAULTS.movement.stepDuration);
    assert.ok(config.camera.far > config.camera.near);
  });

  test('resets malformed colours, wrong types, unknown enum ids and bad seeds', () => {
    const config = createConfig();
    config.lighting.ambientColor = null;
    config.textures.wall.tint = 'red';
    config.objects.rat.color = '#ABCDEF'; // upper-case hex is fine
    config.maze.algorithm = 'labyrinth';
    config.textures.resolution = 300;
    config.movement.manual = 'yes';
    config.maze.seed = '';
    sanitizeConfig(config);
    assert.equal(config.lighting.ambientColor, DEFAULTS.lighting.ambientColor);
    assert.equal(config.textures.wall.tint, DEFAULTS.textures.wall.tint);
    assert.equal(config.objects.rat.color, '#ABCDEF');
    assert.equal(config.maze.algorithm, DEFAULTS.maze.algorithm);
    assert.equal(config.textures.resolution, DEFAULTS.textures.resolution);
    assert.equal(config.movement.manual, false);
    assert.equal(config.maze.seed, DEFAULTS.maze.seed);
    const long = createConfig({ maze: { seed: 'x'.repeat(500) } });
    sanitizeConfig(long);
    assert.equal(long.maze.seed.length, 64);
  });

  test('drops custom-texture references that cannot be restored', () => {
    const config = createConfig();
    for (const slot of TEXTURE_SLOTS) {
      config.textures[slot].kind = 'custom';
      config.textures[slot].custom = slot === 'wall' ? 'data:image/png;base64,AAAA' : 'memory';
    }
    sanitizeConfig(config);
    assert.equal(config.textures.wall.kind, 'custom');
    assert.equal(config.textures.floor.kind, DEFAULTS.textures.floor.kind);
    assert.equal(config.textures.floor.custom, null);
  });

  test('a valid config needs no repairs and is idempotent', () => {
    const config = createConfig({ maze: { width: 30, seed: 'abc' }, lighting: { fogColor: '#123456' } });
    assert.equal(sanitizeConfig(config), 0);
    const snapshot = JSON.stringify(config);
    sanitizeConfig(config);
    assert.equal(JSON.stringify(config), snapshot);
  });
});

describe('session state', () => {
  test('is never persisted or shared', () => {
    const config = createConfig();
    config.movement.paused = true;
    config.movement.manual = true;
    config.screensaver.screensaverMode = true;
    config.movement.stepDuration = 1;
    const diff = shareableDiff(config);
    for (const path of SESSION_PATHS) assert.equal(getPath(diff, path), undefined, path);
    assert.equal(diff.movement.stepDuration, 1);
    assert.equal(diff.screensaver, undefined, 'empty sections are pruned');
    assert.deepEqual(stripSessionState({ movement: { paused: true } }), {});
  });

  test('share diffs never carry uploaded images', () => {
    const config = createConfig();
    config.textures.wall.kind = 'custom';
    config.textures.wall.custom = 'data:image/png;base64,AAAA';
    const diff = shareableDiff(config);
    assert.equal(diff.textures.wall.custom, undefined);
    assert.equal(diff.textures.wall.kind, 'custom');
  });
});
