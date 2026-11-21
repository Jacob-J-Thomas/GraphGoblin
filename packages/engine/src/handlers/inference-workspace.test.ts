import * as domain from '@graphgoblin/domain';
import { describe, expect, it, vi } from 'vitest';
import type { PromptProvenance } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, samplePin, sampleThread } from '@graphgoblin/contracts/testing';
import { RunManager } from '../run-manager.js';
import { createInitialThread } from '../thread.js';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';
import type { HandlerRegistry } from '../handler.js';
import { defaultHandlers } from './index.js';
import { admitInferencePrompt } from './inference-context.js';

const cases = [
  {
    template: 'private-workspace-marker\n{% invalid_private %}',
    cause: 'The template could not be parsed at line 2, column 1. Check its Liquid syntax.',
  },
  {
    template: '{% include "private-workspace-marker" %}',
    cause:
      'The template could not be rendered at line 1, column 1. Check its filters and input values.',
  },
  {
    template: '\t {{ vars.missing }}\r\n',
    cause: 'The template rendered to an empty path. Supply a nonempty directory.',
  },
];

function definition(template: string) {
  const loop = singleNodeLoop('inference workspace failure', {
    id: 'infer',
    kind: 'inference',
    label: 'Infer',
    config: { model: 'gpt-6-luna', effort: 'low', prompt: { template: 'Original task' } },
  });
  loop.settings = { workingDirectory: { kind: 'template', template } };
  return loop;
}

describe('inference workspace preparation through public RunManager methods', () => {
  it.each(cases)(
    'rejects the workspace before any provider intent: $cause',
    async ({ template, cause }) => {
      const engine = await createTestEngine();
      try {
        const run = await engine.runToIdle(engine.publish(definition(template)).loopId);
        expect(run.failure).toEqual({
          code: 'TEMPLATE_ERROR',
          nodeId: 'infer',
          resumable: false,
          message: `Working directory template failed. ${cause}`,
          details: {
            boundary: 'settings.workingDirectory.template',
            cause: { code: 'TEMPLATE_ERROR', message: cause },
          },
        });
        expect(engine.events(run.id).filter((event) => event.type === 'run.failed')).toMatchObject([
          { failure: run.failure },
        ]);
        expect(
          JSON.stringify([run, engine.events(run.id), engine.ports.logger.lines]),
        ).not.toContain('private-workspace-marker');
        expect(engine.ports.workspace.resolved).toEqual([]);
        expect(engine.ports.harness.started).toEqual([]);
        expect(engine.ports.harness.resumed).toEqual([]);
        expect(engine.ports.sessions.rows).toEqual([]);
        expect(engine.eventTypes(run.id)).not.toContain('harness.turn');
        await expect(engine.manager.resume(run.id)).rejects.toMatchObject({
          code: 'FAILURE_NOT_RESUMABLE',
        });
      } finally {
        engine.manager.stop();
      }
    },
  );
});

// Synthetic durable history, seeded only through supported repository/event ports. The
// definition is schema-valid, but its workspace has not been evaluated by this process.
// This establishes recovery behavior, not a naturally occurring change in pinned source.
async function storedTask(
  template: string,
  submission: PromptProvenance['submission'],
  usable = true,
  handlers?: HandlerRegistry,
) {
  const engine = await createTestEngine();
  engine.manager.stop();
  const version = engine.publish(definition(template));
  const runId = fakeUlid('workspace-reentry-run');
  const invocationId = fakeUlid('workspace-reentry-invocation');
  const visitId = runId + ':3';
  const turnId = fakeUlid('workspace-reentry-turn');
  const sessionId = usable ? 'recorded-session' : undefined;
  const inference: PromptProvenance = {
    visitId,
    turnId,
    promptKind: 'authored',
    submission,
    ...(sessionId ? { sessionId } : {}),
  };
  await engine.ports.runs.create(
    {
      id: runId,
      ownerId: 'local',
      loopId: version.loopId,
      versionId: version.id,
      invocationId,
      pinned: samplePin(),
      status: 'running',
      currentNodeId: 'infer',
      iteration: 1,
      createdAt: FIXTURE_TS,
      startedAt: FIXTURE_TS,
      lastEventSeq: 0,
    },
    createInitialThread({
      runId,
      loopId: version.loopId,
      versionId: version.id,
      invocation: {
        id: invocationId,
        source: 'manual.api',
        trigger: {
          nodeId: 'start',
          kind: 'manual',
          payload: null,
          receivedAt: FIXTURE_TS,
        },
      },
    }),
  );
  await engine.ports.events.append(runId, [
    { type: 'run.queued', versionId: version.id, pinned: samplePin() },
    { type: 'run.started', attempt: 1 },
    { type: 'node.started', nodeId: 'infer', kind: 'inference', attempt: 1, configHash: 'fixture' },
    {
      type: 'harness.turn',
      nodeId: 'infer',
      visitId,
      turnId,
      harness: 'codex',
      promptKind: 'authored',
      prompt: 'Original task',
    },
    ...(sessionId
      ? [
          {
            type: 'harness.session' as const,
            nodeId: 'infer',
            harness: 'codex' as const,
            sessionId,
            mode: 'fresh' as const,
          },
        ]
      : []),
    {
      type: 'harness.submission',
      nodeId: 'infer',
      visitId,
      turnId,
      submission,
      ...(submission === 'delivery-uncertain' && usable
        ? { marker: 'fake.accepted' as const }
        : {}),
    },
  ]);
  await engine.ports.sessions.upsert({
    runId,
    nodeId: 'infer',
    attempt: 1,
    harness: 'codex',
    status: 'active',
    updatedAt: FIXTURE_TS,
    ...(sessionId ? { sessionId } : {}),
    model: 'gpt-6-luna',
    effort: 'low',
  });
  return {
    engine,
    runId,
    inference,
    manager: new RunManager(engine.ports, engine.settings, handlers),
  };
}

it('preserves the private canonical diagnostic when reconstruction attaches stored prior task provenance', async () => {
  const marker = 'private reconstructed canonical diagnostic';
  const thread = sampleThread();
  thread.invocation.trigger.payload = {
    protocol: 'graphgoblin.chat.v1',
    conversationId: fakeUlid('canonical-reconstruction'),
    requestId: '33d911ae-7293-4acb-ab74-910e67293f1d',
    turn: 1,
    history: [],
    input: { kind: 'text', text: 'Required question' },
  };
  // Synthetic B17 reachability: real pending turns disable canonical history trimming.
  // The handler fixture invokes that pure seam against already durable task history.
  const handlers: HandlerRegistry = {
    ...defaultHandlers(),
    inference: {
      kind: 'inference',
      async execute() {
        await admitInferencePrompt({
          prompt: 'oversized prompt',
          template: domain.SYSTEM_CHAT_TEXT_PROMPT,
          thread,
          allowHistoryTrim: true,
          window: {
            profile: 'test/reconstruction',
            contextTokens: 4096,
            outputReserveTokens: 1024,
            fits: () => false,
          },
        });
        throw new Error('synthetic canonical renderer unexpectedly succeeded');
      },
    },
  };
  const { engine, manager, runId, inference } = await storedTask(
    cases[2]!.template,
    'definitely-not-submitted',
    true,
    handlers,
  );
  const before = engine.events(runId).filter((event) => event.type.startsWith('harness.'));
  const render = vi
    .spyOn(domain, 'renderTemplate')
    .mockRejectedValueOnce(new domain.TemplateError(marker));
  try {
    await manager.start();
    await manager.waitForIdle();
    const run = await engine.ports.runs.get(runId);
    expect(run?.failure).toEqual({
      code: 'INTERNAL_ERROR',
      nodeId: 'infer',
      resumable: true,
      inference,
      message: 'An unexpected error interrupted the run. See the server logs for this run.',
    });
    expect(run?.failure?.inference?.retry).toBeUndefined();
    expect(engine.ports.logger.lines).toContainEqual({
      level: 'error',
      msg: 'node failed',
      obj: {
        runId,
        nodeId: 'infer',
        failure: run?.failure,
        error: expect.objectContaining({ message: marker }),
      },
    });
    expect(JSON.stringify([run, engine.events(runId)])).not.toContain(marker);
    expect(engine.events(runId).filter((event) => event.type.startsWith('harness.'))).toEqual(
      before,
    );
    expect(engine.ports.harness.started).toEqual([]);
    expect(engine.ports.harness.resumed).toEqual([]);
  } finally {
    render.mockRestore();
    manager.stop();
  }
});

it.each(
  cases.flatMap((item) =>
    (['definitely-not-submitted', 'delivery-uncertain'] as const).map((submission) => ({
      ...item,
      submission,
    })),
  ),
)(
  'retains stored $submission evidence when the inference workspace fails: $cause',
  async ({ template, submission, cause }) => {
    const { engine, manager, runId, inference } = await storedTask(template, submission);
    const before = engine.events(runId);
    const rows = structuredClone(engine.ports.sessions.rows);
    try {
      await manager.start();
      await manager.waitForIdle();
      const run = await engine.ports.runs.get(runId);
      expect(run?.failure).toEqual({
        code: 'TEMPLATE_ERROR',
        nodeId: 'infer',
        resumable: false,
        inference,
        message: `Working directory template failed. ${cause}`,
        details: {
          boundary: 'settings.workingDirectory.template',
          cause: { code: 'TEMPLATE_ERROR', message: cause },
        },
      });
      expect(run?.failure?.inference?.retry).toBeUndefined();
      expect(
        engine
          .events(runId)
          .filter(
            (event) =>
              event.type === 'harness.turn' ||
              event.type === 'harness.submission' ||
              event.type === 'harness.session',
          ),
      ).toEqual(
        before.filter(
          (event) =>
            event.type === 'harness.turn' ||
            event.type === 'harness.submission' ||
            event.type === 'harness.session',
        ),
      );
      expect(engine.events(runId).findLast((event) => event.type === 'run.failed')).toMatchObject({
        failure: run?.failure,
      });
      expect(engine.ports.sessions.rows).toEqual(rows);
      expect(engine.ports.workspace.resolved).toEqual([]);
      expect(engine.ports.harness.started).toEqual([]);
      expect(engine.ports.harness.resumed).toEqual([]);
      expect(JSON.stringify([run, engine.events(runId), engine.ports.logger.lines])).not.toContain(
        'private-workspace-marker',
      );
      await expect(manager.resume(runId)).rejects.toMatchObject({ code: 'FAILURE_NOT_RESUMABLE' });
    } finally {
      manager.stop();
    }
  },
);

it.each([
  { submission: 'delivery-uncertain' as const, usable: false, code: 'HARNESS_DELIVERY_UNCERTAIN' },
  { submission: 'session-missing' as const, usable: true, code: 'HARNESS_SESSION_MISSING' },
])(
  'keeps the earlier $code refusal ahead of workspace evaluation',
  async ({ submission, usable, code }) => {
    const { engine, manager, runId, inference } = await storedTask(
      cases[0]!.template,
      submission,
      usable,
    );
    const observer = vi.spyOn(domain, 'observeTemplate');
    const rows = structuredClone(engine.ports.sessions.rows);
    const before = engine.events(runId).filter((event) => event.type.startsWith('harness.'));
    try {
      await manager.start();
      await manager.waitForIdle();
      expect((await engine.ports.runs.get(runId))?.failure).toMatchObject({
        code,
        resumable: false,
        inference,
      });
      expect(observer).not.toHaveBeenCalled();
      expect(engine.ports.workspace.resolved).toEqual([]);
      expect(engine.ports.sessions.rows).toEqual(rows);
      expect(engine.events(runId).filter((event) => event.type.startsWith('harness.'))).toEqual(
        before,
      );
      expect(engine.ports.harness.started).toEqual([]);
      expect(engine.ports.harness.resumed).toEqual([]);
    } finally {
      observer.mockRestore();
      manager.stop();
    }
  },
);
