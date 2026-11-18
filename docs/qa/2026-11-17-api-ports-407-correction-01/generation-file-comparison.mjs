import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, rename, rm, stat, unlink, writeFile, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

async function acquireDirectory(path) {
  try { await mkdir(path); } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  return true;
}

async function isReleased(path) {
  try { return (await stat(join(path, 'released'))).isDirectory(); } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function claimGeneration(slot) {
  await acquireDirectory(slot);
  let newest = 0;
  for (const name of await readdir(slot)) {
    const generation = Number(name);
    if (Number.isSafeInteger(generation)) newest = Math.max(newest, generation);
  }
  if (newest > 0 && !(await isReleased(join(slot, String(newest))))) return;
  const generation = newest + 1;
  const path = join(slot, String(generation));
  if (!(await acquireDirectory(path))) return;
  const token = randomUUID();
  const owner = join(path, token);
  await mkdir(owner);
  let released;
  return {
    token, path, generation,
    release: () => released ??= rename(owner, join(path, 'released')),
  };
}

async function claimFile(slot) {
  const token = randomUUID();
  try { await writeFile(slot, token, { flag: 'wx' }); } catch (error) {
    if (error.code === 'EEXIST') return;
    throw error;
  }
  return { token, path: slot, release: () => unlink(slot) };
}

const [mode, phase, root, role] = process.argv.slice(2);
const claims = phase === 'generations' ? claimGeneration : claimFile;
if (mode === 'worker') {
  const slot = join(root, 'claims', '63651');
  const began = Date.now();
  await writeFile(join(root, role + '-ready'), '');
  while (true) {
    if (Date.now() - began > 6000) throw new Error('Peer did not reach barrier');
    try {
      await readFile(join(root, 'start'));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await sleep(2);
    }
  }
  const deadline = Date.now() + 6500;
  const codes = {};
  const samples = [];
  const generations = [];
  let attempts = 0, grants = 0, exhausted = 0, nonexclusive = 0;
  const record = (operation, error) => {
    const key = operation + ':' + error.code;
    codes[key] = (codes[key] ?? 0) + 1;
    if (samples.length < 10) samples.push({ operation, code: error.code, syscall: error.syscall, message: error.message });
  };
  while (Date.now() < deadline) {
    attempts++;
    let reservation;
    try {
      reservation = await claims(slot);
    } catch (error) {
      record('claim', error);
      continue;
    }
    if (!reservation) {
      exhausted++;
      continue;
    }
    grants++;
    if (phase === 'generations') {
      generations.push(reservation.generation);
      const names = await readdir(reservation.path);
      if (names.length !== 1 || names[0] !== reservation.token) nonexclusive++;
    } else if (await readFile(reservation.path, 'utf8') !== reservation.token) {
      nonexclusive++;
    }
    try { await reservation.release(); } catch (error) { record('release', error); }
  }
  await writeFile(join(root, role + '.json'), JSON.stringify({
    pid: process.pid, role, attempts, grants, exhausted, nonexclusive, codes, samples, generations,
  }));
} else {
  const base = join(import.meta.dirname, 'generation-comparison');
  await mkdir(base);
  const results = [];
  for (const variant of ['file', 'generations']) {
    const directory = join(base, variant);
    await mkdir(directory);
    const claimsRoot = join(directory, 'claims');
    await mkdir(claimsRoot);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const done = ['A', 'B'].map((name) => {
      const child = spawn(process.execPath, [process.argv[1], 'worker', variant, directory, name], {
        stdio: 'inherit',
        windowsHide: true,
        signal: controller.signal,
      });
      return new Promise((resolve) => {
        child.once('error', (error) => resolve(error.message));
        child.once('close', resolve);
      });
    });
    try {
      const deadline = Date.now() + 6000;
      while (!(await readdir(directory)).includes('A-ready') || !(await readdir(directory)).includes('B-ready')) {
        if (Date.now() > deadline) throw new Error('Children did not reach barrier');
        await sleep(2);
      }
      await writeFile(join(directory, 'start'), '');
      const statuses = await Promise.all(done);
      if (statuses.some((status) => status !== 0)) throw new Error(JSON.stringify(statuses));
      const workers = await Promise.all(['A', 'B'].map(async (who) => JSON.parse(await readFile(join(directory, who + '.json'), 'utf8'))));
      const allGenerations = workers.flatMap((worker) => worker.generations);
      const replicaGrants = allGenerations.length - new Set(allGenerations).size;
      const aggregate = workers.map(({ pid, role, attempts, grants, exhausted, nonexclusive, codes }) => ({
        pid, role, attempts, grants, exhausted, nonexclusive, codes,
      }));
      let quiescentEntries = await readdir(claimsRoot);
      if (variant === 'generations' && quiescentEntries.length === 1)
        quiescentEntries = await readdir(join(claimsRoot, '63651'));
      const settledClaims = quiescentEntries.length;
      const remove = await realpath(claimsRoot);
      if (basename(remove) !== 'claims' || dirname(remove) !== await realpath(directory))
        throw new Error('Refusing cleanup outside the owned probe folder');
      await rm(remove, { recursive: true });
      results.push({ variant, workers: aggregate, replicaGrants, settledClaims });
    } finally {
      controller.abort();
      await Promise.all(done);
      clearTimeout(timeout);
    }
  }
  const stale = join(base, 'stale');
  const old = await claimGeneration(stale);
  const replacement = randomUUID();
  await rename(join(old.path, old.token), join(old.path, replacement));
  const outcome = await old.release().then(() => 'ok', (error) => error.code);
  const markerIntact = (await readdir(old.path))[0] === replacement;
  const blocked = (await claimGeneration(stale)) === undefined;
  const staleRoot = await realpath(stale);
  if (basename(staleRoot) !== 'stale' || dirname(staleRoot) !== await realpath(base))
    throw new Error('Refusing cleanup outside the owned probe folder');
  await rm(staleRoot, { recursive: true });
  console.log(JSON.stringify({ node: process.version, results, staleRelease: { outcome, markerIntact, blocked } }, null, 2));
  const generation = results.find((result) => result.variant === 'generations');
  if (generation.replicaGrants || generation.workers.some((worker) => worker.nonexclusive || Object.keys(worker.codes).length) || outcome !== 'ENOENT' || !markerIntact || !blocked)
    process.exitCode = 1;
}
