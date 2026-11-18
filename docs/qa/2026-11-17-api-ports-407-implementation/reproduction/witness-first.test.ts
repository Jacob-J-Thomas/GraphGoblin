import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createApiProcessFixture, eventually } from './api-subprocess.js';

it('starts the first API only after the competing Vitest worker starts its API', async () => {
  const coordinate = process.env.GG_TEST_PORT_RACE_DIR!;
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  const first = await createApiProcessFixture({ prefix: 'gg-port-407-first-' }).finally(() =>
    random.mockRestore(),
  );
  try {
    const key = await first.createKey();
    const who = { port: first.port, pid: process.pid, pool: process.env.VITEST_POOL_ID };
    console.log('FIRST_RESERVED', who);
    await writeFile(join(coordinate, 'first.json'), JSON.stringify(who));
    let second = '';
    await eventually(async () => {
      second = await readFile(join(coordinate, 'second.json'), 'utf8').catch(() => '');
      return second.length > 0;
    }, 20_000);
    console.log('FIRST_OBSERVED_SECOND_LISTENING', second);
    const running = first.run();
    await first.ready(running, key);
    expect(first.port).not.toBe((JSON.parse(second) as { port: number }).port);
    console.log('FIRST_READY', { port: first.port, pid: running.child.pid });
  } finally {
    await writeFile(join(coordinate, 'done'), 'done');
    await first.dispose();
  }
}, 40_000);
