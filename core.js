export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const mul = (a, k) => a.map((v) => v * k);
export const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function unit(a) {
  const length = Math.hypot(...a);
  if (!Number.isFinite(length) || length === 0)
    throw Error('Cannot normalize a zero or nonfinite vector.');
  return mul(a, 1 / length);
}
export const reflect = (direction, normal) =>
  sub(direction, mul(normal, 2 * dot(direction, normal)));
const EPS = 1e-4;

export function hitSphere(ray, sphere, tMin = EPS, tMax = Infinity) {
  const oc = sub(ray.origin, sphere.center),
    a = dot(ray.direction, ray.direction);
  if (a === 0) return null;
  const halfB = dot(oc, ray.direction),
    c = dot(oc, oc) - sphere.radius * sphere.radius,
    discriminant = halfB * halfB - a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  let t = (-halfB - root) / a;
  if (t < tMin || t > tMax) {
    t = (-halfB + root) / a;
    if (t < tMin || t > tMax) return null;
  }
  const point = add(ray.origin, mul(ray.direction, t)),
    outward = mul(sub(point, sphere.center), 1 / sphere.radius),
    front = dot(ray.direction, outward) < 0;
  return { t, point, normal: front ? outward : mul(outward, -1), front, object: sphere };
}

export function hitBox(ray, bounds, tMin = EPS, tMax = Infinity) {
  for (let axis = 0; axis < 3; axis++) {
    const direction = ray.direction[axis],
      origin = ray.origin[axis];
    if (direction === 0) {
      if (origin < bounds.min[axis] || origin > bounds.max[axis]) return false;
      continue;
    }
    let a = (bounds.min[axis] - origin) / direction,
      b = (bounds.max[axis] - origin) / direction;
    if (a > b) [a, b] = [b, a];
    tMin = Math.max(tMin, a);
    tMax = Math.min(tMax, b);
    if (tMax < tMin) return false;
  }
  return true;
}

export function buildBVH(spheres) {
  if (!spheres.length) return null;
  const bounds = {
    min: [0, 1, 2].map((axis) => Math.min(...spheres.map((s) => s.center[axis] - s.radius))),
    max: [0, 1, 2].map((axis) => Math.max(...spheres.map((s) => s.center[axis] + s.radius))),
  };
  if (spheres.length <= 4) return { bounds, spheres: [...spheres], left: null, right: null };
  const extent = [0, 1, 2].map(
      (axis) =>
        Math.max(...spheres.map((s) => s.center[axis])) -
        Math.min(...spheres.map((s) => s.center[axis])),
    ),
    axis = extent.indexOf(Math.max(...extent));
  if (extent[axis] === 0) return { bounds, spheres: [...spheres], left: null, right: null };
  const sorted = [...spheres].sort((a, b) => a.center[axis] - b.center[axis] || a.id - b.id),
    mid = Math.floor(sorted.length / 2);
  return {
    bounds,
    spheres: null,
    left: buildBVH(sorted.slice(0, mid)),
    right: buildBVH(sorted.slice(mid)),
  };
}

function better(hit, best) {
  return hit && (!best || hit.t < best.t || (hit.t === best.t && hit.object.id < best.object.id));
}
export function closestSphere(ray, spheres, bvh = null, stats = null, tMax = Infinity) {
  let best = null;
  function test(sphere) {
    if (stats) stats.sphereTests++;
    const hit = hitSphere(ray, sphere, EPS, best?.t ?? tMax);
    if (better(hit, best)) best = hit;
  }
  function visit(node) {
    if (!node) return;
    if (stats) stats.boxTests++;
    if (!hitBox(ray, node.bounds, EPS, best?.t ?? tMax)) return;
    if (node.spheres) node.spheres.forEach(test);
    else {
      visit(node.left);
      visit(node.right);
    }
  }
  if (bvh) visit(bvh);
  else spheres.forEach(test);
  return best;
}

const DEFAULTS = {
  scene: 'still-life',
  width: 480,
  height: 300,
  samples: 4,
  bounces: 2,
  azimuth: 25,
  elevation: 18,
  distance: 7.5,
  lightX: -3,
  lightHeight: 6,
  lightPower: 5,
  reflectivity: 0.45,
  mode: 'beauty',
  acceleration: true,
};
export function validateConfig(input = {}) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !Object.hasOwn(DEFAULTS, key))
  )
    throw Error('Unknown scene configuration fields.');
  const config = { ...DEFAULTS, ...input };
  for (const [key, low, high, integer] of [
    ['width', 16, 640, true],
    ['height', 16, 480, true],
    ['bounces', 0, 3, true],
    ['azimuth', -180, 180, false],
    ['elevation', 5, 70, false],
    ['distance', 4, 16, false],
    ['lightX', -8, 8, false],
    ['lightHeight', 1, 12, false],
    ['lightPower', 0.1, 10, false],
    ['reflectivity', 0, 0.9, false],
  ])
    if (
      !Number.isFinite(config[key]) ||
      config[key] < low ||
      config[key] > high ||
      (integer && !Number.isInteger(config[key]))
    )
      throw Error(`${key} must be ${integer ? 'an integer ' : ''}from ${low} to ${high}.`);
  if (
    ![1, 4, 16].includes(config.samples) ||
    !['still-life', 'sphere-field'].includes(config.scene) ||
    !['beauty', 'normals'].includes(config.mode) ||
    typeof config.acceleration !== 'boolean'
  )
    throw Error('Invalid sampling, scene, display mode, or acceleration option.');
  return config;
}

export function makeScene(input = {}) {
  const config = validateConfig(input),
    palette = [
      [0.75, 0.18, 0.12],
      [0.17, 0.4, 0.65],
      [0.8, 0.58, 0.18],
      [0.22, 0.53, 0.38],
      [0.58, 0.29, 0.56],
    ];
  const spheres =
    config.scene === 'still-life'
      ? [
          { id: 0, center: [-1.25, 0, 0], radius: 1, color: palette[0], shine: 0.65 },
          { id: 1, center: [0.6, -0.3, 0.6], radius: 0.7, color: palette[1], shine: 1 },
          { id: 2, center: [1.45, -0.15, -1.1], radius: 0.85, color: palette[2], shine: 0.3 },
        ]
      : Array.from({ length: 48 }, (_, i) => {
          const radius = 0.34 + 0.04 * (i % 3);
          return {
            id: i,
            center: [((i % 8) - 3.5) * 0.95, -1 + radius, (Math.floor(i / 8) - 2.5) * 0.95],
            radius,
            color: palette[i % palette.length],
            shine: (i % 4) / 3,
          };
        });
  const bvh = buildBVH(spheres),
    angle = (config.azimuth * Math.PI) / 180,
    elevation = (config.elevation * Math.PI) / 180,
    target = [0, -0.2, 0],
    origin = [
      config.distance * Math.cos(elevation) * Math.sin(angle),
      target[1] + config.distance * Math.sin(elevation),
      config.distance * Math.cos(elevation) * Math.cos(angle),
    ];
  const forward = unit(sub(target, origin)),
    right = unit(cross(forward, [0, 1, 0])),
    up = unit(cross(right, forward));
  const count = (node) => (node ? 1 + count(node.left) + count(node.right) : 0);
  return {
    config,
    spheres,
    bvh,
    camera: { origin, forward, right, up },
    light: [config.lightX, config.lightHeight, 3],
    bvhNodes: count(bvh),
  };
}

export function cameraRay(scene, x, y) {
  const { config, camera } = scene,
    halfHeight = Math.tan((45 * Math.PI) / 360),
    u = (((2 * x) / config.width - 1) * halfHeight * config.width) / config.height,
    v = (1 - (2 * y) / config.height) * halfHeight;
  return {
    origin: camera.origin,
    direction: unit(add(camera.forward, add(mul(camera.right, u), mul(camera.up, v)))),
  };
}

function hitScene(scene, ray, stats, tMax = Infinity) {
  let best = closestSphere(
    ray,
    scene.spheres,
    scene.config.acceleration ? scene.bvh : null,
    stats,
    tMax,
  );
  if (Math.abs(ray.direction[1]) > 1e-12) {
    const t = (-1 - ray.origin[1]) / ray.direction[1];
    if (t >= EPS && t < (best?.t ?? tMax)) {
      const point = add(ray.origin, mul(ray.direction, t)),
        checker = (Math.floor(point[0]) + Math.floor(point[2])) % 2 === 0;
      best = {
        t,
        point,
        normal: ray.direction[1] < 0 ? [0, 1, 0] : [0, -1, 0],
        front: ray.direction[1] < 0,
        object: { id: -1, color: checker ? [0.64, 0.64, 0.59] : [0.43, 0.45, 0.43], shine: 0.25 },
      };
    }
  }
  return best;
}

function trace(scene, ray, depth, stats) {
  stats.tracedRays++;
  const hit = hitScene(scene, ray, stats);
  if (!hit) {
    if (scene.config.mode === 'normals') return [0.08, 0.09, 0.1];
    const t = 0.5 * (ray.direction[1] + 1);
    return [0, 1, 2].map((i) => (1 - t) * [0.8, 0.83, 0.82][i] + t * [0.25, 0.36, 0.5][i]);
  }
  if (scene.config.mode === 'normals') return hit.normal.map((v) => 0.5 * (v + 1));
  const toLight = sub(scene.light, hit.point),
    distance = Math.hypot(...toLight),
    lightDirection = mul(toLight, 1 / distance),
    diffuse = Math.max(0, dot(hit.normal, lightDirection)),
    origin = add(hit.point, mul(hit.normal, EPS * 2));
  let visibility = 1;
  if (diffuse > 0) {
    stats.shadowRays++;
    if (hitScene(scene, { origin, direction: lightDirection }, stats, distance - EPS))
      visibility = 0;
  }
  const strength = scene.config.lightPower / (1 + 0.08 * distance * distance),
    view = mul(ray.direction, -1),
    half = add(lightDirection, view),
    halfLength = Math.hypot(...half),
    specular =
      halfLength > 0 && diffuse > 0
        ? Math.pow(Math.max(0, dot(hit.normal, mul(half, 1 / halfLength))), 48) * hit.object.shine
        : 0;
  let color = hit.object.color.map(
    (value) =>
      value * (0.16 + 0.85 * diffuse * visibility * strength) +
      0.35 * specular * visibility * strength,
  );
  const reflectivity = scene.config.reflectivity * hit.object.shine;
  if (depth < scene.config.bounces && reflectivity > 0) {
    const reflected = trace(
      scene,
      { origin, direction: unit(reflect(ray.direction, hit.normal)) },
      depth + 1,
      stats,
    );
    color = color.map((value, i) => (1 - reflectivity) * value + reflectivity * reflected[i]);
  }
  return color;
}

export function renderTile(scene, startRow, rowCount) {
  const { config } = scene;
  if (
    !Number.isInteger(startRow) ||
    !Number.isInteger(rowCount) ||
    startRow < 0 ||
    rowCount < 1 ||
    startRow + rowCount > config.height
  )
    throw Error('Tile rows are outside the image.');
  const pixels = new Uint8ClampedArray(config.width * rowCount * 4),
    grid = Math.sqrt(config.samples),
    stats = {
      primaryRays: config.width * rowCount * config.samples,
      tracedRays: 0,
      shadowRays: 0,
      sphereTests: 0,
      boxTests: 0,
    };
  for (let y = startRow; y < startRow + rowCount; y++)
    for (let x = 0; x < config.width; x++) {
      let color = [0, 0, 0];
      for (let sy = 0; sy < grid; sy++)
        for (let sx = 0; sx < grid; sx++) {
          const ray = cameraRay(scene, x + (sx + 0.5) / grid, y + (sy + 0.5) / grid);
          color = add(color, trace(scene, ray, 0, stats));
        }
      const offset = ((y - startRow) * config.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const linear = Math.max(0, color[c] / config.samples),
          mapped =
            config.mode === 'normals'
              ? Math.min(1, linear)
              : Math.pow(linear / (1 + linear), 1 / 2.2);
        pixels[offset + c] = Math.round(255 * mapped);
      }
      pixels[offset + 3] = 255;
    }
  return { pixels, stats };
}
