import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createThreadHistoryFixture } from '@graphgoblin/api/testing';

const t = await createThreadHistoryFixture(resolve('dist'));
t.manager.stop();
const url = await t.app.listen({ port: 5930, host: '127.0.0.1' });
const control = createServer((request, response) => {
  const perform = async () => {
    const path = request.url ?? '';
    if (path === '/start') {
      await t.manager.start();
      await t.manager.waitForIdle();
    } else if (path === '/working') await t.working;
    else if (path === '/release') {
      t.release();
      await t.manager.waitForIdle();
    } else if (path === '/flush') await t.snapshots.flush();
    else if (path.startsWith('/snapshot/')) {
      const id = path.slice('/snapshot/'.length);
      return { snapshot: await t.repos.runs.getThread(id), bytes: await t.bytes(id) };
    } else throw new Error('Unknown control path');
    return { ok: true };
  };
  perform().then(
    (value) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(value));
    },
    (error: unknown) => {
      response.statusCode = 500;
      response.end(String(error));
    },
  );
});
await new Promise<void>((resolveReady) => control.listen(5931, '127.0.0.1', resolveReady));
process.stdout.write(JSON.stringify({ url, loopId: t.loopId }) + '\n');
process.stdin.once('data', () => {
  void (async () => {
    control.close();
    await t.close();
    process.exit(0);
  })();
});
