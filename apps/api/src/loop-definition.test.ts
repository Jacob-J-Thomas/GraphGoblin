import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

describe('canonical loop definition inputs', () => {
  it.each(['root', 'nested'] as const)(
    'reports each unknown %s key with its own escaped pointer and message',
    async (level) => {
      const extras = { extra: true, 'slash/~': true };
      const response = await t.app.inject(
        level === 'root'
          ? {
              method: 'PATCH',
              url: '/model-catalog/codex/gpt-6-luna',
              payload: { enabled: false, ...extras },
            }
          : {
              method: 'POST',
              url: '/loops',
              payload: { definition: { ...minimalLoop(), settings: { defaults: extras } } },
            },
      );
      const base = level === 'root' ? '' : '/definition/settings/defaults';
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [
          { path: `${base}/extra`, message: 'Unrecognized key "extra"' },
          { path: `${base}/slash~1~0`, message: 'Unrecognized key "slash/~"' },
        ],
      });
    },
  );

  it('rejects an unsupported inference harness with its node path', async () => {
    const loopId = await t.publishLoop(minimalLoop());
    const source = minimalLoop();
    const definition = {
      ...source,
      nodes: [
        source.nodes[0],
        {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: { harness: 'wrong', prompt: { template: 'Hello' } },
        },
        source.nodes[1],
      ],
    };
    for (const [method, url] of [
      ['POST', '/loops'],
      ['PUT', `/loops/${loopId}/draft`],
      ['POST', `/loops/${loopId}/validate`],
    ] as const) {
      const response = await t.app.inject({ method, url, payload: { definition } });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: expect.arrayContaining([
          expect.objectContaining({ path: '/definition/nodes/1/config/harness' }),
        ]),
      });
    }
    for (const envelope of [false, true]) {
      const response = await t.app.inject({
        method: 'POST',
        url: '/loops/import',
        payload: envelope
          ? {
              format: 'graphgoblin-loop',
              formatVersion: 2,
              exportedAt: FIXTURE_TS,
              loop: definition,
            }
          : definition,
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'LOOP_IMPORT_ERROR',
        errors: {
          errors: expect.arrayContaining([
            expect.stringContaining(`${envelope ? 'loop.' : ''}nodes.1.config.harness:`),
          ]),
        },
      });
    }
  });

  it.each(['codex', 'wrong'])(
    'rejects a removed loop-default field valued %s everywhere',
    async (harness) => {
      const loopId = await t.publishLoop(minimalLoop());
      const definition = { ...minimalLoop(), settings: { defaults: { harness } } };
      for (const [method, url] of [
        ['POST', '/loops'],
        ['PUT', `/loops/${loopId}/draft`],
        ['POST', `/loops/${loopId}/validate`],
      ] as const) {
        const response = await t.app.inject({ method, url, payload: { definition } });
        expect(response.statusCode, response.body).toBe(400);
        expect(response.json()).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: expect.arrayContaining([
            expect.objectContaining({ path: '/definition/settings/defaults/harness' }),
          ]),
        });
      }
      for (const envelope of [false, true]) {
        const response = await t.app.inject({
          method: 'POST',
          url: '/loops/import',
          payload: envelope
            ? {
                format: 'graphgoblin-loop',
                formatVersion: 2,
                exportedAt: FIXTURE_TS,
                loop: definition,
              }
            : definition,
        });
        expect(response.statusCode, response.body).toBe(400);
        expect(response.json()).toMatchObject({
          code: 'LOOP_IMPORT_ERROR',
          errors: {
            errors: expect.arrayContaining([
              expect.stringContaining(`${envelope ? 'loop.' : ''}settings.defaults.harness:`),
            ]),
          },
        });
      }
    },
  );
});
