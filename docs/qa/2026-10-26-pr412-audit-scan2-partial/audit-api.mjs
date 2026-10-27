import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../../apps/api/dist/app.js';
import { createContainer } from '../../../apps/api/dist/container.js';
import { loadConfig } from '../../../apps/api/dist/config.js';
const apiParent = new URL('../../../apps/api/package.json', import.meta.url).href;
export const fromPackage = (name) => import(import.meta.resolve(name, apiParent));
export const testing = await fromPackage('@graphgoblin/engine/testing');
export const contractTesting = await fromPackage('@graphgoblin/contracts/testing');
export const sqlite = await fromPackage('@graphgoblin/infrastructure/sqlite');
export const fsPorts = await fromPackage('@graphgoblin/infrastructure/fs');
export async function boot({ directory, port = 6490, available = 50 * 1024 ** 3 } = {}) {
  directory ??= await mkdtemp(join(tmpdir(), 'gg-audit-e3-api-'));
  await mkdir(directory, { recursive: true });
  const clock = new testing.FakeClock();
  const capacity = { available };
  const harness = new testing.FakeHarness();
  const config = loadConfig({
    GG_DATA_DIR: directory, GG_DB_URL: `file:${join(directory, 'history.db').replaceAll('\\', '/')}`,
    GG_PORT: String(port), GG_SWAGGER_UI: 'false', GG_WEB_DIST: '',
    GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
  });
  const container = await createContainer(config, {
    storageCapacity: { read: async () => ({ totalBytes: 100 * 1024 ** 3, availableBytes: capacity.available }) },
    harnesses: { codex: harness }, deciders: [new testing.FakeDecider('codex')],
    classifiers: new testing.FakeClassifierRegistry(new testing.FakeClassifier('jev')),
    structured: new testing.FakeStructured(), logger: new testing.CapturingLogger(), clock, startTimers: false,
  });
  await container.start();
  const app = await buildApp(container, { logger: false });
  const url = await app.listen({ host: '127.0.0.1', port });
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => {
    const response = await fetch(url + path, {
      method, headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let value; try { value = JSON.parse(text); } catch { value = text; }
    return { status: response.status, value };
  };
  const create = async (definition) => {
    const created = await request('/loops', { definition });
    assert.equal(created.status, 201, JSON.stringify(created));
    const id = created.value.loop.id;
    assert.equal((await request(`/loops/${id}/publish`, {})).status, 200);
    return id;
  };
  const run = async (loopId, payload = {}) => {
    const started = await request(`/loops/${loopId}/runs`, payload);
    assert.equal(started.status, 202, JSON.stringify(started));
    await container.manager.waitForIdle();
    return (await request(`/runs/${started.value.run.id}`)).value;
  };
  const mark = async (runIds) => {
    const preview = await request('/runs/deletion-eligibility/preview', { runIds });
    const result = await request('/runs/deletion-eligibility', { runIds, token: preview.value.token, action: 'mark', confirmed: true });
    assert.equal(result.status, 200, JSON.stringify(result));
    return result.value;
  };
  return { directory, container, clock, capacity, harness, request, create, run, mark,
    async poll(value = 0) { capacity.available = value; clock.advance(60_000); await container.historyCleanup.poll(); return (await request('/system/storage')).value; },
    async close() { await app.close(); await container.dispose(); },
  };
}
export const inferenceLoop = (name) => testing.singleNodeLoop(name, { id: 'infer', kind: 'inference', label: 'Infer', config: { prompt: { template: 'Hello' }, output: { captureTranscript: 'artifact' } } });

