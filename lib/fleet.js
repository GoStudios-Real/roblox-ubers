// Live fleet: simulated vehicles on map routes + real vehicles pinged from Roblox.

const { MAPS } = require('./maps');

const TICK_MS = 1000;
const EXTERNAL_TTL_MS = 45000; // Roblox pings older than this are dropped

const TYPES = {
  car: { label: 'Car', speed: [34, 60], seats: 4 },
  bus: { label: 'Bus', speed: [24, 34], seats: 32 },
  taxi: { label: 'Taxi', speed: [40, 66], seats: 4 }
};

function polylineLength(stops) {
  let total = 0;
  const segs = [];
  for (let i = 1; i < stops.length; i++) {
    const dx = stops[i][0] - stops[i - 1][0];
    const dy = stops[i][1] - stops[i - 1][1];
    const len = Math.hypot(dx, dy);
    segs.push(len);
    total += len;
  }
  return { segs, total };
}

function pointOnRoute(route, t) {
  const { segs, total } = route.metrics;
  let dist = ((t % 1) + 1) % 1 * total;
  for (let i = 0; i < segs.length; i++) {
    if (dist <= segs[i] || i === segs.length - 1) {
      const f = segs[i] === 0 ? 0 : dist / segs[i];
      const a = route.stops[i];
      const b = route.stops[i + 1];
      return {
        x: +(a[0] + (b[0] - a[0]) * f).toFixed(2),
        y: +(a[1] + (b[1] - a[1]) * f).toFixed(2),
        heading: +(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI).toFixed(1)
      };
    }
    dist -= segs[i];
  }
  return { x: route.stops[0][0], y: route.stops[0][1], heading: 0 };
}

function buildRoutes() {
  const out = {};
  for (const [mapId, map] of Object.entries(MAPS)) {
    out[mapId] = map.routes.map((r) => ({ ...r, metrics: polylineLength(r.stops) }));
  }
  return out;
}

const ROUTES = buildRoutes();

function seedFleet() {
  const fleet = [];
  let n = 0;
  for (const [mapId, routes] of Object.entries(ROUTES)) {
    for (const route of routes) {
      const type = route.id.startsWith('b') ? 'bus' : route.id.startsWith('c') ? 'taxi' : 'car';
      const count = type === 'bus' ? 2 : type === 'taxi' ? 2 : 3;
      for (let i = 0; i < count; i++) {
        const [lo, hi] = TYPES[type].speed;
        const speedUnits = lo + Math.random() * (hi - lo);
        const names = ['Nova', 'Ace', 'Blaze', 'Echo', 'Frost', 'Glide', 'Hydra', 'Indigo', 'Juno', 'Kite', 'Luna', 'Mako', 'Onyx', 'Pixel', 'Quartz', 'Raven', 'Solar', 'Titan', 'Vortex', 'Zenith'];
        n += 1;
        fleet.push({
          id: `${mapId}-${route.id}-${i + 1}`,
          map: mapId,
          routeId: route.id,
          routeName: route.name,
          type,
          plate: `UBR-${(1000 + n * 37).toString(36).toUpperCase().slice(0, 4)}`,
          driver: `${names[(n * 7) % names.length]} R.`,
          t: Math.random(),
          speed: +(speedUnits / Math.hypot(route.metrics.total, 1)).toFixed(5),
          speedUnits,
          rating: +(4.3 + Math.random() * 0.7).toFixed(2),
          status: Math.random() > 0.18 ? 'enroute' : 'idle',
          external: false
        });
      }
    }
  }
  return fleet;
}

const fleet = seedFleet();
const external = new Map(); // id -> vehicle record from Roblox

function tick() {
  for (const v of fleet) {
    const route = ROUTES[v.map].find((r) => r.id === v.routeId);
    const progress = (v.speedUnits / route.metrics.total) * (TICK_MS / 1000);
    v.t = (v.t + progress) % 1;
    const p = pointOnRoute(route, v.t);
    v.x = p.x;
    v.y = p.y;
    v.heading = p.heading;
    v.updatedAt = Date.now();
  }
  const now = Date.now();
  for (const [id, v] of external) {
    if (now - v.lastSeen > EXTERNAL_TTL_MS) external.delete(id);
  }
}

tick();
setInterval(tick, TICK_MS);

// Map units move in real time; ETAs are shown on a slower, human scale.
const ETA_SCALE = 6;

function etaMinutes(v) {
  const route = ROUTES[v.map].find((r) => r.id === v.routeId);
  if (!route) return 0;
  const remainingUnits = (1 - v.t) * route.metrics.total;
  const speed = v.speedUnits || 45; // external Roblox vehicles: assume cruise speed
  const seconds = (remainingUnits / speed) * ETA_SCALE;
  if (!Number.isFinite(seconds)) return 1;
  return Math.max(1, Math.round(seconds / 60));
}

function snapshot(mapId) {
  const sim = fleet
    .filter((v) => !mapId || v.map === mapId)
    .map((v) => ({ ...v, eta: etaMinutes(v) }));
  const ext = [...external.values()]
    .filter((v) => !mapId || v.map === mapId)
    .map((v) => ({ ...v, eta: etaMinutes(v) }));
  return [...ext, ...sim];
}

function reportFromRoblox(payload) {
  const added = [];
  const list = Array.isArray(payload.vehicles) ? payload.vehicles : [payload];
  for (const raw of list) {
    if (!raw || !raw.id) continue;
    const type = TYPES[raw.type] ? raw.type : 'car';
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const map = MAPS[raw.map] ? raw.map : payload.map || 'brookhaven';
    const route = ROUTES[map].find((r) => r.id === raw.routeId) || ROUTES[map][0];
    const rec = {
      id: String(raw.id),
      map,
      routeId: route.id,
      routeName: raw.routeName || route.name,
      type,
      plate: raw.plate || `RBX-${String(raw.id).slice(-4).toUpperCase()}`,
      driver: raw.driver || 'Roblox Driver',
      x: Math.max(0, Math.min(1000, x)),
      y: Math.max(0, Math.min(1000, y)),
      heading: Number.isFinite(Number(raw.heading)) ? Number(raw.heading) : 0,
      speedUnits: 0,
      t: 0,
      rating: Number(raw.rating) || 5,
      status: raw.status === 'idle' ? 'idle' : 'enroute',
      external: true,
      lastSeen: Date.now(),
      updatedAt: Date.now()
    };
    // Approximate eta from distance to end of route
    const idx = route.stops.findIndex((s) => Math.hypot(s[0] - rec.x, s[1] - rec.y) < 120);
    rec.t = idx >= 0 ? idx / (route.stops.length - 1) : 0;
    external.set(rec.id, rec);
    added.push(rec.id);
  }
  return { tracked: external.size, accepted: added.length, ids: added };
}

function stats() {
  const all = snapshot(null);
  return {
    total: all.length,
    cars: all.filter((v) => v.type === 'car').length,
    buses: all.filter((v) => v.type === 'bus').length,
    taxis: all.filter((v) => v.type === 'taxi').length,
    live: all.filter((v) => v.status === 'enroute').length,
    external: [...external.values()].length,
    updatedAt: Date.now()
  };
}

module.exports = { snapshot, reportFromRoblox, stats };
