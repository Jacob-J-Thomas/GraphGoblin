import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './testing/test-app.js';

let test: TestApp;
let headers: { authorization: string };
const observations: Record<string, unknown>[] = [];
afterAll(async () => {
  const destination = process.env['GG_429_CORE_EVIDENCE_DIR'];
  if (destination)
    await writeFile(
      join(destination, 'path-observations.json'),
      JSON.stringify(observations, null, 2) + '\n',
    );
});
beforeEach(async () => {
  test = await createTestApp({ requireApiKey: true });
  const key = await test.container.repos.apiKeys.create('local', 'path fixture', ['*']);
  headers = { authorization: `Bearer ${key.token}` };
});
afterEach(async () => {
  await test.close();
});

function definition(configOverrides: Record<string, unknown>): LoopDefinitionInput {
  const source = minimalLoop();
  return {
    ...source,
    nodes: [
      source.nodes[0]!,
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: {
          prompt: { template: 'Inert configuration fixture.' },
          harnessOptions: { configOverrides },
        },
      },
      source.nodes[1]!,
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

describe('literal authored member paths (#429 F1)', () => {
  it.each([
    ['slash', { 'review/slash': false }, 'review~1slash'],
    ['literal tilde escape text', { 'review~1text': false }, 'review~01text'],
    [
      'nested array member',
      { review: [0, { 'slash/~member': false }] },
      'review/1/slash~1~0member',
    ],
  ] as const)(
    'encodes %s in create, save and validate errors',
    async (_name, overrides, suffix) => {
      const created = await test.app.inject({
        method: 'POST',
        url: '/loops',
        headers,
        payload: { definition: definition({ 'features.plugins': false }) },
      });
      expect(created.statusCode, created.body).toBe(201);
      const loop = created.json<{ loop: { id: string } }>().loop;
      for (const [method, url] of [
        ['POST', '/loops'],
        ['PUT', `/loops/${loop.id}/draft`],
        ['POST', `/loops/${loop.id}/validate`],
      ] as const) {
        const response = await test.app.inject({
          method,
          url,
          headers,
          payload: { definition: definition(overrides) },
        });
        expect(response.statusCode, response.body).toBe(400);
        const result = response.json<{
          code: string;
          errors: { path: string; message: string }[];
        }>();
        const observation = {
          finding: 'F1',
          fixture: _name,
          method,
          code: result.code,
          path: result.errors[0]?.path,
        };
        observations.push(observation);
        expect(result).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [
            {
              path: `/definition/nodes/1/config/harnessOptions/configOverrides/${suffix}`,
              message: expect.stringContaining('every key segment'),
            },
          ],
        });
      }
      expect(test.harness.started).toHaveLength(0);
    },
  );
});
