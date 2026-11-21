'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const net = require('node:net');
const { syncBuiltinESMExports } = require('node:module');
const logFile = process.env.D194_OBSERVER_LOG;
if (!logFile) throw new Error('D194_OBSERVER_LOG is required');
let fetchAttempts = 0;
let socketAttempts = 0;
function record(event) {
  fs.appendFileSync(logFile, JSON.stringify({ utc: new Date().toISOString(), pid: process.pid, ...event }) + '\n');
}
record({ event: 'observer-installed', cwd: process.cwd(), argv: process.argv, node: process.version });
globalThis.fetch = async function d194BlockedFetch(input) {
  fetchAttempts++;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  record({ event: 'blocked-fetch', url, stack: new Error().stack });
  throw new TypeError('D194 outbound fetch blocked');
};
net.Socket.prototype.connect = function d194BlockedSocket(...args) {
  socketAttempts++;
  record({ event: 'blocked-socket', args: args.map((item) => typeof item === 'function' ? '[callback]' : item), stack: new Error().stack });
  throw new Error('D194 outbound socket blocked');
};
if (process.env.D194_STORAGE_TRACE === '1') {
  const promises = fs.promises;
  const readFile = promises.readFile;
  const readdir = promises.readdir;
  const blobDirectory = process.env.D194_STORAGE_BLOBS;
  if (!blobDirectory) throw new Error('D194_STORAGE_BLOBS is required');
  fs.mkdirSync(blobDirectory, { recursive: true });
  function inFixture(file) {
    return typeof file === 'string' && /[\\/]gg-preflight-catalog-[^\\/]+/.test(file);
  }
  promises.readFile = async function d194ObservedRead(file, ...args) {
    const result = await readFile.call(this, file, ...args);
    if (inFixture(file) && /\.db(?:-wal)?$/.test(file) && Buffer.isBuffer(result)) {
      const sha256 = crypto.createHash('sha256').update(result).digest('hex');
      const blob = require('node:path').join(blobDirectory, sha256 + '.blob');
      if (!fs.existsSync(blob)) fs.writeFileSync(blob, result, { flag: 'wx' });
      record({ event: 'storage-read', path: file, size: result.length, sha256 });
    }
    return result;
  };
  promises.readdir = async function d194ObservedListing(file, ...args) {
    const result = await readdir.call(this, file, ...args);
    if (inFixture(file)) record({ event: 'storage-listing', path: file, names: result });
    return result;
  };
  syncBuiltinESMExports();
}
process.on('exit', (code) => record({ event: 'observer-exit', code, fetchAttempts, socketAttempts }));
