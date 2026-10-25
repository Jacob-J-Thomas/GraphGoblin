import { expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { ShutdownController } from './shutdown.js';
import { createTestApp } from './testing/test-app.js';

it('rejects a stale tab force instead of acknowledging a newly failed cleanup', async () => {
  const fixture = await createTestApp();
  let finishDrain!: () => void;
  const drain = new Promise<void>((resolve) => {
    finishDrain = resolve;
  });
  const shutdown = new ShutdownController(
    {
      beginDrain: () => Promise.resolve(),
      waitForDrain: () => drain,
      forceStop: () => Promise.reject(new Error('controlled unconfirmed cleanup')),
      drainingRunIds: () => ['controlled-run'],
      unconfirmedRunIds: () => ['controlled-run'],
    },
    300000,
    () => undefined,
    fixture.logger,
  );
  // Public composition injection: the route uses a real controller over a failing cleanup port.
  const app = await buildApp(
    {
      ...fixture.container,
      shutdown,
      requestShutdown: (action) => shutdown.request(action),
    },
    { logger: false },
  );
  try {
    await shutdown.request('force');
    await vi.waitFor(() => expect(shutdown.state().phase).toBe('force-failed'));
    const stale = await app.inject({
      method: 'POST',
      url: '/system/shutdown',
      payload: { action: 'force' },
      headers: { 'x-graphgoblin-shutdown-token': 'stale-before-cleanup' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ phase: 'force-failed', choices: ['force'] });
    expect(shutdown.state().phase).toBe('force-failed');
    const fresh = (await app.inject('/system/shutdown')).json<{ controlToken: string }>();
    const confirmed = await app.inject({
      method: 'POST',
      url: '/system/shutdown',
      payload: { action: 'force' },
      headers: { 'x-graphgoblin-shutdown-token': fresh.controlToken },
    });
    expect(confirmed.statusCode).toBe(202);
    expect(confirmed.json()).toMatchObject({ phase: 'exiting' });
  } finally {
    finishDrain();
    await app.close();
    await fixture.close();
  }
});

it.each(['after the phase recurs', 'after a wait within draining'] as const)(
  'rejects a force prepared before another control chose to keep waiting (%s)',
  async (path) => {
    const fixture = await createTestApp();
    let finishDrain!: () => void;
    const drain = new Promise<void>((resolve) => {
      finishDrain = resolve;
    });
    const forceStop = vi.fn(() => Promise.resolve());
    const shutdown = new ShutdownController(
      {
        beginDrain: () => Promise.resolve(),
        waitForDrain: () => drain,
        forceStop,
        drainingRunIds: () => ['controlled-run'],
        unconfirmedRunIds: () => [],
      },
      path === 'after the phase recurs' ? 20 : 300000,
      () => undefined,
      fixture.logger,
    );
    const app = await buildApp(
      { ...fixture.container, shutdown, requestShutdown: (action) => shutdown.request(action) },
      { logger: false },
    );
    const read = async () =>
      (await app.inject('/system/shutdown')).json<{ phase: string; controlToken: string }>();
    const post = (action: string, token: string) =>
      app.inject({
        method: 'POST',
        url: '/system/shutdown',
        payload: { action },
        headers: { 'x-graphgoblin-shutdown-token': token },
      });
    try {
      expect((await post('drain', (await read()).controlToken)).statusCode).toBe(202);
      // This tab opens its force confirmation while the gateway drains.
      const prepared = await read();
      expect(prepared.phase).toBe('draining');
      let other = prepared;
      if (path === 'after the phase recurs') {
        await vi.waitFor(async () => expect((other = await read()).phase).toBe('awaiting-choice'));
      }
      const waited = await post('wait', other.controlToken);
      expect(waited.statusCode).toBe(202);
      expect(waited.json()).toMatchObject({ phase: 'draining' });
      const stale = await post('force', prepared.controlToken);
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({
        phase: 'draining',
        controlToken: (await read()).controlToken,
      });
      expect(forceStop).not.toHaveBeenCalled();
    } finally {
      finishDrain();
      await app.close();
      await fixture.close();
    }
  },
);

it('keeps tokens stable per phase and rejects another route incarnation without starting drain', async () => {
  const fixture = await createTestApp();
  const app = await buildApp(fixture.container, { logger: false });
  try {
    const first = (await fixture.app.inject('/system/shutdown')).json<{ controlToken: string }>();
    const current = (await app.inject('/system/shutdown')).json<{ controlToken: string }>();
    expect(current.controlToken).toEqual(expect.any(String));
    expect(current.controlToken).not.toBe(first.controlToken);
    expect((await app.inject('/system/shutdown')).json()).toMatchObject({
      controlToken: current.controlToken,
    });
    const stale = await app.inject({
      method: 'POST',
      url: '/system/shutdown',
      payload: { action: 'drain' },
      headers: { 'x-graphgoblin-shutdown-token': first.controlToken },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ phase: 'running', controlToken: current.controlToken });
    expect(fixture.container.shutdown.state().phase).toBe('running');
    const invalid = await app.inject({
      method: 'POST',
      url: '/system/shutdown',
      payload: { action: 'wait' },
      headers: { 'x-graphgoblin-shutdown-token': current.controlToken },
    });
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json()).toMatchObject({ phase: 'running', controlToken: current.controlToken });
    const empty = await app.inject({
      method: 'POST',
      url: '/system/shutdown',
      payload: { action: 'drain' },
      headers: { 'x-graphgoblin-shutdown-token': '' },
    });
    expect(empty.statusCode).toBe(400);
    expect(fixture.container.shutdown.state().phase).toBe('running');
  } finally {
    await app.close();
    await fixture.close();
  }
});

it('requires system read/write scopes and preserves authentication with the conditional header', async () => {
  const fixture = await createTestApp();
  const key = async (scope: string) => {
    const created = await fixture.app.inject({
      method: 'POST',
      url: '/api-keys',
      payload: { label: 'conditional shutdown', scopes: [scope] },
    });
    expect(created.statusCode).toBe(201);
    return created.json<{ token: string }>().token;
  };
  const reader = await key('system:read');
  const writer = await key('system:write');
  const unrelated = await key('runs:read');
  const app = await buildApp(
    { ...fixture.container, config: { ...fixture.container.config, requireApiKey: true } },
    { logger: false },
  );
  try {
    const read = await app.inject({
      url: '/system/shutdown',
      headers: { authorization: `Bearer ${reader}` },
    });
    expect(read.statusCode).toBe(200);
    const token = read.json<{ controlToken: string }>().controlToken;
    expect(
      (
        await app.inject({
          url: '/system/shutdown',
          headers: { authorization: `Bearer ${unrelated}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/system/shutdown',
          payload: { action: 'wait' },
          headers: { authorization: `Bearer ${reader}`, 'x-graphgoblin-shutdown-token': token },
        })
      ).statusCode,
    ).toBe(403);
    const allowed = await app.inject({
      method: 'POST',
      url: '/system/shutdown',
      payload: { action: 'wait' },
      headers: { authorization: `Bearer ${writer}`, 'x-graphgoblin-shutdown-token': token },
    });
    expect(allowed.statusCode).toBe(409);
    expect(allowed.json()).toMatchObject({ phase: 'running', controlToken: token });
    expect(fixture.container.shutdown.state().phase).toBe('running');
  } finally {
    await app.close();
    await fixture.close();
  }
});
