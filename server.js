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

const { MAPS, getMap } = require('./lib/maps');
const fleet = require('./lib/fleet');
const players = require('./lib/players');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const TRACKING_TOKEN =
  process.env.TRACKING_TOKEN === 'change-me-to-a-long-random-string'
    ? ''
    : process.env.TRACKING_TOKEN || '';
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

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
    time: new Date().toISOString(),
    integrations: {
      openrouter: hasKey('OPENROUTER_API_KEY'),
      stripe: hasKey('STRIPE_SECRET_KEY'),
      robloxApiKey: hasKey('ROBLOX_API_KEY'),
      trackingToken: Boolean(TRACKING_TOKEN),
      playerTracking: Boolean(TRACKING_TOKEN)
    }
  })
);

// ---------- Maps ----------
app.get('/api/maps', (_req, res) => h(res, 200, { maps: Object.values(MAPS) }));
app.get('/api/maps/:id', (req, res) => {
  const map = getMap(req.params.id);
  return map ? h(res, 200, map) : h(res, 404, { error: 'map not found' });
});

// ---------- Tracking ----------
app.get('/api/tracking', (req, res) => {
  const mapId = req.query.map ? String(req.query.map) : null;
  if (mapId && !getMap(mapId)) return h(res, 404, { error: 'map not found' });
  h(res, 200, { vehicles: fleet.snapshot(mapId), stats: fleet.stats(), time: Date.now() });
});

app.get('/api/tracking/stats', (_req, res) => h(res, 200, fleet.stats()));

app.get('/api/players', (req, res) => {
  const mapId = req.query.map ? String(req.query.map) : null;
  if (mapId && !getMap(mapId)) return h(res, 404, { error: 'map not found' });
  h(res, 200, { ...players.snapshot(mapId), time: Date.now(), ttlMs: players.PLAYER_TTL_MS });
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
function cacheGet(key, ttl) {
  const hit = robloxCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  return null;
}
function cacheSet(key, data) {
  robloxCache.set(key, { at: Date.now(), data });
}

async function robloxGameInfo(placeId) {
  const cacheKey = `game:${placeId}`;
  const cached = cacheGet(cacheKey, 60000);
  if (cached) return cached;

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

app.get('/api/roblox/games', async (req, res) => {
  const ids = String(req.query.placeIds || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  const finalIds = ids.length ? ids : Object.values(MAPS).map((m) => m.placeId);
  const games = await Promise.all(finalIds.map(robloxGameInfo));
  h(res, 200, { games });
});

app.get('/api/roblox/key-status', async (_req, res) => {
  const configured = hasKey('ROBLOX_API_KEY');
  if (!configured) {
    return h(res, 200, { configured: false, ok: false, message: 'Add ROBLOX_API_KEY to .env (Create > Credentials).' });
  }
  const universeId = process.env.ROBLOX_UNIVERSE_ID_BROOKHAVEN;
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
  'You are the official support assistant for ROBLOX UBERS, a live vehicle tracking website for Roblox roleplay games',
  '(Brookhaven RP and Welcome to Bloxburg).',
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
  if (!stripe) return h(res, 503, { error: 'STRIPE_SECRET_KEY not configured.' });
  const plan = PLANS[req.body?.plan] || PLANS.rider;
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
    const setupRequired = msg.includes('payment method types') || msg.includes('No such account');
    h(res, setupRequired ? 503 : 502, {
      error: setupRequired
        ? 'Stripe account not activated yet. Finish onboarding at https://dashboard.stripe.com/get-started then try again.'
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

app.get('/api/wifi/hotspots', (_req, res) => {
  const hotspots = Object.values(MAPS).flatMap((m) =>
    m.pois.filter((p) => p.cat === 'wifi').map((p) => ({ ...p, map: m.id, mapName: m.name }))
  );
  h(res, 200, { hotspots, free: true, speed: '100 Mbps', note: 'Free WiFi for all ROBLOX UBERS riders.' });
});

app.post('/api/wifi/connect', (req, res) => {
  const hotspotId = String(req.body?.hotspotId || 'wifi-downtown');
  const device = String(req.body?.device || 'device').slice(0, 64);
  const map = Object.values(MAPS).find((m) => m.pois.some((p) => p.id === hotspotId)) || MAPS.brookhaven;
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

app.listen(PORT, () => {
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
});
