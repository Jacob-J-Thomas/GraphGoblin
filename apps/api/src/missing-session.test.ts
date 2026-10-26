import { describe, expect, it } from 'vitest';
import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import { singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp } from './testing/test-app.js';

async function failed(exitOutcome: 'success' | 'failure' | 'exhausted' = 'success') {
  const t = await createTestApp();
  const def = singleNodeLoop('missing session API', {
    id: 'worker',
    kind: 'inference',
    label: 'Worker',
    config: {
      session: { policy: 'resume-previous' },
      prompt: { template: 'Original selected task' },
      model: 'gpt-6-luna',
      effort: 'low',
    },
  });
  def.nodes.push({
    id: 'upstream',
    kind: 'inference',
    label: 'Upstream',
    config: { prompt: { template: 'Upstream task' } },
  });
  def.edges[0] = { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'upstream' } };
  def.edges.push({ id: 'e3', from: { node: 'upstream', port: 'out' }, to: { node: 'worker' } });
  const exit = def.nodes.find((node) => node.id === 'done');
  if (exit?.kind === 'exit') exit.config = { ...exit.config, outcome: exitOutcome };
  t.harness.script([
    {},
    {
      announceSession: false,
      accepted: false,
      items: [],
      submission: 'session-missing',
      error: { code: 'HARNESS_SESSION_MISSING', message: 'removed' },
    },
  ]);
  const loopId = await t.publishLoop(def);
  const response = await t.app.inject({
    method: 'POST',
    url: `/loops/${loopId}/runs`,
    payload: {},
  });
  const { run } = response.json<{ run: RunRecord }>();
  await t.idle();
  const history = await t.container.repos.events.read(run.id);
  const failureSeq = history.findLast((event) => event.type === 'run.failed')!.seq;
  return { t, runId: run.id, failureSeq, payload: { nodeId: 'worker', failureSeq } };
}

describe('explicit missing-session API recovery', () => {
  it('records the choice and starts fresh with the same task and model; plain Resume refuses', async () => {
    const { t, runId, payload } = await failed();
    try {
      expect(
        (
          await t.app.inject({
            method: 'POST',
            url: `/runs/${runId}/resume`,
            payload: { observedSeq: (await t.container.manager.getRecovery(runId)).observedSeq },
          })
        ).statusCode,
      ).toBe(409);
      expect((await t.container.repos.runs.get(runId))?.status).toBe('failed');
      const chosen = await t.app.inject({
        method: 'POST',
        url: `/runs/${runId}/recover-session`,
        payload,
      });
      expect(chosen.statusCode).toBe(200);
      await t.idle();
      expect((await t.container.repos.runs.get(runId))?.status).toBe('succeeded');
      const events = await t.container.repos.events.read(runId);
      const choice = events.find((event) => event.type === 'run.resumed');
      expect(choice).toMatchObject({
        actor: { kind: 'user', id: 'local' },
        ts: expect.any(String),
        freshSession: {
          ...payload,
          priorContextCarried: false,
          origin: 'resume-previous',
          sessionId: 'fake-session-1',
          model: 'gpt-6-luna',
          effort: 'low',
          prompt: 'Original selected task',
        },
      });
      expect(t.harness.started.at(-1)).toMatchObject({
        model: 'gpt-6-luna',
        effort: 'low',
        turn: { prompt: 'Original selected task' },
      });
      expect(
        events.filter((event) => event.type === 'harness.session').map((event) => event.mode),
      ).toEqual(['fresh', 'fresh']);
      expect(
        (await t.app.inject({ method: 'POST', url: `/runs/${runId}/recover-session`, payload }))
          .statusCode,
      ).toBe(409);
    } finally {
      await t.close();
    }
  });

  it('rejects wrong node, stale failure, wrong scope and wrong owner without recording a choice', async () => {
    const { t, runId, payload } = await failed();
    try {
      const reader = await t.container.repos.apiKeys.create('local', 'reader', ['runs:read']);
      const stranger = await t.container.repos.apiKeys.create('other', 'stranger', ['runs:write']);
      for (const [body, token, status] of [
        [{ ...payload, nodeId: 'upstream' }, undefined, 409],
        [{ ...payload, failureSeq: payload.failureSeq - 1 }, undefined, 409],
        [payload, reader.token, 403],
        [payload, stranger.token, 404],
        [{ ...payload, model: 'other-model' }, undefined, 400],
      ] as const) {
        const response = await t.app.inject({
          method: 'POST',
          url: `/runs/${runId}/recover-session`,
          payload: body,
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        expect(response.statusCode).toBe(status);
      }
      expect(
        (await t.container.repos.events.read(runId)).filter(
          (event) => event.type === 'run.resumed',
        ),
      ).toEqual([]);
      expect(t.harness.started).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it('accepts one concurrent choice and durably attributes an API-key caller', async () => {
    const { t, runId, payload } = await failed();
    try {
      const key = await t.container.repos.apiKeys.create('local', 'operator', ['runs:write']);
      const requests = await Promise.all(
        [1, 2].map(() =>
          t.app.inject({
            method: 'POST',
            url: `/runs/${runId}/recover-session`,
            payload,
            headers: { authorization: `Bearer ${key.token}` },
          }),
        ),
      );
      expect(requests.map((response) => response.statusCode).sort()).toEqual([200, 409]);
      await t.idle();
      const events: RunEvent[] = await t.container.repos.events.read(runId);
      expect(events.filter((event) => event.type === 'run.resumed')).toMatchObject([
        {
          actor: {
            kind: 'api-key',
            id: (await t.container.repos.apiKeys.authenticate(key.token))!.id,
          },
        },
      ]);
    } finally {
      await t.close();
    }
  });
});

it.each(['success', 'failure', 'exhausted'] as const)(
  'allows an explicit parent Resume after its missing-session child was explicitly recovered (%s)',
  async (exitOutcome) => {
    const { t, runId } = await failed(exitOutcome);
    try {
      const source = (await t.container.repos.runs.get(runId))!;
      const parentLoop = await t.publishLoop(
        singleNodeLoop('missing-session parent', {
          id: 'sub',
          kind: 'subloop',
          label: 'Child',
          config: { loopRef: { loopId: source.loopId } },
        }),
      );
      t.harness.script([
        {},
        {
          announceSession: false,
          accepted: false,
          items: [],
          submission: 'session-missing',
          error: { code: 'HARNESS_SESSION_MISSING', message: 'removed child session' },
        },
      ]);
      const started = await t.app.inject({
        method: 'POST',
        url: `/loops/${parentLoop}/runs`,
        payload: {},
      });
      const parent = started.json<{ run: RunRecord }>().run;
      await t.idle();
      const child = (await t.container.repos.runs.listChildren(parent.id))[0]!;
      expect((await t.container.repos.runs.get(parent.id))?.failure).toMatchObject({
        code: 'HARNESS_SESSION_MISSING',
        resumable: false,
      });
      expect(
        (
          await t.app.inject({
            method: 'POST',
            url: `/runs/${parent.id}/resume`,
            payload: {
              observedSeq: (await t.container.manager.getRecovery(parent.id)).observedSeq,
            },
          })
        ).statusCode,
      ).toBe(409);
      const failureSeq = (await t.container.repos.events.read(child.id)).findLast(
        (event) => event.type === 'run.failed',
      )!.seq;
      expect(
        (
          await t.app.inject({
            method: 'POST',
            url: `/runs/${child.id}/recover-session`,
            payload: { nodeId: 'worker', failureSeq },
          })
        ).statusCode,
      ).toBe(200);
      await t.idle();
      expect(
        (
          await t.app.inject({
            method: 'POST',
            url: `/runs/${parent.id}/resume`,
            payload: {
              observedSeq: (await t.container.manager.getRecovery(parent.id)).observedSeq,
            },
          })
        ).statusCode,
      ).toBe(200);
      await t.idle();
      expect((await t.container.repos.runs.get(parent.id))?.status).toBe('succeeded');
    } finally {
      await t.close();
    }
  },
);
