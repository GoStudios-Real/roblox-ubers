// Profile Games: every UBERS map comes from a Roblox profile's public games.
// GET /api/profile/games resolves a username (or "group:<id>"), lists their games,
// and generates a deterministic UBERS layout (zones, stops, routes, WiFi) per game.

const crypto = require('crypto');
const { setMaps, addMaps } = require('./maps');

const CACHE_TTL_MS = 5 * 60 * 1000;
const FIXTURE = process.env.UBERS_PROFILE_FIXTURE === '1';
const cache = new Map(); // username -> { at, data }
let current = null;      // { profile, games, maps } for the default profile
let defaultIds = new Set(); // map ids owned by the default profile refresh

const ZONE_LABELS = ['Hub District', 'Riverside', 'Uptown', 'Market Ward', 'Parkside', 'Industrial Row', 'Harbor Flats', 'Summit'];
const POI_TEMPLATE = [
  ['central', 'Central Transit Hub', 'transport'],
  ['plaza', 'Market Plaza', 'shop'],
  ['depot', 'Vehicle Depot', 'transport'],
  ['park', 'Greenline Park', 'fun'],
  ['civic', 'Civic Hall', 'landmark'],
  ['cafe', 'Corner Cafe', 'job'],
  ['school', 'Local Academy', 'school'],
  ['clinic', 'Community Clinic', 'medical'],
  ['wifi-hub', 'FREE WIFI - Transit Hub', 'wifi'],
  ['wifi-plaza', 'FREE WIFI - Market Plaza', 'wifi'],
  ['wifi-park', 'FREE WIFI - Greenline Park', 'wifi'],
  ['wifi-depot', 'FREE WIFI - Vehicle Depot', 'wifi']
];
const BASE_POINTS = [[520, 195], [430, 330], [700, 260], [300, 450], [620, 520], [200, 700], [820, 640], [480, 780]];

function seededRandom(seed) {
  const digest = crypto.createHash('sha256').update(String(seed)).digest();
  let a = digest.readUInt32LE(0);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildMapForGame(game) {
  const universeId = Number(game.universeId || game.id);
  const rand = seededRandom(`ubers-map-${universeId}`);
  const pois = POI_TEMPLATE.map(([id, name, cat], index) => {
    const [bx, by] = BASE_POINTS[index % BASE_POINTS.length];
    return {
      id,
      name: cat === 'wifi' ? name : `${game.name} ${name}`,
      cat,
      x: Math.round(Math.max(60, Math.min(940, bx + (rand() - 0.5) * 90))),
      y: Math.round(Math.max(60, Math.min(940, by + (rand() - 0.5) * 90)))
    };
  });
  const at = (id) => pois.find((p) => p.id === id);
  const zoneLabels = shuffled(ZONE_LABELS, rand).slice(0, 4);
  const zones = [
    { x: 40, y: 40, w: 440, h: 420, label: zoneLabels[0], color: '#1e3a2f' },
    { x: 520, y: 40, w: 440, h: 420, label: zoneLabels[1], color: '#3b2f52' },
    { x: 40, y: 520, w: 440, h: 420, label: zoneLabels[2], color: '#2c3e57' },
    { x: 520, y: 520, w: 440, h: 420, label: zoneLabels[3], color: '#4a3b23' }
  ];
  const water = [{ x: 0, y: 900, w: 1000, h: 100 }];
  const routes = [
    {
      id: 'b1', name: 'Bus 1 - Hub Loop', color: '#4dd2ff',
      stops: [[at('central').x, at('central').y], [at('plaza').x, at('plaza').y], [at('civic').x, at('civic').y], [at('school').x, at('school').y], [at('park').x, at('park').y], [at('central').x, at('central').y]]
    },
    {
      id: 'b2', name: 'Bus 2 - Coast Line', color: '#7dd3fc',
      stops: [[at('park').x, at('park').y], [at('clinic').x, at('clinic').y], [at('depot').x, at('depot').y], [at('cafe').x, at('cafe').y], [at('plaza').x, at('plaza').y], [at('park').x, at('park').y]]
    },
    {
      id: 'c1', name: 'Taxi 1 - Express', color: '#ffd166',
      stops: [[at('central').x, at('central').y], [at('cafe').x, at('cafe').y], [at('depot').x, at('depot').y], [at('civic').x, at('civic').y], [at('central').x, at('central').y]]
    },
    {
      id: 'v1', name: 'Car - Scenic Drive', color: '#ef5da8',
      stops: [[at('school').x, at('school').y], [at('clinic').x, at('clinic').y], [at('park').x, at('park').y], [at('plaza').x, at('plaza').y], [at('school').x, at('school').y]]
    }
  ];
  return {
    id: `game-${universeId}`,
    name: game.name || `Game ${universeId}`,
    universeId,
    placeId: game.rootPlaceId ? Number(game.rootPlaceId) : null,
    blurb: `Auto-generated UBERS layout for ${game.name || 'this profile game'}.`,
    profileGame: {
      universeId,
      rootPlaceId: game.rootPlaceId ? Number(game.rootPlaceId) : null,
      icon: game.icon || null,
      playing: game.playing ?? null,
      visits: game.visits ?? null,
      favorites: game.favorites ?? null,
      rating: game.rating ?? null
    },
    ownerManaged: Boolean(game.rootPlaceId),
    water,
    zones,
    pois,
    routes
  };
}

function fixtureGames() {
  return [
    { universeId: 90010001, rootPlaceId: 900100011, name: 'Fixture Transit City', playing: 42, visits: 123456, favorites: 789, rating: 91.2, icon: null },
    { universeId: 90020002, rootPlaceId: 900200022, name: 'Fixture Harbor Town', playing: 17, visits: 654321, favorites: 321, rating: 88.4, icon: null }
  ];
}

async function resolveProfile(username) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    const error = new Error('Enter a Roblox username between 3 and 20 letters, numbers, or underscores (or group:<id>).');
    error.statusCode = 400;
    throw error;
  }
  const response = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Roblox profile lookup failed (${response.status}).`);
  const user = (await response.json()).data?.[0];
  if (!user) {
    const error = new Error('Roblox username not found.');
    error.statusCode = 404;
    throw error;
  }
  let avatarUrl = null;
  try {
    const thumb = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=false`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (thumb.ok) avatarUrl = (await thumb.json()).data?.[0]?.imageUrl || null;
  } catch { /* avatar optional */ }
  return {
    kind: 'user',
    userId: user.id,
    username: user.name,
    displayName: user.displayName,
    avatarUrl,
    profileUrl: `https://www.roblox.com/users/${user.id}/profile`
  };
}

async function fetchGameList(profile) {
  const url = profile.kind === 'group'
    ? `https://games.roblox.com/v2/groups/${profile.userId}/games?accessFilter=Public&sortOrder=Desc&limit=25`
    : `https://games.roblox.com/v2/users/${profile.userId}/games?accessFilter=Public&sortOrder=Desc&limit=25`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Roblox game list failed (${response.status}).`);
  return (await response.json()).data || [];
}

async function enrichGames(games) {
  const ids = games.map((g) => g.id).filter(Number.isFinite);
  if (!ids.length) return [];
  const batch = ids.join(',');
  const [detailRes, voteRes, iconRes] = await Promise.all([
    fetch(`https://games.roblox.com/v1/games?universeIds=${batch}`, { signal: AbortSignal.timeout(10000) }),
    fetch(`https://games.roblox.com/v1/games/votes?universeIds=${batch}`, { signal: AbortSignal.timeout(10000) }).catch(() => null),
    fetch(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${batch}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`, { signal: AbortSignal.timeout(10000) }).catch(() => null)
  ]);
  const details = new Map(((await detailRes.json()).data || []).map((d) => [d.id, d]));
  const votes = new Map(((voteRes && (await voteRes.json()).data) || []).map((v) => [v.id, v]));
  const icons = new Map(((iconRes && (await iconRes.json()).data) || []).map((i) => [i.targetId, i.imageUrl]));
  return games.map((game) => {
    const detail = details.get(game.id) || {};
    const vote = votes.get(game.id);
    return {
      universeId: game.id,
      rootPlaceId: game.rootPlaceId || detail.rootPlaceId || null,
      name: game.name || detail.name || `Game ${game.id}`,
      playing: detail.playing ?? null,
      visits: detail.visits ?? null,
      favorites: detail.favoritedCount ?? null,
      rating: vote && vote.upVotes + vote.downVotes > 0
        ? Math.round((vote.upVotes / (vote.upVotes + vote.downVotes)) * 1000) / 10
        : null,
      icon: icons.get(game.id) || null
    };
  });
}

async function fetchProfileGames(username) {
  const key = String(username || '').toLowerCase();
  if (!/^group:\d+$/.test(key) && !/^[a-z0-9_]{3,20}$/.test(key)) {
    const error = new Error('Enter a Roblox username between 3 and 20 letters, numbers, or underscores (or group:<id>).');
    error.statusCode = 400;
    throw error;
  }
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  let data;
  if (FIXTURE) {
    const profile = { kind: 'fixture', userId: 0, username: username || 'fixture', displayName: 'Fixture Profile', avatarUrl: null, profileUrl: null };
    const games = fixtureGames();
    const maps = games.map(buildMapForGame);
    data = { profile, games, maps, source: 'fixture' };
  } else if (/^group:\d+$/.test(key)) {
    const groupId = key.split(':')[1];
    const profile = { kind: 'group', userId: Number(groupId), username: `group:${groupId}`, displayName: `Roblox Group ${groupId}`, avatarUrl: null, profileUrl: `https://www.roblox.com/groups/${groupId}/group` };
    const games = await enrichGames(await fetchGameList(profile));
    const maps = games.map(buildMapForGame);
    data = { profile, games, maps };
  } else {
    const profile = await resolveProfile(username);
    const games = await enrichGames(await fetchGameList(profile));
    const maps = games.map(buildMapForGame);
    data = { profile, games, maps };
  }

  if (cache.size > 64) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), data });
  return data;
}

// Merge freshly fetched maps into the shared registry (used by bookings/tracking).
// Manually loaded maps persist across default-profile refreshes.
function registerMaps(maps) {
  if (!maps?.length) return;
  addMaps(maps.filter((map) => map && map.id && !defaultIds.has(map.id)));
}

async function refreshRegistry(username) {
  let name = String(username || process.env.ROBLOX_PROFILE_USERNAME || '').trim();
  const enabled = !/^(none|off|false|disabled)$/i.test(name);
  if (!name && enabled) name = FIXTURE ? 'fixture' : 'Roblox'; // always-live default profile
  if (!name || !enabled) {
    if (!current) setMaps([]);
    return current;
  }
  const data = await fetchProfileGames(name);
  current = data;
  const fresh = data.maps.map((map) => ({ ...map, source: 'profile' }));
  const nextDefaultIds = new Set(fresh.map((map) => map.id));
  const { listMaps } = require('./maps');
  const manual = listMaps().filter((map) => !nextDefaultIds.has(map.id) && !defaultIds.has(map.id));
  defaultIds = nextDefaultIds;
  setMaps([...fresh, ...manual]);
  return data;
}

function currentProfile() {
  if (!current) return null;
  return {
    kind: current.profile.kind,
    username: current.profile.username,
    displayName: current.profile.displayName,
    avatarUrl: current.profile.avatarUrl || null,
    gameCount: current.games.length
  };
}

module.exports = { fetchProfileGames, buildMapForGame, refreshRegistry, registerMaps, currentProfile, FIXTURE };
