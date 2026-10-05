import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ClassifierModelPutSchema,
  ClassifierModelSummarySchema,
  type ClassifierModelPut,
} from '@graphgoblin/contracts';
import { createTestApp, type TestApp } from '@graphgoblin/api/testing';
import {
  classifierModels,
  createGraphGoblinClient,
  type GraphGoblinClient,
  type RequestBody,
} from './index.js';

const metadata = {
  displayName: 'Kev',
  provider: 'http' as const,
  providerModel: 'kev-latest',
  primitives: ['choice' as const],
  endpoint: 'http://127.0.0.1:8008',
};
// Both directions are checked by workspace typecheck, alongside the live schema assertions.
const generatedInput: RequestBody<'/classifier-models/{id}', 'put'> =
  metadata satisfies ClassifierModelPut;
const contractInput: ClassifierModelPut = generatedInput;
describe('classifier client against the real API', () => {
  let app: TestApp;
  let client: GraphGoblinClient;
  beforeAll(async () => {
    app = await createTestApp();
    client = createGraphGoblinClient({
      baseUrl: await app.app.listen({ port: 0, host: '127.0.0.1' }),
    });
  });
  afterAll(async () => {
    await app.close();
  });
  it('agrees with generated schemas and executes all wrappers', async () => {
    expect(ClassifierModelPutSchema.parse(contractInput)).toEqual(metadata);
    const builtins = await classifierModels.list(client);
    expect(builtins[0]?.id).toBe('jev');
    expect(ClassifierModelSummarySchema.parse(builtins[0])).toEqual(builtins[0]);
    const created = await classifierModels.upsert(client, 'kev.local', generatedInput);
    expect(created).toMatchObject({ source: 'custom', enabled: false, configured: true });
    expect(await classifierModels.setEnabled(client, 'kev.local', true)).toMatchObject({
      enabled: true,
    });
    expect(
      await classifierModels.upsert(client, 'kev.local', {
        ...metadata,
        providerModel: 'kev-next',
      }),
    ).toMatchObject({ enabled: true, providerModel: 'kev-next' });
    await classifierModels.remove(client, 'kev.local');
    await expect(classifierModels.setEnabled(client, 'kev.local', true)).rejects.toMatchObject({
      status: 404,
      code: 'CLASSIFIER_MODEL_NOT_FOUND',
    });
    await expect(classifierModels.remove(client, 'jev')).rejects.toMatchObject({
      status: 409,
      code: 'CLASSIFIER_MANAGED_BY_SYSTEM',
    });
    await expect(classifierModels.upsert(client, 'jev', metadata)).rejects.toMatchObject({
      status: 409,
      code: 'CLASSIFIER_MANAGED_BY_SYSTEM',
    });
  });
  it('encodes ids, sends enabled-only PATCH, and propagates problem details', async () => {
    const calls: { method: string; pathname: string; body: unknown }[] = [];
    const transport = createGraphGoblinClient({
      baseUrl: 'http://test.local',
      fetch: async (request) => {
        calls.push({
          method: request.method,
          pathname: new URL(request.url).pathname,
          body: request.method === 'DELETE' ? undefined : ((await request.json()) as unknown),
        });
        return new Response(
          JSON.stringify({ status: 400, code: 'VALIDATION_FAILED', errors: [{ path: '/id' }] }),
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        );
      },
    });
    for (const call of [
      () => classifierModels.upsert(transport, 'space /?#', metadata),
      () => classifierModels.setEnabled(transport, 'space /?#', true),
      () => classifierModels.remove(transport, 'space /?#'),
    ]) {
      await expect(call()).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_FAILED',
        problem: { errors: [{ path: '/id' }] },
      });
    }
    expect(calls.map((call) => call.pathname)).toEqual(
      Array(3).fill('/classifier-models/space%20%2F%3F%23'),
    );
    expect(calls[1]?.body).toEqual({ enabled: true });
  });
});
