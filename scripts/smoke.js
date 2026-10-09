// Smoke test: boots the server on a test port and hits every integration.
// Run with: npm test
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
try {
  const envFile = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  const line = envFile.split(/\r?\n/).find((l) => l.startsWith('TRACKING_TOKEN='));
  if (line && !process.env.TRACKING_TOKEN) process.env.TRACKING_TOKEN = line.slice('TRACKING_TOKEN='.length).trim();
} catch { /* no .env */ }

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const TEST_TRACKING_TOKEN = 'smoke-test-token';
const results = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  ok  ${name}${detail ? ' - ' + detail : ''}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
    console.log(`FAIL  ${name} - ${e.message}`);
  }
}

async function json(pathname, opts) {
  const res = await fetch(BASE + pathname, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function waitForServer(child, ms = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      if (child.exitCode !== null) return reject(new Error('server exited early'));
      try {
        await fetch(`${BASE}/api/health`);
        clearInterval(timer);
        resolve();
      } catch {
        if (Date.now() - started > ms) {
          clearInterval(timer);
          reject(new Error('server did not start'));
        }
      }
    }, 250);
  });
}

async function main() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), BASE_URL: BASE, TRACKING_TOKEN: TEST_TRACKING_TOKEN },
    stdio: 'ignore'
  });

  try {
    await waitForServer(child);

    await check('health', async () => {
      const d = await json('/api/health');
      if (!d.ok) throw new Error('not ok');
      return `integrations=${Object.values(d.integrations).filter(Boolean).length}/4`;
    });

    await check('maps', async () => {
      const d = await json('/api/maps');
      if (d.maps.length !== 2) throw new Error(`expected 2 maps, got ${d.maps.length}`);
      const missing = d.maps.filter((m) => !m.pois?.length || !m.routes?.length);
      if (missing.length) throw new Error('map missing pois/routes');
      return `${d.maps.map((m) => `${m.pois.length} POIs/${m.routes.length} routes`).join(', ')}`;
    });

    for (const mapId of ['brookhaven', 'bloxburg']) {
      await check(`tracking:${mapId}`, async () => {
        const d = await json(`/api/tracking?map=${mapId}`);
        if (d.vehicles.length < 10) throw new Error(`only ${d.vehicles.length} vehicles`);
        const bad = d.vehicles.filter((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.eta));
        if (bad.length) throw new Error('vehicle with bad position/eta');
        return `${d.vehicles.length} vehicles, ${d.stats.cars} cars / ${d.stats.buses} buses / ${d.stats.taxis} taxis`;
      });
    }

    await check('roblox-api', async () => {
      const d = await json('/api/roblox/games');
      const g = d.games[0];
      if (!g.playing || !g.icon) throw new Error('missing live stats or icon');
      return `${g.name}: ${g.playing} playing, ${g.visits} visits, icon ok`;
    });

    await check('ai-chat', async () => {
      if (!process.env.OPENROUTER_API_KEY) return 'skipped (no OPENROUTER_API_KEY)';
      const res = await fetch(`${BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] })
      });
      if (res.status !== 400) throw new Error(`expected 400 without user message, got ${res.status}`);
      return 'empty-message validation ok (no upstream request sent)';
    });

    await check('wifi', async () => {
      const hot = await json('/api/wifi/hotspots');
      if (hot.hotspots.length < 4) throw new Error('not enough hotspots');
      const c = await json('/api/wifi/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotspotId: hot.hotspots[0].id, device: 'smoke-test' })
      });
      if (!/^UBERS-/.test(c.code)) throw new Error('bad code');
      const s = await json(`/api/wifi/status?code=${c.code}`);
      if (!s.active) throw new Error('code not active');
      return `${hot.hotspots.length} hotspots, code ${c.code}`;
    });

    await check('tracking-ping', async () => {
      const d = await json('/api/tracking/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ubers-token': TEST_TRACKING_TOKEN },
        body: JSON.stringify({ map: 'brookhaven', vehicles: [{ id: 'smoke-1', type: 'taxi', x: 500, y: 500 }] })
      });
      if (!d.ok) throw new Error('rejected');
      return `accepted ${d.accepted}`;
    });

    await check('tracking-ping-rejects-bad-token', async () => {
      const res = await fetch(`${BASE}/api/tracking/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ubers-token': 'wrong' },
        body: JSON.stringify({ vehicles: [{ id: 'x', x: 1, y: 1 }] })
      });
      if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
      return '401 as expected';
    });

    await check('stripe-plans', async () => {
      const d = await json('/api/billing/plans');
      if (d.plans.length !== 3) throw new Error('expected 3 plans');
      return d.plans.map((p) => p.display).join(' / ');
    });

    await check('spa-fallback', async () => {
      const res = await fetch(`${BASE}/#map`);
      const html = await res.text();
      if (!html.includes('ROBLOX UBERS')) throw new Error('index not served');
      return 'index.html ok';
    });
  } finally {
    child.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
