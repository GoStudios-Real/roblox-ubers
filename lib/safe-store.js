// Atomic JSON writes that survive Windows transient file locks
// (antivirus, sync tools, and concurrent readers can make rename() fail
// with EPERM/EACCES for a few milliseconds).

const fs = require('fs');
const crypto = require('crypto');

const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY', 'EAGAIN', 'ETIMEDOUT', 'UNKNOWN']);
const MAX_ATTEMPTS = 6;

function sleepSync(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* busy wait: keeps sync API synchronous */ }
}

function persistAtomic(dataDirectory, dataFile, contents) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const tempFile = `${dataFile}.${process.pid}.${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}.tmp`;
  let lastError = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      fs.writeFileSync(tempFile, contents, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempFile, dataFile);
      return;
    } catch (error) {
      lastError = error;
      try {
        fs.unlinkSync(tempFile);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') { /* keep the original error */ }
      }
      if (!RETRYABLE.has(error.code)) throw error;
      if (attempt < MAX_ATTEMPTS - 1) sleepSync(80 * (attempt + 1));
    }
  }
  const failure = new Error(
    `Could not save data to ${dataFile} (${lastError.code || lastError.message}). Another program may be using the file — try again.`
  );
  failure.statusCode = 500;
  failure.cause = lastError;
  throw failure;
}

module.exports = { persistAtomic, RETRYABLE, MAX_ATTEMPTS };
