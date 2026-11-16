import assert from 'node:assert/strict';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { under } from './binding.mjs';

export const gatewayCap = 4 * 1024 * 1024;
export const launcherCap = 256 * 1024;

export function fixtureLayout(disposable, admission) {
  const slots = [];
  for (const [key, stream, stem, cap] of [
    ['gateway', 'gateway', 'gateway.log', gatewayCap],
    ['launcher', 'launcher', 'launcher.log', launcherCap],
    ['fallback', 'launcher', 'launcher.log', launcherCap],
  ]) {
    const layout = admission.logs[key];
    if (key === 'fallback' && admission.mode === 'baseline') {
      assert.equal(layout, null);
      continue;
    }
    assert(layout, key);
    const { directory, active, previous, temporary } = layout;
    if (key === 'fallback') assert(directory === 'temp' || directory.startsWith('temp/'));
    assert.equal(active, stem);
    assert.equal(previous, stem + '.1');
    assert(Array.isArray(temporary) && temporary.length <= 4);
    for (const [name, role] of [[active, 'active'], [previous, 'previous'],
      ...temporary.map((item) => [item, 'temporary'])]) {
      assert(!name.includes('/'));
      slots.push({ key, stream, cap, name, role, file: under(disposable, directory + '/' + name) });
    }
  }
  assert.equal(new Set(slots.map(({ file }) => file.toLowerCase())).size, slots.length);
  return slots;
}

export async function ordinary(file) {
  let stat;
  try { stat = await lstat(file, { bigint: true }); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n, file);
  assert.equal(await realpath(dirname(file)), dirname(file));
  assert(stat.ino > 0n, 'No usable file identity ' + file);
  assert(stat.size <= BigInt(Number.MAX_SAFE_INTEGER), file);
  return { id: stat.dev + ':' + stat.ino, bytes: Number(stat.size) };
}

// Live file lengths are observations. A rotation can intervene between Windows file reads.
export async function sample(slots, enforce, label, allowedEntries) {
  function scan() {
    return Promise.all(slots.map(async (slot) => ({ ...slot, ...(await ordinary(slot.file)) })));
  }
  function names(rows) { return rows.map((row) => row.file + ':' + (row.id ?? '-')); }
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await scan();
    const rows = await scan();
    if (JSON.stringify(names(before)) !== JSON.stringify(names(rows))) continue;
    const ids = rows.filter((row) => row.id).map((row) => row.id);
    if (new Set(ids).size !== ids.length) continue;
    const unexpected = [];
    for (const parent of new Set(slots.map((slot) => dirname(slot.file)))) {
      let entries;
      try { entries = await readdir(parent); } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      for (const item of entries) {
        const path = under(parent, item);
        if (!slots.some((slot) => slot.file === path) && !allowedEntries.has(path)) unexpected.push(path);
      }
    }
    const gateway = rows.filter((row) => row.stream === 'gateway')
      .reduce((sum, row) => sum + (row.bytes ?? 0), 0);
    const launcher = rows.filter((row) => row.stream === 'launcher')
      .reduce((sum, row) => sum + (row.bytes ?? 0), 0);
    const violations = rows.filter((row) => row.bytes > row.cap).map((row) => row.file);
    if (gateway > 2 * gatewayCap) violations.push('gateway aggregate bytes');
    if (launcher > 2 * launcherCap) violations.push('launcher aggregate bytes across both roots');
    return { at: new Date().toISOString(), label, rows, gateway, launcher, unexpected, violations,
      safe: !enforce || (violations.length === 0 && unexpected.length === 0) };
  }
  return { at: new Date().toISOString(), label, unstable: true };
}

export async function tail(path, maxBytes = 512 * 1024) {
  const info = await ordinary(path);
  if (!info) return Buffer.alloc(0);
  const file = await open(path, 'r');
  try {
    const end = Number((await file.stat({ bigint: true })).size);
    const buffer = Buffer.alloc(Math.min(end, maxBytes));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, end - buffer.length);
    const bytes = buffer.subarray(0, bytesRead);
    // Discard a partial first record when starting inside a file.
    if (end <= maxBytes) return bytes;
    const delimiter = bytes.indexOf(10);
    return delimiter < 0 ? Buffer.alloc(0) : bytes.subarray(delimiter + 1);
  } finally { await file.close(); }
}

export function pinoRecords(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = text.split('\n');
  lines.pop();
  return lines.filter(Boolean).map((line) => JSON.parse(line));
}
