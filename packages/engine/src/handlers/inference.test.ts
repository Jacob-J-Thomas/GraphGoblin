import { describe, expect, it } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';

function inferenceLoop(name: string, config: Record<string, unknown>): LoopDefinitionInput {
  return singleNodeLoop(name, {
    id: 'infer',
    kind: 'inference',
    label: 'Infer',
    config: { prompt: { template: 'Say hi to {{ vars.name }}' }, ...config },
  });
}

describe('inference node', () => {
  it('starts a fresh session, records progress and usage, stores the transcript, and appends the final message', async () => {
    const engine = await createTestEngine();
    engine.ports.harness.script([
      {
        items: [
          {
            id: 'i1',
            type: 'command',
            summary: 'npm test (exit -1)',
            commandPreview: 'npm test',
            exitCode: -1,
            status: 'failed',
            detail: { aggregated_output: 'private command output' },
          },
          { id: 'i2', type: 'file-change', summary: 'src/a.ts' },
          { id: 'i3', type: 'message', summary: 'done' },
          { id: 'i4', type: 'error', summary: 'provider diagnostic must stay private' },
        ],
        finalText: 'All done.',
        usage: { inputTokens: 100, outputTokens: 20 },
      },
    ]);
    const version = engine.publish(
      inferenceLoop('inf', { output: { toMessages: 'final-and-notes' } }),
    );
    const run = await engine.runToIdle(version.loopId);

    expect(run.status).toBe('succeeded');
    const started = engine.ports.harness.started[0];
    expect(started?.model).toBe('gpt-6-luna');
    expect(started?.effort).toBe('low');
    expect(started?.turn.prompt).toBe('Say hi to ');
    expect(started?.options.sandbox).toBe('workspace-write');
    expect(started?.workingDirectory).toMatch(/\/tmp\/graphgoblin\//);

    const types = engine.eventTypes(run.id);
    expect(types).toContain('harness.session');
    expect(types.filter((t) => t === 'node.progress')).toHaveLength(4);
    expect(types).toContain('harness.usage');
    const progress = engine.events(run.id).find((event) => event.type === 'node.progress');
    expect(progress).toMatchObject({
      type: 'node.progress',
      progress: {
        item: {
          id: 'i1',
          type: 'command',
          summary: 'npm test (exit -1)',
          commandPreview: 'npm test',
          exitCode: -1,
          status: 'failed',
        },
      },
    });
    expect(JSON.stringify(progress)).not.toContain('private command output');
    const progressEvents = engine.events(run.id).filter((event) => event.type === 'node.progress');
    expect(JSON.stringify(progressEvents)).not.toContain('provider diagnostic must stay private');
    expect(progressEvents.at(-1)).toMatchObject({
      type: 'node.progress',
      progress: { item: { id: 'i4', summary: 'Harness reported an error' } },
    });

    const thread = await engine.manager.getThread(run.id);
    expect(thread?.messages.map((m) => [m.role, m.content])).toEqual([
      ['note', 'Ran: npm test (exit -1)'],
      ['note', 'Changed: src/a.ts'],
      ['assistant', 'All done.'],
    ]);
    expect(thread?.messages[0]?.tags).toEqual(['harness-note']);
    expect(thread?.artifacts).toHaveLength(1);
    expect(thread?.artifacts[0]?.kind).toBe('transcript');
    expect(await engine.ports.artifacts.get(thread!.artifacts[0]!.ref)).toContain('npm test');
    expect(thread?.counters.usage).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    expect(thread?.lastOutput?.value).toBe('All done.');
    expect(engine.ports.sessions.rows[0]).toMatchObject({
      status: 'finished',
      sessionId: 'fake-session-1',
      model: 'gpt-6-luna',
    });
  });

  it('honours node model and effort, loop defaults, input transforms, context files, and no messages', async () => {
    const engine = await createTestEngine();
    engine.ports.harness.script([{ finalText: '{"ok":true}' }]);
    const loop = inferenceLoop('inf', {
      model: 'gpt-6-sol',
      effort: 'high',
      input: [{ op: 'set', path: '/vars/name', value: { kind: 'literal', value: 'Ada' } }],
      contextFiles: [{ path: '.graphgoblin/context/infer.md', template: 'Name: {{ vars.name }}' }],
      output: { toMessages: 'none', captureTranscript: 'none' },
    });
    const version = engine.publish(loop);
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('succeeded');
    const started = engine.ports.harness.started[0];
    expect(started?.model).toBe('gpt-6-sol');
    expect(started?.effort).toBe('high');
    expect(started?.turn.prompt).toBe('Say hi to Ada');
    const written = [...engine.ports.workspace.files.entries()].find(([k]) =>
      k.endsWith('.graphgoblin/context/infer.md'),
    );
    expect(written?.[1]).toBe('Name: Ada');
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.messages).toEqual([]);
    expect(thread?.artifacts).toEqual([]);
    expect(thread?.vars['name']).toBeUndefined(); // input transforms are not persisted
    expect(thread?.lastOutput?.value).toEqual({ ok: true }); // JSON final text is parsed
  });

  it('preserves a failed tool-call status in progress without provider diagnostics', async () => {
    const engine = await createTestEngine();
    engine.ports.harness.script([
      {
        items: [
          {
            id: 'tool-1',
            type: 'tool-call',
            summary: 'browser.search failed: private provider detail',
            status: 'failed',
            detail: { error: 'private provider detail' },
          },
        ],
        finalText: 'Finished.',
      },
    ]);
    const version = engine.publish(inferenceLoop('tool-failure', {}));
    const run = await engine.runToIdle(version.loopId);
    const progress = engine.events(run.id).find((event) => event.type === 'node.progress');

    expect(progress).toMatchObject({
      type: 'node.progress',
      progress: {
        item: {
          id: 'tool-1',
          type: 'tool-call',
          summary: 'browser.search failed',
          status: 'failed',
        },
      },
    });
    expect(JSON.stringify(progress)).not.toContain('private provider detail');
  });

  it('uses loop-level defaults when the node sets none', async () => {
    const engine = await createTestEngine();
    const loop = inferenceLoop('inf', {});
    loop.settings = { defaults: { model: 'gpt-5.6-luna', effort: 'medium' } };
    const version = engine.publish(loop);
    await engine.runToIdle(version.loopId);
    expect(engine.ports.harness.started[0]).toMatchObject({
      model: 'gpt-5.6-luna',
      effort: 'medium',
    });
  });

  it('falls back to the owner defaults read at run start, then to the configured defaults', async () => {
    let owner: { model?: string; effort?: 'high' } = { model: 'owner-model', effort: 'high' };
    const asked: string[] = [];
    const engine = await createTestEngine({
      ownerDefaults: (ownerId) => {
        asked.push(ownerId);
        return Promise.resolve(owner);
      },
    });
    const version = engine.publish(inferenceLoop('inf', {}));
    await engine.runToIdle(version.loopId);
    expect(engine.ports.harness.started[0]).toMatchObject({ model: 'owner-model', effort: 'high' });
    expect(asked).toEqual(['local']);

    // A change applies to the next run; a missing value falls through to the configuration.
    owner = { effort: 'high' };
    await engine.runToIdle(version.loopId);
    expect(engine.ports.harness.started[1]).toMatchObject({ model: 'gpt-6-luna', effort: 'high' });

    // Loop defaults still win over the owner's.
    const loop = inferenceLoop('inf-loop', {});
    loop.settings = { defaults: { model: 'loop-model' } };
    await engine.runToIdle(engine.publish(loop).loopId);
    expect(engine.ports.harness.started[2]).toMatchObject({ model: 'loop-model', effort: 'high' });
  });

  it('validates native structured output and repairs on the same session', async () => {
    const engine = await createTestEngine();
    engine.ports.harness.script([
      { structured: { ok: 'not-a-boolean' } },
      {
        match: (r) => r.prompt.includes('Validation errors'),
        structured: { ok: true },
        usage: { outputTokens: 5 },
      },
    ]);
    const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
    const version = engine.publish(
      inferenceLoop('inf', {
        output: { schema: { jsonSchema: schema, repair: { maxAttempts: 2 } } },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('succeeded');
    expect(engine.ports.harness.started[0]?.turn.outputSchema).toEqual(schema);
    expect(engine.ports.harness.resumed).toHaveLength(1);
    expect(engine.ports.harness.resumed[0]?.sessionId).toBe('fake-session-1');
    // The repair turn carries the node's full session settings, not just the prompt.
    const started = engine.ports.harness.started[0];
    const resumed = engine.ports.harness.resumed[0]?.request;
    expect(resumed?.turn.outputSchema).toEqual(schema);
    expect(resumed?.turn.prompt).toContain('Validation errors');
    expect(resumed).toMatchObject({
      workingDirectory: started?.workingDirectory,
      model: started?.model,
      effort: started?.effort,
      options: started?.options,
    });
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.lastOutput?.value).toEqual({ ok: true });
    expect(thread?.counters.usage.outputTokens).toBe(5);
  });

  it('fails the run when repair is exhausted, or continues raw when configured', async () => {
    const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
    const engine = await createTestEngine();
    engine.ports.harness.script([{ structured: { ok: 'no' } }, { structured: { ok: 'still no' } }]);
    const failing = engine.publish(
      inferenceLoop('fail', {
        output: { schema: { jsonSchema: schema, repair: { maxAttempts: 1 } } },
      }),
    );
    const failed = await engine.runToIdle(failing.loopId);
    expect(failed.status).toBe('failed');
    expect(failed.failure?.code).toBe('OUTPUT_SCHEMA_MISMATCH');
    expect(engine.ports.sessions.rows.at(-1)?.status).toBe('failed');

    engine.ports.harness.script([{ structured: { ok: 'raw' } }]);
    const lenient = engine.publish(
      inferenceLoop('raw', {
        output: {
          schema: { jsonSchema: schema, repair: { enabled: false, onFailure: 'continue-raw' } },
        },
      }),
    );
    const ok = await engine.runToIdle(lenient.loopId);
    expect(ok.status).toBe('succeeded');
    expect((await engine.manager.getThread(ok.id))?.lastOutput?.value).toEqual({ ok: 'raw' });
  });

  it('resumes the previous session in the run and named sessions across runs', async () => {
    const engine = await createTestEngine();
    engine.ports.harness.script([
      { finalText: 'first' },
      { finalText: 'second' },
      { finalText: 'third' },
    ]);
    const loop: LoopDefinitionInput = {
      schemaVersion: 1,
      name: 'chain',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
        {
          id: 'a',
          kind: 'inference',
          label: 'A',
          config: { prompt: { template: 'a' }, session: { policy: 'resume-named', key: 'shared' } },
        },
        {
          id: 'b',
          kind: 'inference',
          label: 'B',
          config: { prompt: { template: 'b' }, session: { policy: 'resume-previous' } },
        },
        { id: 'done', kind: 'exit', label: 'D', config: {} },
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'a' } },
        { id: 'e2', from: { node: 'a', port: 'out' }, to: { node: 'b' } },
        { id: 'e3', from: { node: 'b', port: 'out' }, to: { node: 'done' } },
      ],
    };
    const version = engine.publish(loop);
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('succeeded');
    expect(engine.ports.harness.started).toHaveLength(1);
    expect(engine.ports.harness.resumed.map((r) => r.sessionId)).toEqual(['fake-session-1']);

    const again = await engine.runToIdle(version.loopId);
    expect(again.status).toBe('succeeded');
    // Node a resumed the named session from the first run; node b resumed a's session.
    expect(engine.ports.harness.started).toHaveLength(1);
    expect(engine.ports.harness.resumed.map((r) => r.sessionId)).toEqual([
      'fake-session-1',
      'fake-session-1',
      'fake-session-1',
    ]);
  });

  it('fails with typed codes for missing harness, harness errors, and quota problems', async () => {
    const engine = await createTestEngine();
    delete engine.ports.harnesses.codex;
    const missing = engine.publish(inferenceLoop('missing', {}));
    const run = await engine.runToIdle(missing.loopId);
    expect(run.failure?.code).toBe('HARNESS_NOT_INSTALLED');

    engine.ports.harnesses.codex = engine.ports.harness;
    engine.ports.harness.script([
      { error: { code: 'usage_limit_reached', message: 'out of quota' } },
    ]);
    const quota = await engine.runToIdle(missing.loopId);
    expect(quota.failure).toMatchObject({ code: 'HARNESS_QUOTA_EXHAUSTED', nodeId: 'infer' });

    engine.ports.harness.script([{ error: { code: 'unauthorized', message: 'login expired' } }]);
    expect((await engine.runToIdle(missing.loopId)).failure?.code).toBe(
      'HARNESS_NOT_AUTHENTICATED',
    );

    engine.ports.harness.script([{ error: { code: 'weird', message: 'something else' } }]);
    expect((await engine.runToIdle(missing.loopId)).failure?.code).toBe('HARNESS_TURN_FAILED');
  });

  it('cancels a session mid-turn and marks the run cancelled', async () => {
    const engine = await createTestEngine();
    engine.ports.harness.script([{ finalText: 'late', delayMs: 500 }]);
    const version = engine.publish(inferenceLoop('slow', {}));
    const run = await engine.start(version.loopId);
    await waitFor(() => engine.eventTypes(run.id).includes('harness.session'));
    await engine.manager.cancel(run.id, { kind: 'user', id: 'u' });
    const done = await engine.settle(run.id);
    expect(done.status).toBe('cancelled');
    expect(engine.ports.harness.cancelled).toEqual(['fake-session-1']);
    expect(engine.eventTypes(run.id).at(-1)).toBe('run.cancelled');
  });

  it('times out a slow session with INFERENCE_TIMEOUT', async () => {
    const engine = await createTestEngine();
    engine.ports.harness.script([{ finalText: 'late', delayMs: 2000 }]);
    const loop = inferenceLoop('timeout', { timeoutSeconds: 1 });
    const version = engine.publish(loop);
    const started = Date.now();
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('failed');
    expect(run.failure?.code).toBe('INFERENCE_TIMEOUT');
    expect(Date.now() - started).toBeLessThan(1900);
    expect(engine.ports.harness.cancelled).toHaveLength(1);
  }, 10_000);

  it('applies output transforms after the message is appended', async () => {
    const engine = await createTestEngine();
    engine.ports.harness.script([{ finalText: 'token sk-abc123 leaked' }]);
    const version = engine.publish(
      inferenceLoop('redact', {
        output: { transforms: [{ op: 'redact', patterns: ['sk-[a-z0-9]+'] }] },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.messages.at(-1)?.content).toBe('token [REDACTED] leaked');
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}
