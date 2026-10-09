const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { configuredMaps } = require('../lib/maps');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(ROOT, process.env.UBERS_WEB_OUTPUT_DIR || 'dist/pages');
const apiBaseUrl = (process.env.UBERS_API_BASE_URL || '').replace(/\/+$/, '');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
const robloxDownloads = [
  'UBERS_FakeTown_Starter.server.lua',
  'UBERS_Dispatch.server.lua',
  'UBERS_VehicleTracker.server.lua'
];
const downloadsDirectory = path.join(OUT, 'downloads');
fs.mkdirSync(downloadsDirectory, { recursive: true });
robloxDownloads.forEach((filename) => {
  fs.copyFileSync(
    path.join(ROOT, 'roblox', filename),
    path.join(downloadsDirectory, filename.replace(/\.lua$/, '.txt'))
  );
});
fs.writeFileSync(
  path.join(OUT, 'static-config.js'),
  `window.UBERS_STATIC_MODE = true;\nwindow.UBERS_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\nwindow.UBERS_STATIC_DATA = ${JSON.stringify({ maps: configuredMaps() })};\n`
);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`GitHub Pages site built in ${path.relative(ROOT, OUT)} (API ${apiBaseUrl ? 'connected' : 'not configured'}).`);
