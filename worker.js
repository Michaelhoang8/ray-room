import { makeScene, renderTile } from './core.js';
let revision = 0;
self.onmessage = (event) => {
  const current = ++revision;
  try {
    const scene = makeScene(event.data),
      started = performance.now(),
      totals = { primaryRays: 0, tracedRays: 0, shadowRays: 0, sphereTests: 0, boxTests: 0 };
    let row = 0;
    function next() {
      if (current !== revision) return;
      try {
        const count = Math.min(8, scene.config.height - row),
          tile = renderTile(scene, row, count);
        for (const key of Object.keys(totals)) totals[key] += tile.stats[key];
        self.postMessage(
          { type: 'tile', row, count, width: scene.config.width, pixels: tile.pixels.buffer },
          [tile.pixels.buffer],
        );
        row += count;
        if (row === scene.config.height)
          self.postMessage({
            type: 'complete',
            stats: {
              ...totals,
              milliseconds: performance.now() - started,
              spheres: scene.spheres.length,
              bvhNodes: scene.bvhNodes,
            },
            config: scene.config,
          });
        else setTimeout(next, 0);
      } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
      }
    }
    next();
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
