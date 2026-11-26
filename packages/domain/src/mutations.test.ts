import { describe, expect, it, vi } from 'vitest';
import type { ContextThread, MutationOperation } from '@graphgoblin/contracts';
import { MutationOperationSchema } from '@graphgoblin/contracts';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { observeExpression } from './expression.js';
import { ExpressionError, MutationError } from './errors.js';
import { applyMutations, completeRepair, planMutation, type MutationContext } from './mutations.js';

function ctx(): MutationContext {
  let n = 0;
  return { nodeId: 'mut', newId: () => `id${(n += 1)}`, now: () => '2026-10-02T13:00:00.000Z' };
}

function op(input: unknown): MutationOperation {
  return MutationOperationSchema.parse(input);
}

async function run(thread: ContextThread, ops: unknown[]): Promise<ContextThread> {
  const result = await applyMutations(thread, ops.map(op), ctx());
  if (result.pending) throw new Error('unexpected pending repair');
  return result.thread;
}

describe('set and delete', () => {
  it('sets literals, templates, and expressions', async () => {
    const thread = await run(sampleThread(), [
      { op: 'set', path: '/vars/a', value: { kind: 'literal', value: { x: 1 } } },
      { op: 'set', path: '/vars/b', value: { kind: 'template', template: '{{ vars.topic }}!' } },
      { op: 'set', path: '/vars/c', value: { kind: 'expression', jsonata: 'vars.count + 1' } },
      { op: 'set', path: '/vars/topic', value: { kind: 'literal', value: 'replaced' } },
    ]);
    expect(thread.vars).toMatchObject({ a: { x: 1 }, b: 'hello!', c: 3, topic: 'replaced' });
  });

  it('converts undefined expression results to null', async () => {
    const thread = await run(sampleThread(), [
      { op: 'set', path: '/vars/z', value: { kind: 'expression', jsonata: 'nope' } },
    ]);
    expect(thread.vars['z']).toBeNull();
  });

  it('refuses writes outside mutable regions', async () => {
    await expect(
      run(sampleThread(), [{ op: 'set', path: '/run/id', value: { kind: 'literal', value: 'x' } }]),
    ).rejects.toBeInstanceOf(MutationError);
    await expect(
      run(sampleThread(), [{ op: 'delete', path: '/counters/usage' }]),
    ).rejects.toBeInstanceOf(MutationError);
  });

  it('deletes existing values and ignores missing ones', async () => {
    const thread = await run(sampleThread(), [
      { op: 'delete', path: '/vars/topic' },
      { op: 'delete', path: '/vars/never' },
    ]);
    expect('topic' in thread.vars).toBe(false);
  });
});

describe('messages', () => {
  it('appends and injects messages with rendered content', async () => {
    const thread = await run(sampleThread(), [
      { op: 'append-message', role: 'note', content: 'Topic {{ vars.topic }}', tags: ['t'] },
      { op: 'inject', position: 'start', messages: [{ role: 'system', content: 'first' }] },
      { op: 'inject', position: 1, messages: [{ content: 'second' }, { content: 'third' }] },
      { op: 'inject', position: 'end', messages: [{ content: 'last' }] },
      { op: 'inject', position: 99, messages: [{ content: 'clamped' }] },
    ]);
    const contents = thread.messages.map((m) => m.content);
    expect(contents).toEqual([
      'first',
      'second',
      'third',
      'Write a haiku about loops.',
      'Loops within loops turn.',
      'Topic hello',
      'last',
      'clamped',
    ]);
    expect(thread.messages[0]?.role).toBe('system');
    expect(thread.messages[1]?.role).toBe('note');
    expect(thread.messages.find((m) => m.content === 'Topic hello')?.tags).toEqual(['t']);
    expect(
      thread.messages.every(
        (m) => m.nodeId === 'mut' || m.nodeId === 'start' || m.nodeId === 'infer',
      ),
    ).toBe(true);
  });

  it('truncates by first, last, token budget, and predicate', async () => {
    const base = sampleThread({
      messages: ['a', 'b', 'c', 'd', 'e'].map((c, i) => ({
        id: `m${i}`,
        role: i % 2 === 0 ? ('user' as const) : ('tool' as const),
        content: c.repeat(8),
        nodeId: 'start',
        ts: '2026-10-02T12:00:00.000Z',
      })),
    });
    expect(
      (await run(base, [{ op: 'truncate', keep: { last: 2 } }])).messages.map((m) => m.id),
    ).toEqual(['m3', 'm4']);
    expect(
      (await run(base, [{ op: 'truncate', keep: { first: 1, last: 1 } }])).messages.map(
        (m) => m.id,
      ),
    ).toEqual(['m0', 'm4']);
    // each message costs ceil(8/4)+4 = 6 tokens; budget of 13 keeps the last two
    expect(
      (await run(base, [{ op: 'truncate', keep: { maxEstimatedTokens: 13 } }])).messages.map(
        (m) => m.id,
      ),
    ).toEqual(['m3', 'm4']);
    expect(
      (
        await run(base, [{ op: 'truncate', keep: { last: 1 }, where: 'role = "tool"' }])
      ).messages.map((m) => m.id),
    ).toEqual(['m0', 'm2', 'm3', 'm4']);
  });

  it('drops messages and artifacts by predicate', async () => {
    const base = sampleThread({
      artifacts: [
        { id: 'a1', kind: 'transcript', ref: 'blob:1', nodeId: 'infer' },
        { id: 'a2', kind: 'file', ref: 'blob:2', nodeId: 'infer' },
      ],
    });
    const thread = await run(base, [
      { op: 'drop', target: 'messages', where: 'role = "assistant"' },
      { op: 'drop', target: 'artifacts', where: 'kind = "transcript"' },
    ]);
    expect(thread.messages.map((m) => m.id)).toEqual(['m1']);
    expect(thread.artifacts.map((a) => a.id)).toEqual(['a2']);
  });

  it('replaces in messages and vars', async () => {
    const thread = await run(sampleThread(), [
      { op: 'replace', target: 'messages', pattern: 'loops', replacement: 'rings' },
      {
        op: 'replace',
        target: 'messages',
        where: 'role = "user"',
        pattern: 'haiku',
        replacement: 'limerick',
      },
      { op: 'replace', target: 'vars', pattern: 'hel', replacement: 'HEL', flags: 'i' },
    ]);
    expect(thread.messages[0]?.content).toBe('Write a limerick about rings.');
    expect(thread.messages[1]?.content).toBe('Loops within rings turn.');
    expect(thread.vars['topic']).toBe('HELlo');
  });

  it('redacts across messages and vars and reports no-ops', async () => {
    const base = sampleThread({ vars: { key: 'sk-abc123', nested: { token: 'sk-zzz' }, n: 1 } });
    const thread = await run(base, [{ op: 'redact', patterns: ['sk-[a-z0-9]+'] }]);
    expect(thread.vars).toEqual({ key: '[REDACTED]', nested: { token: '[REDACTED]' }, n: 1 });
    const plan = await planMutation(
      sampleThread(),
      op({ op: 'redact', target: 'vars', patterns: ['zzz'] }),
      ctx(),
    );
    expect(plan).toEqual({ kind: 'patch', patch: [] });
    const onlyMessages = await run(sampleThread(), [
      { op: 'redact', target: 'messages', patterns: ['haiku'], replacement: '***' },
    ]);
    expect(onlyMessages.messages[0]?.content).toBe('Write a *** about loops.');
  });

  it('rejects invalid regular expressions', async () => {
    await expect(
      run(sampleThread(), [{ op: 'replace', target: 'vars', pattern: '(', replacement: '' }]),
    ).rejects.toBeInstanceOf(MutationError);
  });
});

describe('coerce and repair', () => {
  const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };

  it('writes valid values to the target', async () => {
    const base = sampleThread({
      lastOutput: { nodeId: 'infer', value: { ok: true }, at: '2026-10-02T12:00:00.000Z' },
    });
    const thread = await run(base, [
      { op: 'coerce', source: '/lastOutput/value', jsonSchema: schema, target: '/vars/result' },
    ]);
    expect(thread.vars['result']).toEqual({ ok: true });
    const again = await run(thread, [
      { op: 'coerce', source: '/lastOutput/value', jsonSchema: schema, target: '/vars/result' },
    ]);
    expect(again.vars['result']).toEqual({ ok: true });
  });

  it('stops with a repair request on invalid values and resumes after repair', async () => {
    const base = sampleThread({
      lastOutput: { nodeId: 'infer', value: { ok: 'yes' }, at: '2026-10-02T12:00:00.000Z' },
    });
    const ops = [
      { op: 'set', path: '/vars/before', value: { kind: 'literal', value: 1 } },
      { op: 'coerce', source: '/lastOutput/value', jsonSchema: schema, target: '/vars/result' },
      { op: 'set', path: '/vars/after', value: { kind: 'literal', value: 2 } },
    ].map(op);
    const first = await applyMutations(base, ops, ctx());
    expect(first.pending?.opIndex).toBe(1);
    expect(first.pending?.errors.join(' ')).toMatch(/boolean/);
    expect(first.appliedThrough).toBe(1);
    expect(first.thread.vars['before']).toBe(1);
    expect('after' in first.thread.vars).toBe(false);

    const repaired = completeRepair(first.thread, first.pending!, { ok: true });
    expect(repaired.thread.vars['result']).toEqual({ ok: true });
    const rest = await applyMutations(repaired.thread, ops, ctx(), first.appliedThrough + 1);
    expect(rest.thread.vars['after']).toBe(2);
    expect(rest.appliedThrough).toBe(3);
  });

  it('treats a missing source as undefined', async () => {
    const result = await applyMutations(
      sampleThread(),
      [op({ op: 'coerce', source: '/vars/missing', jsonSchema: schema, target: '/vars/r' })],
      ctx(),
    );
    expect(result.pending?.value).toBeUndefined();
  });

  it('refuses a repaired value that still fails', async () => {
    const base = sampleThread({
      lastOutput: { nodeId: 'infer', value: {}, at: '2026-10-02T12:00:00.000Z' },
    });
    const first = await applyMutations(
      base,
      [op({ op: 'coerce', source: '/lastOutput/value', jsonSchema: schema, target: '/vars/r' })],
      ctx(),
    );
    expect(() => completeRepair(first.thread, first.pending!, { ok: 'still wrong' })).toThrow(
      MutationError,
    );
  });

  it('refuses coerce targets outside mutable regions', async () => {
    await expect(
      run(sampleThread(), [{ op: 'coerce', source: '/vars/x', jsonSchema: {}, target: '/run/id' }]),
    ).rejects.toBeInstanceOf(MutationError);
  });

  it.each([{ type: 'not-a-type' }, { type: 'string', pattern: '(' }])(
    'sends authored schema %j, which does not compile, to repair without either mapper',
    async (jsonSchema) => {
      const failure = vi.fn();
      const fact = vi.fn();
      const ops = [op({ op: 'coerce', source: '/vars/topic', jsonSchema, target: '/vars/r' })];
      const result = await applyMutations(sampleThread(), ops, ctx(), 0, failure, fact);
      expect(result.appliedThrough).toBe(0);
      expect(result.pending).toMatchObject({ opIndex: 0, jsonSchema, value: 'hello' });
      expect(result.pending?.errors).toEqual([expect.stringMatching(/^invalid schema: /)]);
      expect(failure).not.toHaveBeenCalled();
      expect(fact).not.toHaveBeenCalled();
      expect(() => completeRepair(result.thread, result.pending!, 'hello')).toThrow(
        /still fails schema: invalid schema: /,
      );
    },
  );

  it('gives an exception thrown during validation to the ordinary mapper and never a fact', async () => {
    const thread = sampleThread();
    // A synthetic JavaScript value exercises the public domain API outside stored run data.
    const external = new MutationError('getter from caller');
    thread.vars['value'] = Object.defineProperty({}, 'ok', {
      enumerable: true,
      get() {
        throw external;
      },
    });
    const operation = op({
      op: 'coerce',
      source: '/vars/value',
      jsonSchema: schema,
      target: '/vars/r',
    });
    const legacy = vi.fn((e: unknown) => e);
    const observed = vi.fn();
    // With both mappers an authored fact would reach `observed`; this exception reaches `legacy`.
    await expect(planMutation(thread, operation, ctx(), 3, legacy, observed)).rejects.toBe(
      external,
    );
    expect(legacy.mock.calls).toEqual([[external, 3, 'coerce']]);
    expect(observed).not.toHaveBeenCalled();
    // The inference transforms pass only the fact mapper; the original exception propagates.
    await expect(planMutation(thread, operation, ctx(), 3, undefined, observed)).rejects.toBe(
      external,
    );
    expect(observed).not.toHaveBeenCalled();
  });
});

describe('coerce source pointers', () => {
  const coerce = (source: string) => ({
    op: 'coerce',
    source,
    jsonSchema: { type: 'string' },
    target: '/vars/r',
  });

  it.each(['vars/topic', 'topic', '#/vars/topic', '/vars/~2'])(
    'refuses %j at the contract before the domain reads it',
    (source) => {
      const parsed = MutationOperationSchema.safeParse(coerce(source));
      expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['source']]);
    },
  );

  it('copies or repairs every contract-valid source without either mapper', async () => {
    const failure = vi.fn();
    const fact = vi.fn();
    const sources = {
      '/vars/topic': 'patch',
      '/messages/0/content': 'patch',
      '': 'repair',
      '/vars/missing': 'repair',
      '/vars/topic/deeper': 'repair',
      '/messages/x': 'repair',
      '/messages/9': 'repair',
    } as const;
    for (const [source, kind] of Object.entries(sources)) {
      const plan = await planMutation(sampleThread(), op(coerce(source)), ctx(), 0, failure, fact);
      expect(plan.kind, source).toBe(kind);
    }
    expect(failure).not.toHaveBeenCalled();
    expect(fact).not.toHaveBeenCalled();
  });
});

it('delivers facts to the inference mapper at the immediate operation while the legacy mapper keeps three arguments', async () => {
  const operation = op({
    op: 'set',
    path: '/vars/x',
    value: { kind: 'expression', jsonata: '$error("secret")' },
  });
  const seen: unknown[][] = [];
  const projected = new Error('projected');
  await expect(
    applyMutations(sampleThread(), [operation], ctx(), 0, (...args) => {
      seen.push(args);
      return args[0];
    }),
  ).rejects.toBeInstanceOf(Error);
  expect(seen).toEqual([[expect.objectContaining({ code: 'EXPRESSION_ERROR' }), 0, 'set']]);
  await expect(
    applyMutations(sampleThread(), [operation], ctx(), 0, undefined, (...args) => {
      seen.push(args);
      return projected;
    }),
  ).rejects.toBe(projected);
  expect(seen[1]).toEqual([{ kind: 'expression', reason: 'evaluation-rejected' }, 0, 'set']);
});

it('preserves the original predicate coercion rejection for the legacy mapper without authoring an inference fact', async () => {
  const thread = await run(sampleThread(), [{ op: 'append-message', content: 'one' }]);
  // A synthetic JavaScript value exercises the public domain API outside stored run data.
  const external = new ExpressionError('ownKeys from caller');
  const value = new Proxy(
    {},
    {
      ownKeys() {
        throw external;
      },
    },
  );
  thread.vars['value'] = value;
  const where = '$thread.vars.value';
  const evaluated = await observeExpression(where, thread.messages[0], {
    bindings: { thread, index: 0 },
  });
  if (!evaluated.ok) throw new Error('fixture must reach coercion');
  expect(evaluated.value).toBe(value);
  const operation = op({ op: 'drop', target: 'messages', where });
  const legacy = vi.fn((e: unknown) => e);
  const observed = vi.fn();
  await expect(planMutation(thread, operation, ctx(), 2, legacy, observed)).rejects.toBe(external);
  expect(legacy.mock.calls).toEqual([[external, 2, 'drop']]);
  expect(observed).not.toHaveBeenCalled();
});

it('leaves serialization after a successful expression outside both operation mappers', async () => {
  const thread = sampleThread();
  const external = new MutationError('toJSON from caller');
  const value = Object.defineProperty({}, 'toJSON', {
    value: () => {
      throw external;
    },
  });
  thread.vars['value'] = value;
  const operation = op({
    op: 'set',
    path: '/vars/result',
    value: { kind: 'expression', jsonata: 'vars.value' },
  });
  const legacy = vi.fn();
  const observed = vi.fn();
  await expect(planMutation(thread, operation, ctx(), 0, legacy, observed)).rejects.toBe(external);
  expect(legacy).not.toHaveBeenCalled();
  expect(observed).not.toHaveBeenCalled();
});
