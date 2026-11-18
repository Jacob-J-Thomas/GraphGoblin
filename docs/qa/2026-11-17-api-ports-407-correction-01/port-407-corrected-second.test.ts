import { contend } from './native-candidate-contention.js';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { it, vi } from 'vitest';
import { createApiProcessFixture, eventually } from './api-subprocess.js';

it('starts a competing API while the first Vitest worker is between port selection and bind', async () => {
  const coordinate = process.env.GG_TEST_PORT_RACE_DIR!;
  await eventually(async () => {
    try {
      await access(join(coordinate, 'first.json'));
      return true;
    } catch {
      return false;
    }
  }, 20_000);
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  const second = await createApiProcessFixture({ prefix: 'gg-port-407-second-' }).finally(() =>
    random.mockRestore(),
  );
  try {
    const key = await second.createKey();
    const running = second.run();
    await second.ready(running, key);
    const who = {
      port: second.port,
      pid: process.pid,
      pool: process.env.VITEST_POOL_ID,
      child: running.child.pid,
    };
    console.log('SECOND_READY', who);
    await writeFile(join(coordinate, 'second.json'), JSON.stringify(who));
    await eventually(async () => {
      try {
        await access(join(coordinate, 'done'));
        return true;
      } catch {
        return false;
      }
    }, 20_000);
  } finally {
    await second.dispose();
  }
}, 40_000);

it('keeps concurrent generations exclusive (B)', () => contend('B'), 40_000);
