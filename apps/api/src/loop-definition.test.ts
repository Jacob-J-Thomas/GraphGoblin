import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
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

  it('returns ordered literal pointers in the validation problem and accepts valid input', async () => {
    const source = minimalLoop();
    const invalid = {
      ...source,
      name: '',
      variables: { 'literal/~': { type: 'string' } },
      nodes: [
        source.nodes[0],
        { id: 'infer', kind: 'inference', label: 'Infer', config: { prompt: { template: 1 } } },
        source.nodes[1],
      ],
    };
    for (const [payload, errors] of [
      [
        { definition: invalid },
        [
          {
            path: '/definition/name',
            message: 'Too small: expected string to have >=1 characters',
          },
          { path: '/definition/variables/literal~1~0', message: 'Invalid key in record' },
          {
            path: '/definition/nodes/1/config/prompt/template',
            message: 'Invalid input: expected string, received number',
          },
        ],
      ],
      [[], [{ path: '/', message: 'Invalid input: expected object, received array' }]],
    ] as const) {
      const response = await t.app.inject({ method: 'POST', url: '/loops', payload });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json\b/);
      expect(response.json()).toEqual({
        type: 'https://graphgoblin.dev/problems/validation-failed',
        title: 'validation failed',
        status: 400,
        code: 'VALIDATION_FAILED',
        detail: 'the request did not match the schema',
        errors,
      });
    }
    const created = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: { definition: { ...source, variables: { literal: { type: 'string' } } } },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      draft: {
        definition: {
          variables: { literal: { type: 'string' } },
          settings: { workingDirectory: { kind: 'temp' } },
        },
      },
    });
  });

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
              formatVersion: CURRENT_DEFINITION_FORMAT,
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
                formatVersion: CURRENT_DEFINITION_FORMAT,
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
