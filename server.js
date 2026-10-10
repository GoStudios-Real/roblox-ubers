const path = require('path');
const { execFile } = require('child_process');
if (process.pkg) {
  require('dotenv').config({ path: path.join(path.dirname(process.execPath), '.env') });
} else {
  require('dotenv').config();
}
const crypto = require('crypto');
const express = require('express');
const Stripe = require('stripe');

const { MAPS, getMap, configuredMaps, getConfiguredMap } = require('./lib/maps');
const profileGames = require('./lib/profile-games');
const fleet = require('./lib/fleet');
const players = require('./lib/players');
const bookings = require('./lib/bookings');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CORS_ORIGINS = new Set([
  'https://gostudios-real.github.io',
  'https://localhost',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
]);
const TRACKING_TOKEN =
  process.env.TRACKING_TOKEN === 'change-me-to-a-long-random-string'
    ? ''
    : process.env.TRACKING_TOKEN || '';
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && CORS_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, cf-skip-browser-warning');
    res.vary('Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && !CORS_ORIGINS.has(origin) ? 403 : 204);
  return next();
});

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function h(res, status, obj) {
  res.status(status).json(obj);
}
function hasKey(k) {
  return Boolean(process.env[k] && process.env[k].trim());
}

// ---------- Health / config ----------
app.get('/api/health', (_req, res) =>
  h(res, 200, {
    ok: true,
    name: 'ROBLOX UBERS',
    apiVersion: 2,
    time: new Date().toISOString(),
    maps: configuredMaps().length,
    profile: profileGames.currentProfile(),
    integrations: {
      openrouter: hasKey('OPENROUTER_API_KEY'),
      stripe: hasKey('STRIPE_SECRET_KEY'),
      robloxApiKey: hasKey('ROBLOX_API_KEY'),
      trackingToken: Boolean(TRACKING_TOKEN),
      playerTracking: Boolean(TRACKING_TOKEN)
    }
  })
);

// ---------- Maps (from Roblox profile games) ----------
const defaultProfile = () => String(process.env.ROBLOX_PROFILE_USERNAME || '').trim();

async function ensureMaps() {
  try {
    return await profileGames.refreshRegistry(defaultProfile());
  } catch (error) {
    if (!configuredMaps().length) return null;
    throw error;
  }
}

app.get('/api/maps', async (_req, res) => {
  await ensureMaps();
  h(res, 200, {
    maps: configuredMaps(),
    profile: profileGames.currentProfile(),
    sourceProfile: defaultProfile() || null
  });
});

app.get('/api/maps/:id', async (req, res) => {
  await ensureMaps();
  const map = getConfiguredMap(req.params.id);
  return map ? h(res, 200, map) : h(res, 404, { error: 'map not found' });
});

app.get('/api/profile/games', async (req, res) => {
  const username = String(req.query.username || defaultProfile() || (profileGames.FIXTURE ? 'fixture' : '')).trim();
  if (!username) {
    return h(res, 400, { error: 'Provide ?username= (a Roblox username or group:<id>), or set ROBLOX_PROFILE_USERNAME in .env.' });
  }
  try {
    const data = await profileGames.fetchProfileGames(username);
    profileGames.registerMaps(data.maps);
    h(res, 200, data);
  } catch (error) {
    h(res, error.statusCode || 502, { error: error.message });
  }
});

// ---------- Roleplay rides ----------
app.get('/api/rides/timetable', (req, res) => {
  try {
    h(res, 200, bookings.timetable(String(req.query.map || ''), String(req.query.routeId || '')));
  } catch (error) {
    h(res, error.statusCode || 500, { error: error.message });
  }
});

app.post('/api/bookings', (req, res) => {
  const createBooking = async () => {
    let profile = null;
    if (req.body?.robloxUsername) {
      profile = await resolveRobloxProfile(req.body.robloxUsername);
    }
    return bookings.create(req.body, Date.now(), profile);
  };
  createBooking().then((booking) => {
    h(res, 201, { booking });
  }).catch((error) => {
    h(res, error.statusCode || 502, { error: error.message });
  });
});

function authorizedRobloxServer(req, res) {
  if (!TRACKING_TOKEN) {
    h(res, 503, { error: 'TRACKING_TOKEN not configured on server.' });
    return false;
  }
  if (req.get('x-ubers-token') !== TRACKING_TOKEN) {
    h(res, 401, { error: 'invalid tracking token' });
    return false;
  }
  return true;
}

function allowProfileLookup(req, res) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  if (profileHits.size > 500) {
    for (const [address, hits] of profileHits) {
      if (!hits.length || now - hits[hits.length - 1] >= 60000) profileHits.delete(address);
    }
  }
  const recent = (profileHits.get(ip) || []).filter((time) => now - time < 60000);
  if (recent.length >= 20) {
    h(res, 429, { error: 'Too many profile lookups. Wait a minute and try again.' });
    return false;
  }
  recent.push(now);
  profileHits.set(ip, recent);
  return true;
}

app.get('/api/roblox/dispatch/next', (req, res) => {
  if (!authorizedRobloxServer(req, res)) return;
  try {
    const mapId = String(req.query.map || '');
    h(res, 200, { ride: bookings.nextDispatch(mapId) });
  } catch (error) {
    h(res, error.statusCode || 400, { error: error.message });
  }
});

app.post('/api/roblox/dispatch/claim', (req, res) => {
  if (!authorizedRobloxServer(req, res)) return;
  try {
    const ride = bookings.claimDispatch(
      String(req.body?.reference || ''),
      String(req.body?.mapId || ''),
      String(req.body?.serverId || '')
    );
    return ride ? h(res, 200, { ride }) : h(res, 404, { error: 'Ride is unavailable on this map.' });
  } catch (error) {
    h(res, error.statusCode || 500, { error: error.message });
  }
});

app.post('/api/roblox/dispatch/:reference/status', (req, res) => {
  if (!authorizedRobloxServer(req, res)) return;
  try {
    const booking = bookings.updateDispatch(
      req.params.reference,
      String(req.body?.serverId || ''),
      String(req.body?.status || '')
    );
    return booking ? h(res, 200, { booking }) : h(res, 404, { error: 'Ride assignment not found.' });
  } catch (error) {
    return h(res, error.statusCode || 500, { error: error.message });
  }
});

app.post('/api/bookings/:id/lookup', (req, res) => {
  const booking = bookings.get(req.params.id, req.body?.manageKey);
  return booking ? h(res, 200, { booking }) : h(res, 404, { error: 'Booking not found. Check the reference and management key.' });
});

app.post('/api/bookings/:id/profile', async (req, res) => {
  if (!allowProfileLookup(req, res)) return;
  try {
    const profile = await resolveRobloxProfile(req.body?.username);
    const booking = bookings.setRobloxProfile(req.params.id, req.body?.manageKey, profile);
    return booking ? h(res, 200, { booking }) : h(res, 404, { error: 'Booking not found. Check the reference and management key.' });
  } catch (error) {
    return h(res, error.statusCode || 502, { error: error.message });
  }
});

app.delete('/api/bookings/:id', (req, res) => {
  try {
    const booking = bookings.cancel(req.params.id, req.body?.manageKey);
    return booking ? h(res, 200, { booking }) : h(res, 404, { error: 'Booking not found. Check the reference and management key.' });
  } catch (error) {
    return h(res, error.statusCode || 500, { error: error.message });
  }
});

// ---------- Tracking ----------
app.get('/api/tracking', (req, res) => {
  const mapId = req.query.map ? String(req.query.map) : null;
  const mapKnown = !mapId || Boolean(getMap(mapId));
  h(res, 200, {
    vehicles: mapKnown ? fleet.snapshot(mapId) : [],
    stats: fleet.stats(),
    mapKnown,
    time: Date.now()
  });
});

app.get('/api/tracking/stats', (_req, res) => h(res, 200, fleet.stats()));

app.get('/api/players', (req, res) => {
  const mapId = req.query.map ? String(req.query.map) : null;
  const mapKnown = !mapId || Boolean(getMap(mapId));
  h(res, 200, {
    ...(mapKnown ? players.snapshot(mapId) : { players: [], activeServers: 0, offline: false }),
    mapKnown,
    time: Date.now(),
    ttlMs: players.PLAYER_TTL_MS
  });
});

app.post('/api/players/ping', (req, res) => {
  if (!TRACKING_TOKEN) return h(res, 503, { error: 'TRACKING_TOKEN not configured on server' });
  if ((req.get('x-ubers-token') || req.body?.token) !== TRACKING_TOKEN) {
    return h(res, 401, { error: 'invalid tracking token' });
  }
  try {
    h(res, 200, { ok: true, ...players.reportFromRoblox(req.body, TRACKING_TOKEN) });
  } catch (e) {
    h(res, 400, { ok: false, error: e.message });
  }
});

app.post('/api/tracking/ping', (req, res) => {
  if (!TRACKING_TOKEN) return h(res, 503, { error: 'TRACKING_TOKEN not configured on server' });
  const token = req.get('x-ubers-token') || req.body.token;
  if (token !== TRACKING_TOKEN) return h(res, 401, { error: 'invalid tracking token' });
  try {
    const result = fleet.reportFromRoblox(req.body);
    h(res, 200, { ok: true, ...result });
  } catch (e) {
    h(res, 400, { ok: false, error: e.message });
  }
});

// ---------- Roblox API ----------
const robloxCache = new Map();
const ROBLOX_CACHE_TTL_MS = 30000;
function cacheGet(key, ttl) {
  const hit = robloxCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  return null;
}
function cacheSet(key, data) {
  const now = Date.now();
  for (const [cachedKey, hit] of robloxCache) {
    if (now - hit.at >= 60000) robloxCache.delete(cachedKey);
  }
  while (robloxCache.size >= 256) robloxCache.delete(robloxCache.keys().next().value);
  robloxCache.set(key, { at: now, data });
}

async function robloxGameInfo(placeId) {
  const cacheKey = `game:${placeId}`;
  const cached = cacheGet(cacheKey, 60000);
  if (cached) return cached;

  if (profileGames.FIXTURE) {
    const stub = {
      placeId,
      error: null,
      name: `Fixture game ${placeId}`,
      playing: 0,
      visits: 0,
      favorites: 0,
      maxPlayers: 0,
      votes: { up: 0, down: 0 },
      rating: null
    };
    cacheSet(cacheKey, stub);
    return stub;
  }

  const out = { placeId, error: null };
  try {
    const uniRes = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    if (!uniRes.ok) throw new Error(`universe resolve failed (${uniRes.status})`);
    const { universeId } = await uniRes.json();
    out.universeId = universeId;

    const [gamesRes, votesRes, thumbsRes] = await Promise.all([
      fetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
      fetch(`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`),
      fetch(
        `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`
      )
    ]);
    if (gamesRes.ok) {
      const g = (await gamesRes.json()).data?.[0];
      if (g) {
        out.name = g.name;
        out.playing = g.playing;
        out.visits = g.visits;
        out.favorites = g.favoritedCount;
        out.maxPlayers = g.maxPlayers;
        out.created = g.created;
        out.updated = g.updated;
        out.genre = g.genre;
        out.description = (g.description || '').slice(0, 300);
      }
    }
    if (votesRes.ok) {
      const v = (await votesRes.json()).data?.[0];
      if (v) {
        out.votes = { up: v.upVotes, down: v.downVotes };
        out.rating = v.upVotes + v.downVotes > 0
          ? Math.round((v.upVotes / (v.upVotes + v.downVotes)) * 1000) / 10
          : null;
      }
    }
    if (thumbsRes.ok) {
      const t = (await thumbsRes.json()).data?.[0];
      if (t && t.imageUrl) out.icon = t.imageUrl;
    }
  } catch (e) {
    out.error = e.message;
  }
  cacheSet(cacheKey, out);
  return out;
}

const robloxProfiles = new Map();
const profileHits = new Map();

async function resolveRobloxProfile(username) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    const error = new Error('Enter a Roblox username between 3 and 20 letters, numbers, or underscores.');
    error.statusCode = 400;
    throw error;
  }
  const cacheKey = username.toLowerCase();
  const cached = robloxProfiles.get(cacheKey);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.profile;
  const user = await (async () => {
    const response = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`Roblox profile lookup failed (${response.status}).`);
    const result = await response.json();
    return result.data?.[0] || null;
  })();
  if (!user) {
    const error = new Error('Roblox username not found.');
    error.statusCode = 404;
    throw error;
  }

  let description = '';
  let isBanned = false;
  try {
    const response = await fetch(`https://users.roblox.com/v1/users/${encodeURIComponent(user.id)}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (response.ok) {
      const details = await response.json();
      description = typeof details.description === 'string' ? details.description.slice(0, 300) : '';
      isBanned = details.isBanned === true;
    }
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
  }

  let avatarUrl = null;
  try {
    const response = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${encodeURIComponent(user.id)}&size=150x150&format=Png&isCircular=false`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (response.ok) avatarUrl = (await response.json()).data?.[0]?.imageUrl || null;
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
  }

  const profile = {
    userId: user.id,
    username: user.name,
    displayName: user.displayName,
    description,
    isBanned,
    avatarUrl,
    profileUrl: `https://www.roblox.com/users/${encodeURIComponent(user.id)}/profile`
  };
  if (robloxProfiles.size >= 256) robloxProfiles.delete(robloxProfiles.keys().next().value);
  robloxProfiles.set(cacheKey, { at: Date.now(), profile });
  return profile;
}

app.post('/api/roblox/profile', async (req, res) => {
  if (!allowProfileLookup(req, res)) return;
  try {
    h(res, 200, { profile: await resolveRobloxProfile(req.body?.username) });
  } catch (error) {
    h(res, error.statusCode || 502, { error: error.message });
  }
});

app.get('/api/roblox/games', async (req, res) => {
  const maps = configuredMaps().filter((map) => map.placeId !== null);
  const allowed = new Map(maps.map((map) => [String(map.placeId), map]));
  const requestedIds = String(req.query.placeIds || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (requestedIds.some((placeId) => !/^\d{1,20}$/.test(placeId) || !allowed.has(placeId))) {
    return h(res, 400, { error: 'placeIds must match configured UBERS map places' });
  }
  const selectedMaps = requestedIds.length
    ? [...new Set(requestedIds)].map((placeId) => allowed.get(placeId))
    : maps;
  const games = await Promise.all(selectedMaps.map(async (map) => {
    const game = await robloxGameInfo(String(map.placeId));
    return {
      ...game,
      mapId: map.id,
      name: map.ownerManaged ? map.name : game.name,
      ownerManaged: map.ownerManaged
    };
  }));
  h(res, 200, {
    games,
    setupRequired: maps.length === 0,
    message: maps.length === 0
      ? 'Configure your own Roblox place IDs in .env to enable game stats, joins, and NPC dispatch. Official third-party game links are disabled.'
      : undefined
  });
});

app.get('/api/roblox/servers', async (req, res) => {
  const placeId = String(req.query.placeId || '');
  if (!/^\d{1,20}$/.test(placeId) || !configuredMaps().some((map) => String(map.placeId) === placeId)) {
    return h(res, 400, { error: 'placeId must match a configured game map' });
  }
  const cursor = String(req.query.cursor || '');
  if (cursor.length > 4096) return h(res, 400, { error: 'cursor is too long' });
  const cursorKey = crypto.createHash('sha256').update(cursor).digest('hex').slice(0, 16);
  const cacheKey = `servers:${placeId}:${cursorKey}`;
  const cached = cacheGet(cacheKey, ROBLOX_CACHE_TTL_MS);
  if (cached) return h(res, 200, cached);

  try {
    const url = new URL(`https://games.roblox.com/v1/games/${placeId}/servers/Public`);
    url.searchParams.set('sortOrder', 'Desc');
    url.searchParams.set('limit', '100');
    url.searchParams.set('excludeFullGames', 'false');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Roblox public servers API returned ${response.status}`);
    const result = await response.json();
    const servers = (Array.isArray(result.data) ? result.data : [])
      .filter((server) => typeof server.id === 'string' && Number.isFinite(server.playing))
      .map((server) => ({
        id: server.id,
        playing: server.playing,
        maxPlayers: Number.isFinite(server.maxPlayers) ? server.maxPlayers : null,
        fps: Number.isFinite(server.fps) ? server.fps : null,
        ping: Number.isFinite(server.ping) ? server.ping : null
      }));
    const data = {
      placeId: Number(placeId),
      servers,
      sampledServers: servers.length,
      sampledPlayers: servers.reduce((sum, server) => sum + server.playing, 0),
      nextCursor: typeof result.nextPageCursor === 'string' ? result.nextPageCursor : null,
      updatedAt: Date.now()
    };
    cacheSet(cacheKey, data);
    h(res, 200, data);
  } catch (error) {
    h(res, 502, { error: error.message });
  }
});

app.get('/api/roblox/key-status', async (_req, res) => {
  const configured = hasKey('ROBLOX_API_KEY');
  if (!configured) {
    return h(res, 200, { configured: false, ok: false, message: 'Add ROBLOX_API_KEY to .env (Create > Credentials).' });
  }
  const universeId = process.env.ROBLOX_UBERS_UNIVERSE_ID || configuredMaps()[0]?.universeId;
  try {
    const url = universeId
      ? `https://apis.roblox.com/cloud/v2/universes/${universeId}`
      : 'https://apis.roblox.com/cloud/v2/users/1';
    const r = await fetch(url, { headers: { 'x-api-key': process.env.ROBLOX_API_KEY } });
    h(res, 200, {
      configured: true,
      ok: r.ok,
      status: r.status,
      message: r.ok
        ? 'Roblox Open Cloud key is valid.'
        : `Roblox API replied ${r.status} - check the key scopes (universes.read / datastore.read).`
    });
  } catch (e) {
    h(res, 200, { configured: true, ok: false, message: e.message });
  }
});

// ---------- OpenRouter AI support ----------
const aiHits = new Map();
function rateLimit(ip, max = 20, windowMs = 60000) {
  const now = Date.now();
  const arr = (aiHits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  aiHits.set(ip, arr);
  return true;
}

const SYSTEM_PROMPT = [
  'You are the support assistant for ROBLOX UBERS, an app that turns Roblox profile games into live ride maps.',
  'Every map is generated from a Roblox profile\'s public games (searchable in the Profile Games bar on the Live Map).',
  'You can track cars, buses and taxis on the Live Map, connect to FREE WiFi hotspots on the map,',
  'and subscribe to UBERS Premium with Stripe.',
  'Keep answers short, friendly and under 120 words. If asked about a specific vehicle, tell the user to open the Live Map tab.',
  'Never reveal API keys or secrets. If you do not know something, say so and offer the contact email support@robloxubers.app.'
].join(' ');

app.post('/api/ai/chat', async (req, res) => {
  if (!rateLimit(req.ip)) return h(res, 429, { error: 'Too many messages, wait a minute.' });
  if (!hasKey('OPENROUTER_API_KEY')) return h(res, 503, { error: 'OPENROUTER_API_KEY not configured.' });

  const incoming = Array.isArray(req.body.messages) ? req.body.messages : [];
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...incoming
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
  ];
  if (!messages.some((m) => m.role === 'user')) return h(res, 400, { error: 'No user message provided.' });

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': BASE_URL,
        'X-Title': 'ROBLOX UBERS Support'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
        messages,
        max_tokens: 400,
        temperature: 0.6
      })
    });
    const data = await r.json();
    if (!r.ok) {
      return h(res, 502, { error: data?.error?.message || `OpenRouter error ${r.status}` });
    }
    const reply = data.choices?.[0]?.message?.content || 'Sorry, I did not get a reply. Try again.';
    h(res, 200, { reply, model: data.model });
  } catch (e) {
    h(res, 502, { error: e.message });
  }
});

// ---------- Stripe ----------
const PLANS = {
  rider: { name: 'UBERS Premium - Rider', amount: 499, desc: 'Priority tracking, no ads, ETA alerts' },
  driver: { name: 'UBERS Premium - Driver', amount: 999, desc: 'List your Roblox vehicle, AI dispatch, payouts-ready' },
  fleet: { name: 'UBERS Fleet', amount: 2999, desc: 'Up to 50 vehicles, webhooks, API access' }
};

app.get('/api/billing/plans', (_req, res) => {
  const currency = (process.env.STRIPE_CURRENCY || 'usd').toUpperCase();
  h(res, 200, {
    currency,
    checkoutEnabled: Boolean(stripe),
    checkoutMode: 'payment',
    plans: Object.entries(PLANS).map(([id, p]) => ({
      id,
      name: p.name,
      desc: p.desc,
      amount: p.amount,
      display: `${currency === 'USD' ? '$' : ''}${(p.amount / 100).toFixed(2)}${currency === 'USD' ? '' : ' ' + currency}`
    }))
  });
});

app.post('/api/billing/checkout', async (req, res) => {
  if (!stripe) return h(res, 503, { error: 'Stripe Checkout is unavailable: configure STRIPE_SECRET_KEY on the server. A publishable pk_ key cannot create Checkout sessions.' });
  const plan = PLANS[req.body?.plan];
  if (!plan) return h(res, 400, { error: 'Choose a valid Premium plan.' });
  const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${BASE_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/?checkout=cancelled`,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: plan.amount,
            product_data: { name: plan.name, description: plan.desc }
          }
        }
      ],
      metadata: { plan: req.body.plan, source: 'roblox-ubers' }
    });
    h(res, 200, { url: session.url, id: session.id });
  } catch (e) {
    const msg = String(e.message || '');
    const lowerMessage = msg.toLowerCase();
    const setupRequired = [
      'payment method types',
      'no such account',
      'not activated',
      'onboard',
      'business_profile.url',
      'company.registration_number',
      'company.tax_id',
      'external_account',
      'tos_acceptance'
    ].some((marker) => lowerMessage.includes(marker));
    h(res, setupRequired ? 503 : 502, {
      error: setupRequired
        ? 'Stripe Checkout is disabled because the account still needs onboarding details. The account owner must provide accurate business profile, registration/tax ID, payout account, and terms acceptance information at https://dashboard.stripe.com/get-started. UBERS cannot supply or bypass these requirements.'
        : msg,
      setupRequired: Boolean(setupRequired)
    });
  }
});

app.get('/api/billing/session', async (req, res) => {
  if (!stripe) return h(res, 503, { error: 'STRIPE_SECRET_KEY not configured.' });
  try {
    const s = await stripe.checkout.sessions.retrieve(String(req.query.session_id || ''));
    h(res, 200, {
      id: s.id,
      status: s.status,
      paid: s.payment_status === 'paid',
      amountTotal: s.amount_total,
      currency: s.currency
    });
  } catch (e) {
    h(res, 502, { error: e.message });
  }
});

// ---------- Free WiFi ----------
const wifiSessions = new Map();

app.get('/api/wifi/hotspots', async (_req, res) => {
  await ensureMaps();
  const hotspots = configuredMaps().flatMap((m) =>
    (m.pois || []).filter((p) => p.cat === 'wifi').map((p) => ({ ...p, map: m.id, mapName: m.name }))
  );
  h(res, 200, { hotspots, free: true, speed: '100 Mbps', note: 'Free WiFi for all ROBLOX UBERS riders.' });
});

app.post('/api/wifi/connect', async (req, res) => {
  await ensureMaps();
  const hotspotId = String(req.body?.hotspotId || 'wifi-hub');
  const device = String(req.body?.device || 'device').slice(0, 64);
  const maps = configuredMaps();
  const map = maps.find((m) => (m.pois || []).some((p) => p.id === hotspotId)) || maps[0];
  if (!map) return h(res, 404, { error: 'No profile-game maps are loaded yet.' });
  const code = 'UBERS-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const record = {
    code,
    hotspotId,
    map: map.id,
    device,
    connectedAt: Date.now(),
    expiresAt: Date.now() + 30 * 60 * 1000
  };
  wifiSessions.set(code, record);
  h(res, 200, { ok: true, ...record, message: 'Connected to ROBLOX UBERS Free WiFi' });
});

app.get('/api/wifi/status', (req, res) => {
  const rec = wifiSessions.get(String(req.query.code || ''));
  if (!rec) return h(res, 404, { error: 'Unknown code' });
  h(res, 200, { ...rec, active: rec.expiresAt > Date.now() });
});

// ---------- SPA fallback ----------
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`ROBLOX UBERS running on ${BASE_URL}`);
  if (process.pkg && process.platform === 'win32' && !process.env.UBERS_NO_BROWSER) {
    execFile('rundll32.exe', ['url.dll,FileProtocolHandler', `http://localhost:${PORT}`], (error) => {
      if (error) console.error(`Could not open your browser. Visit http://localhost:${PORT}`);
    });
  }
  console.log(
    `Integrations: openrouter=${hasKey('OPENROUTER_API_KEY')} stripe=${hasKey(
      'STRIPE_SECRET_KEY'
    )} robloxKey=${hasKey('ROBLOX_API_KEY')} tracking=${Boolean(TRACKING_TOKEN)}`
  );

  // Profile Games: load the default profile's games as maps, then keep them fresh.
  try {
    const data = await ensureMaps();
    console.log(
      data
        ? `Profile Games: ${data.games.length} game map(s) from @${data.profile.username}`
        : `Profile Games: no ROBLOX_PROFILE_USERNAME configured - load one from the site.`
    );
  } catch (error) {
    console.error(`Profile Games refresh failed: ${error.message}`);
  }
  setInterval(() => {
    ensureMaps().catch((error) => console.error(`Profile Games refresh failed: ${error.message}`));
  }, 5 * 60 * 1000);
});
