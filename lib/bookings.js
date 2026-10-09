const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { MAPS } = require('./maps');

const BOOKING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MINIMUM_NOTICE_MS = 15 * 60 * 1000;
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
  fs.mkdirSync(dataDirectory, { recursive: true });
  const tempFile = `${dataFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempFile, dataFile);
  } catch (error) {
    try {
      fs.unlinkSync(tempFile);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
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
  return {
    id: booking.id,
    reference: booking.reference,
    mapId: booking.mapId,
    mapName: MAPS[booking.mapId].name,
    routeId: booking.routeId,
    routeName: configuredRoute(booking.mapId, booking.routeId).route.name,
    pickupName: MAPS[booking.mapId].pois.find((poi) => poi.id === booking.pickupPoiId).name,
    dropoffName: MAPS[booking.mapId].pois.find((poi) => poi.id === booking.dropoffPoiId).name,
    departureAt: booking.departureAt,
    seats: booking.seats,
    riderName: booking.riderName,
    status: booking.status,
    createdAt: booking.createdAt
  };
}

function create(payload, now = Date.now()) {
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
    status: 'confirmed',
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

function cancel(id, manageKey, now = Date.now()) {
  const booking = authorizedBooking(id, manageKey);
  if (!booking) return null;
  if (booking.status !== 'confirmed') throw bookingError('This booking is already cancelled.', 409);
  if (Date.parse(booking.departureAt) <= now) throw bookingError('A ride cannot be cancelled after its departure time.', 409);
  booking.status = 'cancelled';
  try {
    persist();
  } catch (error) {
    booking.status = 'confirmed';
    throw error;
  }
  return publicBooking(booking);
}

module.exports = { timetable, create, get, cancel, dataFile, PARTY_LIMIT };
