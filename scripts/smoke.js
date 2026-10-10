// Smoke test: boots the server on a test port and hits every integration.
// Run with: npm test
process.env.UBERS_PROFILE_FIXTURE = '1';
process.env.ROBLOX_PROFILE_USERNAME = process.env.ROBLOX_PROFILE_USERNAME || 'fixture';
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
// Fixture profile games (see lib/profile-games.js fixtureGames()).
const MAP_A = 'game-90010001';
const MAP_B = 'game-90020002';
const PLACE_A = 900100011;
const POI_PICKUP = 'central';
const POI_DROPOFF = 'clinic';
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
      UBERS_DATA_DIR: TEST_DATA_DIRECTORY,
      UBERS_PROFILE_FIXTURE: '1',
      ROBLOX_PROFILE_USERNAME: 'fixture'
    },
    stdio: 'ignore'
  });

  try {
    await waitForServer(child);

    // The dispatch/player checks below run in this process, so mirror the
    // fixture profile-game registry that the server process loaded.
    await require('../lib/profile-games').refreshRegistry('fixture');

    await check('health', async () => {
      const d = await json('/api/health');
      if (!d.ok) throw new Error('not ok');
      return `integrations=${Object.values(d.integrations).filter(Boolean).length}/${Object.keys(d.integrations).length}`;
    });

    await check('maps', async () => {
      const d = await json('/api/maps');
      if (d.maps.length !== 2) throw new Error(`expected 2 fixture maps, got ${d.maps.length}`);
      if (d.maps.map((m) => m.id).sort().join(',') !== [MAP_A, MAP_B].sort().join(',')) {
        throw new Error(`unexpected fixture map ids: ${d.maps.map((m) => m.id).join(', ')}`);
      }
      const missing = d.maps.filter((m) => !m.pois?.length || !m.routes?.length);
      if (missing.length) throw new Error('map missing pois/routes');
      if (d.maps.some((map) => !Number.isSafeInteger(map.placeId) || !map.ownerManaged)) {
        throw new Error('profile-game maps must link to their own root place');
      }
      const singleMap = await json(`/api/maps/${MAP_A}`);
      if (!singleMap.routes.some((route) => route.id === 'b1') ||
          !singleMap.pois.some((poi) => poi.id === POI_PICKUP)) {
        throw new Error('single-map endpoint did not return the generated layout');
      }
      if (!d.sourceProfile) throw new Error('maps response missing source profile');
      return `${d.maps.map((m) => `${m.pois.length} POIs/${m.routes.length} routes`).join(', ')} from @${d.profile?.username}`;
    });

    await check('profile-games', async () => {
      const d = await json('/api/profile/games?username=fixture');
      if (d.games.length !== 2 || d.maps.length !== 2) throw new Error('fixture profile did not return two games/maps');
      if (!d.maps.every((m) => m.id.startsWith('game-') && m.profileGame)) {
        throw new Error('profile maps were not generated from games');
      }
      const again = await json(`/api/profile/games?username=${encodeURIComponent(d.profile.username)}`);
      if (again.maps.map((m) => m.id).join(',') !== d.maps.map((m) => m.id).join(',')) {
        throw new Error('profile game maps are not deterministic');
      }
      const invalid = await fetch(`${BASE}/api/profile/games?username=%21%21`);
      if (invalid.status !== 400) throw new Error(`invalid username returned ${invalid.status}`);
      return `${d.games.length} games -> deterministic profile maps`;
    });

    for (const mapId of [MAP_A, MAP_B]) {
      await check(`tracking:${mapId}`, async () => {
        const d = await json(`/api/tracking?map=${mapId}`);
        if (d.vehicles.length !== 0) throw new Error(`expected no fabricated vehicles, got ${d.vehicles.length}`);
        const bad = d.vehicles.filter((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.eta));
        if (bad.length) throw new Error('vehicle with bad position/eta');
        return 'empty until a real Roblox tracker reports positions';
      });
    }

    await check('graceful-unknown-map-feeds', async () => {
      const playersFeed = await json('/api/players?map=not-a-real-map');
      if (playersFeed.mapKnown !== false || playersFeed.players.length) {
        throw new Error('unknown player map should return an empty graceful feed');
      }
      const trackingFeed = await json('/api/tracking?map=not-a-real-map');
      if (trackingFeed.mapKnown !== false || trackingFeed.vehicles.length) {
        throw new Error('unknown tracking map should return an empty graceful feed');
      }
      return 'unknown maps degrade to empty feeds instead of UI errors';
    });

    await check('roblox-api', async () => {
      const d = await json('/api/roblox/games');
      if (d.setupRequired || d.games.length !== 2 ||
          d.games.some((game) => ![MAP_A, MAP_B].includes(game.mapId) || game.error)) {
        throw new Error('profile-game maps should serve game stats');
      }
      const rejected = await fetch(`${BASE}/api/roblox/games?placeIds=4924922222`);
      if (rejected.status !== 400) throw new Error(`unmapped place should be rejected, got ${rejected.status}`);
      return 'game stats served only for configured profile-game places';
    });

    await check('roblox-public-servers-require-owner-place', async () => {
      const res = await fetch(`${BASE}/api/roblox/servers?placeId=4924922222`);
      if (res.status !== 400) throw new Error(`official third-party place should be rejected, got ${res.status}`);
      return 'unconfigured third-party places rejected';
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

    await check('roblox-dispatch-api-protects-game-servers', async () => {
      const denied = await fetch(`${BASE}/api/roblox/dispatch/next?map=${MAP_A}`);
      if (denied.status !== 401) throw new Error(`unauthenticated dispatch poll returned ${denied.status}`);
      const allowed = await json(`/api/roblox/dispatch/next?map=${MAP_A}`, {
        headers: { 'x-ubers-token': TEST_TRACKING_TOKEN }
      });
      if (allowed.ride !== null) throw new Error('unexpected ride was dispatched');
      return 'game-server polling requires the shared server token';
    });

    await check('roleplay-bookings-and-timetable', async () => {
      const schedule = await json(`/api/rides/timetable?map=${MAP_A}&routeId=b1`);
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
            mapId: MAP_A,
            routeId: 'b1',
            pickupPoiId: POI_PICKUP,
            dropoffPoiId: POI_DROPOFF,
            departureAt: firstDeparture,
            seats: 4,
            riderName: `Roleplay ${index + 1}`
          }
        });
        if (!result.booking.reference.startsWith('UBR-') || !/^[a-f0-9]{64}$/.test(result.booking.manageKey)) {
          throw new Error('booking reference or private key missing');
        }
        if (result.booking.placeId !== PLACE_A) {
          throw new Error('booking was not linked to its profile game place');
        }
        bookings.push(result.booking);
      }
      const fullTimetable = await json(`/api/rides/timetable?map=${MAP_A}&routeId=b1`);
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

      const profileResult = await json('/api/roblox/profile', {
        method: 'POST',
        body: { username: 'Builderman' }
      });
      if (!/^\d+$/.test(String(profileResult.profile.userId)) || !profileResult.profile.profileUrl) {
        throw new Error('public Roblox profile lookup returned invalid identity fields');
      }
      const linked = await json(`/api/bookings/${bookings[1].reference}/profile`, {
        method: 'POST',
        body: { manageKey: bookings[1].manageKey, username: 'Builderman' }
      });
      if (linked.booking.robloxProfile?.userId !== String(profileResult.profile.userId)) {
        throw new Error('Roblox profile was not linked to the private booking');
      }

      const previousDispatchDataDirectory = process.env.UBERS_DATA_DIR;
      process.env.UBERS_DATA_DIR = TEST_DATA_DIRECTORY;
      let dispatchStore;
      try {
        dispatchStore = require('../lib/bookings');
      } finally {
        if (previousDispatchDataDirectory === undefined) delete process.env.UBERS_DATA_DIR;
        else process.env.UBERS_DATA_DIR = previousDispatchDataDirectory;
      }
      const dispatchTime = Date.parse(bookings[1].departureAt);
      const due = dispatchStore.nextDispatch(MAP_A, dispatchTime);
      if (due?.reference !== bookings[1].reference) throw new Error('profile-linked ride did not enter dispatch queue');
      const assigned = dispatchStore.claimDispatch(due.reference, MAP_A, 'smoke-server-001', dispatchTime);
      if (assigned.robloxProfile.userId !== String(profileResult.profile.userId)) {
        throw new Error('dispatch response did not include the matched Roblox user ID');
      }
      if (dispatchStore.updateDispatch(due.reference, 'different-server', 'enroute', dispatchTime)) {
        throw new Error('another game server updated the ride status');
      }
      for (const status of ['enroute', 'arrived', 'picked_up', 'completed']) {
        dispatchStore.updateDispatch(due.reference, 'smoke-server-001', status, dispatchTime);
      }
      if (dispatchStore.get(bookings[1].reference, bookings[1].manageKey).dispatchStatus !== 'completed') {
        throw new Error('dispatch lifecycle did not persist its completed status');
      }

      const cancelled = await json(`/api/bookings/${bookings[0].reference}`, {
        method: 'DELETE',
        body: { manageKey: bookings[0].manageKey }
      });
      if (cancelled.booking.status !== 'cancelled') throw new Error('booking was not cancelled');
      const reopened = await json(`/api/rides/timetable?map=${MAP_A}&routeId=b1`);
      if (reopened.departures.find((slot) => slot.departureAt === firstDeparture)?.seatsAvailable !== 4) {
        throw new Error('cancelled seats were not released');
      }
      const invalid = await fetch(`${BASE}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapId: MAP_A, routeId: 'b1', pickupPoiId: POI_PICKUP, dropoffPoiId: POI_PICKUP,
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

    await check('driver-jobs-flow', async () => {
      const schedule = await json(`/api/rides/timetable?map=${MAP_A}&routeId=c1`);
      const slot = schedule.departures[0].departureAt;
      const created = await json('/api/bookings', {
        method: 'POST',
        body: {
          mapId: MAP_A,
          routeId: 'c1',
          pickupPoiId: POI_PICKUP,
          dropoffPoiId: POI_DROPOFF,
          departureAt: slot,
          seats: 2,
          riderName: 'Job Rider'
        }
      });
      const reference = created.booking.reference;
      const manageKey = created.booking.manageKey;

      const open = await json(`/api/jobs?map=${MAP_A}`);
      const listed = (open.jobs || []).find((job) => job.reference === reference);
      if (!listed) throw new Error('new booking did not appear as an open driver job');
      if (listed.placeId !== PLACE_A || listed.routeType !== 'taxi' || !listed.pickupName?.endsWith('Central Transit Hub')) {
        throw new Error(`open job is missing route or place details: placeId=${listed.placeId} routeType=${listed.routeType} pickupName=${listed.pickupName}`);
      }
      if (!listed.pickup || !listed.dropoff || !Array.isArray(listed.routeStops)) {
        throw new Error('open job is missing map coordinates or route stops for the driver map');
      }
      const listedJson = JSON.stringify(open);
      if (listedJson.includes(manageKey) || listedJson.includes('codeHash') || listedJson.includes('driverCode')) {
        throw new Error('public job list leaked a secret');
      }

      const anonClaim = await fetch(`${BASE}/api/jobs/${reference}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverName: 'Taxi Driver' })
      });
      if (anonClaim.status !== 401) throw new Error(`anonymous claim returned ${anonClaim.status} instead of 401`);

      const shortUser = await fetch(`${BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ab', password: 'long-enough-password' })
      });
      if (shortUser.status !== 400) throw new Error(`short signup username returned ${shortUser.status}`);
      const weakPass = await fetch(`${BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'smoke_driver1', password: 'short' })
      });
      if (weakPass.status !== 400) throw new Error(`weak signup password returned ${weakPass.status}`);

      const signedUp = await json('/api/auth/signup', {
        method: 'POST',
        body: { username: 'smoke_driver1', password: 'smoke-secret-123', displayName: 'Taxi Driver' }
      });
      if (!/^[a-f0-9]{64}$/.test(signedUp.token)) throw new Error('sign-up did not return a private 64-hex token');
      if (signedUp.account?.username !== 'smoke_driver1' || signedUp.account?.displayName !== 'Taxi Driver') {
        throw new Error('sign-up account payload is wrong');
      }
      if (JSON.stringify(signedUp).includes('hash') || JSON.stringify(signedUp).includes('salt')) {
        throw new Error('sign-up leaked password material');
      }
      const duplicateUser = await fetch(`${BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'SMOKE_DRIVER1', password: 'smoke-secret-123' })
      });
      if (duplicateUser.status !== 409) throw new Error(`duplicate signup returned ${duplicateUser.status}`);
      const wrongPass = await fetch(`${BASE}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'smoke_driver1', password: 'not-the-password' })
      });
      if (wrongPass.status !== 401) throw new Error(`wrong password returned ${wrongPass.status}`);
      const signedIn = await json('/api/auth/signin', {
        method: 'POST',
        body: { username: 'smoke_driver1', password: 'smoke-secret-123' }
      });
      const session = { 'x-ubers-auth': signedIn.token };

      const meAnon = await fetch(`${BASE}/api/auth/me`);
      if (meAnon.status !== 401) throw new Error(`anonymous /api/auth/me returned ${meAnon.status}`);

      const badName = await fetch(`${BASE}/api/jobs/${reference}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ubers-auth': signedIn.token },
        body: JSON.stringify({ driverName: 'x' })
      });
      if (badName.status !== 400) throw new Error(`invalid driver name returned ${badName.status}`);

      const claimed = await json(`/api/jobs/${reference}/claim`, {
        method: 'POST',
        headers: session,
        body: { driverName: 'Taxi Driver', driverUsername: 'driver_user1' }
      });
      if (!/^[a-f0-9]{64}$/.test(claimed.driverCode)) throw new Error('driver code was not a private 64-hex secret');
      if (claimed.job.dispatchStatus !== 'claimed' || claimed.job.driver?.name !== 'Taxi Driver') {
        throw new Error('claim did not assign the driver');
      }
      if ('accountId' in (claimed.job.driver || {}) || JSON.stringify(claimed.job).includes(signedIn.account.id)) {
        throw new Error('public job view leaked the account id');
      }

      const afterClaim = await json(`/api/jobs?map=${MAP_A}`);
      if ((afterClaim.jobs || []).some((job) => job.reference === reference)) {
        throw new Error('claimed job still listed as open');
      }
      const duplicate = await fetch(`${BASE}/api/jobs/${reference}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ubers-auth': signedIn.token },
        body: JSON.stringify({ driverName: 'Second Driver' })
      });
      if (duplicate.status !== 409) throw new Error(`double claim returned ${duplicate.status}`);

      const mine = await json(`/api/jobs/driver?code=${claimed.driverCode}`);
      if (mine.job.reference !== reference || mine.job.dispatchStatus !== 'claimed') {
        throw new Error('driver code did not resolve the claimed job');
      }
      const deniedDriver = await fetch(`${BASE}/api/jobs/driver?code=${'a'.repeat(64)}`);
      if (deniedDriver.status !== 404) throw new Error(`unknown driver code returned ${deniedDriver.status}`);

      const accountJobs = await json('/api/jobs/mine', { headers: session });
      if (!(accountJobs.jobs || []).some((job) => job.reference === reference)) {
        throw new Error('/api/jobs/mine did not list the claimed ride for the account');
      }
      const mineAnon = await fetch(`${BASE}/api/jobs/mine`);
      if (mineAnon.status !== 401) throw new Error(`anonymous /api/jobs/mine returned ${mineAnon.status}`);

      const second = await json('/api/bookings', {
        method: 'POST',
        headers: session,
        body: {
          mapId: MAP_A,
          routeId: 'c1',
          pickupPoiId: POI_PICKUP,
          dropoffPoiId: POI_DROPOFF,
          departureAt: slot,
          seats: 1,
          riderName: 'Job Rider 2'
        }
      });
      const me = await json('/api/auth/me', { headers: session });
      if (me.account?.username !== 'smoke_driver1') throw new Error('/api/auth/me did not return the session account');
      if (!(me.bookings || []).some((booking) => booking.reference === second.booking.reference)) {
        throw new Error('/api/auth/me did not return the session-created booking');
      }
      const secondClaim = await json(`/api/jobs/${second.booking.reference}/claim`, {
        method: 'POST',
        headers: session
      });
      if (secondClaim.job.driver?.name !== 'Taxi Driver') {
        throw new Error('claim without a driver name did not fall back to the account display name');
      }

      const npcClaim = await fetch(`${BASE}/api/roblox/dispatch/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ubers-token': TEST_TRACKING_TOKEN },
        body: JSON.stringify({ reference, mapId: MAP_A, serverId: 'smoke-npc-001' })
      });
      const npcBody = await npcClaim.json().catch(() => ({}));
      if (npcClaim.status !== 409 || !String(npcBody.error || '').includes('website driver')) {
        throw new Error(`NPC dispatcher returned ${npcClaim.status} (${npcBody.error || ''}) for a website-driver ride`);
      }

      const codeStep = await json(`/api/jobs/${reference}/status`, {
        method: 'POST',
        body: { driverCode: claimed.driverCode, status: 'enroute' }
      });
      if (codeStep.job.dispatchStatus !== 'enroute') throw new Error('driver-code status step did not advance');
      for (const status of ['arrived', 'picked_up', 'completed']) {
        const step = await json(`/api/jobs/${reference}/status`, {
          method: 'POST',
          headers: session,
          body: { status }
        });
        if (step.job.dispatchStatus !== status) throw new Error(`account session did not advance status to ${status}`);
      }
      const wrongStatus = await fetch(`${BASE}/api/jobs/${reference}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverCode: 'b'.repeat(64), status: 'completed' })
      });
      if (wrongStatus.status !== 404) throw new Error(`forged driver code returned ${wrongStatus.status}`);
      const noCredential = await fetch(`${BASE}/api/jobs/${reference}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      });
      if (noCredential.status !== 404) throw new Error(`credential-less status returned ${noCredential.status}`);

      const riderView = await json(`/api/bookings/${reference}/lookup`, {
        method: 'POST',
        body: { manageKey }
      });
      if (riderView.booking.dispatchStatus !== 'completed' || riderView.booking.driver?.name !== 'Taxi Driver') {
        throw new Error('rider booking bar did not receive the live driver status');
      }

      const released = await json(`/api/jobs/${second.booking.reference}/release`, {
        method: 'POST',
        headers: session
      });
      if (released.job.dispatchStatus !== 'scheduled' || released.job.driver) {
        throw new Error('released job did not return to the open list');
      }
      const reopened = await json(`/api/jobs?map=${MAP_A}`);
      if (!(reopened.jobs || []).some((job) => job.reference === second.booking.reference)) {
        throw new Error('released job is not open for other drivers again');
      }
      const mineAfter = await json('/api/jobs/mine', { headers: session });
      if ((mineAfter.jobs || []).some((job) => [reference, second.booking.reference].includes(job.reference))) {
        throw new Error('released/completed rides still listed as active driver jobs');
      }

      const signedOut = await json('/api/auth/signout', {
        method: 'POST',
        headers: session,
        body: {}
      });
      if (!signedOut.signedOut) throw new Error('sign-out did not confirm');
      const meAfterSignout = await fetch(`${BASE}/api/auth/me`, { headers: session });
      if (meAfterSignout.status !== 401) throw new Error(`sign-out token still valid (/api/auth/me ${meAfterSignout.status})`);

      let limited = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await fetch(`${BASE}/api/auth/signin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'smoke_driver1', password: 'smoke-secret-123' })
        });
        if (res.status === 429) {
          const body = await res.json().catch(() => ({}));
          if (!String(body.error || '').includes('Too many sign-in attempts')) {
            throw new Error(`rate limiter returned 429 without a retry message: ${body.error || ''}`);
          }
          limited = true;
          break;
        }
      }
      if (!limited) throw new Error('auth rate limiter never kicked in after 20 sign-in attempts');

      return 'account sign-up/in/out, session-scoped claim, secret driver code, NPC conflict guard, account status chain, release and rate limit verified';
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
        body: JSON.stringify({ map: MAP_A, vehicles: [{ id: 'smoke-1', type: 'taxi', x: 500, y: 500 }] })
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
      map: MAP_A,
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
      const d = await json(`/api/players?map=${MAP_A}`);
      if (d.players.length !== 1 || d.activeServers !== 1) throw new Error('live position missing');
      const serialized = JSON.stringify(d);
      if (serialized.includes('123456789') || serialized.includes('smoke-server-001')) {
        throw new Error('response exposed a Roblox user or server ID');
      }
      if (d.players[0].x !== 420 || d.players[0].y !== 240) throw new Error('wrong live position');
      const otherMap = await json(`/api/players?map=${MAP_B}`);
      if (otherMap.players.length) throw new Error('player leaked into the other profile map');
      return 'anonymous position returned only on its configured map';
    });

    await check('players-empty-server-clears-snapshot', async () => {
      await json('/api/players/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ubers-token': TEST_TRACKING_TOKEN },
        body: JSON.stringify({ ...playerReport, players: [] })
      });
      const d = await json(`/api/players?map=${MAP_A}`);
      if (d.players.length || d.activeServers) throw new Error('departed players remained in the snapshot');
      return 'empty roster clears the game server immediately';
    });

    await check('players-reports-expire-after-ttl', async () => {
      const now = Date.now;
      try {
        Date.now = () => 1000;
        playerTracker.reportFromRoblox({
          map: MAP_B,
          serverId: 'ttl-test-server',
          players: [{ userId: 99887766, x: 100, y: 200 }]
        }, TEST_TRACKING_TOKEN);
        if (playerTracker.snapshot(MAP_B).players.length !== 1) throw new Error('fresh report missing');
        Date.now = () => 1001 + playerTracker.PLAYER_TTL_MS;
        if (playerTracker.snapshot(MAP_B).players.length) throw new Error('stale report was not removed');
      } finally {
        Date.now = now;
      }
      return `${playerTracker.PLAYER_TTL_MS / 1000}s heartbeat expiry verified`;
    });

    await check('stripe-plans', async () => {
      const d = await json('/api/billing/plans');
      if (d.plans.length !== 3 || d.checkoutMode !== 'payment' || typeof d.checkoutEnabled !== 'boolean') {
        throw new Error('expected three plans and explicit Checkout readiness');
      }
      if (!d.checkoutEnabled) {
        const unavailable = await fetch(`${BASE}/api/billing/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: 'rider' })
        });
        const result = await unavailable.json();
        if (unavailable.status !== 503 || !result.error.includes('STRIPE_SECRET_KEY')) {
          throw new Error('missing Stripe secret did not produce a clear Checkout configuration error');
        }
      }
      return d.plans.map((p) => p.display).join(' / ');
    });

    await check('spa-fallback', async () => {
      const res = await fetch(`${BASE}/#map`);
      const html = await res.text();
      for (const text of ['ROBLOX UBERS', 'bookingForm', 'soundToggle', 'view-faq', 'view-legal', '© 2026',
        'view-jobs', 'jobList', 'driverJobList', 'accountPanel', 'accountBody', 'driversMapCard', 'jobsMapSvg',
        'jobsMapLegend', 'jobClaimPanel', 'Can bots spawn cars', '/api/jobs/:reference/claim', '/api/auth/signin']) {
        if (!html.includes(text)) throw new Error(`index is missing ${text}`);
      }
      for (const text of ['Real Human Drivers', 'GoStudios Of Roblox Transport']) {
        if (!html.includes(text)) throw new Error(`index is missing ${text}`);
      }
      const lowered = html.toLowerCase();
      for (const text of ['roleplay', 'not affiliated with', 'fan project', 'npc']) {
        if (lowered.includes(text)) throw new Error(`index still contains banned copy: ${text}`);
      }
      const banner = await fetch(`${BASE}/assets/uber-banner.svg`);
      if (!banner.ok || !(await banner.text()).includes('UBERS real driver ride banner')) {
        throw new Error('brand banner was not served');
      }
      return 'booking, Drive jobs, Real Human Drivers branding, FAQ, terms and SVG banner are served';
    });

    await check('booking-tracker-and-12-hour-times', async () => {
      const app = await fetch(`${BASE}/app.js`).then((response) => response.text());
      const styles = await fetch(`${BASE}/styles.css`).then((response) => response.text());
      for (const text of [
        'hour12: true',
        'role',
        'progressbar',
        'aria-valuetext',
        'refreshBookingDetails()',
        'roblox://experiences/start',
        'Launch Roblox app',
        "Opens this ride's Roblox experience on your device",
        'soundToggle',
        'AudioContext',
        'soundPreferenceKey',
        "playSound('tap')",
        'Sound off'
      ]) {
        if (!app.includes(text)) throw new Error(`booking tracker is missing ${text}`);
      }
      for (const text of ['ride-tracking', 'ride-progress-fill', 'ride-stages']) {
        if (!styles.includes(text)) throw new Error(`booking tracker styles are missing ${text}`);
      }
      return 'local AM/PM times, accessible ride progress and live detail refresh are served';
    });

    await check('accounts-and-drivers-map-ui', async () => {
      const html = await fetch(`${BASE}/`).then((response) => response.text());
      const app = await fetch(`${BASE}/app.js`).then((response) => response.text());
      const styles = await fetch(`${BASE}/styles.css`).then((response) => response.text());
      for (const text of [
        'authToken()', 'x-ubers-auth', '/api/auth/signup', '/api/auth/signin', '/api/auth/signout',
        '/api/auth/me', '/api/jobs/mine', 'renderAccountPanel', 'renderDriversMap', 'Next ·',
        "localStorage.getItem('ubersAuth')", 'Sign out', 'SIGNED IN', 'routeMapSvg',
        'actions/variables/UBERS_API_BASE_URL', 'resolveApiBaseOnce', 'resetApiBaseResolution',
        'gist.githubusercontent.com', 'ubers-api-base.txt', 'staticConfigUrl',
        'Reconnected to the UBERS server'
      ]) {
        if (!app.includes(text)) throw new Error(`app.js is missing ${text}`);
      }
      for (const text of ['jobs-map-marker', 'job-route-map', 'job-tracking', 'auth-form', 'job-row-flash', 'jobs-map-legend']) {
        if (!styles.includes(text)) throw new Error(`styles.css is missing ${text}`);
      }
      for (const text of ['Sign in / Sign up', 'Drivers map', 'My driver jobs', 'Open rides', 'SIGNED OUT']) {
        if (!html.includes(text)) throw new Error(`index is missing ${text}`);
      }
      return 'account panel, session headers, drivers map and Next-driven tracking UI are served';
    });

    await check('static-site-requires-compatible-backend', async () => {
      const app = await fetch(`${BASE}/app.js`).then((response) => response.text());
      if (!app.includes('health.apiVersion !== 2') || !app.includes('SERVER UPDATE REQUIRED')) {
        throw new Error('static site does not reject incompatible API servers safely');
      }
      return 'old backend APIs cannot re-enable third-party fallback behavior';
    });

    await check('roblox-notepad-download-links', async () => {
      const html = await fetch(`${BASE}/`).then((response) => response.text());
      const scripts = [
        'UBERS_FakeTown_Starter.server.txt',
        'UBERS_Dispatch.server.txt',
        'UBERS_VehicleTracker.server.txt'
      ];
      if (!html.includes('Roblox scripts for Notepad') || !html.includes('Change the <code>.txt</code> extension to <code>.lua</code>')) {
        throw new Error('Notepad download instructions are missing');
      }
      for (const script of scripts) {
        if (!html.includes(`./downloads/${script}`)) {
          throw new Error(`Notepad download link is missing ${script}`);
        }
      }
      return 'starter, dispatch, and tracker scripts are linked as Notepad-friendly text files';
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
