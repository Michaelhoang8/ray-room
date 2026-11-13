import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hitSphere,
  hitBox,
  buildBVH,
  closestSphere,
  makeScene,
  cameraRay,
  renderTile,
  validateConfig,
  unit,
  dot,
  reflect,
} from '../core.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const sphere = { id: 0, center: [0, 0, 0], radius: 1 };
test('sphere intersection handles near/far roots, tangency, inside rays, and nonunit directions', () => {
  near(hitSphere({ origin: [0, 0, 3], direction: [0, 0, -1] }, sphere).t, 2);
  near(hitSphere({ origin: [0, 0, 3], direction: [0, 0, -2] }, sphere).t, 1);
  near(hitSphere({ origin: [1, 0, 3], direction: [0, 0, -1] }, sphere).t, 3);
  const inside = hitSphere({ origin: [0, 0, 0], direction: [1, 0, 0] }, sphere);
  near(inside.t, 1);
  assert.equal(inside.front, false);
  assert.deepEqual(inside.normal, [-1, -0, -0]);
  assert.equal(hitSphere({ origin: [0, 0, 3], direction: [0, 1, 0] }, sphere), null);
  assert.equal(hitSphere({ origin: [0, 0, 3], direction: [0, 0, -1] }, sphere, 0, 1), null);
});
test('slab intersection handles parallel rays, boundary rays, and negative directions', () => {
  const box = { min: [-1, -1, -1], max: [1, 1, 1] };
  assert.equal(hitBox({ origin: [0, 0, 3], direction: [0, 0, -1] }, box), true);
  assert.equal(hitBox({ origin: [2, 0, 3], direction: [0, 0, -1] }, box), false);
  assert.equal(hitBox({ origin: [1, 0, 3], direction: [0, 0, -1] }, box), true);
  assert.equal(hitBox({ origin: [0, 0, 0], direction: [1, 0, 0] }, box), true);
  assert.equal(hitBox({ origin: [0, 0, 3], direction: [0, 0, 1] }, box), false);
});
test('reflection preserves a unit direction and reverses its normal component', () => {
  const d = unit([1, -1, 0]),
    n = [0, 1, 0],
    r = reflect(d, n);
  near(Math.hypot(...r), 1);
  near(dot(r, n), -dot(d, n));
  assert.throws(() => unit([0, 0, 0]));
});
test('BVH traversal agrees with brute-force intersections for generated rays', () => {
  const scene = makeScene({ scene: 'sphere-field' });
  let seed = 11;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 3000; i++) {
    const ray = {
      origin: [random() * 14 - 7, random() * 8, random() * 14 - 7],
      direction: unit([random() * 2 - 1, random() * 2 - 1, random() * 2 - 1]),
    };
    const a = closestSphere(ray, scene.spheres, scene.bvh),
      b = closestSphere(ray, scene.spheres);
    assert.equal(a?.object.id, b?.object.id);
    if (a) near(a.t, b.t);
  }
});
test('empty and coincident BVHs remain valid and exact hit ties are stable', () => {
  assert.equal(buildBVH([]), null);
  const spheres = Array.from({ length: 6 }, (_, i) => ({ ...sphere, id: 5 - i })),
    ray = { origin: [0, 0, 3], direction: [0, 0, -1] };
  assert.equal(closestSphere(ray, spheres, buildBVH(spheres)).object.id, 0);
});
test('camera center points toward the target with an orthonormal basis', () => {
  const scene = makeScene({ width: 32, height: 24 }),
    ray = cameraRay(scene, 16, 12);
  near(dot(ray.direction, scene.camera.forward), 1);
  near(dot(scene.camera.right, scene.camera.up), 0);
  near(dot(scene.camera.right, scene.camera.forward), 0);
});
test('tile stitching is deterministic and matches a single full render', () => {
  const scene = makeScene({ width: 32, height: 24, samples: 4 }),
    whole = renderTile(scene, 0, 24),
    first = renderTile(scene, 0, 8),
    second = renderTile(scene, 8, 16);
  const joined = new Uint8ClampedArray(whole.pixels.length);
  joined.set(first.pixels);
  joined.set(second.pixels, first.pixels.length);
  assert.deepEqual(joined, whole.pixels);
  assert.equal(whole.stats.primaryRays, 32 * 24 * 4);
  assert.ok(whole.pixels.filter((_, i) => i % 4 === 3).every((a) => a === 255));
  assert.ok(new Set(whole.pixels).size > 30);
});
test('accelerated and brute-force renders are identical while BVH reduces sphere tests', () => {
  const config = { scene: 'sphere-field', width: 32, height: 24, samples: 1, distance: 10 };
  const accelerated = renderTile(makeScene({ ...config, acceleration: true }), 0, 24),
    brute = renderTile(makeScene({ ...config, acceleration: false }), 0, 24);
  assert.deepEqual(accelerated.pixels, brute.pixels);
  assert.ok(accelerated.stats.sphereTests < brute.stats.sphereTests / 2);
});
test('normal mode avoids secondary rays and invalid configurations fail early', () => {
  const result = renderTile(
    makeScene({ width: 16, height: 16, samples: 1, mode: 'normals' }),
    0,
    16,
  );
  assert.equal(result.stats.shadowRays, 0);
  assert.equal(result.stats.tracedRays, 256);
  for (const patch of [
    { width: 0 },
    { samples: 3 },
    { bounces: 4 },
    { azimuth: NaN },
    { scene: 'unknown' },
    { acceleration: 1 },
    { extra: true },
  ])
    assert.throws(() => validateConfig(patch));
  assert.throws(() => renderTile(makeScene(), -1, 8));
});
