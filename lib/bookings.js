const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { persistAtomic } = require('./safe-store');
const {
  MAPS,
  configuredPlaceId: configuredRobloxPlaceId,
  getConfiguredMap
} = require('./maps');

const BOOKING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MINIMUM_NOTICE_MS = 15 * 60 * 1000;
const DISPATCH_EARLY_MS = 15 * 60 * 1000;
const DISPATCH_LATE_MS = 30 * 60 * 1000;
const DISPATCH_LEASE_MS = 2 * 60 * 1000;
const PARTY_LIMIT = 4;
const dataDirectory = process.env.UBERS_DATA_DIR ||
  (process.pkg
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'ROBLOX-UBERS')
    : path.join(process.cwd(), 'data'));
const dataFile = path.join(dataDirectory, 'bookings.json');

function bookingError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function authNeeded(message = 'Sign in to continue.') {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
}

function readStore() {
  let contents;
  try {
    contents = fs.readFileSync(dataFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { bookings: [] };
    throw error;
  }
  const parsed = JSON.parse(contents);
  if (!parsed || !Array.isArray(parsed.bookings)) {
    throw new Error(`Invalid booking store format at ${dataFile}`);
  }
  return parsed;
}

let store = readStore();

function persist() {
  persistAtomic(dataDirectory, dataFile, JSON.stringify(store, null, 2));
}

function configuredRoute(mapId, routeId) {
  const map = MAPS[mapId];
  const route = map?.routes.find((entry) => entry.id === routeId);
  if (!map || !route) return null;
  return { map, route };
}

function capacityFor(route) {
  return route.id.startsWith('b') ? 32 : 4;
}

function configuredPlaceId(mapId) {
  return configuredRobloxPlaceId(mapId);
}

function occupiedSeats(mapId, routeId, departureAt) {
  return store.bookings
    .filter((booking) =>
      booking.mapId === mapId &&
      booking.routeId === routeId &&
      booking.departureAt === departureAt &&
      booking.status === 'confirmed')
    .reduce((sum, booking) => sum + booking.seats, 0);
}

function timetable(mapId, routeId, now = Date.now()) {
  const configured = configuredRoute(mapId, routeId);
  if (!configured) throw bookingError('Choose a valid game and route.');
  const capacity = capacityFor(configured.route);
  const departures = [];
  let start = Math.ceil((now + MINIMUM_NOTICE_MS) / (30 * 60 * 1000)) * 30 * 60 * 1000;
  const end = now + BOOKING_WINDOW_MS;
  for (; start <= end; start += 30 * 60 * 1000) {
    const departureAt = new Date(start).toISOString();
    const seatsBooked = occupiedSeats(mapId, routeId, departureAt);
    if (seatsBooked < capacity) {
      departures.push({ departureAt, seatsAvailable: capacity - seatsBooked, capacity });
    }
  }
  return {
    mapId,
    route: { id: configured.route.id, name: configured.route.name, type: routeType(configured.route) },
    departures
  };
}

function routeType(route) {
  return route.id.startsWith('b') ? 'bus' : route.id.startsWith('c') ? 'taxi' : 'car';
}

function publicBooking(booking) {
  let dispatchStatus = booking.dispatchStatus;
  if (dispatchStatus === 'scheduled') {
    if (!booking.robloxProfile?.userId) dispatchStatus = 'profile_required';
    else if (Date.parse(booking.departureAt) <= Date.now() + DISPATCH_EARLY_MS) dispatchStatus = 'waiting';
  }
  return {
    id: booking.id,
    reference: booking.reference,
    mapId: booking.mapId,
    mapName: getConfiguredMap(booking.mapId).name,
    placeId: configuredPlaceId(booking.mapId),
    routeId: booking.routeId,
    routeName: configuredRoute(booking.mapId, booking.routeId).route.name,
    pickupName: MAPS[booking.mapId].pois.find((poi) => poi.id === booking.pickupPoiId).name,
    dropoffName: MAPS[booking.mapId].pois.find((poi) => poi.id === booking.dropoffPoiId).name,
    departureAt: booking.departureAt,
    seats: booking.seats,
    riderName: booking.riderName,
    robloxProfile: booking.robloxProfile || null,
    driver: booking.driver
      ? { name: booking.driver.name, username: booking.driver.username || null }
      : null,
    status: booking.status,
    dispatchStatus,
    dispatchServerId: booking.dispatchServerId || null,
    createdAt: booking.createdAt
  };
}

function create(payload, now = Date.now(), robloxProfile = null, accountId = null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw bookingError('Booking details are required.');
  }
  const { mapId, routeId, pickupPoiId, dropoffPoiId } = payload;
  const configured = configuredRoute(String(mapId || ''), String(routeId || ''));
  if (!configured) throw bookingError('Choose a valid game and route.');
  const pickup = configured.map.pois.find((poi) => poi.id === pickupPoiId && poi.cat !== 'wifi');
  const dropoff = configured.map.pois.find((poi) => poi.id === dropoffPoiId && poi.cat !== 'wifi');
  if (!pickup || !dropoff || pickup.id === dropoff.id) {
    throw bookingError('Choose two different pickup and drop-off places.');
  }

  const departureTime = Date.parse(payload.departureAt);
  if (!Number.isFinite(departureTime) ||
      departureTime < now + MINIMUM_NOTICE_MS ||
      departureTime > now + BOOKING_WINDOW_MS ||
      departureTime % (30 * 60 * 1000) !== 0) {
    throw bookingError('Choose an available 30-minute timetable slot within the next 7 days.');
  }

  const riderName = typeof payload.riderName === 'string' ? payload.riderName.trim() : '';
  if (riderName.length < 2 || riderName.length > 24 || /[\u0000-\u001f\u007f]/.test(riderName)) {
    throw bookingError('Enter a display name between 2 and 24 characters. Do not use private contact details.');
  }
  const seats = Number(payload.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > PARTY_LIMIT) {
    throw bookingError(`Choose between 1 and ${PARTY_LIMIT} seats per booking.`);
  }

  const departureAt = new Date(departureTime).toISOString();
  const capacity = capacityFor(configured.route);
  const seatsBooked = occupiedSeats(mapId, routeId, departureAt);
  if (seatsBooked + seats > capacity) {
    throw bookingError('That departure no longer has enough seats. Choose another timetable slot.', 409);
  }

  const id = crypto.randomUUID();
  const manageKey = crypto.randomBytes(32).toString('hex');
  const booking = {
    id,
    reference: `UBR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    mapId,
    routeId,
    pickupPoiId: pickup.id,
    dropoffPoiId: dropoff.id,
    departureAt,
    seats,
    riderName,
    robloxProfile: robloxProfile
      ? { userId: robloxProfile.userId, username: robloxProfile.username, displayName: robloxProfile.displayName }
      : null,
    status: 'confirmed',
    dispatchStatus: 'scheduled',
    accountId: accountId || null,
    createdAt: new Date(now).toISOString(),
    manageKeyHash: crypto.createHash('sha256').update(manageKey).digest('hex')
  };
  store.bookings.push(booking);
  try {
    persist();
  } catch (error) {
    store.bookings.pop();
    throw error;
  }
  return { ...publicBooking(booking), manageKey };
}

function nextDispatch(mapId, now = Date.now()) {
  if (!MAPS[mapId]) throw bookingError('Choose a valid game map.');
  const booking = store.bookings
    .filter((entry) =>
      entry.mapId === mapId &&
      entry.status === 'confirmed' &&
      entry.robloxProfile?.userId &&
      entry.dispatchStatus === 'scheduled' &&
      Date.parse(entry.departureAt) >= now - DISPATCH_LATE_MS &&
      Date.parse(entry.departureAt) <= now + DISPATCH_EARLY_MS)
    .sort((a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt))[0];
  return booking ? { reference: booking.reference, departureAt: booking.departureAt } : null;
}

function dispatchDetails(booking) {
  const map = MAPS[booking.mapId];
  const route = configuredRoute(booking.mapId, booking.routeId).route;
  const pickup = map.pois.find((poi) => poi.id === booking.pickupPoiId);
  const dropoff = map.pois.find((poi) => poi.id === booking.dropoffPoiId);
  return {
    reference: booking.reference,
    mapId: booking.mapId,
    mapName: getConfiguredMap(booking.mapId).name,
    placeId: configuredPlaceId(booking.mapId),
    route: { id: route.id, name: route.name, type: routeType(route) },
    departureAt: booking.departureAt,
    seats: booking.seats,
    riderName: booking.riderName,
    robloxProfile: booking.robloxProfile || null,
    pickup: { id: pickup.id, name: pickup.name, x: pickup.x, y: pickup.y },
    dropoff: { id: dropoff.id, name: dropoff.name, x: dropoff.x, y: dropoff.y }
  };
}

function claimDispatch(reference, mapId, serverId, now = Date.now()) {
  if (!MAPS[mapId]) throw bookingError('Choose a valid game map.');
  if (typeof serverId !== 'string' || serverId.length < 5 || serverId.length > 128) {
    throw bookingError('serverId must be a string between 5 and 128 characters.');
  }
  const booking = store.bookings.find((entry) => entry.reference === reference);
  if (!booking || booking.mapId !== mapId || booking.status !== 'confirmed') return null;
  if (booking.driver) throw bookingError('This ride is claimed by a website driver.', 409);
  const departureTime = Date.parse(booking.departureAt);
  if (departureTime < now - DISPATCH_LATE_MS || departureTime > now + DISPATCH_EARLY_MS) {
    throw bookingError('This ride is outside its dispatch window.', 409);
  }
  if (booking.dispatchStatus === 'claimed' &&
      booking.dispatchServerId !== serverId &&
      now - Date.parse(booking.dispatchUpdatedAt) < DISPATCH_LEASE_MS) {
    throw bookingError('Another game server has claimed this ride.', 409);
  }
  if (booking.dispatchStatus !== 'scheduled' && booking.dispatchStatus !== 'claimed') {
    throw bookingError('This ride has already been dispatched.', 409);
  }

  const previous = {
    dispatchStatus: booking.dispatchStatus,
    dispatchServerId: booking.dispatchServerId,
    dispatchUpdatedAt: booking.dispatchUpdatedAt
  };
  booking.dispatchStatus = 'claimed';
  booking.dispatchServerId = serverId;
  booking.dispatchUpdatedAt = new Date(now).toISOString();
  try {
    persist();
  } catch (error) {
    Object.assign(booking, previous);
    throw error;
  }
  return dispatchDetails(booking);
}

const DISPATCH_TRANSITIONS = {
  claimed: ['enroute', 'failed'],
  enroute: ['enroute', 'arrived', 'failed'],
  arrived: ['arrived', 'picked_up', 'failed'],
  picked_up: ['picked_up', 'completed', 'failed']
};

function updateDispatch(reference, serverId, status, now = Date.now()) {
  const booking = store.bookings.find((entry) => entry.reference === reference);
  if (!booking || booking.dispatchServerId !== serverId) return null;
  if (!DISPATCH_TRANSITIONS[booking.dispatchStatus]?.includes(status)) {
    throw bookingError(`Invalid dispatch status transition: ${booking.dispatchStatus} to ${status}.`, 409);
  }

  const previousStatus = booking.dispatchStatus;
  const previousUpdatedAt = booking.dispatchUpdatedAt;
  booking.dispatchStatus = status;
  booking.dispatchUpdatedAt = new Date(now).toISOString();
  try {
    persist();
  } catch (error) {
    booking.dispatchStatus = previousStatus;
    booking.dispatchUpdatedAt = previousUpdatedAt;
    throw error;
  }
  return publicBooking(booking);
}

function authorizedBooking(id, manageKey) {
  if (typeof manageKey !== 'string' || !/^[a-f0-9]{64}$/.test(manageKey)) return null;
  const booking = store.bookings.find((entry) => entry.id === id || entry.reference === id);
  if (!booking) return null;
  const candidate = crypto.createHash('sha256').update(manageKey).digest();
  const saved = Buffer.from(booking.manageKeyHash, 'hex');
  return saved.length === candidate.length && crypto.timingSafeEqual(saved, candidate) ? booking : null;
}

function get(id, manageKey) {
  const booking = authorizedBooking(id, manageKey);
  return booking ? publicBooking(booking) : null;
}

function setRobloxProfile(id, manageKey, profile) {
  const booking = authorizedBooking(id, manageKey);
  if (!booking) return null;
  if (booking.status !== 'confirmed' || booking.dispatchStatus !== 'scheduled') {
    throw bookingError('A Roblox profile can only be linked to a scheduled booking.', 409);
  }
  if (!profile || !/^\d{1,20}$/.test(String(profile.userId)) ||
      typeof profile.username !== 'string' || typeof profile.displayName !== 'string') {
    throw bookingError('A valid public Roblox profile is required.');
  }

  const previous = booking.robloxProfile;
  booking.robloxProfile = {
    userId: String(profile.userId),
    username: profile.username,
    displayName: profile.displayName
  };
  try {
    persist();
  } catch (error) {
    booking.robloxProfile = previous;
    throw error;
  }
  return publicBooking(booking);
}

function cancel(id, manageKey, now = Date.now()) {
  const booking = authorizedBooking(id, manageKey);
  if (!booking) return null;
  if (booking.status !== 'confirmed') throw bookingError('This booking is already cancelled.', 409);
  if (booking.dispatchStatus !== 'scheduled' && booking.dispatchStatus !== 'failed') {
    throw bookingError('A ride already assigned to a driver cannot be cancelled from the website.', 409);
  }
  if (Date.parse(booking.departureAt) <= now) throw bookingError('A ride cannot be cancelled after its departure time.', 409);
  const previousStatus = booking.status;
  const previousDispatch = booking.dispatchStatus;
  booking.status = 'cancelled';
  booking.dispatchStatus = 'cancelled';
  booking.driver = null;
  try {
    persist();
  } catch (error) {
    booking.status = previousStatus;
    booking.dispatchStatus = previousDispatch;
    throw error;
  }
  return publicBooking(booking);
}

// ---------- Website driver jobs: real players drive, no bots ----------
function hasControlChars(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function jobView(booking) {
  const configured = configuredRoute(booking.mapId, booking.routeId);
  const pickup = MAPS[booking.mapId]?.pois.find((poi) => poi.id === booking.pickupPoiId);
  const dropoff = MAPS[booking.mapId]?.pois.find((poi) => poi.id === booking.dropoffPoiId);
  return {
    reference: booking.reference,
    mapId: booking.mapId,
    mapName: getConfiguredMap(booking.mapId).name,
    placeId: configuredPlaceId(booking.mapId),
    routeId: booking.routeId,
    routeName: configured?.route.name || booking.routeId,
    routeType: configured ? routeType(configured.route) : null,
    pickupName: pickup?.name || booking.pickupPoiId,
    dropoffName: dropoff?.name || booking.dropoffPoiId,
    pickup: pickup ? { id: pickup.id, x: pickup.x, y: pickup.y } : null,
    dropoff: dropoff ? { id: dropoff.id, x: dropoff.x, y: dropoff.y } : null,
    routeStops: configured?.route.stops || null,
    departureAt: booking.departureAt,
    seats: booking.seats,
    riderName: booking.riderName,
    riderRoblox: booking.robloxProfile?.username || null,
    dispatchStatus: booking.dispatchStatus,
    driver: booking.driver
      ? { name: booking.driver.name, username: booking.driver.username || null, claimedAt: booking.driver.claimedAt }
      : null,
    updatedAt: booking.dispatchUpdatedAt || null
  };
}

function listJobs(mapId, now = Date.now()) {
  if (mapId && !MAPS[mapId]) throw bookingError('Choose a valid game map.');
  return store.bookings
    .filter((booking) =>
      booking.status === 'confirmed' &&
      booking.dispatchStatus === 'scheduled' &&
      !booking.driver &&
      (!mapId || booking.mapId === mapId) &&
      Date.parse(booking.departureAt) >= now - DISPATCH_LATE_MS &&
      Date.parse(booking.departureAt) <= now + BOOKING_WINDOW_MS)
    .sort((a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt))
    .slice(0, 50)
    .map(jobView);
}

function claimJob(reference, payload, accountId, now = Date.now()) {
  if (!accountId) throw authNeeded('Sign in to claim a ride.');
  const driverName = typeof payload?.driverName === 'string' && payload.driverName.trim()
    ? payload.driverName.trim()
    : String(payload?.displayName || '').trim();
  if (driverName.length < 2 || driverName.length > 24 || hasControlChars(driverName)) {
    throw bookingError('Enter a driver display name between 2 and 24 characters.');
  }
  const driverUsername = typeof payload?.driverUsername === 'string' ? payload.driverUsername.trim() : '';
  if (driverUsername && !/^[A-Za-z0-9_]{3,20}$/.test(driverUsername)) {
    throw bookingError('Enter a valid Roblox username (3-20 letters, numbers or underscores).');
  }
  const booking = store.bookings.find((entry) => entry.reference === reference);
  if (!booking) throw bookingError('Booking not found.', 404);
  if (booking.status !== 'confirmed') throw bookingError('This ride is no longer available.', 409);
  if (booking.dispatchStatus !== 'scheduled' || booking.driver) {
    throw bookingError('This ride already has a driver.', 409);
  }
  if (Date.parse(booking.departureAt) <= now) throw bookingError('This ride has already departed.', 409);

  const driverCode = crypto.randomBytes(32).toString('hex');
  const previous = {
    driver: booking.driver,
    dispatchStatus: booking.dispatchStatus,
    dispatchServerId: booking.dispatchServerId,
    dispatchUpdatedAt: booking.dispatchUpdatedAt
  };
  booking.driver = {
    name: driverName,
    username: driverUsername || null,
    accountId,
    codeHash: crypto.createHash('sha256').update(driverCode).digest('hex'),
    claimedAt: new Date(now).toISOString()
  };
  booking.dispatchStatus = 'claimed';
  booking.dispatchServerId = `web-driver-${crypto.randomBytes(8).toString('hex')}`;
  booking.dispatchUpdatedAt = new Date(now).toISOString();
  try {
    persist();
  } catch (error) {
    Object.assign(booking, previous);
    throw error;
  }
  return { job: jobView(booking), driverCode };
}

function bookingByDriverCode(driverCode) {
  if (typeof driverCode !== 'string' || !/^[a-f0-9]{64}$/.test(driverCode)) return null;
  const candidate = crypto.createHash('sha256').update(driverCode).digest();
  const booking = store.bookings.find((entry) =>
    entry.driver?.codeHash &&
    Buffer.from(entry.driver.codeHash, 'hex').length === candidate.length &&
    crypto.timingSafeEqual(Buffer.from(entry.driver.codeHash, 'hex'), candidate));
  return booking || null;
}

function getDriverJob(driverCode) {
  const booking = bookingByDriverCode(driverCode);
  return booking ? jobView(booking) : null;
}

function bookingForDriver(reference, credential = {}) {
  const booking = store.bookings.find((entry) => entry.reference === reference);
  if (!booking || !booking.driver) return null;
  if (typeof credential.driverCode === 'string' && /^[a-f0-9]{64}$/.test(credential.driverCode)) {
    const candidate = crypto.createHash('sha256').update(credential.driverCode).digest();
    if (Buffer.from(booking.driver.codeHash, 'hex').length === candidate.length &&
        crypto.timingSafeEqual(Buffer.from(booking.driver.codeHash, 'hex'), candidate)) {
      return booking;
    }
  }
  if (credential.accountId && booking.driver.accountId === credential.accountId) return booking;
  return null;
}

function listMine(accountId, now = Date.now()) {
  if (!accountId) throw authNeeded('Sign in to see your driver jobs.');
  return store.bookings
    .filter((booking) => booking.driver?.accountId === accountId &&
      ['claimed', 'enroute', 'arrived', 'picked_up'].includes(booking.dispatchStatus) &&
      Date.parse(booking.departureAt) >= now - DISPATCH_LATE_MS)
    .sort((a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt))
    .map(jobView);
}

function listMineBookings(accountId) {
  if (!accountId) throw authNeeded('Sign in to see your bookings.');
  return store.bookings
    .filter((booking) => booking.accountId === accountId || booking.driver?.accountId === accountId)
    .sort((a, b) => Date.parse(b.departureAt) - Date.parse(a.departureAt))
    .map(publicBooking);
}

function updateDriverStatus(reference, credential, status, now = Date.now()) {
  const booking = bookingForDriver(reference, credential);
  if (!booking) throw bookingError('Unknown driver credential for this ride.', 404);
  updateDispatch(reference, booking.dispatchServerId, status, now);
  return jobView(store.bookings.find((entry) => entry.reference === reference));
}

function releaseJob(reference, credential, now = Date.now()) {
  const booking = bookingForDriver(reference, credential);
  if (!booking) throw bookingError('Unknown driver credential for this ride.', 404);
  if (['picked_up', 'completed'].includes(booking.dispatchStatus)) {
    throw bookingError('An in-progress ride cannot be released. Mark it completed or failed instead.', 409);
  }
  const previous = {
    driver: booking.driver,
    dispatchStatus: booking.dispatchStatus,
    dispatchServerId: booking.dispatchServerId,
    dispatchUpdatedAt: booking.dispatchUpdatedAt
  };
  booking.driver = null;
  booking.dispatchStatus = 'scheduled';
  booking.dispatchServerId = null;
  booking.dispatchUpdatedAt = new Date(now).toISOString();
  try {
    persist();
  } catch (error) {
    Object.assign(booking, previous);
    throw error;
  }
  return jobView(booking);
}

module.exports = {
  timetable,
  create,
  nextDispatch,
  claimDispatch,
  updateDispatch,
  get,
  setRobloxProfile,
  cancel,
  listJobs,
  claimJob,
  getDriverJob,
  listMine,
  listMineBookings,
  updateDriverStatus,
  releaseJob,
  dataFile,
  PARTY_LIMIT
};
