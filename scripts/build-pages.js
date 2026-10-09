const fs = require('fs');
const path = require('path');
const { MAPS } = require('../lib/maps');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'pages');
const apiBaseUrl = (process.env.UBERS_API_BASE_URL || '').replace(/\/+$/, '');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, 'static-config.js'),
  `window.UBERS_STATIC_MODE = true;\nwindow.UBERS_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\nwindow.UBERS_STATIC_DATA = ${JSON.stringify({ maps: Object.values(MAPS) })};\n`
);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`GitHub Pages site built in ${path.relative(ROOT, OUT)} (API ${apiBaseUrl ? 'connected' : 'not configured'}).`);
