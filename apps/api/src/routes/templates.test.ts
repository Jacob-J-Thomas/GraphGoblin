import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TemplateCatalog } from '../templates/catalog.js';
import { TemplateError } from '../templates/errors.js';
import { singleNodeLoop } from '@graphgoblin/engine/testing';
import type { ScriptRunRequest, ScriptRunResult } from '@graphgoblin/engine';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { SqliteRunRepository } from '@graphgoblin/infrastructure/sqlite';
import { createTestApp, type TestApp } from '../testing/test-app.js';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('template API without runtime authority', () => {
  it('reads only manifests without provider, script or credential probes', async () => {
    app = await createTestApp();
    const preflight = vi.spyOn(app.harness, 'preflight');
    const script = vi.spyOn(app.container.ports.scripts, 'run');
    const secret = vi.spyOn(app.container.ports.secrets, 'resolve');
    const authenticate = vi.spyOn(app.container.repos.apiKeys, 'authenticate');
    const list = await app.app.inject({ method: 'GET', url: '/templates' });
    expect(list.statusCode, list.body).toBe(200);
    const { items } = list.json<{ items: { manifest: { id: string } }[] }>();
    expect(items.map((item) => item.manifest.id)).toEqual([
      'starter',
      'implementation',
      'review',
      'qa',
    ]);
    for (const entry of items) {
      expect(Object.keys(entry)).toEqual(['manifest']);
      const read = await app.app.inject({ method: 'GET', url: '/templates/' + entry.manifest.id });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json()).toEqual(entry);
    }
    expect(preflight).not.toHaveBeenCalled();
    expect(script).not.toHaveBeenCalled();
    expect(secret).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
    expect(
      (
        await app.container.handle.client.execute(
          "SELECT name FROM sqlite_master WHERE name LIKE 'template_%'",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (await app.container.handle.client.execute('PRAGMA table_info(runs)')).rows.map(
        (row) => row.name,
      ),
    ).not.toContain('template_subject');
  });
  it('removes configured actions from routing and OpenAPI without allocating state', async () => {
    app = await createTestApp();
    for (const url of ['/templates/starter/prerequisites', '/templates/starter/instantiate']) {
      const response = await app.app.inject({ method: 'POST', url, payload: { settings: {} } });
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(
      (await app.app.inject({ method: 'GET', url: '/template-instances/' + fakeUlid('retired') }))
        .statusCode,
    ).toBe(404);
    const document = (await app.app.inject({ method: 'GET', url: '/openapi.json' })).json<{
      paths: Record<string, unknown>;
    }>();
    expect(
      Object.keys(document.paths).filter((path) =>
        /instantiate|prerequisites|template-instances/.test(path),
      ),
    ).toEqual([]);
    expect(await app.container.repos.loops.listLoops('local')).toEqual([]);
    expect(await app.container.repos.runs.list()).toEqual([]);
  });
  it('keeps catalogue reads scoped and unknown template IDs explicit', async () => {
    app = await createTestApp({ requireApiKey: true });
    const denied = await app.container.repos.apiKeys.create('local', 'runs only', ['runs:read']);
    const reader = await app.container.repos.apiKeys.create('local', 'reader', ['loops:read']);
    expect((await app.app.inject({ method: 'GET', url: '/templates' })).statusCode).toBe(401);
    expect(
      (
        await app.app.inject({
          method: 'GET',
          url: '/templates',
          headers: { authorization: 'Bearer ' + denied.token },
        })
      ).statusCode,
    ).toBe(403);
    const headers = { authorization: 'Bearer ' + reader.token };
    expect((await app.app.inject({ method: 'GET', url: '/templates', headers })).statusCode).toBe(
      200,
    );
    const absent = await app.app.inject({ method: 'GET', url: '/templates/absent', headers });
    expect(absent.statusCode).toBe(404);
    expect(absent.json()).toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
  });
  it.each([409, 503])('sanitizes trusted catalogue asset faults with status %s', async (status) => {
    app = await createTestApp();
    vi.spyOn(app.container.templates.catalog, 'list').mockRejectedValue(
      new TemplateError('TEMPLATE_PACKAGE_INVALID', 'private/path secret content', status),
    );
    for (const [method, url] of [
      ['GET', '/templates'],
      ['GET', '/templates/starter'],
      ['POST', '/templates/starter/draft'],
    ] as const) {
      const response = await app.app.inject({
        method,
        url,
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        code: 'TEMPLATE_PACKAGE_INVALID',
        detail: 'The installed template catalog is invalid; reinstall the package.',
      });
      expect(response.body).not.toContain('private/path');
      expect(response.body).not.toContain('secret content');
    }
  });
  it('keeps arbitrary server errors sanitized as internal errors', async () => {
    app = await createTestApp();
    vi.spyOn(app.container.templates.catalog, 'list').mockRejectedValue(
      Object.assign(new Error('private failure'), {
        statusCode: 503,
        code: 'TEMPLATE_PACKAGE_INVALID',
      }),
    );
    const response = await app.app.inject({ method: 'GET', url: '/templates' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(response.body).not.toContain('private failure');
  });
  it.each(['missing', 'malformed', 'oversized'])(
    'maps a real %s catalogue asset to a sanitized package fault without allocating a loop',
    async (fault) => {
      app = await createTestApp();
      app.container.templates.catalog = new TemplateCatalog(app.dataDir);
      if (fault !== 'missing')
        await writeFile(
          join(app.dataDir, 'catalog.json'),
          fault === 'malformed' ? '{private-installed-content' : Buffer.alloc(1_048_577),
        );
      for (const [method, url] of [
        ['GET', '/templates'],
        ['GET', '/templates/starter'],
        ['POST', '/templates/starter/draft'],
      ] as const) {
        const response = await app.app.inject({
          method,
          url,
          ...(method === 'POST' ? { payload: {} } : {}),
        });
        expect(response.statusCode, response.body).toBe(503);
        expect(response.json()).toMatchObject({ code: 'TEMPLATE_PACKAGE_INVALID' });
        expect(response.body).not.toContain('private-installed-content');
        expect(response.body).not.toContain(app.dataDir);
      }
      expect(await app.container.repos.loops.listLoops('local')).toEqual([]);
    },
  );
  it('keeps ordinary returns and the unwrapped durable finalization marker', async () => {
    app = await createTestApp();
    expect(app.container.repos.runs.markFinalized).toBe(
      SqliteRunRepository.prototype.markFinalized,
    );
    const draft = await app.app.inject({
      method: 'POST',
      url: '/templates/starter/draft',
      payload: {},
    });
    const loopId = draft.json<{ loop: { id: string } }>().loop.id;
    expect(
      (await app.app.inject({ method: 'POST', url: '/loops/' + loopId + '/publish' })).statusCode,
    ).toBe(200);
    app.harness.script([{ finalText: 'ordinary result' }]);
    const started = await app.app.inject({
      method: 'POST',
      url: '/loops/' + loopId + '/runs',
      payload: { input: { task: 'bounded' } },
    });
    expect(started.statusCode, started.body).toBe(202);
    const runId = started.json<{ run: { id: string } }>().run.id;
    await app.idle();
    expect(await app.container.repos.runs.get(runId)).toMatchObject({
      status: 'succeeded',
      result: 'ordinary result',
    });
    expect(
      (await app.container.repos.runs.listRecoveryCandidates()).filter((r) => r.terminal),
    ).toEqual([]);
    expect(app.container.settings).not.toHaveProperty('beforeExecute');
    expect(app.container.settings).not.toHaveProperty('beforeResume');
    expect(app.container.ports.scripts.constructor.name).toBe('ProcessScripts');
  });
  it('preserves ordinary script environment, stdin and JSON stdout through the container', async () => {
    app = await createTestApp();
    await app.container.repos.secretsFor('local').set('script-token', 'ordinary-secret');
    let observed: ScriptRunRequest | undefined;
    app.container.ports.scripts = {
      run: (request) => {
        observed = request;
        return Promise.resolve({
          exitCode: 0,
          stdout: '{"saved":true}',
          stderr: '',
          stdoutBytes: 14,
          stdoutOverflow: false,
          stderrBytes: 0,
          stderrOverflow: false,
          state: 'completed' as const,
          timedOut: false,
        });
      },
    };
    const loopId = await app.publishLoop(
      singleNodeLoop(
        'ordinary-script',
        {
          id: 'script',
          kind: 'script',
          label: 'Script',
          config: {
            command: 'ordinary-command',
            args: ['{{ trigger.payload.task }}'],
            env: { TOKEN: 'secret:script-token', PLAIN: 'ordinary' },
            stdin: 'thread',
            timeoutSeconds: 5,
          },
        },
        { returns: 'lastOutput.value' },
      ),
    );
    const response = await app.app.inject({
      method: 'POST',
      url: '/loops/' + loopId + '/runs',
      payload: { input: { task: 'bounded' } },
    });
    expect(response.statusCode, response.body).toBe(202);
    const runId = response.json<{ run: { id: string } }>().run.id;
    await app.idle();
    expect(observed).toMatchObject({
      command: 'ordinary-command',
      args: ['bounded'],
      env: { TOKEN: 'ordinary-secret', PLAIN: 'ordinary' },
      timeoutMs: 5000,
    });
    expect(JSON.parse(observed!.stdin!)).toMatchObject({
      invocation: { trigger: { payload: { task: 'bounded' } } },
    });
    expect(await app.container.repos.runs.get(runId)).toMatchObject({
      status: 'succeeded',
      result: { saved: true },
    });
    expect(
      (await app.container.repos.runs.listRecoveryCandidates()).filter((r) => r.terminal),
    ).toEqual([]);
  });
  it.each(['cancel', 'timeout'] as const)(
    'preserves ordinary script %s and finalization',
    async (action) => {
      app = await createTestApp();
      let invoked!: (request: ScriptRunRequest) => void;
      const started = new Promise<ScriptRunRequest>((resolve) => {
        invoked = resolve;
      });
      app.container.ports.scripts = {
        run: (request) =>
          new Promise<ScriptRunResult>((resolve) => {
            invoked(request);
            request.signal.addEventListener(
              'abort',
              () =>
                resolve({
                  exitCode: null,
                  stdout: '',
                  stderr: '',
                  stdoutBytes: 0,
                  stdoutOverflow: false,
                  stderrBytes: 0,
                  stderrOverflow: false,
                  state: 'completed' as const,
                  timedOut: false,
                }),
              { once: true },
            );
          }),
      };
      const loopId = await app.publishLoop(
        singleNodeLoop('ordinary-script-' + action, {
          id: 'script',
          kind: 'script',
          label: 'Script',
          config: { command: 'ordinary-command', timeoutSeconds: action === 'timeout' ? 1 : 30 },
        }),
      );
      const response = await app.app.inject({
        method: 'POST',
        url: '/loops/' + loopId + '/runs',
        payload: {},
      });
      expect(response.statusCode, response.body).toBe(202);
      const runId = response.json<{ run: { id: string } }>().run.id;
      const request = await started;
      if (action === 'cancel')
        expect(
          (await app.app.inject({ method: 'POST', url: '/runs/' + runId + '/cancel' })).statusCode,
        ).toBe(200);
      await app.idle();
      expect(request.signal.aborted).toBe(true);
      expect(await app.container.repos.runs.get(runId)).toMatchObject(
        action === 'cancel'
          ? { status: 'cancelled' }
          : { status: 'failed', failure: { code: 'SCRIPT_TIMEOUT' } },
      );
      expect(
        (await app.container.repos.runs.listRecoveryCandidates()).filter((r) => r.terminal),
      ).toEqual([]);
    },
  );
});
