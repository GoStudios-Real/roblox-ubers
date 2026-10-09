const fs = require('fs');
const path = require('path');
const { MAPS } = require('../lib/maps');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'pages');
const vehicles = [];
let index = 0;

for (const map of Object.values(MAPS)) {
  for (const route of map.routes) {
    const type = route.id.startsWith('b') ? 'bus' : route.id.startsWith('c') ? 'taxi' : 'car';
    const stop = route.stops[1] || route.stops[0];
    index += 1;
    vehicles.push({
      id: `demo-${map.id}-${route.id}`,
      map: map.id,
      routeId: route.id,
      routeName: route.name,
      type,
      plate: `DEMO-${String(index).padStart(3, '0')}`,
      driver: 'Demo Driver',
      x: stop[0],
      y: stop[1],
      heading: 0,
      eta: 3 + (index % 12),
      rating: 5,
      status: 'enroute',
      external: false
    });
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, 'static-config.js'),
  `window.UBERS_STATIC_MODE = true;\nwindow.UBERS_STATIC_DATA = ${JSON.stringify({ maps: Object.values(MAPS), vehicles })};\n`
);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`GitHub Pages site built in ${path.relative(ROOT, OUT)} (${vehicles.length} demo vehicles).`);
