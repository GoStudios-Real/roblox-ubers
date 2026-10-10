// Local accounts for ROBLOX UBERS: sign in / sign up for drivers and riders.
// Passwords are scrypt-hashed with a per-account salt; sessions are random
// bearer tokens stored only as SHA-256 hashes in the local data directory.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { persistAtomic } = require('./safe-store');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const dataDirectory = process.env.UBERS_DATA_DIR ||
  (process.pkg
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'ROBLOX-UBERS')
    : path.join(process.cwd(), 'data'));
const dataFile = path.join(dataDirectory, 'accounts.json');
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

function authError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function emptyStore() {
  return { accounts: [], sessions: {} };
}

function readStore() {
  let contents;
  try {
    contents = fs.readFileSync(dataFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw error;
  }
  const parsed = JSON.parse(contents);
  if (!parsed || !Array.isArray(parsed.accounts) || typeof parsed.sessions !== 'object') {
    throw new Error(`Invalid account store format at ${dataFile}`);
  }
  return parsed;
}

let store = readStore();

function persist() {
  persistAtomic(dataDirectory, dataFile, JSON.stringify(store, null, 2));
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function validateCredentials(payload) {
  const username = typeof payload?.username === 'string' ? payload.username.trim() : '';
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    throw authError('Username must be 3-20 letters, numbers or underscores.');
  }
  const password = typeof payload?.password === 'string' ? payload.password : '';
  if (password.length < 8 || password.length > 100) {
    throw authError('Password must be between 8 and 100 characters.');
  }
  return { username, password };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64, SCRYPT_PARAMS).toString('hex');
}

function publicAccount(account) {
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    createdAt: account.createdAt
  };
}

function cleanupSessions(now = Date.now()) {
  let changed = false;
  for (const [tokenHash, session] of Object.entries(store.sessions)) {
    if (!session || Date.parse(session.expiresAt) <= now) {
      delete store.sessions[tokenHash];
      changed = true;
    }
  }
  return changed;
}

function signUp(payload, now = Date.now()) {
  const { username, password } = validateCredentials(payload);
  const usernameLower = normalizeUsername(username);
  if (store.accounts.some((account) => account.usernameLower === usernameLower)) {
    throw authError('That username is already taken.', 409);
  }
  const displayName = typeof payload?.displayName === 'string' && payload.displayName.trim()
    ? payload.displayName.trim().slice(0, 24)
    : username;
  const salt = crypto.randomBytes(16).toString('hex');
  const account = {
    id: crypto.randomUUID(),
    username,
    usernameLower,
    displayName,
    salt,
    hash: hashPassword(password, salt),
    createdAt: new Date(now).toISOString()
  };
  store.accounts.push(account);
  try {
    persist();
  } catch (error) {
    store.accounts.pop();
    throw error;
  }
  return startSession(account, now);
}

function signIn(payload, now = Date.now()) {
  const { username, password } = validateCredentials(payload);
  const usernameLower = normalizeUsername(username);
  const account = store.accounts.find((entry) => entry.usernameLower === usernameLower);
  const salt = account ? account.salt : '0'.repeat(32);
  const candidate = hashPassword(password, salt);
  if (!account) {
    crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(candidate, 'hex'));
    throw authError('Wrong username or password.', 401);
  }
  const saved = Buffer.from(account.hash, 'hex');
  if (saved.length !== Buffer.from(candidate, 'hex').length ||
      !crypto.timingSafeEqual(saved, Buffer.from(candidate, 'hex'))) {
    throw authError('Wrong username or password.', 401);
  }
  return startSession(account, now);
}

function startSession(account, now = Date.now()) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  if (cleanupSessions(now)) {
    // dropped expired sessions
  }
  store.sessions[tokenHash] = {
    accountId: account.id,
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString()
  };
  try {
    persist();
  } catch (error) {
    delete store.sessions[tokenHash];
    throw error;
  }
  return { token, account: publicAccount(account) };
}

function accountByToken(token, now = Date.now()) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = store.sessions[tokenHash];
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= now) {
    delete store.sessions[tokenHash];
    try {
      persist();
    } catch {
      // session cleanup is best-effort
    }
    return null;
  }
  const account = store.accounts.find((entry) => entry.id === session.accountId);
  return account ? publicAccount(account) : null;
}

function signOut(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    throw authError('Sign-in token is required.', 401);
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  if (!store.sessions[tokenHash]) throw authError('Not signed in.', 401);
  delete store.sessions[tokenHash];
  try {
    persist();
  } catch (error) {
    throw error;
  }
  return { signedOut: true };
}

function accountIdForToken(token) {
  const account = accountByToken(token);
  return account ? account.id : null;
}

function dataFileForTests() {
  return dataFile;
}

module.exports = {
  signUp,
  signIn,
  signOut,
  accountByToken,
  accountIdForToken,
  dataFile: dataFileForTests,
  SESSION_TTL_MS
};
