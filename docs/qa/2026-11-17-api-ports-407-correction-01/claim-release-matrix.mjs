import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rmdir, stat, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const pathName = '63651';
const stamp = () => process.hrtime.bigint().toString();
const [mode, phase, root, role] = process.argv.slice(2);
if (mode === 'worker') {
  const leaseRoot = join(root, 'claims');
  const lock = join(leaseRoot, pathName);
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
  const deadline = Date.now() + 6500;
  let skips = 0, grants = 0, total = 0;
  const errors = [];
  const releases = [];
  while (Date.now() < deadline) {
    total++;
    const claimStart = stamp();
    try {
      await mkdir(lock);
    } catch (error) {
      if (error.code === 'EEXIST') {
        skips++;
      } else {
        const claimEnd = stamp();
        const directoryObservation = await readdir(leaseRoot).then((names) => names.includes(pathName), (e) => e.code);
        const statObservation = await stat(lock).then((entry) => entry.isDirectory(), (e) => e.code);
        errors.push({ code: error.code, syscall: error.syscall, path: error.path, claimStart, claimEnd, directoryObservation, statObservation });
      }
      continue;
    }
    grants++;
    const token = randomUUID();
    const marker = join(lock, token);
    await mkdir(marker);
    await rmdir(marker);
    const released = { start: stamp() };
    if (phase === 'delete') {
      await rmdir(lock);
      released.end = stamp();
    } else {
      const retired = join(leaseRoot, `${pathName}-${token}`);
      await rename(lock, retired);
      released.end = stamp();
      await rmdir(retired);
    }
    releases.push(released);
  }
  await writeFile(join(root, role + '.json'), JSON.stringify({ pid: process.pid, role, grants, skips, total, errors, releases }));
} else {
  const evidence = new URL('.', import.meta.url);
  const summaries = [];
  for (const variant of ['delete', 'retire']) {
    const directory = join(import.meta.dirname, 'claim-' + variant);
    const leaseRoot = join(directory, 'claims');
    await mkdir(directory);
    await mkdir(leaseRoot);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 14000);
    const children = ['A', 'B'].map((who) => {
      const child = spawn(process.execPath, [process.argv[1], 'worker', variant, directory, who], {
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
      const limit = Date.now() + 6000;
      while (!(await readdir(directory)).includes('A-ready') || !(await readdir(directory)).includes('B-ready')) {
        if (Date.now() > limit) throw new Error('Children did not reach barrier');
        await sleep(2);
      }
      await writeFile(join(directory, 'start'), stamp());
      const statuses = await Promise.all(children);
      if (statuses.some((status) => status !== 0)) throw new Error('Worker status ' + JSON.stringify(statuses));
      const records = await Promise.all(['A', 'B'].map(async (who) => JSON.parse(await readFile(join(directory, who + '.json'), 'utf8'))));
      const results = records.map(({ role, grants, skips, total, errors }, index) => {
        const peer = records[1 - index];
        return {
          role, grants, skips, total, errors: errors.length,
          errorsDuringPeerRelease: errors.filter((event) => peer.releases.some((during) =>
            BigInt(event.claimStart) <= BigInt(during.end) && BigInt(event.claimEnd) >= BigInt(during.start)
          )).length,
          directoryObservations: Object.groupBy(errors.map((event) => event.directoryObservation), String),
          statObservations: Object.groupBy(errors.map((event) => event.statObservation), String),
        };
      });
      const leftovers = await readdir(leaseRoot);
      await rmdir(leaseRoot);
      summaries.push({ variant, results, leftovers });
    } finally {
      controller.abort();
      await Promise.all(children);
      clearTimeout(timeout);
    }
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, summaries }, null, 2));
}
