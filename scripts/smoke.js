// Smoke test: boots the server on a test port and hits every integration.
// Run with: npm test
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const playerTracker = require('../lib/players');

const ROOT = path.join(__dirname, '..');
try {
  const envFile = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  const line = envFile.split(/\r?\n/).find((l) => l.startsWith('TRACKING_TOKEN='));
  if (line && !process.env.TRACKING_TOKEN) process.env.TRACKING_TOKEN = line.slice('TRACKING_TOKEN='.length).trim();
} catch { /* no .env */ }

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const TEST_TRACKING_TOKEN = 'smoke-test-token-do-not-use-in-production-0123456789abcdef';
const TEST_DATA_DIRECTORY = fs.mkdtempSync(path.join(os.tmpdir(), 'roblox-ubers-smoke-'));
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

async function json(pathname, opts = {}) {
  const request = { ...opts };
  if (request.body && typeof request.body !== 'string') {
    request.headers = { 'Content-Type': 'application/json', ...request.headers };
    request.body = JSON.stringify(request.body);
  }
  const res = await fetch(BASE + pathname, request);
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
    env: {
      ...process.env,
      PORT: String(PORT),
      BASE_URL: BASE,
      TRACKING_TOKEN: TEST_TRACKING_TOKEN,
      UBERS_DATA_DIR: TEST_DATA_DIRECTORY
    },
    stdio: 'ignore'
  });

  try {
    await waitForServer(child);

    await check('health', async () => {
      const d = await json('/api/health');
      if (!d.ok) throw new Error('not ok');
      return `integrations=${Object.values(d.integrations).filter(Boolean).length}/${Object.keys(d.integrations).length}`;
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
        if (d.vehicles.length !== 0) throw new Error(`expected no fabricated vehicles, got ${d.vehicles.length}`);
        const bad = d.vehicles.filter((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.eta));
        if (bad.length) throw new Error('vehicle with bad position/eta');
        return 'empty until a real Roblox tracker reports positions';
      });
    }

    await check('roblox-api', async () => {
      const d = await json('/api/roblox/games');
      const g = d.games[0];
      if (!Number.isFinite(g.playing) || !g.icon) throw new Error('missing live stats or icon');
      return `${g.name}: ${g.playing} playing, ${g.visits} visits, icon ok`;
    });

    await check('roblox-public-servers', async () => {
      const d = await json('/api/roblox/servers?placeId=4924922222');
      if (d.placeId !== 4924922222 || !Array.isArray(d.servers) || !Number.isFinite(d.sampledPlayers)) {
        throw new Error('invalid public-server response');
      }
      if (d.servers.length > 100 || d.servers.some((server) =>
        typeof server.id !== 'string' || !Number.isFinite(server.playing) ||
        Object.keys(server).some((key) => !['id', 'playing', 'maxPlayers', 'fps', 'ping'].includes(key))
      )) throw new Error('invalid server fields or page size');
      if (d.nextCursor) {
        const next = await json(`/api/roblox/servers?placeId=4924922222&cursor=${encodeURIComponent(d.nextCursor)}`);
        if (next.placeId !== d.placeId || !Array.isArray(next.servers) || next.servers.length > 100) {
          throw new Error('next public-server page is invalid');
        }
      }
      return `${d.servers.length} public servers, ${d.sampledPlayers} sampled players`;
    });

    await check('roblox-public-servers-validates-place', async () => {
      const res = await fetch(`${BASE}/api/roblox/servers?placeId=1`);
      if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
      return 'unknown places rejected';
    });

    await check('pages-cors', async () => {
      const res = await fetch(`${BASE}/api/roblox/servers?placeId=4924922222`, {
        headers: { Origin: 'https://gostudios-real.github.io' }
      });
      if (res.headers.get('access-control-allow-origin') !== 'https://gostudios-real.github.io') {
        throw new Error('GitHub Pages origin is not allowed');
      }
      const preflight = await fetch(`${BASE}/api/roblox/servers?placeId=4924922222`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://gostudios-real.github.io',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'content-type,cf-skip-browser-warning'
        }
      });
      const allowedHeaders = preflight.headers.get('access-control-allow-headers') || '';
      if (preflight.status !== 204 || !allowedHeaders.includes('Content-Type') ||
          !allowedHeaders.toLowerCase().includes('cf-skip-browser-warning')) {
        throw new Error('browser API preflight was not allowed');
      }
      const methods = preflight.headers.get('access-control-allow-methods') || '';
      if (!methods.includes('DELETE')) throw new Error('booking cancellation method is not allowed');
      return 'GitHub Pages origin allowed';
    });

    await check('roleplay-bookings-and-timetable', async () => {
      const schedule = await json('/api/rides/timetable?map=brookhaven&routeId=b1');
      if (schedule.route.id !== 'b1' || !schedule.departures.length ||
          schedule.departures.some((slot) => !Number.isFinite(slot.seatsAvailable) || slot.seatsAvailable !== 32)) {
        throw new Error('invalid route timetable or seat availability');
      }
      const firstDeparture = schedule.departures[0].departureAt;
      const bookings = [];
      for (let index = 0; index < 8; index++) {
        const result = await json('/api/bookings', {
          method: 'POST',
          body: {
            mapId: 'brookhaven',
            routeId: 'b1',
            pickupPoiId: 'fountain',
            dropoffPoiId: 'hospital',
            departureAt: firstDeparture,
            seats: 4,
            riderName: `Roleplay ${index + 1}`
          }
        });
        if (!result.booking.reference.startsWith('UBR-') || !/^[a-f0-9]{64}$/.test(result.booking.manageKey)) {
          throw new Error('booking reference or private key missing');
        }
        bookings.push(result.booking);
      }
      const fullTimetable = await json('/api/rides/timetable?map=brookhaven&routeId=b1');
      if (fullTimetable.departures.some((slot) => slot.departureAt === firstDeparture)) {
        throw new Error('full departure remained bookable');
      }
      const privateLookup = await json(`/api/bookings/${bookings[0].reference}/lookup`, {
        method: 'POST',
        body: { manageKey: bookings[0].manageKey }
      });
      if (privateLookup.booking.riderName !== 'Roleplay 1' || privateLookup.booking.manageKey) {
        throw new Error('private lookup did not protect the management key');
      }
      const denied = await fetch(`${BASE}/api/bookings/${bookings[0].reference}/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manageKey: '0'.repeat(64) })
      });
      if (denied.status !== 404) throw new Error(`invalid management key returned ${denied.status}`);
      const cancelled = await json(`/api/bookings/${bookings[0].reference}`, {
        method: 'DELETE',
        body: { manageKey: bookings[0].manageKey }
      });
      if (cancelled.booking.status !== 'cancelled') throw new Error('booking was not cancelled');
      const reopened = await json('/api/rides/timetable?map=brookhaven&routeId=b1');
      if (reopened.departures.find((slot) => slot.departureAt === firstDeparture)?.seatsAvailable !== 4) {
        throw new Error('cancelled seats were not released');
      }
      const invalid = await fetch(`${BASE}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapId: 'brookhaven', routeId: 'b1', pickupPoiId: 'fountain', dropoffPoiId: 'fountain',
          departureAt: firstDeparture, seats: 5, riderName: 'invalid'
        })
      });
      if (invalid.status !== 400) throw new Error(`invalid booking returned ${invalid.status}`);
      const saved = fs.readFileSync(path.join(TEST_DATA_DIRECTORY, 'bookings.json'), 'utf8');
      if (saved.includes(bookings[0].manageKey) || !saved.includes(bookings[0].reference)) {
        throw new Error('management secret was stored in plaintext or booking was not persisted');
      }
      const previousDataDirectory = process.env.UBERS_DATA_DIR;
      process.env.UBERS_DATA_DIR = TEST_DATA_DIRECTORY;
      try {
        const reopenedStore = require('../lib/bookings');
        if (!reopenedStore.get(bookings[1].reference, bookings[1].manageKey)) {
          throw new Error('booking could not be loaded again from persistent storage');
        }
      } finally {
        if (previousDataDirectory === undefined) delete process.env.UBERS_DATA_DIR;
        else process.env.UBERS_DATA_DIR = previousDataDirectory;
      }
      return 'persistence across store reload, capacity, private lookup, cancellation, validation and hashed key verified';
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

    const playerReport = {
      map: 'brookhaven',
      serverId: 'smoke-server-001',
      players: [{ userId: 123456789, x: 420, y: 240, heading: 90 }]
    };

    await check('players-ping', async () => {
      const d = await json('/api/players/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ubers-token': TEST_TRACKING_TOKEN },
        body: JSON.stringify(playerReport)
      });
      if (!d.ok || d.accepted !== 1) throw new Error('player report was not accepted');
      return `accepted ${d.accepted} anonymous position`;
    });

    await check('players-ping-rejects-bad-token', async () => {
      const res = await fetch(`${BASE}/api/players/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ubers-token': 'wrong' },
        body: JSON.stringify(playerReport)
      });
      if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
      return '401 as expected';
    });

    await check('players-ping-validates-coordinates', async () => {
      const res = await fetch(`${BASE}/api/players/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ubers-token': TEST_TRACKING_TOKEN },
        body: JSON.stringify({ ...playerReport, players: [{ userId: 22, x: 1100, y: 200 }] })
      });
      if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
      return 'out-of-map positions rejected';
    });

    await check('players-snapshot-is-anonymous-and-map-scoped', async () => {
      const d = await json('/api/players?map=brookhaven');
      if (d.players.length !== 1 || d.activeServers !== 1) throw new Error('live position missing');
      const serialized = JSON.stringify(d);
      if (serialized.includes('123456789') || serialized.includes('smoke-server-001')) {
        throw new Error('response exposed a Roblox user or server ID');
      }
      if (d.players[0].x !== 420 || d.players[0].y !== 240) throw new Error('wrong live position');
      const otherMap = await json('/api/players?map=bloxburg');
      if (otherMap.players.length) throw new Error('Brookhaven player leaked into Bloxburg');
      return 'anonymous position returned only on its configured map';
    });

    await check('players-empty-server-clears-snapshot', async () => {
      await json('/api/players/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ubers-token': TEST_TRACKING_TOKEN },
        body: JSON.stringify({ ...playerReport, players: [] })
      });
      const d = await json('/api/players?map=brookhaven');
      if (d.players.length || d.activeServers) throw new Error('departed players remained in the snapshot');
      return 'empty roster clears the game server immediately';
    });

    await check('players-reports-expire-after-ttl', async () => {
      const now = Date.now;
      try {
        Date.now = () => 1000;
        playerTracker.reportFromRoblox({
          map: 'bloxburg',
          serverId: 'ttl-test-server',
          players: [{ userId: 99887766, x: 100, y: 200 }]
        }, TEST_TRACKING_TOKEN);
        if (playerTracker.snapshot('bloxburg').players.length !== 1) throw new Error('fresh report missing');
        Date.now = () => 1001 + playerTracker.PLAYER_TTL_MS;
        if (playerTracker.snapshot('bloxburg').players.length) throw new Error('stale report was not removed');
      } finally {
        Date.now = now;
      }
      return `${playerTracker.PLAYER_TTL_MS / 1000}s heartbeat expiry verified`;
    });

    await check('stripe-plans', async () => {
      const d = await json('/api/billing/plans');
      if (d.plans.length !== 3) throw new Error('expected 3 plans');
      return d.plans.map((p) => p.display).join(' / ');
    });

    await check('spa-fallback', async () => {
      const res = await fetch(`${BASE}/#map`);
      const html = await res.text();
      for (const text of ['ROBLOX UBERS', 'bookingForm', 'view-faq', 'view-legal', '© 2026']) {
        if (!html.includes(text)) throw new Error(`index is missing ${text}`);
      }
      const banner = await fetch(`${BASE}/assets/uber-banner.svg`);
      if (!banner.ok || !(await banner.text()).includes('UBERS roleplay ride banner')) {
        throw new Error('brand banner was not served');
      }
      return 'booking, FAQ, terms, copyright and SVG banner are served';
    });
  } finally {
    child.kill();
    fs.rmSync(TEST_DATA_DIRECTORY, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
