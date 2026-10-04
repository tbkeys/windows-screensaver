import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashSeed, randomSeedString } from '../src/maze/rng.js';

const draw = (rng, n) => Array.from({ length: n }, () => rng());

test('same seed reproduces the same sequence; different seeds differ', () => {
  assert.deepEqual(draw(createRng('windows95'), 64), draw(createRng('windows95'), 64));
  assert.notDeepEqual(draw(createRng('windows95'), 64), draw(createRng('windows96'), 64));
  assert.deepEqual(draw(createRng(42), 16), draw(createRng('42'), 16), 'numeric and string seeds hash alike');
});

test('values lie in [0, 1) and are not constant', () => {
  const rng = createRng('range');
  const values = draw(rng, 5000);
  for (const v of values) assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  assert.ok(new Set(values).size > 4900);
});

test('int(n) yields integers covering [0, n)', () => {
  const rng = createRng('int');
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const v = rng.int(7);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 7, `bad int ${v}`);
    seen.add(v);
  }
  assert.equal(seen.size, 7);
  assert.equal(createRng('one').int(1), 0);
});

test('range(a, b) stays within bounds', () => {
  const rng = createRng('float');
  for (let i = 0; i < 2000; i++) {
    const v = rng.range(-2.5, 4);
    assert.ok(v >= -2.5 && v < 4, `out of range: ${v}`);
  }
});

test('pick returns an element of the array', () => {
  const rng = createRng('pick');
  const items = ['N', 'E', 'S', 'W'];
  for (let i = 0; i < 200; i++) assert.ok(items.includes(rng.pick(items)));
});

test('chance(0) is never true and chance(1) is always true', () => {
  const rng = createRng('chance');
  for (let i = 0; i < 500; i++) {
    assert.equal(rng.chance(0), false);
    assert.equal(rng.chance(1), true);
  }
});

test('shuffle is an in-place permutation and deterministic', () => {
  const original = Array.from({ length: 40 }, (_, i) => i);
  const a = original.slice();
  const returned = createRng('shuffle').shuffle(a);
  assert.equal(returned, a, 'returns the same array');
  assert.notDeepEqual(a, original, 'order changed');
  assert.deepEqual(a.slice().sort((p, q) => p - q), original, 'same elements');
  assert.deepEqual(createRng('shuffle').shuffle(original.slice()), a, 'same seed, same permutation');
  const typed = createRng('typed').shuffle(Int32Array.from(original));
  assert.deepEqual(Array.from(typed).sort((p, q) => p - q), original, 'works on typed arrays');
});

test('fork streams are independent, reproducible and distinct per label', () => {
  const parent = createRng('root');
  const before = draw(parent, 5);
  const forkA1 = draw(parent.fork('a'), 20);
  const after = draw(parent, 5);
  assert.deepEqual([...before, ...after], draw(createRng('root'), 10), 'forking does not consume the parent');
  assert.deepEqual(forkA1, draw(createRng('root').fork('a'), 20), 'same seed + label ⇒ same stream');
  assert.notDeepEqual(forkA1, draw(parent.fork('b'), 20), 'different labels differ');
  assert.notDeepEqual(forkA1, draw(createRng('root'), 20), 'fork differs from parent');
  assert.equal(parent.fork('a').seed, 'root::a');
});

test('hashSeed is a deterministic 32-bit unsigned integer', () => {
  const h = hashSeed('maze');
  assert.equal(h, hashSeed('maze'));
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  assert.notEqual(hashSeed('maze'), hashSeed('mazf'));
  assert.equal(hashSeed(7), hashSeed('7'));
});

test('randomSeedString has the adjective-noun-hex shape', () => {
  for (let i = 0; i < 20; i++) assert.match(randomSeedString(), /^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
});
