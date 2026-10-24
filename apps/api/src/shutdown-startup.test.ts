import { expect, it } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { FakeHarness } from '@graphgoblin/engine/testing';
import { createContainer, type Container } from './container.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createApiProcessFixture } from './testing/api-subprocess.js';

it('a stop requested during startup leaves independent queued work unstarted on the same store', async () => {
  const f = await createApiProcessFixture({ prefix: 'gg-wp-c7-', portStart: 5760, portCount: 10 });
  const owners: Container[] = [];
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const config = loadConfig({ ...f.env, GG_REQUIRE_API_KEY: 'false' });
  const owner = async () => {
    const c = await createContainer(config, {
      harnesses: { codex: new FakeHarness() },
      startTimers: false,
    });
    owners.push(c);
    return c;
  };
  try {
    const seed = await owner();
    await seed.start();
    app = await buildApp(seed);
    await app.ready();
    const created = await app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: minimalLoop() },
    });
    expect(created.statusCode).toBe(201);
    const loopId = created.json<{ loop: { id: string } }>().loop.id;
    expect((await app.inject({ method: 'POST', url: `/loops/${loopId}/publish` })).statusCode).toBe(
      200,
    );
    // The public dispatch-freeze primitive seeds durable recovery work, as existing recovery tests do.
    seed.manager.stop();
    const queued = await seed.manager.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
    await app.close();
    await seed.stop();
    const next = await owner();
    const starting = next.start();
    const stopping = next.stop();
    await Promise.all([starting, stopping]);
    const inspection = await owner();
    expect(await inspection.repos.runs.get(queued.id)).toMatchObject({ status: 'queued' });
    expect((await inspection.repos.events.read(queued.id)).map((event) => event.type)).toEqual([
      'run.queued',
    ]);
  } finally {
    await app?.close();
    for (const c of owners.reverse()) await c.stop();
    await f.dispose();
  }
}, 120_000);
