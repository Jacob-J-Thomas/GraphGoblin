import { describe, expect, it, vi } from 'vitest';
import type { HarnessId, LoopDefinitionInput } from '@graphgoblin/contracts';
import { FakeHarness } from '../testing/fakes.js';
import { RunFailureError } from '../errors.js';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';
import type { HarnessSession, HarnessStartRequest } from '../ports.js';
async function engineWithClaude() {
  const engine = await createTestEngine({
    defaults: {
      byHarness: {
        codex: { model: 'gpt-6-luna', effort: 'low' },
        claude: { model: 'claude-opus-5-5', effort: 'xhigh' },
      },
    },
  });
  const claude = new FakeHarness([], 'claude');
  engine.ports.harnesses.claude = claude;
  engine.ports.modelCatalog.entries.push({
    harness: 'claude',
    model: 'claude-opus-5-5',
    source: 'harness',
    displayName: 'Opus',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    enabled: true,
  });
  return { engine, claude };
}
function infer(
  id: string,
  harness: HarnessId,
  policy: 'fresh' | 'resume-previous' | 'resume-named',
): Extract<LoopDefinitionInput['nodes'][number], { kind: 'inference' }> {
  return {
    id,
    kind: 'inference' as const,
    label: id,
    config: {
      harness,
      prompt: { template: id },
      session: policy === 'resume-named' ? { policy, key: 'shared' } : { policy },
      ...(harness === 'claude'
        ? { harnessOptions: { sandbox: 'read-only' as const, approval: 'never' as const } }
        : {}),
    },
  };
}
describe('mixed native harness families', () => {
  it('resumes previous sessions within each family across interleaved nodes', async () => {
    const { engine, claude } = await engineWithClaude();
    const nodes: LoopDefinitionInput['nodes'] = [
      {
        id: 'start',
        kind: 'trigger' as const,
        label: 'Start',
        config: { subtype: 'manual' as const },
      },
      infer('c1', 'codex', 'fresh'),
      infer('a1', 'claude', 'resume-previous'),
      infer('c2', 'codex', 'resume-previous'),
      infer('a2', 'claude', 'resume-previous'),
      { id: 'done', kind: 'exit' as const, label: 'Done', config: {} },
    ];
    const loop: LoopDefinitionInput = {
      schemaVersion: 3,
      name: 'mixed',
      nodes,
      edges: nodes.slice(0, -1).map((node, i) => ({
        id: 'e' + i,
        from: { node: node.id, port: 'out' },
        to: { node: nodes[i + 1]!.id },
      })),
    };
    const version = engine.publish(loop);
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('succeeded');
    expect(engine.ports.harness.started).toHaveLength(1);
    expect(claude.started).toHaveLength(1);
    expect(engine.ports.harness.resumed[0]?.sessionId).toBe('fake-session-1');
    expect(claude.resumed[0]?.sessionId).toBe('fake-claude-session-1');
    expect(claude.started[0]).toMatchObject({
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      options: { sandbox: 'read-only', approval: 'never' },
    });
    const events = engine.events(run.id).filter((e) => e.type === 'harness.session');
    expect(events.map((e) => e.harness)).toEqual(['codex', 'claude', 'codex', 'claude']);
    expect(
      events
        .filter((e) => e.harness === 'claude')
        .every((e) => e.model === 'claude-opus-5-5' && e.effort === 'xhigh'),
    ).toBe(true);
  });
  it('keeps named keys unchanged while selecting the family across runs', async () => {
    const { engine, claude } = await engineWithClaude();
    const nodes: LoopDefinitionInput['nodes'] = [
      { id: 'start', kind: 'trigger' as const, label: 'S', config: { subtype: 'manual' as const } },
      infer('c', 'codex', 'resume-named'),
      infer('a', 'claude', 'resume-named'),
      { id: 'done', kind: 'exit' as const, label: 'D', config: {} },
    ];
    const loop: LoopDefinitionInput = {
      schemaVersion: 3,
      name: 'named-families',
      nodes,
      edges: nodes.slice(0, -1).map((node, i) => ({
        id: 'e' + i,
        from: { node: node.id, port: 'out' },
        to: { node: nodes[i + 1]!.id },
      })),
    };
    const v = engine.publish(loop);
    expect((await engine.runToIdle(v.loopId)).status).toBe('succeeded');
    expect((await engine.runToIdle(v.loopId)).status).toBe('succeeded');
    expect(engine.ports.harness.started).toHaveLength(1);
    expect(claude.started).toHaveLength(1);
    expect(engine.ports.harness.resumed[0]?.sessionId).toBe('fake-session-1');
    expect(claude.resumed[0]?.sessionId).toBe('fake-claude-session-1');
    expect(new Set(engine.ports.sessions.rows.map((r) => r.scopeKey))).toEqual(
      new Set([v.loopId + ':shared']),
    );
  });
  it.each([false, true])(
    'guards interrupted row family (foreign=%s) without changing recovery policy',
    async (foreign) => {
      const { engine, claude } = await engineWithClaude();
      claude.script([
        {
          error: {
            code: 'HARNESS_TURN_FAILED',
            message: 'Transient native failure',
            retriable: true,
          },
        },
      ]);
      const v = engine.publish(singleNodeLoop('recovery-family', infer('a', 'claude', 'fresh')));
      const run = await engine.runToIdle(v.loopId);
      expect(run.failure?.resumable).toBe(true);
      if (foreign) engine.ports.sessions.rows[0]!.harness = 'codex';
      await engine.manager.resume(run.id);
      const resumed = await engine.settle(run.id);
      if (foreign) {
        expect(resumed.failure).toMatchObject({
          code: 'HARNESS_TURN_FAILED',
          resumable: false,
          details: { adapterCode: 'HARNESS_SESSION_FAMILY_MISMATCH' },
        });
        expect(claude.resumed).toEqual([]);
      } else {
        expect(resumed.status).toBe('succeeded');
        expect(claude.resumed[0]?.request.turn.prompt).toContain('previous turn was interrupted');
      }
    },
  );
});
class UnconfirmedHarness extends FakeHarness {
  override start(request: HarnessStartRequest, signal: AbortSignal): HarnessSession {
    this.started.push(request);
    const error = Object.assign(
      new Error('Termination not confirmed; stop installed CLI before retrying'),
      { code: 'HARNESS_TERMINATION_UNCONFIRMED', retriable: false },
    );
    const result: HarnessSession['result'] = new Promise((_, reject) => {
      if (signal.aborted) reject(error);
      else signal.addEventListener('abort', () => reject(error), { once: true });
    });
    result.catch(() => undefined);
    return {
      sessionId: Promise.resolve('native-claude'),
      events: (async function* () {
        yield { type: 'session' as const, sessionId: 'native-claude', mode: 'fresh' as const };
        await result.catch(() => undefined);
        yield {
          type: 'error' as const,
          code: error.code,
          message: error.message,
          retriable: false,
        };
      })(),
      result,
      cancel: () => Promise.reject(error),
    };
  }
}
describe('unconfirmed native cancellation', () => {
  it.each(['user', 'timeout'] as const)(
    'retains actionable failure over %s cancellation',
    async (cause) => {
      const { engine } = await engineWithClaude();
      const harness = new UnconfirmedHarness([], 'claude');
      engine.ports.harnesses.claude = harness;
      const node = infer('a', 'claude', 'fresh');
      const v = engine.publish(
        singleNodeLoop('unconfirmed-' + cause, {
          ...node,
          config: { ...node.config, ...(cause === 'timeout' ? { timeoutSeconds: 1 } : {}) },
        }),
      );
      const started = await engine.start(v.loopId);
      await vi.waitFor(() => expect(harness.started).toHaveLength(1));
      if (cause === 'user') await engine.manager.cancel(started.id, { kind: 'user', id: 'owner' });
      const run = await engine.settle(started.id);
      expect(run.status).toBe('failed');
      expect(run.failure).toMatchObject({
        code: 'HARNESS_TERMINATION_UNCONFIRMED',
        resumable: false,
      });
      const types = engine.eventTypes(run.id);
      expect(types.filter((t) => t === 'run.failed')).toHaveLength(1);
      expect(types).not.toContain('run.cancelled');
      expect(
        engine.events(run.id).some((e) => e.type === 'node.finished' && e.nodeId === 'a'),
      ).toBe(false);
      expect(engine.ports.sessions.rows.at(-1)?.status).toBe('failed');
      if (cause === 'user')
        expect(types.filter((t) => t === 'run.cancel_requested')).toHaveLength(1);
    },
  );
  it.each([
    ['HARNESS_NOT_INSTALLED', 'HARNESS_NOT_INSTALLED', true],
    ['HARNESS_NOT_AUTHENTICATED', 'HARNESS_NOT_AUTHENTICATED', true],
    ['HARNESS_QUOTA_EXHAUSTED', 'HARNESS_QUOTA_EXHAUSTED', true],
    ['HARNESS_TIMEOUT', 'INFERENCE_TIMEOUT', true],
    ['HARNESS_PROTOCOL_ERROR', 'HARNESS_TURN_FAILED', false],
    ['HARNESS_OUTPUT_INVALID', 'HARNESS_TURN_FAILED', false],
    ['HARNESS_UNSUPPORTED_POLICY', 'HARNESS_TURN_FAILED', false],
    ['HARNESS_OUTPUT_LIMIT', 'HARNESS_TURN_FAILED', false],
    ['HARNESS_INVALID_CONFIGURATION', 'HARNESS_TURN_FAILED', false],
    ['HARNESS_MODEL_UNVERIFIED', 'HARNESS_TURN_FAILED', false],
    ['HARNESS_TURN_FAILED', 'HARNESS_TURN_FAILED', false],
  ])('maps fixed %s without substring inference', async (code, expected, resumable) => {
    const { engine, claude } = await engineWithClaude();
    claude.script([{ error: { code, message: 'Safe adapter diagnostic' } }]);
    const v = engine.publish(singleNodeLoop('failure-' + code, infer('a', 'claude', 'fresh')));
    expect((await engine.runToIdle(v.loopId)).failure).toMatchObject({ code: expected, resumable });
  });
});

describe('inference consumption keeps engine failures and cleans up both harness families', () => {
  it.each(['codex', 'claude'] as const)(
    'preserves %s session persistence errors as INTERNAL_ERROR and cancels',
    async (family) => {
      const { engine, claude } = await engineWithClaude();
      const harness = family === 'claude' ? claude : engine.ports.harness;
      const upsert = engine.ports.sessions.upsert.bind(engine.ports.sessions);
      vi.spyOn(engine.ports.sessions, 'upsert').mockImplementation(async (row) => {
        if (row.status === 'active') throw new Error('Synthetic session persistence fault');
        await upsert(row);
      });
      const v = engine.publish(singleNodeLoop('persist-' + family, infer('a', family, 'fresh')));
      const run = await engine.runToIdle(v.loopId);
      expect(run.failure).toMatchObject({
        code: 'INTERNAL_ERROR',
        resumable: true,
        message: 'Synthetic session persistence fault',
      });
      expect(harness.cancelled).toHaveLength(1);
    },
  );
  it.each(['codex', 'claude'] as const)(
    'preserves %s record failures and their typed cause while cancelling',
    async (family) => {
      for (const type of ['harness.session', 'node.progress', 'harness.usage'] as const) {
        const { engine, claude } = await engineWithClaude();
        const harness = family === 'claude' ? claude : engine.ports.harness;
        const cause = new RunFailureError('SECRET_MISSING', 'Synthetic engine service failure', {
          resumable: false,
          details: { source: 'fixture' },
        });
        const append = engine.ports.events.append.bind(engine.ports.events);
        vi.spyOn(engine.ports.events, 'append').mockImplementation((id, drafts, opts) => {
          if (drafts.some((event) => event.type === type)) return Promise.reject(cause);
          return append(id, drafts, opts);
        });
        const v = engine.publish(
          singleNodeLoop(
            'record-' + family + '-' + type.replace('.', '-'),
            infer('a', family, 'fresh'),
          ),
        );
        expect((await engine.runToIdle(v.loopId)).failure).toMatchObject({
          code: 'SECRET_MISSING',
          message: 'Synthetic engine service failure',
          resumable: false,
          details: { source: 'fixture' },
        });
        expect(harness.cancelled).toHaveLength(1);
      }
    },
  );
  it.each(['codex', 'claude'] as const)(
    'preserves typed %s completion failures when secondary cleanup fails',
    async (family) => {
      const { engine, claude } = await engineWithClaude();
      const harness = family === 'claude' ? claude : engine.ports.harness;
      const cause = new RunFailureError('SECRET_MISSING', 'Synthetic typed completion failure', {
        resumable: false,
        details: { source: 'fixture' },
      });
      const cleanup = vi.fn(() => Promise.reject(new Error('PRIVATE_CLEANUP_BODY')));
      const start = harness.start.bind(harness);
      vi.spyOn(harness, 'start').mockImplementation((request, signal) => {
        const session = start(request, signal);
        return {
          ...session,
          result: session.result.then(() => {
            throw cause;
          }),
          cancel: cleanup,
        };
      });
      const v = engine.publish(
        singleNodeLoop('secondary-cleanup-' + family, infer('a', family, 'fresh')),
      );
      expect((await engine.runToIdle(v.loopId)).failure).toMatchObject({
        code: 'SECRET_MISSING',
        message: 'Synthetic typed completion failure',
        resumable: false,
        details: { source: 'fixture' },
      });
      expect(cleanup).toHaveBeenCalledOnce();
      expect(engine.ports.logger.lines).toContainEqual({
        level: 'warn',
        msg: 'harness cleanup failed',
        obj: { nodeId: 'a', code: 'HARNESS_TURN_FAILED' },
      });
      expect(JSON.stringify(engine.ports.logger.lines)).not.toContain('PRIVATE_CLEANUP_BODY');
    },
  );
  it.each(['codex', 'claude'] as const)(
    'preserves %s stream-origin error classification and cancels',
    async (family) => {
      const { engine, claude } = await engineWithClaude();
      const harness = family === 'claude' ? claude : engine.ports.harness;
      const start = harness.start.bind(harness);
      vi.spyOn(harness, 'start').mockImplementation((request, signal) => {
        const session = start(request, signal);
        return {
          ...session,
          events: (async function* () {
            await session.sessionId;
            yield { type: 'session' as const, sessionId: 'stream-failure', mode: 'fresh' as const };
            throw Object.assign(new Error('Synthetic stream fault'), {
              code: 'HARNESS_PROTOCOL_ERROR',
              retriable: false,
            });
          })(),
        };
      });
      const v = engine.publish(singleNodeLoop('stream-' + family, infer('a', family, 'fresh')));
      expect((await engine.runToIdle(v.loopId)).failure).toMatchObject({
        code: 'HARNESS_TURN_FAILED',
        resumable: family === 'codex',
        details: { adapterCode: 'HARNESS_PROTOCOL_ERROR' },
      });
      expect(harness.cancelled).toHaveLength(1);
    },
  );
  it.each(['codex', 'claude'] as const)(
    'prioritizes %s unconfirmed cleanup over engine and status-write failures',
    async (family) => {
      const { engine, claude } = await engineWithClaude();
      const harness = family === 'claude' ? claude : engine.ports.harness;
      const start = harness.start.bind(harness);
      const cancellation = vi.fn(() =>
        Promise.reject(
          Object.assign(new Error('Synthetic termination not confirmed'), {
            code: 'HARNESS_TERMINATION_UNCONFIRMED',
            retriable: false,
          }),
        ),
      );
      vi.spyOn(harness, 'start').mockImplementation((request, signal) => ({
        ...start(request, signal),
        cancel: cancellation,
      }));
      const upsert = engine.ports.sessions.upsert.bind(engine.ports.sessions);
      vi.spyOn(engine.ports.sessions, 'upsert').mockImplementation(async (row) => {
        if (row.status === 'active' || row.status === 'failed')
          throw new Error('Synthetic persistence failure');
        await upsert(row);
      });
      const v = engine.publish(singleNodeLoop('cleanup-' + family, infer('a', family, 'fresh')));
      expect((await engine.runToIdle(v.loopId)).failure).toMatchObject({
        code: 'HARNESS_TERMINATION_UNCONFIRMED',
        resumable: false,
      });
      expect(cancellation).toHaveBeenCalledOnce();
    },
  );
  it('repairs Claude native candidates on the same session, including missing structured output', async () => {
    for (const candidate of [undefined, { ok: 'wrong' }]) {
      const { engine, claude } = await engineWithClaude();
      // A valid-looking final text must not replace an explicitly missing native candidate.
      claude.script([
        { finalText: '{"ok":true}', structured: candidate },
        { structured: { ok: true } },
      ]);
      const start = claude.start.bind(claude);
      vi.spyOn(claude, 'start').mockImplementation((request, signal) => {
        const session = start(request, signal);
        return {
          ...session,
          result: session.result.then((result) => ({ ...result, structured: candidate })),
        };
      });
      const n = infer('a', 'claude', 'fresh');
      const schema = {
        type: 'object',
        required: ['ok'],
        properties: { ok: { type: 'boolean' } },
        additionalProperties: false,
      };
      const v = engine.publish(
        singleNodeLoop('claude-repair-' + (candidate === undefined ? 'missing' : 'wrong'), {
          ...n,
          config: {
            ...n.config,
            output: { schema: { jsonSchema: schema, native: true, repair: { maxAttempts: 1 } } },
          },
        }),
      );
      const run = await engine.runToIdle(v.loopId);
      expect(run.status).toBe('succeeded');
      expect(claude.resumed).toHaveLength(1);
      expect(claude.resumed[0]?.sessionId).toBe('fake-claude-session-1');
      expect(claude.resumed[0]?.request.turn.outputSchema).toEqual(schema);
      expect((await engine.manager.getThread(run.id))?.lastOutput?.value).toEqual({ ok: true });
    }
  });
  it.each([
    ['codex', 'valid-null', null, { type: 'null' }, 'fail-run'],
    ['claude', 'valid-null', null, { type: 'null' }, 'fail-run'],
    ['codex', 'missing-continue-raw', undefined, { type: 'object' }, 'continue-raw'],
    ['claude', 'missing-continue-raw', undefined, { type: 'object' }, 'continue-raw'],
  ] as const)(
    'retains the %s native schema-policy output for %s',
    async (family, name, candidate, jsonSchema, onFailure) => {
      const { engine, claude } = await engineWithClaude();
      const harness = family === 'claude' ? claude : engine.ports.harness;
      harness.script([{ finalText: 'Final text must not replace the native candidate' }]);
      const start = harness.start.bind(harness);
      vi.spyOn(harness, 'start').mockImplementation((request, signal) => {
        const session = start(request, signal);
        return {
          ...session,
          result: session.result.then((result) => ({ ...result, structured: candidate })),
        };
      });
      const n = infer('a', family, 'fresh');
      const v = engine.publish(
        singleNodeLoop('native-output-' + family + '-' + name, {
          ...n,
          config: {
            ...n.config,
            output: {
              schema: { jsonSchema, native: true, repair: { enabled: false, onFailure } },
            },
          },
        }),
      );
      const run = await engine.runToIdle(v.loopId);
      expect(run.status).toBe('succeeded');
      expect((await engine.manager.getThread(run.id))?.lastOutput?.value).toBeNull();
      expect(harness.resumed).toEqual([]);
    },
  );
  it('cancels the current repair turn when persistence fails', async () => {
    const { engine, claude } = await engineWithClaude();
    claude.script([{ structured: { ok: 'wrong' } }, { structured: { ok: true } }]);
    const upsert = engine.ports.sessions.upsert.bind(engine.ports.sessions);
    let active = 0;
    vi.spyOn(engine.ports.sessions, 'upsert').mockImplementation(async (row) => {
      if (row.status === 'active' && ++active === 2)
        throw new Error('Synthetic repair persistence fault');
      await upsert(row);
    });
    const n = infer('a', 'claude', 'fresh');
    const v = engine.publish(
      singleNodeLoop('repair-cleanup', {
        ...n,
        config: {
          ...n.config,
          output: {
            schema: {
              jsonSchema: {
                type: 'object',
                required: ['ok'],
                properties: { ok: { type: 'boolean' } },
              },
              repair: { maxAttempts: 1 },
            },
          },
        },
      }),
    );
    expect((await engine.runToIdle(v.loopId)).failure?.code).toBe('INTERNAL_ERROR');
    expect(claude.resumed).toHaveLength(1);
    expect(claude.cancelled).toHaveLength(1);
  });
});
