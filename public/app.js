// ROBLOX UBERS - frontend
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NS = 'http://www.w3.org/2000/svg';

const state = {
  maps: {},
  mapId: 'brookhaven',
  vehicles: [],
  players: [],
  playerServers: 0,
  filter: 'all',
  search: '',
  selected: null,
  wifiFilterOn: false
};

const ICON = { car: '🚗', bus: '🚌', taxi: '🚕' };
const TYPE_COLOR = { car: '#ef5da8', bus: '#4dd2ff', taxi: '#ffd166' };

async function api(path, opts = {}) {
  const apiBase = window.UBERS_API_BASE_URL || '';
  if (window.UBERS_STATIC_MODE && !apiBase) return staticApi(path, opts);
  const tunnelHeaders = apiBase.includes('.trycloudflare.com') ? { 'cf-skip-browser-warning': '1' } : {};
  const res = await fetch(`${apiBase}${path}`, {
    headers: { 'Content-Type': 'application/json', ...tunnelHeaders },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function staticApi(path, opts = {}) {
  const url = new URL(path, location.href);
  const method = (opts.method || 'GET').toUpperCase();
  const { maps } = window.UBERS_STATIC_DATA;
  const statsFor = (items) => ({
    total: items.length,
    cars: items.filter((v) => v.type === 'car').length,
    buses: items.filter((v) => v.type === 'bus').length,
    taxis: items.filter((v) => v.type === 'taxi').length,
    live: items.length,
    external: 0,
    updatedAt: Date.now()
  });

  if (url.pathname.endsWith('/api/maps') && method === 'GET') return { maps };
  if (url.pathname.endsWith('/api/tracking') && method === 'GET') {
    return { vehicles: [], stats: statsFor([]), time: Date.now(), offline: true };
  }
  if (url.pathname.endsWith('/api/players') && method === 'GET') {
    return { players: [], activeServers: 0, updatedAt: Date.now(), offline: true };
  }
  if (url.pathname.endsWith('/api/health') && method === 'GET') {
    return { ok: false, name: 'ROBLOX UBERS', integrations: {}, staticMode: true, offline: true };
  }
  if (url.pathname.endsWith('/api/wifi/hotspots') && method === 'GET') {
    const hotspots = maps.flatMap((map) => map.pois
      .filter((poi) => poi.cat === 'wifi')
      .map((poi) => ({ ...poi, map: map.id, mapName: map.name })));
    return { hotspots, free: true, speed: '100 Mbps', note: 'Demo only: this site does not provide an internet connection.' };
  }
  if (url.pathname.endsWith('/api/wifi/connect') && method === 'POST') {
    throw new Error('WiFi access codes need the connected UBERS server.');
  }
  if (url.pathname.endsWith('/api/wifi/status') && method === 'GET') {
    throw new Error('WiFi status needs the connected UBERS server.');
  }
  if (url.pathname.endsWith('/api/billing/plans') && method === 'GET') {
    const plans = [
      { id: 'rider', name: 'UBERS Premium - Rider', desc: 'Priority tracking, no ads, ETA alerts', amount: 499, display: '$4.99' },
      { id: 'driver', name: 'UBERS Premium - Driver', desc: 'List your Roblox vehicle, AI dispatch, payouts-ready', amount: 999, display: '$9.99' },
      { id: 'fleet', name: 'UBERS Fleet', desc: 'Up to 50 vehicles, webhooks, API access', amount: 2999, display: '$29.99' }
    ];
    return { currency: 'USD', plans };
  }
  if (url.pathname.endsWith('/api/roblox/games') && method === 'GET') {
    return { games: maps.map((map) => ({ placeId: map.placeId, name: map.name, error: 'Connect the Playit HTTPS server to load live Roblox data.' })) };
  }
  if (url.pathname.endsWith('/api/roblox/servers') && method === 'GET') {
    throw new Error('Live servers need the connected Playit HTTPS server.');
  }
  if (url.pathname.endsWith('/api/roblox/key-status') && method === 'GET') {
    return { configured: false, ok: false, message: 'Open the Windows app with a configured server to check an Open Cloud key.' };
  }
  throw new Error('This feature needs the Windows app and a running server.');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.hidden = true), 3500);
}

function fmt(n) {
  if (n == null) return '-';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

/* ---------------- views ---------------- */
$$('#tabs .tab').forEach((btn) =>
  btn.addEventListener('click', () => {
    location.hash = btn.dataset.view;
    activateView(btn.dataset.view);
    if (btn.dataset.view === 'ai') $('#chatInput').focus();
  })
);

/* ---------------- map ---------------- */
function el(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}

function renderMap() {
  const svg = $('#mapSvg');
  const map = state.maps[state.mapId];
  if (!map) return;
  svg.innerHTML = '';

  const defs = el('defs');
  const pat = el('pattern', { id: 'grid', width: 50, height: 50, patternUnits: 'userSpaceOnUse' });
  pat.appendChild(el('path', { d: 'M50 0H0V50', fill: 'none', stroke: '#16203a', 'stroke-width': 1 }));
  defs.appendChild(pat);
  svg.appendChild(defs);

  svg.appendChild(el('rect', { x: 0, y: 0, width: 1000, height: 1000, fill: '#0a1020' }));
  svg.appendChild(el('rect', { x: 0, y: 0, width: 1000, height: 1000, fill: 'url(#grid)' }));

  const zones = el('g');
  map.zones.forEach((z) => {
    zones.appendChild(el('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 18, fill: z.color, opacity: 0.55, stroke: '#2b3d63' }));
    zones.appendChild(el('text', { x: z.x + 12, y: z.y + 24, class: 'zone-label' }, z.label));
  });
  svg.appendChild(zones);

  const water = el('g');
  map.water.forEach((w) => water.appendChild(el('rect', { x: w.x, y: w.y, width: w.w, height: w.h, fill: '#0f3c58', opacity: 0.85 })));
  svg.appendChild(water);

  const routes = el('g', { id: 'routesLayer' });
  map.routes.forEach((r) => {
    const d = r.stops.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
    routes.appendChild(el('path', { d, class: 'route-line', stroke: r.color }));
  });
  svg.appendChild(routes);

  const pois = el('g', { id: 'poiLayer' });
  map.pois.forEach((p) => {
    const g = el('g', { class: 'poi-dot', 'data-cat': p.cat, 'data-id': p.id });
    const isWifi = p.cat === 'wifi';
    g.appendChild(
      el('circle', {
        cx: p.x, cy: p.y, r: isWifi ? 10 : 7,
        fill: isWifi ? '#3ddc97' : catColor(p.cat),
        stroke: '#04121c', 'stroke-width': 2
      })
    );
    if (!isWifi) {
      g.appendChild(el('text', { x: p.x + 12, y: p.y + 5, class: 'poi-label' }, p.name));
    } else {
      g.appendChild(el('text', { x: p.x + 14, y: p.y + 5, class: 'poi-label' }, '📶 WiFi · ' + p.name.replace('FREE WIFI - ', '')));
    }
    g.addEventListener('click', () => {
      if (isWifi) {
        activateView('wifi', p.id);
      } else {
        toast(`${p.name} · ${map.name}`);
      }
    });
    pois.appendChild(g);
  });
  svg.appendChild(pois);
  svg.appendChild(el('g', { id: 'vehicleLayer' }));
  svg.appendChild(el('g', { id: 'playerLayer' }));

  $('#mapLegend').innerHTML =
    `<span><b>${map.name}</b></span>` +
    `<span>🚗 car</span><span>🚌 bus</span><span>🚕 taxi</span><span>📶 free wifi</span>` +
    `<span>${map.routes.length} routes</span><span>${map.pois.length} POIs</span>`;

  drawVehicles();
  drawPlayers();
}

function catColor(cat) {
  return { landmark: '#a78bfa', medical: '#ff6b6b', service: '#4dd2ff', school: '#f9a825', shop: '#3ddc97', transport: '#ffd166', fun: '#ef5da8', job: '#7dd3fc' }[cat] || '#8b9bb8';
}

function matches(v) {
  if (state.wifiFilterOn) return false;
  if (state.filter !== 'all' && v.type !== state.filter) return false;
  const q = state.search.toLowerCase();
  if (!q) return true;
  return [v.plate, v.driver, v.routeName, v.type, v.id].join(' ').toLowerCase().includes(q);
}

function drawVehicles() {
  const layer = $('#vehicleLayer');
  if (!layer) return;
  const map = state.maps[state.mapId];
  const wanted = new Set();

  state.vehicles.filter((v) => v.map === state.mapId).forEach((v) => {
    if (!matches(v)) return;
    wanted.add(v.id);
    let g = layer.querySelector(`[data-vid="${cssEsc(v.id)}"]`);
    if (!g) {
      g = el('g', { class: 'veh', 'data-vid': v.id });
      g.appendChild(el('circle', { class: 'ring', r: 17 }));
      const rot = el('g', { class: 'rot' });
      rot.appendChild(el('rect', { class: 'body', x: -14, y: -10, width: 28, height: 20, rx: 7, fill: TYPE_COLOR[v.type] || '#fff' }));
      rot.appendChild(el('text', { x: 0, y: 5, 'text-anchor': 'middle' }, ICON[v.type] || '🚗'));
      g.appendChild(rot);
      const plateG = el('g', { class: 'plate', visibility: 'hidden' });
      const w = v.plate.length * 7 + 12;
      plateG.appendChild(el('rect', { x: -w / 2, y: 16, width: w, height: 16, rx: 8, fill: '#04121c', stroke: TYPE_COLOR[v.type] || '#fff', 'stroke-width': 1.5 }));
      plateG.appendChild(el('text', { x: 0, y: 28, 'text-anchor': 'middle', fill: '#e6edf7', 'font-size': 11, 'font-weight': 700 }, v.plate));
      g.appendChild(plateG);
      g.addEventListener('click', (e) => { e.stopPropagation(); selectVehicle(v.id); });
      layer.appendChild(g);
    }
    const deg = Number.isFinite(v.heading) ? v.heading : 0;
    g.setAttribute('transform', `translate(${v.x},${v.y})`);
    g.querySelector('.rot').setAttribute('transform', `rotate(${deg})`);
    g.querySelector('.plate').setAttribute('visibility', state.selected === v.id ? 'visible' : 'hidden');
    g.classList.toggle('sel', state.selected === v.id);
    g.style.opacity = v.external ? '1' : '0.97';
  });

  [...layer.children].forEach((c) => {
    if (!wanted.has(c.dataset.vid)) c.remove();
  });

  if (state.wifiFilterOn) {
    $$('#poiLayer .poi-dot').forEach((p) => { p.style.opacity = p.dataset.cat === 'wifi' ? '1' : '0.15'; });
  } else {
    $$('#poiLayer .poi-dot').forEach((p) => { p.style.opacity = '1'; });
  }
  renderList();
}

function drawPlayers() {
  const layer = $('#playerLayer');
  if (!layer) return;
  layer.innerHTML = '';
  const players = state.players.filter((p) => p.map === state.mapId);
  players.forEach((p, i) => {
    const dot = el('g', {
      class: 'player-dot',
      transform: `translate(${p.x},${p.y})`,
      'aria-label': `Anonymous player ${i + 1}`
    });
    dot.appendChild(el('circle', { class: 'halo', r: 13 }));
    dot.appendChild(el('circle', { class: 'core', r: 5 }));
    layer.appendChild(dot);
  });
}

function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

function renderList() {
  const list = state.vehicles.filter((v) => v.map === state.mapId && matches(v));
  $('#fleetCount').textContent = list.length;
  const box = $('#vehicleList');
  box.innerHTML = '';
  list.forEach((v) => {
    const row = document.createElement('div');
    row.className = 'vrow' + (state.selected === v.id ? ' sel' : '');
    row.innerHTML = `
      <span class="ico">${ICON[v.type]}</span>
      <span><span class="nm">${v.plate}</span><br><span class="sub">${v.driver} · ${v.routeName}</span></span>
      <span class="eta">ETA ${v.eta} min<br><span class="sub">${v.external ? 'ROBLOX LIVE' : v.status === 'enroute' ? 'en route' : 'idle'}</span></span>`;
    row.addEventListener('click', () => selectVehicle(v.id));
    box.appendChild(row);
  });
  const s = state.vehicles.filter((v) => v.map === state.mapId && matches(v));
  const by = (t) => s.filter((v) => v.type === t).length;
  const players = state.players.filter((p) => p.map === state.mapId);
  const playerLabel = `${players.length} mapped players · ${state.playerServers} reporting servers`;
  $('#mapStats').textContent = `${by('car')} cars · ${by('bus')} buses · ${by('taxi')} taxis · ${playerLabel} · updated ${new Date().toLocaleTimeString()}`;
  renderPlayers();
}

function renderPlayers() {
  const players = state.players.filter((p) => p.map === state.mapId);
  $('#playerCount').textContent = players.length;
  $('#playerList').replaceChildren();
  players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    const name = document.createElement('span');
    name.textContent = `${state.playerDemo ? 'Demo' : 'Anonymous'} player ${String(i + 1).padStart(2, '0')}`;
    const position = document.createElement('b');
    position.textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
    row.append(name, position);
    $('#playerList').appendChild(row);
  });
  const status = $('#playerStatus');
  if (state.playerOffline) {
    status.textContent = 'Live data is not connected. Configure the Playit HTTPS API URL.';
  } else if (players.length) {
    status.textContent = `LIVE · ${state.playerServers} connected game server${state.playerServers === 1 ? '' : 's'} · refreshes every 2s`;
  } else {
    status.textContent = 'No position reports received. Public Roblox server counts are shown in the Roblox API tab.';
  }
}

function selectVehicle(id) {
  state.selected = id;
  const v = state.vehicles.find((x) => x.id === id);
  const card = $('#selectedCard');
  if (!v) { card.innerHTML = '<p class="muted">Tap a vehicle to see details.</p>'; return; }
  card.innerHTML = `
    <h4>${ICON[v.type]} ${v.plate} <span class="badge">${v.external ? 'ROBLOX LIVE' : 'UBERS'}</span></h4>
    <div class="kv"><span>Driver</span><b>${v.driver}</b></div>
    <div class="kv"><span>Route</span><b>${v.routeName}</b></div>
    <div class="kv"><span>Type</span><b>${v.type.toUpperCase()}</b></div>
    <div class="kv"><span>ETA end of route</span><b>${v.eta} min</b></div>
    <div class="kv"><span>Rating</span><b>★ ${v.rating}</b></div>
    <div class="kv"><span>Position</span><b>${Math.round(v.x)}, ${Math.round(v.y)}</b></div>`;
  drawVehicles();
}

$$('#mapSwitch .seg-btn').forEach((b) =>
  b.addEventListener('click', () => {
    $$('#mapSwitch .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    state.mapId = b.dataset.map;
    state.selected = null;
    renderMap();
    pollTracking();
  })
);

$$('#filters .chip').forEach((b) =>
  b.addEventListener('click', () => {
    $$('#filters .chip').forEach((x) => x.classList.toggle('active', x === b));
    state.filter = b.dataset.type;
    state.wifiFilterOn = state.filter === 'wifi';
    drawVehicles();
  })
);

$('#vehicleSearch').addEventListener('input', (e) => { state.search = e.target.value; drawVehicles(); });

/* ---------------- tracking ---------------- */
async function pollTracking() {
  try {
    const data = await api(`/api/tracking?map=${state.mapId}`);
    state.vehicles = data.vehicles;
    drawVehicles();
    $('#pillFleet').textContent = `FLEET ${data.stats.total}`;
    $('#footStats').textContent = `${data.stats.cars} cars · ${data.stats.buses} buses · ${data.stats.taxis} taxis · ${data.stats.external} from Roblox`;
    if (data.offline) {
      $('#pillLive').textContent = '● API NOT CONNECTED';
      $('#pillLive').classList.remove('live');
    }
  } catch (e) {
    $('#pillLive').textContent = '● OFFLINE';
    $('#pillLive').classList.remove('live');
  }
  await pollPlayers();
}

async function pollPlayers() {
  try {
    const data = await api(`/api/players?map=${state.mapId}`);
    state.players = data.players.map((p) => ({ ...p, map: state.mapId }));
    state.playerServers = data.activeServers || 0;
    state.playerOffline = Boolean(data.offline);
    drawPlayers();
    renderPlayers();
    $('#pillPlayers').textContent = state.playerOffline
      ? '● API NOT CONNECTED'
      : state.players.length ? `● ${state.players.length} PLAYERS` : '● WAITING FOR ROBLOX';
    $('#pillPlayers').classList.toggle('live', !state.playerOffline && state.players.length > 0);
  } catch (e) {
    $('#playerStatus').textContent = `Player feed unavailable: ${e.message}`;
    $('#pillPlayers').textContent = '● PLAYER FEED ERROR';
    $('#pillPlayers').classList.remove('live');
  }
}

/* ---------------- wifi ---------------- */
async function loadWifi(preselect) {
  try {
    const { hotspots } = await api('/api/wifi/hotspots');
    const grid = $('#wifiGrid');
    grid.innerHTML = '';
    hotspots.forEach((h) => {
      const card = document.createElement('div');
      card.className = 'card hot';
      card.innerHTML = `
        <div class="top"><b>📶 ${h.name.replace('FREE WIFI - ', '')}</b><span class="badge">FREE</span></div>
        <span class="muted">${h.mapName}</span>
        <span class="muted">100 Mbps · 30 min session</span>
        <button class="btn" data-hs="${h.id}">Connect</button>`;
      card.querySelector('button').addEventListener('click', () => connectWifi(h));
      grid.appendChild(card);
      if (preselect === h.id) connectWifi(h);
    });
  } catch (e) { toast(e.message); }
}

async function connectWifi(h) {
  try {
    const data = await api('/api/wifi/connect', { method: 'POST', body: { hotspotId: h.id, device: navigator.userAgent.slice(0, 60) } });
    $('#wifiTicket').hidden = false;
    $('#wifiCode').textContent = data.code;
    $('#wifiMeta').textContent = `${h.name} · expires ${new Date(data.expiresAt).toLocaleTimeString()}${window.UBERS_STATIC_MODE ? ' · demo code only; no internet access' : ''}`;
    $('#wifiTicket').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(window.UBERS_STATIC_MODE ? 'Demo access code created' : 'Connected to ROBLOX UBERS Free WiFi');
  } catch (e) { toast(e.message); }
}

$('#wifiCheckBtn').addEventListener('click', async () => {
  try {
    const code = $('#wifiCheckInput').value.trim();
    const d = await api(`/api/wifi/status?code=${encodeURIComponent(code)}`);
    $('#wifiCheckResult').textContent = d.active
      ? `ACTIVE until ${new Date(d.expiresAt).toLocaleTimeString()} at ${d.hotspotId}`
      : 'Expired - connect again for a new code.';
  } catch (e) { $('#wifiCheckResult').textContent = e.message; }
});

/* ---------------- AI chat ---------------- */
function addMsg(text, cls) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.textContent = text;
  $('#chatLog').appendChild(d);
  $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
  return d;
}

const chatHistory = [];
async function sendChat(text) {
  if (!text.trim()) return;
  addMsg(text, 'user');
  chatHistory.push({ role: 'user', content: text });
  const pend = addMsg('Thinking...', 'bot');
  try {
    const data = await api('/api/ai/chat', { method: 'POST', body: { messages: chatHistory.slice(-10) } });
    pend.textContent = data.reply;
    chatHistory.push({ role: 'assistant', content: data.reply });
    if (data.model) $('#aiModel').textContent = data.model;
  } catch (e) {
    pend.remove();
    addMsg('AI unavailable: ' + e.message, 'err');
  }
}

$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chatInput');
  sendChat(input.value);
  input.value = '';
});
$$('#quickAsks .chip').forEach((c) => c.addEventListener('click', () => sendChat(c.textContent)));

/* ---------------- Stripe ---------------- */
async function loadPlans() {
  try {
    const { plans, currency } = await api('/api/billing/plans');
    const grid = $('#planGrid');
    grid.innerHTML = '';
    plans.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'card plan';
      card.innerHTML = `
        <h3>${p.name}</h3>
        <div class="price">${p.display}</div>
        <div class="desc">${p.desc}</div>
        <button class="btn" data-plan="${p.id}">${window.UBERS_STATIC_MODE ? 'Requires Windows app' : 'Subscribe with Stripe'}</button>`;
      card.querySelector('button').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Redirecting...';
        try {
          const { url } = await api('/api/billing/checkout', { method: 'POST', body: { plan: p.id } });
          window.location = url;
        } catch (e) {
          toast(e.message);
          btn.disabled = false;
          btn.textContent = 'Try again';
        }
      });
      grid.appendChild(card);
    });
  } catch (e) { toast(e.message); }
}

async function handleCheckoutParam() {
  const p = new URLSearchParams(location.search);
  const banner = $('#checkoutBanner');
  if (!p.get('checkout')) return;
  banner.hidden = false;
  if (p.get('checkout') === 'cancelled') {
    banner.className = 'banner bad';
    banner.textContent = 'Checkout cancelled - no charge was made.';
    return;
  }
  try {
    const s = await api(`/api/billing/session?session_id=${encodeURIComponent(p.get('session_id') || '')}`);
    banner.className = 'banner ' + (s.paid ? 'ok' : 'bad');
    banner.textContent = s.paid
      ? `Payment confirmed (${(s.amount_total / 100).toFixed(2)} ${s.currency.toUpperCase()}). Welcome to UBERS Premium!`
      : 'Payment not completed yet.';
  } catch (e) {
    banner.className = 'banner bad';
    banner.textContent = e.message;
  }
}

/* ---------------- Roblox ---------------- */
async function loadGames() {
  try {
    const { games } = await api('/api/roblox/games');
    const grid = $('#gameGrid');
    grid.innerHTML = '';
    games.forEach((g) => {
      const card = document.createElement('div');
      card.className = 'card game';
      card.innerHTML = `
        <img loading="lazy">
        <h3></h3>
        <div class="stat-row"><span>Playing now</span><b data-stat="playing"></b></div>
        <div class="stat-row"><span>Visits</span><b data-stat="visits"></b></div>
        <div class="stat-row"><span>Favorites</span><b data-stat="favorites"></b></div>
        <div class="stat-row"><span>Approval</span><b data-stat="rating"></b></div>
        <div class="bar"><span></span></div>
        <a class="btn ghost game-link" target="_blank" rel="noopener">Open on Roblox</a>
        <p class="game-error muted" hidden></p>
        <section class="server-browser">
          <h4>Live public servers</h4>
          <p class="server-status muted">Loading official Roblox server data…</p>
          <div class="server-list"></div>
          <button class="btn ghost server-more" type="button" hidden>Load next 100 servers</button>
        </section>`;
      const title = g.name || `Place ${g.placeId}`;
      const image = card.querySelector('img');
      image.src = g.icon || '';
      image.alt = title;
      image.addEventListener('error', () => { image.hidden = true; }, { once: true });
      card.querySelector('h3').textContent = title;
      card.querySelector('[data-stat="playing"]').textContent = fmt(g.playing);
      card.querySelector('[data-stat="visits"]').textContent = fmt(g.visits);
      card.querySelector('[data-stat="favorites"]').textContent = fmt(g.favorites);
      card.querySelector('[data-stat="rating"]').textContent = g.rating == null ? 'n/a' : `${g.rating}%`;
      card.querySelector('.bar > span').style.width = `${Math.max(0, Math.min(100, Number(g.rating) || 0))}%`;
      card.querySelector('.game-link').href = `https://www.roblox.com/games/${encodeURIComponent(g.placeId)}`;
      if (g.error) {
        const error = card.querySelector('.game-error');
        error.textContent = g.error;
        error.hidden = false;
      }
      const status = card.querySelector('.server-status');
      const list = card.querySelector('.server-list');
      const more = card.querySelector('.server-more');
      const pageState = { cursor: null, count: 0, players: 0 };
      const load = () => loadPublicServers(g.placeId, status, list, more, pageState);
      more.addEventListener('click', load);
      load();
      grid.appendChild(card);
    });
  } catch (e) { toast(e.message); }
}

async function loadPublicServers(placeId, status, list, more, pageState) {
  more.disabled = true;
  status.textContent = pageState.cursor ? 'Loading next page from Roblox…' : 'Loading official Roblox server data…';
  try {
    const query = new URLSearchParams({ placeId });
    if (pageState.cursor) query.set('cursor', pageState.cursor);
    const data = await api(`/api/roblox/servers?${query}`);
    pageState.count += data.sampledServers;
    pageState.players += data.sampledPlayers;
    pageState.cursor = data.nextCursor;
    status.textContent = `Live · ${fmt(pageState.players)} players across ${fmt(pageState.count)} loaded public servers · updated ${new Date(data.updatedAt).toLocaleTimeString()}`;
    if (!pageState.count) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Roblox currently returned no public servers.';
      list.appendChild(empty);
    }
    data.servers.forEach((server, index) => {
      const row = document.createElement('div');
      row.className = 'server-row';
      const details = document.createElement('span');
      details.textContent = `Server ${pageState.count - data.sampledServers + index + 1} · ${server.playing}/${server.maxPlayers ?? '?'} players`;
      if (server.ping != null) details.textContent += ` · ${Math.round(server.ping)} ms`;
      const join = document.createElement('a');
      join.className = 'btn ghost';
      join.href = `https://www.roblox.com/games/${encodeURIComponent(placeId)}?gameInstanceId=${encodeURIComponent(server.id)}`;
      join.target = '_blank';
      join.rel = 'noopener';
      join.textContent = 'Join';
      row.append(details, join);
      list.appendChild(row);
    });
    more.hidden = !pageState.cursor;
  } catch (error) {
    status.textContent = error.message;
    more.hidden = !pageState.cursor;
  } finally {
    more.disabled = false;
  }
}

$('#keyCheckBtn').addEventListener('click', async () => {
  $('#keyCheckResult').textContent = 'Checking...';
  try {
    const d = await api('/api/roblox/key-status');
    $('#keyCheckResult').textContent = (d.ok ? '✅ ' : '⚠️ ') + d.message;
  } catch (e) { $('#keyCheckResult').textContent = e.message; }
});

/* ---------------- boot ---------------- */
function activateView(name, wifiPreselect) {
  if (!$(`#view-${name}`)) return;
  if (location.hash !== `#${name}`) location.hash = name;
  $$('#tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'wifi') loadWifi(wifiPreselect);
  if (name === 'premium') loadPlans();
  if (name === 'roblox') loadGames();
}

async function boot() {
  if (window.UBERS_STATIC_MODE && !window.UBERS_API_BASE_URL) {
    $('.brand-sub').textContent = 'ROBLOX · LIVE DATA NOT CONNECTED';
    $('#view-integrate .hero p').textContent = 'Configure the Playit HTTPS tunnel URL as the UBERS_API_BASE_URL repository variable to connect GitHub Pages to live Roblox data.';
    addMsg('Live Roblox data is not connected yet. Configure the Playit HTTPS tunnel using the setup instructions below.', 'err');
  }
  try {
    const { maps } = await api('/api/maps');
    maps.forEach((m) => (state.maps[m.id] = m));
    renderMap();
  } catch (e) { toast(e.message); }

  await pollTracking();
  setInterval(pollTracking, 2000);

  if (window.UBERS_STATIC_MODE && !window.UBERS_API_BASE_URL) {
    $('#pillLive').textContent = '● API NOT CONNECTED';
    $('#pillLive').classList.remove('live');
  } else {
    api('/api/health').then((d) => {
      const on = Object.values(d.integrations).filter(Boolean).length;
      $('#pillLive').textContent = d.offline ? '● API NOT CONNECTED' : `● LIVE · ${on} integrations`;
      if (d.offline) $('#pillLive').classList.remove('live');
    }).catch(() => {});
  }

  const initial = location.hash.replace('#', '');
  if (initial) activateView(initial);

  handleCheckoutParam().then(() => {
    if (new URLSearchParams(location.search).get('checkout')) activateView('premium');
    window.addEventListener('hashchange', () => activateView(location.hash.replace('#', '') || 'map'));
  });
}
boot();
