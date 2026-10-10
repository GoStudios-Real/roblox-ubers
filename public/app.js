// ROBLOX UBERS - frontend
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NS = 'http://www.w3.org/2000/svg';

const state = {
  maps: {},
  mapId: '',
  vehicles: [],
  players: [],
  playerServers: 0,
  filter: 'all',
  search: '',
  selected: null,
  wifiFilterOn: false,
  bookingSlots: []
};

const ICON = { car: '🚗', bus: '🚌', taxi: '🚕' };
const TYPE_COLOR = { car: '#ef5da8', bus: '#4dd2ff', taxi: '#ffd166' };
const apiOverrideStorageKey = 'roblox-ubers-api-base-url';
const soundPreferenceKey = 'roblox-ubers-sound-enabled';
let apiCompatibilityPromise = null;
let apiServerOutdated = false;
let soundEnabled = false;
let soundContext = null;
try {
  soundEnabled = localStorage.getItem(soundPreferenceKey) === 'true';
} catch {
  soundEnabled = false;
}

function activeApiBase() {
  try {
    if (localStorage.getItem(apiOverrideStorageKey) !== null) {
      return localStorage.getItem(apiOverrideStorageKey);
    }
    return window.UBERS_API_BASE_URL || '';
  } catch {
    return window.UBERS_API_BASE_URL || '';
  }
}

function authToken() {
  try {
    return localStorage.getItem('ubersAuth') || '';
  } catch {
    return '';
  }
}

function setAuthToken(token) {
  try {
    if (token) localStorage.setItem('ubersAuth', token);
    else localStorage.removeItem('ubersAuth');
  } catch {
    // storage unavailable; session simply will not persist
  }
}

let apiBaseResolutionPromise = null;

function resetApiBaseResolution() {
  apiBaseResolutionPromise = null;
  apiCompatibilityPromise = null;
  apiServerOutdated = false;
}

// GitHub Pages bakes the tunnel URL into static-config.js at deploy time, and
// browsers cache that file. Quick-tunnel URLs rotate whenever the tunnel
// restarts, so at boot we ask GitHub for the *current* repository variable and
// health-check it before falling back to the baked-in URL. A manual server
// address entered by the user always wins.
function resolveApiBaseOnce() {
  if (!window.UBERS_STATIC_MODE) return Promise.resolve(activeApiBase());
  if (!apiBaseResolutionPromise) {
    apiBaseResolutionPromise = (async () => {
      try {
        if (localStorage.getItem(apiOverrideStorageKey) !== null) return activeApiBase();
        const baked = (window.UBERS_API_BASE_URL || '').replace(/\/+$/, '');
        const timeout = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined;
        const res = await fetch('https://api.github.com/repos/GoStudios-Real/roblox-ubers/actions/variables/UBERS_API_BASE_URL', {
          headers: { Accept: 'application/vnd.github+json' },
          cache: 'no-store',
          signal: timeout
        });
        if (!res.ok) return baked;
        const data = await res.json().catch(() => ({}));
        const url = String(data.value || '').replace(/\/+$/, '');
        if (!url || url === baked) return baked || url;
        try {
          const probe = await fetch(`${url}/api/health`, {
            headers: { 'cf-skip-browser-warning': '1' },
            cache: 'no-store',
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
          });
          const health = await probe.json().catch(() => ({}));
          if (probe.ok && health.apiVersion === 2) {
            window.UBERS_API_BASE_URL = url;
            return url;
          }
        } catch {
          // candidate URL is dead; keep the baked one
        }
        return activeApiBase();
      } catch {
        return activeApiBase();
      }
    })();
  }
  return apiBaseResolutionPromise;
}

async function api(path, opts = {}, _retryAfterRelocate = false) {
  const apiBase = await resolveApiBaseOnce();
  if (window.UBERS_STATIC_MODE && !apiBase) return staticApi(path, opts);
  const tunnelHeaders = apiBase.includes('.trycloudflare.com') ? { 'cf-skip-browser-warning': '1' } : {};
  try {
    if (window.UBERS_STATIC_MODE && !apiCompatibilityPromise) {
      apiCompatibilityPromise = fetch(`${apiBase}/api/health`, { headers: tunnelHeaders })
        .then(async (response) => {
          const health = await response.json().catch(() => ({}));
          if (health.apiVersion !== 2) {
            apiServerOutdated = true;
            throw new Error('The connected UBERS server is outdated. Update and restart the Windows app to enable bookings, Roblox usernames, and owner-place safety.');
          }
          if (!response.ok) throw new Error('The connected UBERS server is not responding correctly.');
        });
    }
    if (window.UBERS_STATIC_MODE) await apiCompatibilityPromise;
    const headers = { 'Content-Type': 'application/json', ...tunnelHeaders };
    const token = authToken();
    if (token) headers['x-ubers-auth'] = token;
    Object.assign(headers, opts.headers || {});
    const res = await fetch(`${apiBase}${path}`, {
      ...opts,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && path !== '/api/auth/me' && path !== '/api/auth/signin' && path !== '/api/auth/signup') {
        setAuthToken('');
        currentAccount = null;
        renderAccountPanel();
      }
      const error = new Error(data.error || `Request failed (${res.status})`);
      error.setupRequired = Boolean(data.setupRequired);
      error.status = res.status;
      throw error;
    }
    return data;
  } catch (error) {
    const isNetworkFailure = error instanceof TypeError && /fetch|network/i.test(error.message);
    if (window.UBERS_STATIC_MODE && isNetworkFailure && !_retryAfterRelocate) {
      // The tunnel URL probably rotated since this page was cached: re-resolve
      // the repository variable and retry once against the fresh URL.
      resetApiBaseResolution();
      const relocated = await resolveApiBaseOnce();
      if (relocated && relocated !== apiBase) return api(path, opts, true);
    }
    throw error;
  }
}

async function staticApi(path, opts = {}) {
  const url = new URL(path, location.href);
  const method = (opts.method || 'GET').toUpperCase();
  const { maps } = window.UBERS_STATIC_DATA;
  if (url.pathname.includes('/api/rides/timetable') || url.pathname.includes('/api/bookings')) {
    throw new Error('Timetables and bookings need the UBERS server and its Cloudflare HTTPS API connection.');
  }
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
    return { currency: 'USD', plans, checkoutEnabled: false, checkoutMode: 'payment' };
  }
  if (url.pathname.endsWith('/api/roblox/games') && method === 'GET') {
    const games = maps
      .filter((map) => Number.isSafeInteger(map.placeId) && map.ownerManaged)
      .map((map) => ({ placeId: map.placeId, name: map.name, error: 'Connect the public HTTPS server to load live Roblox data.' }));
    return {
      games,
      setupRequired: games.length === 0,
      message: games.length === 0 ? 'Configure your own Roblox place IDs in the Node server .env to enable game stats and joins.' : undefined
    };
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
  if (/unavailable|error|failed|invalid|not connected|could not|need the connected/i.test(msg)) {
    playSound('error');
  } else {
    playSound('notice');
  }
}

function playSound(kind = 'tap') {
  if (!soundEnabled) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    soundContext ||= new AudioContextClass();
    if (soundContext.state === 'suspended') soundContext.resume().catch(() => {});
    const notes = kind === 'notice' ? [660, 880] : kind === 'error' ? [330, 247] : [520];
    const start = soundContext.currentTime;
    notes.forEach((frequency, index) => {
      const oscillator = soundContext.createOscillator();
      const gain = soundContext.createGain();
      const onset = start + index * 0.11;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, onset);
      gain.gain.setValueAtTime(0.0001, onset);
      gain.gain.exponentialRampToValueAtTime(0.055, onset + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, onset + 0.15);
      oscillator.connect(gain);
      gain.connect(soundContext.destination);
      oscillator.start(onset);
      oscillator.stop(onset + 0.16);
    });
  } catch {
    // Sound is optional; unavailable browser audio must not interrupt the app.
  }
}

function updateSoundToggle() {
  const toggle = $('#soundToggle');
  if (!toggle) return;
  toggle.textContent = soundEnabled ? 'Sound on' : 'Sound off';
  toggle.setAttribute('aria-pressed', String(soundEnabled));
  toggle.setAttribute('aria-label', `Turn sound effects ${soundEnabled ? 'off' : 'on'}`);
}

$('#soundToggle')?.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  try {
    localStorage.setItem(soundPreferenceKey, String(soundEnabled));
  } catch {
    toast('Sound preference could not be saved in this browser.');
  }
  updateSoundToggle();
  if (soundEnabled) playSound('notice');
});
updateSoundToggle();

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
    playSound('tap');
    location.hash = btn.dataset.view;
    activateView(btn.dataset.view);
    if (btn.dataset.view === 'ai') $('#chatInput').focus();
  })
);

$$('[data-navigate]').forEach((btn) =>
  btn.addEventListener('click', () => {
    playSound('tap');
    activateView(btn.dataset.navigate);
  })
);

/* ---------------- real driver bookings ---------------- */
const bookingStorageKey = 'roblox-ubers-bookings';
let timetableRequest = 0;
let savedBookingRefreshTimer = null;
let activeBooking = null;
let bookingDetailsRequest = 0;

function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localTime(value) {
  return new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function localDateTime(value) {
  const date = new Date(value);
  return `${date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })} · ${localTime(value)}`;
}

function addRobloxLaunchLinks(container, placeId, serverId = '') {
  const safePlaceId = String(placeId);
  if (!/^\d{1,20}$/.test(safePlaceId)) return;
  const query = new URLSearchParams({ placeId: safePlaceId });
  if (serverId) query.set('gameInstanceId', String(serverId));

  const appLink = document.createElement('a');
  appLink.className = 'btn';
  appLink.href = `roblox://experiences/start?${query}`;
  appLink.textContent = 'Launch Roblox app';
  appLink.setAttribute('aria-label', 'Launch this experience in the Roblox app');

  const webLink = document.createElement('a');
  webLink.className = 'btn ghost';
  webLink.href = `https://www.roblox.com/games/${encodeURIComponent(safePlaceId)}${serverId ? `?gameInstanceId=${encodeURIComponent(serverId)}` : ''}`;
  webLink.target = '_blank';
  webLink.rel = 'noopener noreferrer';
  webLink.textContent = 'Open Roblox game page';

  const hint = document.createElement('small');
  hint.className = 'muted roblox-launch-hint';
  hint.textContent = "Opens this ride's Roblox experience on your device. Your human driver meets you in game at the pickup stop.";
  container.append(appLink, webLink, hint);
}

function configureBookingForm() {
  const map = state.maps[$('#rideMap').value];
  if (!map) return;
  const routeSelect = $('#rideRoute');
  const previousRoute = routeSelect.value;
  routeSelect.replaceChildren(...map.routes.map((route) => {
    const option = document.createElement('option');
    option.value = route.id;
    option.textContent = route.name;
    return option;
  }));
  if (map.routes.some((route) => route.id === previousRoute)) routeSelect.value = previousRoute;

  const stops = map.pois.filter((poi) => poi.cat !== 'wifi');
  for (const select of [$('#ridePickup'), $('#rideDropoff')]) {
    const previousStop = select.value;
    select.replaceChildren(...stops.map((poi) => {
      const option = document.createElement('option');
      option.value = poi.id;
      option.textContent = poi.name;
      return option;
    }));
    if (stops.some((poi) => poi.id === previousStop)) select.value = previousStop;
  }
  if ($('#ridePickup').value === $('#rideDropoff').value && stops.length > 1) {
    $('#rideDropoff').selectedIndex = 1;
  }
  loadTimetable();
}

function savedBookings() {
  try {
    const stored = JSON.parse(localStorage.getItem(bookingStorageKey) || '[]');
    return Array.isArray(stored)
      ? stored.filter((item) => item && typeof item.reference === 'string' && typeof item.key === 'string').slice(-20)
      : [];
  } catch {
    return [];
  }
}

function saveBooking(reference, key) {
  const all = savedBookings().filter((item) => item.reference !== reference);
  all.push({ reference, key });
  try {
    localStorage.setItem(bookingStorageKey, JSON.stringify(all.slice(-20)));
  } catch {
    toast('Booking confirmed. Save your management key somewhere safe; this browser could not store it.');
  }
  renderSavedBookings();
}

function renderSavedBookings() {
  const list = $('#savedBookingList');
  if (!list) return;
  list.replaceChildren();
  const entries = savedBookings();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No locally saved bookings yet.';
    list.appendChild(empty);
    return;
  }
  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'saved-booking';
    const reference = document.createElement('b');
    reference.textContent = entry.reference;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn ghost';
    open.textContent = 'View';
    open.addEventListener('click', () => lookupBooking(entry.reference, entry.key));
    const status = document.createElement('small');
    status.className = 'muted saved-ride-status';
    status.textContent = 'Checking…';
    row.append(reference, status, open);
    list.appendChild(row);
  });
  refreshSavedBookingStatuses();
}

function dispatchStatusText(status) {
  return ({
    scheduled: 'Scheduled',
    profile_required: 'Add a Roblox profile so a driver can find you',
    waiting: 'Waiting for a real driver to claim this ride',
    claimed: 'Driver assigned',
    enroute: 'Driver on the way',
    arrived: 'Driver at pickup',
    picked_up: 'Ride in progress',
    completed: 'Ride completed',
    failed: 'Dispatch failed',
    cancelled: 'Cancelled'
  })[status] || 'Ride booking';
}

async function refreshSavedBookingStatuses() {
  const rows = $$('.saved-booking');
  const entries = savedBookings();
  await Promise.all(rows.map(async (row, index) => {
    const status = $('.saved-ride-status', row);
    const entry = entries[index];
    if (!status || !entry) return;
    try {
      const result = await api(`/api/bookings/${encodeURIComponent(entry.reference)}/lookup`, {
        method: 'POST',
        body: { manageKey: entry.key }
      });
      status.textContent = `${dispatchStatusText(result.booking.dispatchStatus)} · ${result.booking.mapName} · ${localTime(result.booking.departureAt)}`;
    } catch {
      status.textContent = 'Unavailable';
    }
  }));
}

function renderRobloxProfile(profile, container, addToBooking = false) {
  container.replaceChildren();
  const card = document.createElement('div');
  card.className = 'roblox-profile';
  if (typeof profile.avatarUrl === 'string' && profile.avatarUrl.startsWith('https://tr.rbxcdn.com/')) {
    const avatar = document.createElement('img');
    avatar.src = profile.avatarUrl;
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.referrerPolicy = 'no-referrer';
    card.appendChild(avatar);
  }
  const text = document.createElement('div');
  text.className = 'roblox-profile-info';
  const name = document.createElement('b');
  name.textContent = profile.displayName;
  const username = document.createElement('span');
  username.textContent = `@${profile.username}`;
  const profileLink = document.createElement('a');
  profileLink.href = profile.profileUrl;
  profileLink.target = '_blank';
  profileLink.rel = 'noopener noreferrer';
  profileLink.textContent = 'Open Roblox profile';
  text.append(name, username, profileLink);
  if (profile.description) {
    const description = document.createElement('p');
    description.textContent = profile.description;
    text.appendChild(description);
  }
  if (profile.isBanned) {
    const banned = document.createElement('span');
    banned.className = 'field-hint';
    banned.textContent = 'Roblox reports this account as banned.';
    text.appendChild(banned);
  }
  card.appendChild(text);
  if (addToBooking) {
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'btn ghost';
    use.textContent = 'Use for ride';
    use.addEventListener('click', () => {
      $('#bookingRobloxUsername').value = profile.username;
      if (!$('#rideName').value.trim()) $('#rideName').value = profile.displayName;
      $('#bookingProfileResult').replaceChildren();
      const message = document.createElement('p');
      message.className = 'field-hint';
      message.textContent = `Selected @${profile.username}. Roblox will be checked again when you book. This does not verify account ownership.`;
      $('#bookingProfileResult').appendChild(message);
      activateView('book');
    });
    card.appendChild(use);
  }
  container.appendChild(card);
}

async function lookupRobloxProfile(username, target, useForBooking = false) {
  target.replaceChildren();
  const pending = document.createElement('p');
  pending.className = 'muted';
  pending.textContent = 'Looking up public Roblox profile…';
  target.appendChild(pending);
  try {
    const result = await api('/api/roblox/profile', {
      method: 'POST',
      body: { username }
    });
    renderRobloxProfile(result.profile, target, useForBooking);
    return result.profile;
  } catch (error) {
    target.replaceChildren();
    const message = document.createElement('p');
    message.className = 'booking-result error';
    message.textContent = error.message;
    target.appendChild(message);
    return null;
  }
}

function setBookingResult(title, message, isError = false, manageKey = '') {
  const result = $('#bookingResult');
  result.replaceChildren();
  result.hidden = false;
  result.classList.toggle('error', isError);
  const heading = document.createElement('h3');
  heading.textContent = title;
  const text = document.createElement('p');
  text.textContent = message;
  result.append(heading, text);
  if (manageKey) {
    const label = document.createElement('p');
    label.textContent = 'Private management key (shown once): ';
    const key = document.createElement('code');
    key.textContent = manageKey;
    label.append(key);
    result.appendChild(label);
    const hint = document.createElement('p');
    hint.textContent = 'Save this key. It is needed to view or cancel the booking and cannot be recovered if lost.';
    result.appendChild(hint);
  }
}

function updateSeatOptions() {
  const select = $('#rideSeats');
  const departureAt = $('#rideDeparture').value;
  const available = state.bookingSlots.find((slot) => slot.departureAt === departureAt)?.seatsAvailable || 4;
  const selected = Math.min(Number(select.value) || 1, available);
  select.replaceChildren(...Array.from({ length: Math.min(4, available) }, (_, index) =>
    new Option(`${index + 1} seat${index ? 's' : ''}`, String(index + 1))
  ));
  select.value = String(selected);
}

async function loadTimetable() {
  const requestId = ++timetableRequest;
  const list = $('#timetableList');
  const departureSelect = $('#rideDeparture');
  if (!list || !departureSelect) return;
  const mapId = $('#rideMap').value;
  const routeId = $('#rideRoute').value;
  const date = $('#rideDate').value;
  state.bookingSlots = [];
  updateSeatOptions();
  departureSelect.disabled = true;
  departureSelect.replaceChildren(new Option('Loading departures…', ''));
  list.replaceChildren();
  if (!mapId || !routeId || !date) return;
  try {
    const data = await api(`/api/rides/timetable?map=${encodeURIComponent(mapId)}&routeId=${encodeURIComponent(routeId)}`);
    if (requestId !== timetableRequest) return;
    const slots = data.departures.filter((slot) => localDateKey(slot.departureAt) === date);
    state.bookingSlots = slots;
    departureSelect.replaceChildren();
    if (!slots.length) {
      departureSelect.add(new Option('No departures available for this date', ''));
      departureSelect.disabled = true;
      const note = document.createElement('p');
      note.textContent = 'No seats are available for this route and date. Try another day.';
      list.appendChild(note);
      return;
    }
    departureSelect.add(new Option('Select a departure time', ''));
    const preview = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = `${data.route.name} · ${slots.length} departures`;
    preview.appendChild(heading);
    slots.forEach((slot) => {
      const label = `${localTime(slot.departureAt)} · ${slot.seatsAvailable} seats`;
      departureSelect.add(new Option(label, slot.departureAt));
      const item = document.createElement('p');
      item.className = 'slot-note';
      item.textContent = `${localTime(slot.departureAt)} — ${slot.seatsAvailable} seat${slot.seatsAvailable === 1 ? '' : 's'} available`;
      preview.appendChild(item);
    });
    list.appendChild(preview);
    departureSelect.disabled = false;
    updateSeatOptions();
  } catch (error) {
    if (requestId !== timetableRequest) return;
    state.bookingSlots = [];
    departureSelect.replaceChildren(new Option('Timetable unavailable', ''));
    const note = document.createElement('p');
    note.textContent = error.message;
    list.appendChild(note);
  }
}

function renderBookingCard(booking, manageKey) {
  const container = $('#bookingDetails');
  container.replaceChildren();
  const card = document.createElement('div');
  card.className = 'card booking-card';
  const title = document.createElement('h3');
  title.textContent = `${booking.reference} · ${booking.mapName}`;
  const details = document.createElement('p');
  details.textContent = `${booking.routeName} · ${booking.pickupName} → ${booking.dropoffName}`;
  const departure = document.createElement('p');
  departure.className = 'booking-departure';
  departure.textContent = `${localDateTime(booking.departureAt)} · ${booking.seats} seat${booking.seats === 1 ? '' : 's'} · ${booking.riderName}`;
  const status = document.createElement('p');
  status.className = `booking-status${booking.status === 'cancelled' ? ' cancelled' : ''}`;
  status.textContent = `Status: ${booking.status}`;
  const dispatch = document.createElement('p');
  dispatch.textContent = `Driver: ${dispatchStatusText(booking.dispatchStatus)}` +
    (booking.driver ? ` · ${booking.driver.name}` : '');
  card.append(title, details, departure, status, dispatch);
  const tracking = document.createElement('section');
  tracking.className = 'ride-tracking';
  tracking.setAttribute('aria-label', 'Ride tracking progress');
  const trackingHeading = document.createElement('h4');
  trackingHeading.textContent = 'Ride tracking';
  const trackingStatus = document.createElement('p');
  trackingStatus.className = 'ride-tracking-status';
  trackingStatus.textContent = dispatchStatusText(booking.dispatchStatus) +
    (booking.driver ? ` · driven by ${booking.driver.name}` : '');
  const stageNames = ['Booked', 'Driver assigned', 'On the way', 'At pickup', 'On ride', 'Complete'];
  const stageIndex = ({
    scheduled: 0,
    profile_required: 0,
    waiting: 0,
    claimed: 1,
    enroute: 2,
    arrived: 3,
    picked_up: 4,
    completed: 5
  })[booking.dispatchStatus] ?? 0;
  const progress = document.createElement('div');
  progress.className = 'ride-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', 'Ride progress');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-valuenow', String(Math.round((stageIndex / (stageNames.length - 1)) * 100)));
  progress.setAttribute('aria-valuetext', stageNames[stageIndex]);
  const progressFill = document.createElement('span');
  progressFill.className = 'ride-progress-fill';
  progressFill.style.width = `${(stageIndex / (stageNames.length - 1)) * 100}%`;
  progress.appendChild(progressFill);
  const stages = document.createElement('ol');
  stages.className = 'ride-stages';
  stageNames.forEach((name, index) => {
    const item = document.createElement('li');
    if (index < stageIndex) item.classList.add('complete');
    if (index === stageIndex) item.classList.add('current');
    const label = document.createElement('span');
    label.textContent = name;
    item.appendChild(label);
    stages.appendChild(item);
  });
  const trackingNote = document.createElement('small');
  trackingNote.className = 'muted ride-tracking-note';
  trackingNote.textContent = 'Times are local (AM/PM). Live status refreshes every 15 seconds while this booking is open.';
  tracking.append(trackingHeading, trackingStatus, progress, stages, trackingNote);
  card.appendChild(tracking);
  if (booking.robloxProfile?.username) {
    const profile = document.createElement('a');
    profile.href = booking.robloxProfile.profileUrl ||
      `https://www.roblox.com/users/${encodeURIComponent(booking.robloxProfile.userId)}/profile`;
    profile.target = '_blank';
    profile.rel = 'noopener noreferrer';
    profile.textContent = `Roblox profile: @${booking.robloxProfile.username}`;
    card.appendChild(profile);
  } else if (booking.status === 'confirmed' && booking.dispatchStatus === 'profile_required') {
    const profileForm = document.createElement('form');
    profileForm.className = 'profile-form booking-profile-form';
    const username = document.createElement('input');
    username.type = 'text';
    username.name = 'username';
    username.required = true;
    username.minLength = 3;
    username.maxLength = 20;
    username.pattern = '[A-Za-z0-9_]{3,20}';
    username.autocomplete = 'off';
    username.placeholder = 'Roblox username';
    username.setAttribute('aria-label', 'Roblox username');
    const attach = document.createElement('button');
    attach.type = 'submit';
    attach.className = 'btn';
    attach.textContent = 'Link profile for your driver';
    profileForm.append(username, attach);
    profileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      attach.disabled = true;
      try {
        const result = await api(`/api/bookings/${encodeURIComponent(booking.reference)}/profile`, {
          method: 'POST',
          body: { manageKey, username: username.value.trim() }
        });
        renderBookingCard(result.booking, manageKey);
        toast('Public profile linked. Your Roblox account must join the participating game server to board.');
      } catch (error) {
        toast(error.message);
        attach.disabled = false;
      }
    });
    const helper = document.createElement('small');
    helper.className = 'muted';
    helper.textContent = 'Public lookup only; the Roblox account linked here must join this ride’s participating game.';
    card.append(profileForm, helper);
  }
  const game = state.maps[booking.mapId];
  if (game?.placeId) {
    const gamePlaceId = booking.placeId || game.placeId;
    addRobloxLaunchLinks(card, gamePlaceId, booking.dispatchServerId || '');
  }
  if (booking.status === 'confirmed' && Date.parse(booking.departureAt) > Date.now()) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn ghost';
    cancel.textContent = 'Cancel booking';
    cancel.addEventListener('click', async () => {
      cancel.disabled = true;
      try {
        const result = await api(`/api/bookings/${encodeURIComponent(booking.reference)}`, {
          method: 'DELETE',
          body: { manageKey }
        });
        renderBookingCard(result.booking, manageKey);
      } catch (error) {
        toast(error.message);
        cancel.disabled = false;
      }
    });
    card.appendChild(cancel);
  }
  container.appendChild(card);
}

async function lookupBooking(reference, key) {
  $('#lookupReference').value = reference;
  $('#lookupKey').value = key;
  activeBooking = { reference, key };
  const details = $('#bookingDetails');
  details.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'muted';
  loading.textContent = 'Looking up booking…';
  details.appendChild(loading);
  await refreshBookingDetails(true);
}

async function refreshBookingDetails(showError = false) {
  if (!activeBooking) return;
  const requestId = ++bookingDetailsRequest;
  const { reference, key } = activeBooking;
  try {
    const result = await api(`/api/bookings/${encodeURIComponent(reference)}/lookup`, {
      method: 'POST',
      body: { manageKey: key }
    });
    if (requestId !== bookingDetailsRequest) return;
    renderBookingCard(result.booking, key);
  } catch (error) {
    if (requestId !== bookingDetailsRequest) return;
    if (!showError) {
      const note = $('.ride-tracking-note', $('#bookingDetails'));
      if (note) note.textContent = 'Live update unavailable. Showing the last received status.';
      return;
    }
    const details = $('#bookingDetails');
    details.replaceChildren();
    const message = document.createElement('p');
    message.className = 'booking-result error';
    message.textContent = error.message;
    $('#bookingDetails').appendChild(message);
  }
}

function initializeApiConnection() {
  const input = $('#apiBaseUrl');
  const status = $('#apiConnectionStatus');
  if (!input || !status) return;
  input.value = activeApiBase();
  status.textContent = activeApiBase()
    ? 'Server address configured.'
    : 'No server connected. Enter a public HTTPS UBERS server URL.';
}

$('#apiConnectionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#apiBaseUrl');
  const status = $('#apiConnectionStatus');
  const value = input.value.trim().replace(/\/+$/, '');
  if (!value) {
    try { localStorage.setItem(apiOverrideStorageKey, ''); } catch {}
    status.textContent = 'Saved server connection cleared.';
    window.location.reload();
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    status.textContent = 'Enter a valid HTTPS URL.';
    return;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    status.textContent = 'Use the server origin only, for example https://your-tunnel.example.com.';
    return;
  }
  try {
    localStorage.setItem(apiOverrideStorageKey, value);
  } catch {
    status.textContent = 'This browser could not save the server address.';
    return;
  }
  status.textContent = 'Checking connection…';
  try {
    await api('/api/health');
    status.textContent = 'Connected to the UBERS server. Reloading to refresh the live app…';
    window.location.reload();
  } catch (error) {
    try { localStorage.removeItem(apiOverrideStorageKey); } catch {}
    status.textContent = `Server check failed: ${error.message}`;
  }
});

$('#bookingProfileLookup').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const profile = await lookupRobloxProfile(
      $('#bookingRobloxUsername').value.trim(),
      $('#bookingProfileResult')
    );
    if (profile) {
      if (!$('#rideName').value.trim()) $('#rideName').value = profile.displayName;
      toast(`Public profile found: @${profile.username}. This lookup does not verify account ownership.`);
    }
  } finally {
    button.disabled = false;
  }
});

$('#robloxProfileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await lookupRobloxProfile($('#robloxProfileUsername').value.trim(), $('#robloxProfileResult'), true);
});

$('#rideMap').addEventListener('change', configureBookingForm);
$('#rideRoute').addEventListener('change', loadTimetable);
$('#rideDate').addEventListener('change', loadTimetable);
$('#rideDeparture').addEventListener('change', updateSeatOptions);
$('#bookingForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = $('#bookingSubmit');
  submit.disabled = true;
  try {
    const result = await api('/api/bookings', {
      method: 'POST',
      body: {
        mapId: $('#rideMap').value,
        routeId: $('#rideRoute').value,
        pickupPoiId: $('#ridePickup').value,
        dropoffPoiId: $('#rideDropoff').value,
        departureAt: $('#rideDeparture').value,
        seats: Number($('#rideSeats').value),
        riderName: $('#rideName').value,
        robloxUsername: $('#bookingRobloxUsername').value.trim() || undefined
      }
    });
    const booking = result.booking;
    saveBooking(booking.reference, booking.manageKey);
    await loadTimetable();
    setBookingResult(
      'Your ride is reserved!',
      `${booking.reference} · ${booking.routeName} · ${localDateTime(booking.departureAt)}`,
      false,
      booking.manageKey
    );
  } catch (error) {
    setBookingResult('Booking not completed', error.message, true);
  } finally {
    submit.disabled = false;
  }
});

$('#lookupForm').addEventListener('submit', (event) => {
  event.preventDefault();
  lookupBooking($('#lookupReference').value.trim(), $('#lookupKey').value.trim());
});

function initializeBookingForm() {
  const date = $('#rideDate');
  if (!date || !Object.keys(state.maps).length) return;
  const today = new Date();
  const lastDate = new Date(today);
  lastDate.setDate(today.getDate() + 6);
  date.min = localDateKey(today);
  date.max = localDateKey(lastDate);
  date.value = date.min;
  configureBookingForm();
  renderSavedBookings();
}

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

/* ---------------- profile games switcher ---------------- */
function mapList() {
  return Object.values(state.maps);
}

function renderMapSwitch() {
  const host = $('#mapSwitch');
  if (!host) return;
  host.innerHTML = '';
  const maps = mapList();
  if (!maps.length) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = 'No profile games loaded yet.';
    host.appendChild(empty);
    return;
  }
  maps.forEach((map, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn' + ((map.id === state.mapId) || (!state.mapId && index === 0) ? ' active' : '');
    btn.dataset.map = map.id;
    const icon = map.profileGame?.icon;
    btn.innerHTML = `${icon ? `<img class="seg-icon" src="${icon}" alt="">` : '🎮'} ${escapeHtml(map.name)}`;
    btn.addEventListener('click', () => selectMap(map.id));
    host.appendChild(btn);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function selectMap(mapId) {
  if (!state.maps[mapId]) return;
  state.mapId = mapId;
  state.selected = null;
  $$('#mapSwitch .seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.map === mapId));
  renderMap();
  pollTracking();
}

function populateRideMapSelect() {
  const select = $('#rideMap');
  if (!select) return;
  const previous = select.value;
  const maps = mapList();
  select.replaceChildren(...maps.map((map) => {
    const option = document.createElement('option');
    option.value = map.id;
    option.textContent = map.name;
    return option;
  }));
  if (maps.some((map) => map.id === previous)) select.value = previous;
  else if (state.mapId) select.value = state.mapId;
}

async function loadProfileGames(username) {
  const status = $('#profileStatus');
  if (status) status.textContent = 'Loading profile games…';
  try {
    const data = await api(`/api/profile/games?username=${encodeURIComponent(username)}`);
    (data.maps || []).forEach((m) => (state.maps[m.id] = m));
    renderMapSwitch();
    populateRideMapSelect();
    const gamesBox = $('#profileGames');
    if (gamesBox) {
      gamesBox.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'profile-head';
      head.innerHTML = `${data.profile.avatarUrl ? `<img src="${data.profile.avatarUrl}" alt="">` : ''}
        <div><b>@${escapeHtml(data.profile.username)}</b>
        <span class="muted">${(data.games || []).length} public game${(data.games || []).length === 1 ? '' : 's'}</span></div>`;
      gamesBox.appendChild(head);
      (data.games || []).forEach((game) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'game-chip';
        card.innerHTML = `${game.icon ? `<img src="${game.icon}" alt="">` : '🎮'}
          <span><b>${escapeHtml(game.name)}</b>
          <small>${game.playing != null ? `${game.playing} playing` : 'view map'}${game.visits != null ? ` · ${fmt(game.visits)} visits` : ''}</small></span>`;
        card.addEventListener('click', () => {
          selectMap(`game-${game.universeId}`);
          activateView('map');
        });
        gamesBox.appendChild(card);
      });
    }
    if (status) status.textContent = `${(data.maps || []).length} map(s) added from @${data.profile.username}.`;
    if (data.maps?.length) selectMap(data.maps[0].id);
    toast(`Loaded ${data.maps.length} profile game map(s).`);
  } catch (e) {
    if (status) status.textContent = e.message;
    toast(e.message);
  }
}

$$('#mapSwitch .seg-btn').forEach((b) =>
  b.addEventListener('click', () => {
    selectMap(b.dataset.map);
  })
);

const profileForm = $('#profileForm');
if (profileForm) {
  profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = $('#profileUsername').value.trim();
    if (username) loadProfileGames(username);
  });
}

$$('#profileForm [data-quick]').forEach((btn) =>
  btn.addEventListener('click', () => {
    $('#profileUsername').value = btn.dataset.quick;
    loadProfileGames(btn.dataset.quick);
  })
);

const openInRobloxBtn = $('#openInRoblox');
if (openInRobloxBtn) {
  openInRobloxBtn.addEventListener('click', () => {
    const map = state.maps[state.mapId];
    const placeId = map?.placeId;
    if (!placeId) {
      toast('This map has no Roblox place to launch. Load a profile game first.');
      return;
    }
    window.location.href = `roblox://experiences/start?${new URLSearchParams({ placeId: String(placeId) })}`;
    toast(`Launching ${map.name} in Roblox…`);
  });
}

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
    $('#pillLive').textContent = window.UBERS_STATIC_MODE && apiServerOutdated
      ? '● SERVER UPDATE REQUIRED'
      : '● OFFLINE';
    $('#pillLive').classList.remove('live');
  }
  await pollPlayers();
}

async function pollPlayers() {
  try {
    const data = await api(`/api/players?map=${state.mapId}`);
    state.players = (data.players || []).map((p) => ({ ...p, map: state.mapId }));
    state.playerServers = data.activeServers || 0;
    state.playerOffline = Boolean(data.offline);
    drawPlayers();
    renderPlayers();
    const status = $('#playerStatus');
    if (data.mapKnown === false) {
      if (status) status.textContent = 'This map is not loaded on the connected server yet. Load its profile in the Profile Games bar.';
      $('#pillPlayers').textContent = '● WAITING FOR ROBLOX';
      $('#pillPlayers').classList.remove('live');
      return;
    }
    if (status && !state.players.length) status.textContent = 'No position reports received. Public Roblox server counts are shown in the Roblox API tab.';
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
    const { plans, currency, checkoutEnabled } = await api('/api/billing/plans');
    const grid = $('#planGrid');
    const paymentStatus = $('#paymentStatus');
    grid.innerHTML = '';
    if (paymentStatus) {
      paymentStatus.hidden = Boolean(checkoutEnabled);
      paymentStatus.className = 'banner bad';
      paymentStatus.textContent = window.UBERS_STATIC_MODE && !activeApiBase()
        ? 'Payments are unavailable on this static site until it is connected to a running UBERS server.'
        : 'Payments are not configured on the connected server. Add your private Stripe secret key (sk_live_…) as STRIPE_SECRET_KEY on the server, then restart it. The publishable pk_live_… key alone cannot create Checkout sessions.';
    }
    plans.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'card plan';
      card.innerHTML = `
        <h3>${p.name}</h3>
        <div class="price">${p.display}</div>
        <div class="desc">${p.desc}</div>
        <small class="muted plan-payment-type">One-time payment</small>
        <button class="btn" data-plan="${p.id}">${checkoutEnabled ? 'Buy with Stripe' : 'Payments unavailable'}</button>`;
      const button = card.querySelector('button');
      button.disabled = !checkoutEnabled;
      button.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Redirecting...';
        try {
          const { url } = await api('/api/billing/checkout', { method: 'POST', body: { plan: p.id } });
          window.location = url;
        } catch (e) {
          toast(e.message);
          if (e.setupRequired) {
            const paymentStatus = $('#paymentStatus');
            paymentStatus.hidden = false;
            paymentStatus.className = 'banner bad';
            paymentStatus.replaceChildren(
              document.createTextNode(`${e.message} The account owner must submit accurate business, tax, payout, and terms information in `)
            );
            const dashboard = document.createElement('a');
            dashboard.href = 'https://dashboard.stripe.com/get-started';
            dashboard.target = '_blank';
            dashboard.rel = 'noopener';
            dashboard.textContent = 'Stripe Dashboard';
            paymentStatus.append(dashboard, document.createTextNode('.'));
            $('#planGrid').querySelectorAll('button[data-plan]').forEach((planButton) => {
              planButton.disabled = true;
              planButton.textContent = 'Stripe setup required';
            });
            return;
          }
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
    const { games, setupRequired, message } = await api('/api/roblox/games');
    const grid = $('#gameGrid');
    grid.innerHTML = '';
    if (!games.length) {
      const notice = document.createElement('p');
      notice.className = 'card muted';
      notice.textContent = message || (setupRequired
        ? 'Configure your own Roblox place IDs in the server .env to enable game stats and joins.'
        : 'No configured Roblox places are available.');
      grid.appendChild(notice);
      return;
    }
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
        <div class="roblox-launch-links">
          <a class="btn game-app-link">Launch Roblox app</a>
          <a class="btn ghost game-link" target="_blank" rel="noopener">Open game page</a>
        </div>
        <small class="muted roblox-launch-hint">Opens this place in Roblox. Meet your human driver at the pickup stop.</small>
        <p class="game-error muted" hidden></p>
        <section class="server-browser">
          <h4>Live public servers</h4>
          <p class="server-status muted">Loading Roblox public-server data…</p>
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
      const placeId = String(g.placeId);
      if (/^\d{1,20}$/.test(placeId)) {
        card.querySelector('.game-app-link').href =
          `roblox://experiences/start?${new URLSearchParams({ placeId })}`;
        card.querySelector('.game-link').href = `https://www.roblox.com/games/${encodeURIComponent(placeId)}`;
      } else {
        card.querySelector('.game-app-link').remove();
        card.querySelector('.game-link').remove();
      }
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
  status.textContent = pageState.cursor ? 'Loading next page from Roblox…' : 'Loading Roblox public-server data…';
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
// ---------- Drive tab: real-player driver jobs ----------
let jobsRefreshTimer = null;
let pendingClaimReference = null;
let currentAccount = null;

// ---------- Accounts: sign in / sign up ----------
async function refreshAccount() {
  if (!authToken()) {
    currentAccount = null;
    renderAccountPanel();
    return;
  }
  try {
    const data = await api('/api/auth/me');
    currentAccount = data.account;
    renderAccountPanel();
    await refreshDriverJobs();
  } catch {
    setAuthToken('');
    currentAccount = null;
    renderAccountPanel();
  }
}

function renderAccountPanel() {
  const body = $('#accountBody');
  const badge = $('#accountBadge');
  if (!body) return;
  if (badge) badge.textContent = currentAccount ? 'SIGNED IN' : 'SIGNED OUT';
  body.replaceChildren();
  if (currentAccount) {
    const greeting = document.createElement('p');
    greeting.innerHTML = '';
    const name = document.createElement('b');
    name.textContent = currentAccount.displayName || currentAccount.username;
    greeting.append('Signed in as ', name, ` (@${currentAccount.username}). Sign in syncs your claimed rides on any browser.`);
    const signOut = document.createElement('button');
    signOut.type = 'button';
    signOut.className = 'btn ghost';
    signOut.textContent = 'Sign out';
    signOut.addEventListener('click', async () => {
      try {
        await api('/api/auth/signout', { method: 'POST', body: {} });
      } catch {
        // local session is cleared even if the server call fails
      }
      setAuthToken('');
      currentAccount = null;
      renderAccountPanel();
      await refreshDriverJobs();
      toast('Signed out.');
    });
    body.append(greeting, signOut);
    return;
  }

  const tabs = document.createElement('div');
  tabs.className = 'seg auth-tabs';
  const signInTab = document.createElement('button');
  signInTab.type = 'button';
  signInTab.className = 'chip active';
  signInTab.textContent = 'Sign in';
  const signUpTab = document.createElement('button');
  signUpTab.type = 'button';
  signUpTab.className = 'chip';
  signUpTab.textContent = 'Sign up';
  tabs.append(signInTab, signUpTab);

  const form = document.createElement('form');
  form.className = 'profile-form auth-form';
  const usernameLabel = document.createElement('label');
  usernameLabel.textContent = 'Username';
  const username = document.createElement('input');
  username.required = true;
  username.minLength = 3;
  username.maxLength = 20;
  username.autocomplete = 'username';
  username.pattern = '[A-Za-z0-9_]{3,20}';
  username.placeholder = 'driver_username';
  usernameLabel.appendChild(username);
  const passwordLabel = document.createElement('label');
  passwordLabel.textContent = 'Password';
  const password = document.createElement('input');
  password.type = 'password';
  password.required = true;
  password.minLength = 8;
  password.maxLength = 100;
  password.autocomplete = 'current-password';
  password.placeholder = 'At least 8 characters';
  passwordLabel.appendChild(password);
  const displayLabel = document.createElement('label');
  displayLabel.textContent = 'Display name (sign up only)';
  const displayName = document.createElement('input');
  displayName.maxLength = 24;
  displayName.autocomplete = 'nickname';
  displayName.placeholder = 'How riders see you';
  displayLabel.appendChild(displayName);
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn';
  submit.textContent = 'Sign in';
  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent = 'Accounts are stored on this UBERS server only. Passwords are salted and hashed — never shared with Roblox.';
  form.append(usernameLabel, passwordLabel, displayLabel, submit, hint);
  displayLabel.hidden = true;

  let mode = 'signin';
  const setMode = (next) => {
    mode = next;
    signInTab.classList.toggle('active', mode === 'signin');
    signUpTab.classList.toggle('active', mode === 'signup');
    displayLabel.hidden = mode !== 'signup';
    password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  };
  signInTab.addEventListener('click', () => setMode('signin'));
  signUpTab.addEventListener('click', () => setMode('signup'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const path = mode === 'signup' ? '/api/auth/signup' : '/api/auth/signin';
      const body = { username: username.value, password: password.value };
      if (mode === 'signup' && displayName.value.trim()) body.displayName = displayName.value.trim();
      const result = await api(path, { method: 'POST', body });
      setAuthToken(result.token);
      currentAccount = result.account;
      renderAccountPanel();
      await refreshDriverJobs();
      toast(mode === 'signup' ? 'Account created — you can claim rides now.' : 'Signed in.');
    } catch (error) {
      toast(error.message);
    }
  });
  body.append(tabs, form);
}

function savedDriverJobs() {
  try {
    const parsed = JSON.parse(localStorage.getItem('ubersDriverJobs') || '[]');
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && entry.reference && entry.code) : [];
  } catch {
    return [];
  }
}

function saveDriverJobs(list) {
  localStorage.setItem('ubersDriverJobs', JSON.stringify(list));
}

function robloxLaunchUrl(placeId, serverId) {
  let url = `roblox://experiences/start?placeId=${encodeURIComponent(placeId)}`;
  if (serverId) url += `&gameInstanceId=${encodeURIComponent(serverId)}`;
  return url;
}

async function loadJobsView() {
  await Promise.all([refreshJobList(), refreshDriverJobs()]);
}

async function refreshJobList() {
  const list = $('#jobList');
  if (!list) return;
  try {
    const data = await api('/api/jobs');
    const jobs = data.jobs || [];
    if ($('#jobCount')) $('#jobCount').textContent = String(jobs.length);
    renderDriversMap(jobs);
    list.replaceChildren();
    if (!jobs.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No open rides right now. Book a ride first — it appears here until a driver claims it.';
      list.appendChild(empty);
      return;
    }
    jobs.forEach((job) => list.appendChild(renderJobRow(job)));
  } catch (error) {
    list.replaceChildren();
    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = `Open rides unavailable: ${error.message}`;
    list.appendChild(line);
  }
}

function routeMapSvg(job, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1000 1000');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('class', className);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${job.pickupName} to ${job.dropoffName} route`);
  const grid = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  grid.setAttribute('width', '1000');
  grid.setAttribute('height', '1000');
  grid.setAttribute('class', 'route-map-bg');
  svg.appendChild(grid);
  if (Array.isArray(job.routeStops) && job.routeStops.length > 1) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', job.routeStops.map(([x, y]) => `${x},${y}`).join(' '));
    line.setAttribute('class', 'route-map-line');
    svg.appendChild(line);
  }
  const addMarker = (point, cls) => {
    if (!point) return;
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(point.x));
    dot.setAttribute('cy', String(point.y));
    dot.setAttribute('r', '34');
    dot.setAttribute('class', cls);
    svg.appendChild(dot);
  };
  addMarker(job.dropoff, 'route-map-dropoff');
  addMarker(job.pickup, 'route-map-pickup');
  return svg;
}

function renderJobRow(job) {
  const row = document.createElement('div');
  row.className = 'saved-booking job-row';
  row.id = `job-row-${job.reference}`;
  const info = document.createElement('div');
  info.className = 'job-row-info';
  const title = document.createElement('b');
  title.textContent = `${job.reference} · ${job.routeType || 'ride'} · ${job.mapName}`;
  const detail = document.createElement('small');
  detail.className = 'muted';
  detail.textContent = `${job.pickupName} → ${job.dropoffName} · ${localDateTime(job.departureAt)} · ${job.seats} seat${job.seats === 1 ? '' : 's'} · rider: ${job.riderName}` +
    (job.riderRoblox ? ` (@${job.riderRoblox})` : '');
  info.append(title, detail, routeMapSvg(job, 'job-route-map'));
  const actions = document.createElement('div');
  actions.className = 'job-row-actions';
  const join = document.createElement('a');
  join.className = 'btn ghost';
  join.href = robloxLaunchUrl(job.placeId);
  join.textContent = '🎮 Join game';
  join.title = 'Open this Roblox experience on your device';
  const claim = document.createElement('button');
  claim.type = 'button';
  claim.className = 'btn';
  claim.textContent = 'Claim ride';
  claim.addEventListener('click', () => renderClaimForm(job));
  actions.append(join, claim);
  row.append(info, actions);
  return row;
}

function renderClaimForm(job) {
  pendingClaimReference = job.reference;
  const panel = $('#jobClaimPanel');
  if (!panel) return;
  panel.replaceChildren();
  if (!currentAccount) {
    const card = document.createElement('div');
    card.className = 'card lookup-form';
    const heading = document.createElement('h3');
    heading.textContent = `Sign in to claim ${job.reference}`;
    const summary = document.createElement('p');
    summary.className = 'muted';
    summary.textContent = 'Driver accounts keep your claimed rides, tracking progress, and Next steps synced on any browser.';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn';
    go.textContent = 'Go to sign in / sign up';
    go.addEventListener('click', () => {
      $('#accountPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#accountBody input')?.focus();
    });
    card.append(heading, summary, go);
    panel.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  const card = document.createElement('form');
  card.className = 'card lookup-form';
  const heading = document.createElement('h3');
  heading.textContent = `Claim ${job.reference}`;
  const summary = document.createElement('p');
  summary.className = 'muted';
  summary.textContent = `${job.mapName} · ${job.routeName} · ${job.pickupName} → ${job.dropoffName} · ${localDateTime(job.departureAt)}`;
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Driver display name';
  const nameInput = document.createElement('input');
  nameInput.required = true;
  nameInput.minLength = 2;
  nameInput.maxLength = 24;
  nameInput.autocomplete = 'off';
  nameInput.placeholder = 'e.g. TaxiKing42';
  nameInput.value = currentAccount?.displayName || currentAccount?.username || '';
  nameLabel.appendChild(nameInput);
  const userLabel = document.createElement('label');
  userLabel.textContent = 'Roblox username (optional)';
  const userInput = document.createElement('input');
  userInput.pattern = '[A-Za-z0-9_]{3,20}';
  userInput.autocomplete = 'off';
  userInput.placeholder = 'Shown to the rider so they can find you';
  userLabel.appendChild(userInput);
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn';
  submit.textContent = 'Claim this ride';
  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent = 'The ride is linked to your account, and you also get a private backup driver code (shown once). Anyone with either credential can update this ride — keep them secret.';
  card.append(heading, summary, nameLabel, userLabel, submit, hint);
  card.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api(`/api/jobs/${encodeURIComponent(job.reference)}/claim`, {
        method: 'POST',
        body: { driverName: nameInput.value, driverUsername: userInput.value }
      });
      const saved = savedDriverJobs().filter((entry) => entry.reference !== job.reference);
      saved.push({ reference: job.reference, code: result.driverCode, mapName: job.mapName });
      saveDriverJobs(saved);
      pendingClaimReference = null;
      showDriverCode(job, result.driverCode);
      await loadJobsView();
    } catch (error) {
      toast(error.message);
    }
  });
  panel.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showDriverCode(job, driverCode) {
  const panel = $('#jobClaimPanel');
  panel.replaceChildren();
  const card = document.createElement('div');
  card.className = 'card booking-card';
  const heading = document.createElement('h3');
  heading.textContent = `Driver code for ${job.reference}`;
  const code = document.createElement('code');
  code.className = 'token';
  code.textContent = driverCode;
  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent = 'Shown once and saved only in this browser. Copy it somewhere safe — you need it to update the ride status.';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn ghost';
  copy.textContent = 'Copy code';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(driverCode);
      toast('Driver code copied.');
    } catch {
      toast('Select the code and copy it manually.');
    }
  });
  card.append(heading, code, hint, copy);
  panel.appendChild(card);
}

function renderDriversMap(jobs) {
  const svg = $('#jobsMapSvg');
  const legend = $('#jobsMapLegend');
  if (!svg || !legend) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  legend.replaceChildren();
  const active = jobs.filter((job) => job.pickup);
  const mapJobs = active.filter((job) => job.mapId === state.mapId);
  const shown = mapJobs.length ? mapJobs : active;
  if ($('#jobsMapCount')) $('#jobsMapCount').textContent = String(shown.length);
  if (!shown.length) {
    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = 'No open rides to plot yet.';
    legend.appendChild(line);
    return;
  }
  shown.forEach((job, index) => {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    marker.setAttribute('cx', String(job.pickup.x));
    marker.setAttribute('cy', String(job.pickup.y));
    marker.setAttribute('r', '42');
    marker.setAttribute('class', 'jobs-map-marker');
    marker.setAttribute('tabindex', '0');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${job.reference} · ${job.pickupName}`;
    marker.appendChild(title);
    const jump = () => {
      const row = document.getElementById(`job-row-${job.reference}`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.remove('job-row-flash');
        void row.offsetWidth;
        row.classList.add('job-row-flash');
      }
    };
    marker.addEventListener('click', jump);
    marker.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') jump();
    });
    svg.appendChild(marker);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(job.pickup.x));
    label.setAttribute('y', String(job.pickup.y + 14));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'jobs-map-label');
    label.textContent = String(index + 1);
    svg.appendChild(label);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'chip jobs-map-chip';
    item.textContent = `${index + 1} · ${job.reference} · ${job.pickupName}`;
    item.addEventListener('click', () => marker.dispatchEvent(new Event('click')));
    legend.appendChild(item);
  });
}

async function refreshDriverJobs() {
  const list = $('#driverJobList');
  if (!list) return;
  const entries = [];
  const seen = new Set();
  if (currentAccount) {
    try {
      const data = await api('/api/jobs/mine');
      (data.jobs || []).forEach((job) => {
        seen.add(job.reference);
        entries.push({ reference: job.reference, job, credential: {}, saved: false });
      });
    } catch {
      // account list unavailable; local driver codes still work
    }
  }
  const stillSaved = [];
  for (const saved of savedDriverJobs()) {
    if (seen.has(saved.reference)) continue;
    try {
      const data = await api(`/api/jobs/driver?code=${encodeURIComponent(saved.code)}`);
      if (!data.job) continue;
      entries.push({ reference: saved.reference, job: data.job, credential: { driverCode: saved.code }, saved });
      stillSaved.push(saved);
    } catch {
      // stale or unknown code; drop it
    }
  }
  saveDriverJobs(stillSaved);
  if ($('#driverJobCount')) $('#driverJobCount').textContent = String(entries.filter((entry) => entry.job).length);
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = currentAccount
      ? 'No claimed jobs for this account yet. Claim one from Open rides.'
      : 'Sign in above, or claim a ride to see it tracked here.';
    list.appendChild(empty);
    return;
  }
  entries.forEach((entry) => list.appendChild(renderDriverJobRow(entry, entry.job)));
}

const DRIVER_ACTIONS = {
  claimed: [{ next: 'enroute', label: 'Next · On the way' }, { release: true, label: 'Release' }],
  enroute: [{ next: 'arrived', label: 'Next · At pickup' }, { fail: true, label: 'Fail ride' }],
  arrived: [{ next: 'picked_up', label: 'Next · Picked up' }, { fail: true, label: 'Fail ride' }],
  picked_up: [{ next: 'completed', label: 'Next · Ride completed' }, { fail: true, label: 'Fail ride' }],
  completed: [{ remove: true, label: 'Remove' }],
  failed: [{ release: true, label: 'Return to open list' }, { remove: true, label: 'Remove' }]
};

const TRACKING_STAGES = ['Booked', 'Driver assigned', 'On the way', 'At pickup', 'On ride', 'Complete'];
const TRACKING_STAGE_INDEX = {
  scheduled: 0,
  profile_required: 0,
  waiting: 0,
  claimed: 1,
  enroute: 2,
  arrived: 3,
  picked_up: 4,
  completed: 5
};

function renderTrackingProgress(status, driverName) {
  const wrap = document.createElement('div');
  wrap.className = 'job-tracking';
  const stageIndex = TRACKING_STAGE_INDEX[status] ?? 0;
  const progress = document.createElement('div');
  progress.className = 'ride-progress job-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.setAttribute('aria-valuenow', String(Math.round((stageIndex / (TRACKING_STAGES.length - 1)) * 100)));
  progress.setAttribute('aria-valuetext', TRACKING_STAGES[stageIndex]);
  const fill = document.createElement('span');
  fill.className = 'ride-progress-fill';
  fill.style.width = `${(stageIndex / (TRACKING_STAGES.length - 1)) * 100}%`;
  progress.appendChild(fill);
  const label = document.createElement('small');
  label.className = 'muted job-tracking-label';
  const nextStage = stageIndex < TRACKING_STAGES.length - 1 ? TRACKING_STAGES[stageIndex + 1] : null;
  label.textContent = `Ride tracking: ${TRACKING_STAGES[stageIndex]}` +
    (driverName ? ` · driven by ${driverName}` : '') +
    (nextStage ? ` · next: ${nextStage}` : ' · ride finished');
  wrap.append(progress, label);
  return wrap;
}

function renderDriverJobRow(entry, job) {
  const row = document.createElement('div');
  row.className = 'saved-booking job-row';
  row.id = `driver-job-row-${job.reference}`;
  const info = document.createElement('div');
  info.className = 'job-row-info';
  const title = document.createElement('b');
  title.textContent = `${job.reference} · ${dispatchStatusText(job.dispatchStatus)}`;
  const detail = document.createElement('small');
  detail.className = 'muted';
  detail.textContent = `${job.mapName} · ${job.pickupName} → ${job.dropoffName} · ${localDateTime(job.departureAt)} · rider: ${job.riderName}` +
    (job.riderRoblox ? ` (@${job.riderRoblox})` : '');
  info.append(title, detail, routeMapSvg(job, 'job-route-map'), renderTrackingProgress(job.dispatchStatus, job.driver?.name));
  const actions = document.createElement('div');
  actions.className = 'job-row-actions';
  const join = document.createElement('a');
  join.className = 'btn ghost';
  join.href = robloxLaunchUrl(job.placeId);
  join.textContent = '🎮 Join game';
  actions.appendChild(join);
  (DRIVER_ACTIONS[job.dispatchStatus] || []).forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action.release || action.remove || action.fail ? 'btn ghost' : 'btn';
    button.textContent = action.label;
    button.addEventListener('click', async () => {
      try {
        if (action.next || action.fail) {
          const status = action.next || 'failed';
          await api(`/api/jobs/${encodeURIComponent(job.reference)}/status`, {
            method: 'POST',
            body: { ...entry.credential, status }
          });
          if (action.next) playSound('tap');
        } else if (action.release) {
          await api(`/api/jobs/${encodeURIComponent(job.reference)}/release`, {
            method: 'POST',
            body: { ...entry.credential }
          });
          if (entry.saved) {
            saveDriverJobs(savedDriverJobs().filter((saved) => saved.reference !== entry.reference));
          }
          toast('Ride released back to the open list.');
        } else if (action.remove) {
          saveDriverJobs(savedDriverJobs().filter((saved) => saved.reference !== entry.reference));
        }
        await loadJobsView();
        if (currentAccount) refreshAccount().catch(() => {});
      } catch (error) {
        toast(error.message);
      }
    });
    actions.appendChild(button);
  });
  row.append(info, actions);
  return row;
}

function activateView(name, wifiPreselect) {
  if (!$(`#view-${name}`)) return;
  if (location.hash !== `#${name}`) location.hash = name;
  $$('#tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'wifi') loadWifi(wifiPreselect);
  if (name === 'premium') loadPlans();
  if (name === 'roblox') loadGames();
  if (name === 'jobs') {
    loadJobsView();
    if (!jobsRefreshTimer) {
      jobsRefreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && $('#view-jobs').classList.contains('active')) {
          loadJobsView();
        }
      }, 10000);
    }
  }
  if (name === 'myrides') {
    renderSavedBookings();
    if (!savedBookingRefreshTimer) {
      savedBookingRefreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && $('#view-myrides').classList.contains('active')) {
          refreshSavedBookingStatuses();
          refreshBookingDetails();
        }
      }, 15000);
    }
  }
}

async function boot() {
  await resolveApiBaseOnce().catch(() => {});
  initializeApiConnection();
  refreshAccount().catch(() => {});
  if (window.UBERS_STATIC_MODE && !activeApiBase()) {
    $('.brand-sub').textContent = 'ROBLOX · LIVE DATA NOT CONNECTED';
    $('#view-integrate .hero p').textContent = 'Configure your Cloudflare HTTPS tunnel URL as the UBERS_API_BASE_URL repository variable to connect GitHub Pages to live Roblox data and bookings.';
    addMsg('Live Roblox data and bookings are not connected. Configure a Cloudflare HTTPS tunnel using the setup instructions below.', 'err');
  }
  try {
    const data = await api('/api/maps');
    (data.maps || []).forEach((m) => (state.maps[m.id] = m));
    if (!state.mapId && Object.keys(state.maps).length) state.mapId = Object.keys(state.maps)[0];
    renderMapSwitch();
    populateRideMapSelect();
    renderMap();
    initializeBookingForm();
    const status = $('#profileStatus');
    if (status && data.sourceProfile && data.profile?.username) {
      status.textContent = `Maps from @${data.profile.username} (${Object.keys(state.maps).length} game${Object.keys(state.maps).length === 1 ? '' : 's'}).`;
    }
  } catch (e) {
    toast(e.message);
    const maps = window.UBERS_STATIC_MODE ? window.UBERS_STATIC_DATA?.maps || [] : [];
    maps.forEach((map) => (state.maps[map.id] = map));
    if (maps.length) {
      if (!state.mapId) state.mapId = maps[0].id;
      renderMapSwitch();
      populateRideMapSelect();
      renderMap();
      initializeBookingForm();
    }
    if (window.UBERS_STATIC_MODE && activeApiBase() && apiServerOutdated) {
      $('#pillLive').textContent = '● SERVER UPDATE REQUIRED';
      $('#pillLive').classList.remove('live');
      $('.brand-sub').textContent = 'ROBLOX · BACKEND UPDATE REQUIRED';
      $('#view-integrate .hero p').textContent = e.message;
    }
  }

  await pollTracking();
  setInterval(pollTracking, 2000);

  if (window.UBERS_STATIC_MODE && !activeApiBase()) {
    $('#pillLive').textContent = '● API NOT CONNECTED';
    $('#pillLive').classList.remove('live');
    $('.brand-sub').textContent = 'ROBLOX · LIVE DATA NOT CONNECTED';
    $('#view-integrate .hero p').textContent = 'Configure your Cloudflare HTTPS tunnel URL as the UBERS_API_BASE_URL repository variable to connect GitHub Pages to live Roblox data and bookings.';
    addMsg('Live Roblox data and bookings are not connected. Configure a Cloudflare HTTPS tunnel using the setup instructions below.', 'err');
    $('.brand-sub').textContent = 'ROBLOX · LIVE DATA NOT CONNECTED';
    $('#view-integrate .hero p').textContent = 'Configure your Cloudflare HTTPS tunnel URL as the UBERS_API_BASE_URL repository variable to connect GitHub Pages to live Roblox data and bookings.';
    addMsg('Live Roblox data and bookings are not connected. Configure a Cloudflare HTTPS tunnel using the setup instructions below.', 'err');
  } else {
    api('/api/health').then((d) => {
      const on = Object.values(d.integrations || {}).filter(Boolean).length;
      const games = Number(d.maps) || 0;
      $('#pillLive').textContent = d.offline
        ? '● API NOT CONNECTED'
        : on
          ? `● LIVE · ${on} INTEGRATIONS`
          : games
            ? `● LIVE · ${games} GAMES`
            : '● LIVE';
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
