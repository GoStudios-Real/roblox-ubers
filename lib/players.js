const crypto = require('crypto');
const { getMap } = require('./maps');

const PLAYER_TTL_MS = 20000;
const MAX_PLAYERS_PER_SERVER = 100;
const servers = new Map();

function reportFromRoblox(payload, secret) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('report must be an object');
  }
  const map = getMap(payload.map);
  if (!map) throw new TypeError('unknown map');
  if (typeof payload.serverId !== 'string' || payload.serverId.length < 5 || payload.serverId.length > 128) {
    throw new TypeError('serverId must be a string between 5 and 128 characters');
  }
  if (!Array.isArray(payload.players) || payload.players.length > MAX_PLAYERS_PER_SERVER) {
    throw new TypeError(`players must be an array of at most ${MAX_PLAYERS_PER_SERVER} entries`);
  }

  const now = Date.now();
  const serverKey = `${map.id}:${payload.serverId}`;
  if (!payload.players.length) {
    servers.delete(serverKey);
    return { accepted: 0, activeServers: servers.size };
  }

  const seen = new Set();
  const players = payload.players.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('each player must be an object');
    }
    const userId = String(raw.userId || '');
    const x = Number(raw.x);
    const y = Number(raw.y);
    const heading = Number(raw.heading || 0);
    if (!/^\d{1,20}$/.test(userId)) throw new TypeError('each player needs a numeric userId');
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000) {
      throw new TypeError('player coordinates must be between 0 and 1000');
    }
    if (!Number.isFinite(heading)) throw new TypeError('player heading must be a finite number');

    const id = crypto.createHmac('sha256', secret).update(`${serverKey}:${userId}`).digest('hex').slice(0, 16);
    if (seen.has(id)) throw new TypeError('duplicate player in report');
    seen.add(id);
    return { id, x, y, heading, updatedAt: now };
  });

  servers.set(serverKey, { map: map.id, players, updatedAt: now });
  return { accepted: players.length, activeServers: servers.size };
}

function snapshot(mapId) {
  const now = Date.now();
  const output = [];
  let activeServers = 0;
  let updatedAt = 0;
  for (const [key, server] of servers) {
    if (now - server.updatedAt > PLAYER_TTL_MS) {
      servers.delete(key);
      continue;
    }
    if (mapId && server.map !== mapId) continue;
    activeServers += 1;
    updatedAt = Math.max(updatedAt, server.updatedAt);
    output.push(...server.players);
  }
  return { players: output, activeServers, updatedAt };
}

module.exports = { reportFromRoblox, snapshot, PLAYER_TTL_MS };
