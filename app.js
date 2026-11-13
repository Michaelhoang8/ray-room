import { validateConfig } from './core.js';
const $ = (id) => document.getElementById(id),
  form = $('controls'),
  canvas = $('canvas'),
  context = canvas.getContext('2d');
let worker = null,
  revision = 0,
  completed = null,
  importRevision = 0;
function read() {
  const result = {};
  for (const element of form.elements)
    if (element.name)
      result[element.name] =
        element.type === 'checkbox'
          ? element.checked
          : ['scene', 'mode'].includes(element.name)
            ? element.value
            : Number(element.value);
  return validateConfig(result);
}
function labels() {
  for (const output of form.querySelectorAll('output')) {
    const name = output.htmlFor.value;
    output.value =
      form.elements.namedItem(name).value + (['azimuth', 'elevation'].includes(name) ? '°' : '');
  }
}
function invalidate(message) {
  revision++;
  worker?.terminate();
  worker = null;
  completed = null;
  $('cancel').disabled = true;
  $('png').disabled = true;
  $('report').disabled = true;
  $('stats').replaceChildren();
  $('status').textContent = message;
}
form.addEventListener('input', () => {
  importRevision++;
  labels();
  invalidate('Settings changed. Render to update the image.');
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  render();
});
$('cancel').onclick = () =>
  invalidate('Rendering cancelled. Partial image retained; exports disabled.');
function render() {
  let config;
  try {
    config = read();
  } catch (error) {
    invalidate(error.message);
    return;
  }
  $('settings-panel').close();
  invalidate('Rendering…');
  const current = revision;
  canvas.width = config.width;
  canvas.height = config.height;
  canvas.style.setProperty('--image-ratio', config.width / config.height);
  context.fillStyle = '#202521';
  context.fillRect(0, 0, canvas.width, canvas.height);
  $('progress').value = 0;
  $('progress').max = config.height;
  $('cancel').disabled = false;
  $('dimensions').textContent = `${config.width} × ${config.height}`;
  $('caption').textContent =
    config.scene === 'still-life' ? 'Still life / three spheres' : 'Sphere field / 48 spheres';
  try {
    worker = new Worker('./worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (current !== revision) return;
      if (data.type === 'tile') {
        context.putImageData(
          new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.count),
          0,
          data.row,
        );
        $('progress').value = data.row + data.count;
      } else if (data.type === 'complete') {
        completed = { config: data.config, stats: data.stats };
        worker.terminate();
        worker = null;
        $('cancel').disabled = true;
        $('png').disabled = false;
        $('report').disabled = false;
        $('status').textContent =
          `Complete · ${(data.stats.milliseconds / 1000).toFixed(2)} s · ${config.acceleration ? 'BVH' : 'brute force'}`;
        for (const [label, key] of [
          ['Primary rays', 'primaryRays'],
          ['Traced rays', 'tracedRays'],
          ['Shadow rays', 'shadowRays'],
          ['Sphere tests', 'sphereTests'],
          ['Box tests', 'boxTests'],
          ['BVH nodes', 'bvhNodes'],
        ]) {
          const item = document.createElement('div'),
            dt = document.createElement('dt'),
            dd = document.createElement('dd');
          dt.textContent = label;
          dd.textContent = data.stats[key].toLocaleString();
          item.append(dt, dd);
          $('stats').append(item);
        }
      } else if (data.type === 'error') invalidate(data.message);
    };
    worker.onerror = (event) => invalidate(`Renderer failed: ${event.message}`);
    worker.postMessage(config);
  } catch (error) {
    invalidate(error.message);
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function json(value, name) {
  download(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), name);
}
$('save').onclick = () => {
  try {
    json(read(), 'ray-room-scene.json');
  } catch (error) {
    $('status').textContent = error.message;
  }
};
$('report').onclick = () => {
  if (completed) json(completed, 'ray-room-report.json');
};
$('png').onclick = () => {
  if (!completed) return;
  const current = revision;
  canvas.toBlob((blob) => {
    if (blob && current === revision && completed) download(blob, 'ray-room.png');
  });
};
$('import').onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const ticket = ++importRevision;
  try {
    if (file.size > 16000) throw Error('Scene files must be smaller than 16 KB.');
    const config = validateConfig(JSON.parse(await file.text()));
    if (ticket !== importRevision) return;
    for (const [key, value] of Object.entries(config)) {
      const element = form.elements.namedItem(key);
      if (element.type === 'checkbox') element.checked = value;
      else element.value = String(value);
    }
    labels();
    invalidate('Scene imported. Render to calculate the image.');
  } catch (error) {
    if (ticket === importRevision) $('status').textContent = `Import failed: ${error.message}`;
  }
};
labels();
render();

for (const name of ['settings', 'metrics']) {
  $(name + '-open').addEventListener('click', () => $(name + '-panel').showModal());
  $(name + '-close').addEventListener('click', () => $(name + '-panel').close());
}
$('render-again').addEventListener('click', render);
