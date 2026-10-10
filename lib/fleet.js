// Vehicles reported from Roblox game servers.

const { getMap, registryStamp } = require('./maps');

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

// Routes come from the live profile-games registry, so they are rebuilt lazily
// whenever the registry changes.
const routeCache = new Map(); // mapId -> { stamp, routes }

function routesFor(mapId) {
  const map = getMap(mapId);
  if (!map) return [];
  const stamp = registryStamp();
  const cached = routeCache.get(mapId);
  if (cached && cached.stamp === stamp) return cached.routes;
  const routes = (map.routes || []).map((r) => ({ ...r, metrics: polylineLength(r.stops) }));
  routeCache.set(mapId, { stamp, routes });
  return routes;
}

function defaultMapId() {
  const { listMaps } = require('./maps');
  const maps = listMaps();
  return maps.length ? maps[0].id : null;
}

const external = new Map(); // id -> vehicle record from Roblox

function tick() {
  const now = Date.now();
  for (const [id, v] of external) {
    if (now - v.lastSeen > EXTERNAL_TTL_MS) external.delete(id);
  }
}

tick();
setInterval(tick, EXTERNAL_TTL_MS);

// Map units move in real time; ETAs are shown on a slower, human scale.
const ETA_SCALE = 6;

function etaMinutes(v) {
  const route = routesFor(v.map).find((r) => r.id === v.routeId);
  if (!route) return 1;
  const remainingUnits = (1 - v.t) * route.metrics.total;
  const speed = v.speedUnits || 45; // external Roblox vehicles: assume cruise speed
  const seconds = (remainingUnits / speed) * ETA_SCALE;
  if (!Number.isFinite(seconds)) return 1;
  return Math.max(1, Math.round(seconds / 60));
}

function snapshot(mapId) {
  const ext = [...external.values()]
    .filter((v) => !mapId || v.map === mapId)
    .map((v) => ({ ...v, eta: etaMinutes(v) }));
  return ext;
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
    const map = getMap(raw.map)
      ? raw.map
      : getMap(payload.map)
        ? payload.map
        : defaultMapId();
    if (!map) continue;
    const route = routesFor(map).find((r) => r.id === raw.routeId) || routesFor(map)[0];
    if (!route) continue;
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
