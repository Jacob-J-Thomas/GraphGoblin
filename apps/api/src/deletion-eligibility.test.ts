import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DeletionPreview, RunRecord } from '@graphgoblin/contracts';
import { fakeUlid, minimalLoop } from '@graphgoblin/contracts/testing';
import { singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-e3-'));
  t = await createTestApp({
    tempPrefix: 'gg-wp-e3-',
    env: { GG_DATA_DIR: dataDir, GG_DB_URL: `file:${join(dataDir, 'history.db')}` },
  });
});
afterEach(async () => {
  await t.close();
  globalThis.gc?.();
  await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

let sequence = 0;
async function completed() {
  const loopId = await t.publishLoop({ ...minimalLoop(), name: `History ${++sequence}` });
  const response = await t.app.inject({
    method: 'POST',
    url: `/loops/${loopId}/runs`,
    payload: {},
  });
  expect(response.statusCode).toBe(202);
  await t.idle();
  return (await t.container.repos.runs.get(response.json<{ run: RunRecord }>().run.id))!;
}

async function preview(runIds: string[]) {
  const response = await t.app.inject({
    method: 'POST',
    url: '/runs/deletion-eligibility/preview',
    payload: { runIds },
  });
  expect(response.statusCode).toBe(200);
  return response.json<DeletionPreview>();
}
async function confirm(
  runIds: string[],
  action: 'mark' | 'withdraw' = 'mark',
  selection?: DeletionPreview,
) {
  const checked = selection ?? (await preview(runIds));
  return t.app.inject({
    method: 'POST',
    url: '/runs/deletion-eligibility',
    payload: { runIds, token: checked.token, action, confirmed: true },
  });
}

it('previews only the explicit selection without changing history', async () => {
  const run = await completed();
  const response = await t.app.inject({
    method: 'POST',
    url: '/runs/deletion-eligibility/preview',
    payload: { runIds: [run.id] },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ items: [{ runId: run.id, reasons: [] }] });
  expect(await t.container.repos.runs.get(run.id)).not.toHaveProperty('deletionApproval');
});

it('persists identical success/failure consent with actor and time across reopening, scopes it to the selection, and withdraws it', async () => {
  const success = await completed(),
    failed = await completed();
  await t.container.repos.runs.update(failed.id, {
    status: 'failed',
    failure: { code: 'INTERNAL_ERROR', message: 'fixture', resumable: true },
  });
  const ids = [success.id, failed.id];
  expect((await preview(ids)).items.every((item) => item.reasons.length === 0)).toBe(true);
  expect((await confirm(ids)).statusCode).toBe(200);
  const stored = await t.container.handle.client.execute({
    sql: 'SELECT deletion_approval FROM runs WHERE id = ?',
    args: [success.id],
  });
  const approvalText = stored.rows[0]!['deletion_approval'];
  if (typeof approvalText !== 'string') throw new Error('Approval must be stored as JSON text.');
  expect(JSON.parse(approvalText)).toEqual({
    confirmedAt: t.clock.now().toISOString(),
    confirmedBy: { ownerId: 'local', kind: 'user', id: 'local' },
  });
  await t.close();
  t = await createTestApp({
    tempPrefix: 'gg-wp-e3-',
    env: { GG_DATA_DIR: dataDir, GG_DB_URL: `file:${join(dataDir, 'history.db')}` },
  });
  expect(
    (await t.app.inject({ method: 'GET', url: `/runs/${success.id}` })).json<RunRecord>()
      .deletionApproval,
  ).toBeDefined();
  const listed = (await t.app.inject({ method: 'GET', url: '/runs' })).json<{
    items: RunRecord[];
  }>().items;
  expect(
    listed
      .filter((run) => run.deletionApproval)
      .map((run) => run.id)
      .sort(),
  ).toEqual(ids.sort());
  const fresh = await completed();
  expect(fresh.deletionApproval).toBeUndefined();
  const old = await preview([success.id]);
  expect((await confirm([success.id], 'withdraw')).statusCode).toBe(200);
  expect((await t.container.repos.runs.get(success.id))?.deletionApproval).toBeUndefined();
  expect((await t.container.repos.runs.get(failed.id))?.deletionApproval).toBeDefined();
  expect((await confirm([success.id], 'mark', old)).json()).toMatchObject({
    code: 'DELETION_SELECTION_STALE',
  });
});

it('refuses a mixed protected selection atomically and reports each reason without silently dropping it', async () => {
  const finished = await completed(),
    paused = await completed();
  await t.container.repos.runs.update(paused.id, { status: 'paused' });
  const selection = await preview([finished.id, paused.id]);
  expect(selection.items[1]?.reasons.join(' ')).toContain('paused');
  const response = await confirm([finished.id, paused.id], 'mark', selection);
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({
    code: 'DELETION_SELECTION_PROTECTED',
    errors: [{ runId: finished.id }, { runId: paused.id }],
  });
  expect((await t.container.repos.runs.get(finished.id))?.deletionApproval).toBeUndefined();
});

it('rejects malformed, unconfirmed, missing and foreign selections without approving the valid subset', async () => {
  const run = await completed();
  for (const runIds of [
    [],
    [run.id, run.id],
    ['invalid'],
    Array.from({ length: 501 }, (_, i) => fakeUlid(String(i))),
  ]) {
    expect(
      (
        await t.app.inject({
          method: 'POST',
          url: '/runs/deletion-eligibility/preview',
          payload: { runIds },
        })
      ).statusCode,
    ).toBe(400);
  }
  const foreign = { ...run, id: fakeUlid('foreign'), ownerId: 'other' };
  await t.container.repos.runs.create(
    foreign,
    (await t.container.repos.runs.getInitialThread(run.id))!,
  );
  for (const missing of [fakeUlid('missing'), foreign.id]) {
    const ids = [run.id, missing];
    const checked = await preview(ids);
    expect(checked.items[1]?.reasons).toEqual(['Run not found.']);
    expect((await confirm(ids, 'mark', checked)).json()).toMatchObject({
      code: 'DELETION_SELECTION_MISSING',
    });
  }
  expect(
    (
      await t.app.inject({
        method: 'POST',
        url: '/runs/deletion-eligibility',
        payload: {
          runIds: [run.id],
          action: 'mark',
          token: (await preview([run.id])).token,
          confirmed: false,
        },
      })
    ).statusCode,
  ).toBe(400);
  expect((await t.container.repos.runs.get(run.id))?.deletionApproval).toBeUndefined();
});

it('allows one competing confirmation and refuses the stale one', async () => {
  const run = await completed();
  const selection = await preview([run.id]);
  const responses = await Promise.all([
    confirm([run.id], 'mark', selection),
    confirm([run.id], 'withdraw', selection),
  ]);
  expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
});

it('rolls back a failed bulk write, and records only the authorized authenticated confirming actor', async () => {
  const first = await completed(),
    second = await completed();
  const ids = [first.id, second.id];
  const selection = await preview(ids);
  await t.container.handle.client.execute(
    `CREATE TRIGGER fail_consent BEFORE UPDATE OF deletion_approval ON runs WHEN NEW.id = '${second.id}' AND NEW.deletion_approval IS NOT NULL BEGIN SELECT RAISE(ABORT, 'injected consent failure'); END`,
  );
  expect((await confirm(ids, 'mark', selection)).statusCode).toBe(500);
  for (const id of ids)
    expect((await t.container.repos.runs.get(id))?.deletionApproval).toBeUndefined();
  await t.container.handle.client.execute('DROP TRIGGER fail_consent');
  const reader = await t.container.repos.apiKeys.create('local', 'history reader', ['runs:read']);
  const writer = await t.container.repos.apiKeys.create('local', 'history confirmer', [
    'runs:write',
  ]);
  const payload = { runIds: ids, token: selection.token, action: 'mark', confirmed: true };
  expect(
    (
      await t.app.inject({
        method: 'POST',
        url: '/runs/deletion-eligibility/preview',
        headers: { authorization: `Bearer ${reader.token}` },
        payload: { runIds: ids },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await t.app.inject({
        method: 'POST',
        url: '/runs/deletion-eligibility',
        headers: { authorization: `Bearer ${reader.token}` },
        payload,
      })
    ).statusCode,
  ).toBe(403);
  const accepted = await t.app.inject({
    method: 'POST',
    url: '/runs/deletion-eligibility',
    headers: { authorization: `Bearer ${writer.token}` },
    payload,
  });
  expect(accepted.statusCode).toBe(200);
  expect((await t.container.repos.runs.get(first.id))?.deletionApproval?.confirmedBy).toMatchObject(
    { ownerId: 'local', kind: 'api-key' },
  );
});

it('requires related history together and revokes approvals on new dependencies and withdrawal', async () => {
  const parent = await completed();
  expect((await confirm([parent.id])).statusCode).toBe(200);
  const child = await completed();
  await t.container.repos.runs.update(child.id, { parentRunId: parent.id });
  expect((await t.container.repos.runs.get(parent.id))?.deletionApproval).toBeUndefined();
  expect((await preview([child.id])).items[0]?.reasons.join(' ')).toContain(parent.id);
  expect((await preview([parent.id])).items[0]?.reasons.join(' ')).toContain(child.id);
  expect((await confirm([parent.id, child.id])).statusCode).toBe(200);
  expect((await confirm([child.id], 'withdraw')).statusCode).toBe(200);
  expect((await t.container.repos.runs.get(parent.id))?.deletionApproval).toBeUndefined();
  expect((await t.container.repos.runs.get(child.id))?.deletionApproval).toBeUndefined();
});

it('keeps ADR-0033 loop deletion as separate explicit consent and detaches a retained child', async () => {
  const parent = await completed();
  const child = await completed();
  await t.container.repos.runs.update(child.id, { parentRunId: parent.id });
  const history = await t.container.repos.events.read(child.id);
  const thread = await t.container.repos.runs.getThread(child.id);
  // No eligibility approval is necessary for the separately confirmed loop command.
  await t.container.repos.runs.clearFinalized(parent.id);
  expect(
    (await t.app.inject({ method: 'DELETE', url: `/loops/${parent.loopId}` })).statusCode,
  ).toBe(204);
  expect(await t.container.repos.runs.get(parent.id)).toBeUndefined();
  expect((await t.container.repos.runs.get(child.id))?.parentRunId).toBeUndefined();
  expect(await t.container.repos.events.read(child.id)).toEqual(history);
  expect(await t.container.repos.runs.getThread(child.id)).toEqual(thread);
});

it('revokes the source when replay creates dependent history and leaves retained artifact bytes retrievable', async () => {
  t.harness.script([{ finalText: 'shared transcript' }, { finalText: 'shared transcript' }]);
  const loopId = await t.publishLoop(
    singleNodeLoop('Artifacts', {
      id: 'infer',
      kind: 'inference',
      label: 'Infer',
      config: { prompt: { template: 'Hello' }, output: { captureTranscript: 'artifact' } },
    }),
  );
  const started = await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} });
  const source = started.json<{ run: RunRecord }>().run;
  await t.idle();
  const artifact = (await t.container.manager.getThread(source.id))!.artifacts[0]!;
  const bytes = await t.app.inject({
    method: 'GET',
    url: `/runs/${source.id}/artifacts/${artifact.id}`,
  });
  expect(bytes.statusCode).toBe(200);
  expect((await confirm([source.id])).statusCode).toBe(200);
  const replay = await t.app.inject({
    method: 'POST',
    url: `/runs/${source.id}/replay`,
    payload: { nodeId: 'infer' },
  });
  expect(replay.statusCode).toBe(202);
  await t.idle();
  expect((await t.container.repos.runs.get(source.id))?.deletionApproval).toBeUndefined();
  expect(
    (await t.app.inject({ method: 'GET', url: `/runs/${source.id}/artifacts/${artifact.id}` }))
      .rawPayload,
  ).toEqual(bytes.rawPayload);
  expect((await preview([source.id])).items[0]?.reasons.join(' ')).toContain(
    'Required retained history',
  );
});
