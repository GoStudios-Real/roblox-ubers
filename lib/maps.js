// Map registry. Maps are no longer static: every map is generated from a Roblox
// profile's public games (see lib/profile-games.js) and swapped in at runtime.
// The MAPS export is a live Proxy so existing `MAPS[id]` / `Object.values(MAPS)`
// call sites keep working.

const registry = new Map(); // id -> map
let stamped = 0;

function setMaps(list) {
  registry.clear();
  for (const map of list || []) registry.set(map.id, map);
  stamped = Date.now();
}

function addMaps(list) {
  for (const map of list || []) registry.set(map.id, map);
  stamped = Date.now();
}

function listMaps() {
  return [...registry.values()];
}

function getMap(id) {
  return typeof id === 'string' ? registry.get(id) || null : null;
}

function configuredMaps() {
  return listMaps();
}

function getConfiguredMap(id) {
  return getMap(id);
}

// Roblox place linked to a map for bookings/dispatch (profile-game root place).
function configuredPlaceId(mapId) {
  const map = getMap(mapId);
  if (!map || map.placeId == null) return null;
  return Number.isSafeInteger(map.placeId) ? map.placeId : null;
}

function registryStamp() {
  return stamped;
}

const MAPS = new Proxy({}, {
  get: (_target, key) => (typeof key === 'string' ? registry.get(key) : undefined),
  has: (_target, key) => registry.has(key),
  ownKeys: () => [...registry.keys()],
  getOwnPropertyDescriptor: (_target, key) =>
    registry.has(key)
      ? { configurable: true, enumerable: true, value: registry.get(key) }
      : undefined
});

module.exports = { MAPS, getMap, configuredMaps, getConfiguredMap, configuredPlaceId, setMaps, addMaps, listMaps, registryStamp };
