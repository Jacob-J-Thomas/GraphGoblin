import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rmdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

async function claim(slot) {
  let fresh = false;
  try {
    await mkdir(slot);
    fresh = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const available = join(slot, 'available');
  if (fresh) await mkdir(available);
  const token = randomUUID();
  const owner = join(slot, token);
  try {
    await rename(available, owner);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  let released;
  return { token, release: () => released ??= rename(owner, available) };
}

const [mode, root, role] = process.argv.slice(2);

if (mode === 'worker') {
  const slot = join(root, '63651');
  const started = Date.now();
  await writeFile(join(root, role + '-ready'), '');
  while (true) {
    if (Date.now() - started > 6000) throw new Error('Peer did not reach barrier');
    try {
      await readFile(join(root, 'start'));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await sleep(2);
    }
  }
  const deadline = Date.now() + 7000;
  const errors = [];
  let attempts = 0, grants = 0, exhausted = 0, nonexclusive = 0;
  while (Date.now() < deadline) {
    attempts++;
    let reservation;
    try {
      reservation = await claim(slot);
    } catch (error) {
      errors.push({ operation: 'claim', code: error.code, syscall: error.syscall, message: error.message });
      continue;
    }
    if (!reservation) {
      exhausted++;
      continue;
    }
    grants++;
    const names = await readdir(slot);
    if (names.length !== 1 || names[0] !== reservation.token) nonexclusive++;
    try {
      await reservation.release();
    } catch (error) {
      errors.push({ operation: 'release', code: error.code, syscall: error.syscall, message: error.message });
    }
  }
  await writeFile(join(root, role + '.json'), JSON.stringify({
    pid: process.pid, role, attempts, grants, exhausted, nonexclusive, errors,
  }));
} else {
  const root = join(import.meta.dirname, 'permanent-slot');
  await mkdir(root);
  const race = join(root, 'race');
  await mkdir(race);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 16000);
  const outcomes = ['A', 'B'].map((who) => {
    const child = spawn(process.execPath, [process.argv[1], 'worker', race, who], {
      stdio: 'inherit',
      windowsHide: true,
      signal: controller.signal,
    });
    return new Promise((resolve) => {
      child.once('error', (error) => resolve(error.message));
      child.once('close', resolve);
    });
  });
  let workers;
  try {
    const deadline = Date.now() + 6500;
    while (!(await readdir(race)).includes('A-ready') || !(await readdir(race)).includes('B-ready')) {
      if (Date.now() > deadline) throw new Error('Children did not reach barrier');
      await sleep(2);
    }
    await writeFile(join(race, 'start'), '');
    const statuses = await Promise.all(outcomes);
    if (statuses.some((status) => status !== 0)) throw new Error(JSON.stringify(statuses));
    workers = await Promise.all(['A', 'B'].map(async (who) => JSON.parse(await readFile(join(race, who + '.json'), 'utf8'))));
  } finally {
    controller.abort();
    await Promise.all(outcomes);
    clearTimeout(timeout);
  }
  const afterStress = await readdir(join(race, '63651'));
  await rmdir(join(race, '63651', 'available'));
  await rmdir(join(race, '63651'));

  // Externally replace the UUID marker before a paused original owner releases.
  const slot = join(root, 'stale-release');
  const old = await claim(slot);
  await rmdir(join(slot, old.token));
  const replacement = randomUUID();
  await mkdir(join(slot, replacement));
  const exactTokenRelease = await old.release().then(() => 'ok', (error) => error.code);
  const intactReplacement = (await readdir(slot))[0] === replacement;
  const blocked = (await claim(slot)) === undefined;
  await rmdir(join(slot, replacement));
  await rmdir(slot);

  // Pause canonical retirement after owner-marker removal and install a replacement.
  const canonical = join(root, 'canonical');
  await mkdir(canonical);
  const oldMarker = join(canonical, randomUUID());
  await mkdir(oldMarker);
  await rmdir(oldMarker);
  await rmdir(canonical);
  await mkdir(canonical);
  const second = randomUUID();
  await mkdir(join(canonical, second));
  const previousRmdir = await rmdir(canonical).then(() => 'ok', (error) => error.code);
  const retired = join(root, 'canonical-retired');
  const canonicalRename = await rename(canonical, retired).then(() => 'ok', (error) => error.code);
  const replacementWasMoved = (await readdir(retired))[0] === second;
  await rmdir(join(retired, second));
  await rmdir(retired);

  const result = {
    node: process.version, workers, afterStress,
    controlledStaleRelease: { exactTokenRelease, intactReplacement, blocked, previousRmdir, canonicalRename, replacementWasMoved },
  };
  console.log(JSON.stringify(result, null, 2));
  if (workers.some((worker) => worker.errors.length || worker.nonexclusive) || exactTokenRelease !== 'ENOENT' || !intactReplacement || !blocked)
    process.exitCode = 1;
}
