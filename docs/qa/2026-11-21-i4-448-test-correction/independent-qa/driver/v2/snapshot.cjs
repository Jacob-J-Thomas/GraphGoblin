'use strict';
// Independent SQLite store-file observer (QA448). Synchronous, read-only measurements of a directory:
// listing, sizes, SHA-256 and parsed SQLite database / WAL headers including WAL frame checksum
// validation. It never opens files through SQLite and never writes into the observed directory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STORE_FILE = /\.db(?:-wal|-shm|-journal)?$/;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function dbHeader(buf) {
  if (buf.length < 100) return { valid: false, size: buf.length };
  const magic = buf.subarray(0, 16).toString('latin1');
  const rawPage = buf.readUInt16BE(16);
  return {
    valid: magic === 'SQLite format 3\u0000',
    pageSize: rawPage === 1 ? 65536 : rawPage,
    writeVersion: buf[18],
    readVersion: buf[19],
    walModeHeader: buf[18] === 2 && buf[19] === 2,
    fileChangeCounter: buf.readUInt32BE(24),
    pageCount: buf.readUInt32BE(28),
    schemaCookie: buf.readUInt32BE(40),
    versionValidFor: buf.readUInt32BE(92),
    sqliteVersionNumber: buf.readUInt32BE(96),
  };
}

// SQLite WAL checksum (https://www.sqlite.org/fileformat2.html#walformat).
function walChecksum(bytes, bigEndian, s0, s1) {
  for (let i = 0; i + 8 <= bytes.length; i += 8) {
    const x0 = bigEndian ? bytes.readUInt32BE(i) : bytes.readUInt32LE(i);
    const x1 = bigEndian ? bytes.readUInt32BE(i + 4) : bytes.readUInt32LE(i + 4);
    s0 = (s0 + x0 + s1) >>> 0;
    s1 = (s1 + x1 + s0) >>> 0;
  }
  return [s0, s1];
}

function walInfo(buf) {
  const info = { size: buf.length };
  if (buf.length === 0) return { ...info, empty: true };
  if (buf.length < 32) return { ...info, empty: false, headerComplete: false };
  const magic = buf.readUInt32BE(0);
  const bigEndian = (magic & 1) === 1;
  const pageSize = buf.readUInt32BE(8);
  const salt1 = buf.readUInt32BE(16);
  const salt2 = buf.readUInt32BE(20);
  let [s0, s1] = walChecksum(buf.subarray(0, 24), bigEndian, 0, 0);
  const headerChecksumValid = s0 === buf.readUInt32BE(24) && s1 === buf.readUInt32BE(28);
  Object.assign(info, {
    empty: false,
    headerComplete: true,
    magic: `0x${magic.toString(16)}`,
    magicValid: magic === 0x377f0682 || magic === 0x377f0683,
    formatVersion: buf.readUInt32BE(4),
    pageSize,
    checkpointSequence: buf.readUInt32BE(12),
    salt1,
    salt2,
    headerChecksumValid,
  });
  const frameSize = 24 + pageSize;
  const frames = [];
  let validPrefix = 0;
  let chainValid = headerChecksumValid;
  for (let off = 32; pageSize > 0 && off + frameSize <= buf.length; off += frameSize) {
    const pageNumber = buf.readUInt32BE(off);
    const commitSize = buf.readUInt32BE(off + 4);
    const saltMatch = buf.readUInt32BE(off + 8) === salt1 && buf.readUInt32BE(off + 12) === salt2;
    [s0, s1] = walChecksum(buf.subarray(off, off + 8), bigEndian, s0, s1);
    [s0, s1] = walChecksum(buf.subarray(off + 24, off + frameSize), bigEndian, s0, s1);
    const checksumValid = s0 === buf.readUInt32BE(off + 16) && s1 === buf.readUInt32BE(off + 20);
    chainValid = chainValid && saltMatch && checksumValid;
    if (chainValid) validPrefix++;
    frames.push({ pageNumber, commitSize, saltMatch, checksumValid });
  }
  info.frameCount = frames.length;
  info.trailingBytes = pageSize > 0 ? (buf.length - 32) % frameSize : buf.length - 32;
  info.validFramePrefix = validPrefix;
  info.commitFramesInValidPrefix = frames.slice(0, validPrefix).filter((f) => f.commitSize > 0).length;
  info.frames = frames;
  return info;
}

function saveBlob(blobDir, buf, digest) {
  if (!blobDir) return undefined;
  fs.mkdirSync(blobDir, { recursive: true });
  const file = path.join(blobDir, `${digest}.bin`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(`${file}.partial-${process.pid}`, buf);
    try {
      fs.renameSync(`${file}.partial-${process.pid}`, file);
    } catch {
      fs.rmSync(`${file}.partial-${process.pid}`, { force: true });
    }
  }
  return file;
}

function describeFile(full, name, blobDir) {
  const st = fs.lstatSync(full);
  const entry = { name, type: st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other', size: st.size, mtimeMs: st.mtimeMs };
  if (entry.type === 'file' && STORE_FILE.test(name)) {
    const buf = fs.readFileSync(full);
    entry.readSize = buf.length;
    entry.sha256 = sha256(buf);
    if (name.endsWith('.db')) entry.dbHeader = dbHeader(buf);
    if (name.endsWith('.db-wal')) entry.wal = walInfo(buf);
    entry.blob = saveBlob(blobDir, buf, entry.sha256);
  }
  return entry;
}

function snapshotDir(dir, options = {}) {
  const result = { dir, utc: new Date().toISOString() };
  let names;
  try {
    names = fs.readdirSync(dir).sort();
  } catch (error) {
    result.error = error.code ?? String(error);
    return result;
  }
  result.entries = [];
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const entry = describeFile(full, name, options.blobDir);
      result.entries.push(entry);
      if (entry.type === 'dir' && options.recursive) entry.children = snapshotDir(full, options);
    } catch (error) {
      result.entries.push({ name, error: error.code ?? String(error) });
    }
  }
  return result;
}

module.exports = { snapshotDir, dbHeader, walInfo, sha256, STORE_FILE };
