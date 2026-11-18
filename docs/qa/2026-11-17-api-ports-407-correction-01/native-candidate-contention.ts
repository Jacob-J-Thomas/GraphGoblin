import { access, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, inject } from 'vitest';
import { reserveApiPort } from './api-port.js';
import { eventually } from './api-subprocess.js';

export async function contend(role: 'A' | 'B') {
  const peer = role === 'A' ? 'B' : 'A';
  const coordinate = process.env.GG_TEST_PORT_RACE_DIR!;
  const port = Number(process.env.GG_TEST_PORT_START);
  const slot = join(inject('apiPortRoot'), String(port));
  const ready = (name: string) => join(coordinate, name + '-contention-ready');
  const end = (name: string) => join(coordinate, name + '-contention.json');
  const exists = (path: string) => access(path).then(() => true, () => false);
  await writeFile(ready(role), '');
  await eventually(() => exists(ready(peer)), 15_000);
  const generations: number[] = [];
  const faults: string[] = [];
  let attempts = 0, exhausted = 0, nonexclusive = 0;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    attempts++;
    const claim = await reserveApiPort(port, 1).catch((error: unknown) => {
      if (error instanceof Error && error.message.startsWith('No disposable API port is available'))
        exhausted++;
      else faults.push(String(error));
      return undefined;
    });
    if (!claim) continue;
    try {
      const latest = Math.max(...(await readdir(slot)).map(Number));
      const names = await readdir(join(slot, String(latest)));
      generations.push(latest);
      if (names.length !== 1 || !/^[a-f0-9-]{36}$/.test(names[0]!)) nonexclusive++;
    } finally {
      await claim.release().catch((error: unknown) => faults.push(String(error)));
    }
  }
  const summary = {
    role, pid: process.pid, pool: process.env.VITEST_POOL_ID, port, attempts,
    grants: generations.length, exhausted, nonexclusive, faults,
  };
  const file = end(role);
  await writeFile(file + '.tmp', JSON.stringify({ ...summary, generations }));
  await rename(file + '.tmp', file);
  await eventually(() => exists(end(peer)), 15_000);
  const other = JSON.parse(await readFile(end(peer), 'utf8')) as { generations: number[]; pid: number };
  const combined = generations.concat(other.generations);
  console.log('NATIVE_CONTENTION', { ...summary, duplicateGenerations: combined.length - new Set(combined).size });
  expect(other.pid).not.toBe(process.pid);
  expect(generations.length).toBeGreaterThan(0);
  expect(other.generations.length).toBeGreaterThan(0);
  expect(exhausted).toBeGreaterThan(0);
  expect(nonexclusive).toBe(0);
  expect(faults).toEqual([]);
  expect(new Set(combined).size).toBe(combined.length);
}
