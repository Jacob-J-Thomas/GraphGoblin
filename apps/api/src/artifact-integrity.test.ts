import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { RunRecord } from '@graphgoblin/contracts';
import { singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
});

it('serves exact verified transcript bytes, reports corruption explicitly, repairs on put and distinguishes missing content', async () => {
  t = await createTestApp();
  t.harness.script([
    { finalText: 'Hello, 世界 🧙', items: [{ id: 'note', type: 'message', summary: '世界' }] },
  ]);
  const loopId = await t.publishLoop(
    singleNodeLoop('Artifact API', {
      id: 'infer',
      kind: 'inference',
      label: 'Infer',
      config: { prompt: { template: 'Hello' }, output: { captureTranscript: 'artifact' } },
    }),
  );
  const started = await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} });
  expect(started.statusCode).toBe(202);
  const { run } = started.json<{ run: RunRecord }>();
  await t.idle();
  expect((await t.container.repos.runs.get(run.id))?.status).toBe('succeeded');
  const thread = await t.container.manager.getThread(run.id);
  const artifact = thread!.artifacts[0]!;
  const url = `/runs/${run.id}/artifacts/${artifact.id}`;
  const good = await t.app.inject({ method: 'GET', url });
  expect(good.statusCode).toBe(200);
  expect(good.body).toContain('世界');
  const path = join(t.dataDir, 'artifacts', ...artifact.ref.slice('artifact:'.length).split('/'));
  await writeFile(path, 'partial');
  const corrupt = await t.app.inject({ method: 'GET', url });
  expect(corrupt.statusCode).toBe(500);
  expect(corrupt.json()).toMatchObject({ code: 'ARTIFACT_CORRUPT' });
  expect(corrupt.body).not.toContain('partial');
  await t.container.ports.artifacts.put('transcript', good.body);
  const repaired = await t.app.inject({ method: 'GET', url });
  expect(repaired.statusCode).toBe(200);
  expect(repaired.rawPayload.equals(good.rawPayload)).toBe(true);
  await unlink(path);
  const missing = await t.app.inject({ method: 'GET', url });
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
});
