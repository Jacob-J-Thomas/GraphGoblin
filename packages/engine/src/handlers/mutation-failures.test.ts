import { describe, expect, it, vi } from 'vitest';
import type { MutationOperationInput, RunRecord } from '@graphgoblin/contracts';
import { TemplateError } from '@graphgoblin/domain';
import { createTestEngine, singleNodeLoop, type TestEngine } from '../testing/scenario.js';

const prior: MutationOperationInput = {
  op: 'set',
  path: '/vars/prior',
  value: { kind: 'literal', value: 1 },
};
const later: MutationOperationInput = {
  op: 'set',
  path: '/vars/later',
  value: { kind: 'expression', jsonata: '$error("later operation ran")' },
};
const coerce = {
  op: 'coerce',
  source: '/vars/raw',
  target: '/vars/repaired',
  jsonSchema: { type: 'boolean' },
  repair: { maxAttempts: 1 },
} satisfies MutationOperationInput;

function publish(engine: TestEngine, operations: MutationOperationInput[]) {
  return engine.publish(
    singleNodeLoop('Mutation failures', {
      id: 'mut',
      kind: 'mutate',
      label: 'Mutate',
      config: { operations },
    }),
  );
}

function expectAtomicFailure(engine: TestEngine, run: RunRecord) {
  expect(run.status).toBe('failed');
  const events = engine.events(run.id);
  expect(events.filter((event) => event.type === 'run.failed')).toEqual([
    expect.objectContaining({ failure: run.failure }),
  ]);
  expect(
    events.filter((event) => event.type === 'node.started').map((event) => event.nodeId),
  ).toEqual(['start', 'mut']);
  expect(
    events.filter((event) => event.type === 'node.finished').map((event) => event.nodeId),
  ).toEqual(['start']);
}

async function expectAuthoredFailure(
  engine: TestEngine,
  run: RunRecord,
  index: number,
  kind: MutationOperationInput['op'],
  cause: { code: string; text: string },
) {
  expectAtomicFailure(engine, run);
  expect(run.failure).toMatchObject({
    code: 'MUTATION_ERROR',
    nodeId: 'mut',
    resumable: false,
    details: {
      operationIndex: index,
      operationKind: kind,
      cause: { code: cause.code, message: expect.stringContaining(cause.text) },
    },
  });
  expect(run.failure?.message).toContain('operation ' + (index + 1) + ' (' + kind + ')');
  expect(run.failure?.message).toContain(cause.text);
  expect((await engine.manager.getThread(run.id))?.vars).not.toHaveProperty('prior');
  expect((await engine.manager.getRecovery(run.id)).resume).toMatchObject({
    code: 'FAILURE_NOT_RESUMABLE',
  });
  await expect(engine.manager.resume(run.id)).rejects.toMatchObject({
    code: 'FAILURE_NOT_RESUMABLE',
  });
  expect(engine.eventTypes(run.id)).not.toContain('run.resumed');
}

describe('authored mutation failure boundaries', () => {
  it.each([
    {
      faulty: {
        op: 'set',
        path: '/vars/out',
        value: { kind: 'expression', jsonata: '$error("author fault")' },
      },
      cause: { code: 'EXPRESSION_ERROR', text: 'author fault' },
    },
    {
      faulty: { op: 'append-message', content: '{{ "x" | append }}' },
      cause: { code: 'TEMPLATE_ERROR', text: 'append expect 2 arguments' },
    },
    {
      faulty: { op: 'set', path: '/run/id', value: { kind: 'literal', value: 1 } },
      cause: { code: 'MUTATION_ERROR', text: 'not in a mutable region' },
    },
    {
      faulty: { op: 'set', path: '/vars/prior/invalid', value: { kind: 'literal', value: 1 } },
      cause: { code: 'PATCH_ERROR', text: 'traverses a non-container' },
    },
  ] satisfies { faulty: MutationOperationInput; cause: { code: string; text: string } }[])(
    'reports $cause.code at the real authored index',
    async ({ faulty, cause }) => {
      const engine = await createTestEngine();
      const run = await engine.runToIdle(publish(engine, [prior, faulty, later]).loopId);
      await expectAuthoredFailure(engine, run, 1, faulty.op, cause);
    },
  );

  it('identifies the coerce operation when its repair prompt fails to render', async () => {
    const engine = await createTestEngine();
    const repair = { ...coerce, repair: { ...coerce.repair, prompt: '{{ "x" | append }}' } };
    const run = await engine.runToIdle(publish(engine, [prior, repair, later]).loopId);
    await expectAuthoredFailure(engine, run, 1, 'coerce', {
      code: 'TEMPLATE_ERROR',
      text: 'append expect 2 arguments',
    });
    expect(engine.ports.structuredFake.requests).toHaveLength(0);
  });

  it('keeps the original operation index after repairs continue', async () => {
    const engine = await createTestEngine();
    engine.ports.structuredFake.respondWith(() => true);
    const run = await engine.runToIdle(publish(engine, [prior, coerce, later]).loopId);
    await expectAuthoredFailure(engine, run, 2, 'set', {
      code: 'EXPRESSION_ERROR',
      text: 'later operation ran',
    });
    expect(engine.ports.structuredFake.requests).toHaveLength(1);
    expect((await engine.manager.getThread(run.id))?.vars).not.toHaveProperty('repaired');
  });

  it.each([true, 'invalid'])(
    'identifies a failed coerce target write after answer %s',
    async (value) => {
      const engine = await createTestEngine();
      engine.ports.structuredFake.respondWith(() => value);
      const repair = {
        ...coerce,
        target: '/vars/prior/invalid',
        repair: { ...coerce.repair, onFailure: 'continue-raw' as const },
      };
      const run = await engine.runToIdle(publish(engine, [prior, repair, later]).loopId);
      await expectAuthoredFailure(engine, run, 1, 'coerce', {
        code: 'PATCH_ERROR',
        text: 'traverses a non-container',
      });
      expect(engine.ports.structuredFake.requests).toHaveLength(1);
    },
  );

  it.each(['mutate', 'inference'] as const)(
    'repairs a %s coerce whose authored schema does not compile, without an authored boundary',
    async (kind) => {
      const engine = await createTestEngine();
      const invalid = { ...coerce, source: '/vars/prior', jsonSchema: { type: 'not-a-type' } };
      const operations = [prior, invalid, later];
      const config =
        kind === 'mutate'
          ? { operations }
          : { prompt: { template: 'never sent' }, input: operations };
      const run = await engine.runToIdle(
        engine.publish(singleNodeLoop('Invalid schema', { id: 'mut', kind, label: 'M', config }))
          .loopId,
      );
      expectAtomicFailure(engine, run);
      expect(run.failure).toMatchObject({
        code: 'OUTPUT_SCHEMA_MISMATCH',
        nodeId: 'mut',
        resumable: true,
        details: { errors: [expect.stringMatching(/^invalid schema: /)], value: 1 },
      });
      expect(run.failure?.details).not.toHaveProperty('boundary');
      expect(engine.ports.structuredFake.requests).toEqual([
        { prompt: expect.stringContaining('invalid schema: '), schema: invalid.jsonSchema },
      ]);
      expect(engine.ports.harness.started).toHaveLength(0);
    },
  );

  it('continues raw after an authored schema that does not compile when the policy allows', async () => {
    const engine = await createTestEngine();
    const invalid = {
      ...coerce,
      source: '/vars/prior',
      jsonSchema: { type: 'not-a-type' },
      repair: { ...coerce.repair, onFailure: 'continue-raw' as const },
    };
    const run = await engine.runToIdle(publish(engine, [prior, invalid]).loopId);
    expect(run.status).toBe('succeeded');
    expect((await engine.manager.getThread(run.id))?.vars).toEqual({ prior: 1, repaired: 1 });
    expect(engine.ports.structuredFake.requests).toHaveLength(1);
  });

  it.each([
    { source: 'completion', ErrorType: Error },
    { source: 'completion', ErrorType: TemplateError },
    { source: 'resolver', ErrorType: TemplateError },
  ] as const)(
    'keeps a $source exception ($ErrorType.name) private and resumable',
    async ({ source, ErrorType }) => {
      const engine = await createTestEngine();
      const fault = new ErrorType('D:/message-canary/engine.ts');
      fault.stack = 'D:/stack-canary/engine.ts';
      if (source === 'completion') {
        engine.ports.structuredFake.respondWith(() => {
          throw fault;
        });
      } else vi.spyOn(engine.ports.modelCatalog, 'list').mockRejectedValueOnce(fault);
      const run = await engine.runToIdle(publish(engine, [prior, coerce, later]).loopId);
      expectAtomicFailure(engine, run);
      expect(run.failure).toMatchObject({ code: 'INTERNAL_ERROR', nodeId: 'mut', resumable: true });
      expect(JSON.stringify([run.failure, engine.events(run.id)])).not.toMatch(
        /message-canary|stack-canary/,
      );
      const diagnostics = engine.ports.logger.lines.filter(
        ({ obj }) => obj.runId === run.id && obj.nodeId === 'mut',
      );
      expect(JSON.stringify(diagnostics)).toContain('message-canary');
      expect(JSON.stringify(diagnostics)).toContain('stack-canary');
    },
  );

  it('keeps final ContextThread validation outside authored operation attribution', async () => {
    const engine = await createTestEngine();
    const invalid: MutationOperationInput = {
      op: 'set',
      path: '/vars',
      value: { kind: 'literal', value: 1 },
    };
    const run = await engine.runToIdle(publish(engine, [prior, invalid]).loopId);
    expectAtomicFailure(engine, run);
    expect(run.failure).toMatchObject({ code: 'INTERNAL_ERROR', nodeId: 'mut', resumable: false });
    expect(run.failure?.details).toBeUndefined();
    expect(run.failure?.message).not.toContain('expected record');
    expect(JSON.stringify(engine.ports.logger.lines)).toContain('expected record');
    const restore: MutationOperationInput = {
      ...invalid,
      value: { kind: 'literal', value: { restored: true } },
    };
    const restored = await engine.runToIdle(publish(engine, [prior, invalid, restore]).loopId);
    expect(restored.status).toBe('succeeded');
    expect((await engine.manager.getThread(restored.id))?.vars).toEqual({ restored: true });
  });
});
