import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateExpression, TemplateError } from '@graphgoblin/domain';
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

  it.each(['{"reply":"answer"}', '42', 'null', '"quoted"', '**🦎 café**\nこんにちは'])(
    'captures native final text verbatim: %s',
    async (finalText) => {
      const engine = await createTestEngine();
      engine.ports.harness.script([{ finalText, structured: { ignored: true } }]);
      const version = engine.publish(
        inferenceLoop('text-capture', { output: { capture: 'text' } }),
      );
      const run = await engine.runToIdle(version.loopId);
      expect(run.status).toBe('succeeded');
      const thread = await engine.manager.getThread(run.id);
      expect(thread?.lastOutput?.value).toBe(finalText);
      expect(thread?.messages.at(-1)?.content).toBe(finalText);
      expect(engine.ports.harness.started[0]?.turn.outputSchema).toBeUndefined();
    },
  );

  it('rejects malformed structured text without extracting one convenient object', async () => {
    const engine = await createTestEngine();
    engine.ports.harness.script([{ finalText: '{"ok":true} {"extra":true}' }]);
    const version = engine.publish(
      inferenceLoop('strict-malformed', {
        output: {
          schema: {
            jsonSchema: {
              type: 'object',
              properties: { ok: { type: 'boolean' } },
              required: ['ok'],
              additionalProperties: false,
            },
            repair: { enabled: false },
          },
        },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.failure?.code).toBe('OUTPUT_SCHEMA_MISMATCH');
    expect(engine.ports.harness.started).toHaveLength(1);
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
    loop.settings = {
      defaults: { byHarness: { codex: { model: 'gpt-5.6-luna', effort: 'medium' } } },
    };
    engine.ports.modelCatalog.entries.push({
      ...engine.ports.modelCatalog.entries[0]!,
      model: 'gpt-5.6-luna',
    });
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
        return Promise.resolve({ byHarness: { codex: owner } });
      },
    });
    for (const model of ['owner-model', 'loop-model'])
      engine.ports.modelCatalog.entries.push({ ...engine.ports.modelCatalog.entries[0]!, model });
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
    loop.settings = { defaults: { byHarness: { codex: { model: 'loop-model' } } } };
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
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: 'chain',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'S', config: { type: 'manual' } },
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
    expect((await engine.runToIdle(missing.loopId)).failure).toMatchObject({
      code: 'HARNESS_DELIVERY_UNCERTAIN',
      resumable: true,
    });
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
    expect(run.failure?.inference).toMatchObject({
      submission: 'delivery-uncertain',
      promptKind: 'authored',
    });
    await engine.manager.resume(run.id);
    expect((await engine.settle(run.id)).status).toBe('succeeded');
    expect(engine.ports.harness.resumed.at(-1)?.request.turn.prompt).toContain(
      'previous turn was interrupted',
    );
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

const badLiquid = '{{ "PRIVATE_TEMPLATE" | append }}';
const badExpression = {
  op: 'set',
  path: '/vars/value',
  value: { kind: 'expression', jsonata: '$error("PRIVATE_EXPRESSION")' },
};
const repairBoolean = {
  op: 'coerce',
  source: '/vars/missing',
  target: '/vars/boolean',
  jsonSchema: { type: 'boolean' },
  repair: { maxAttempts: 1 },
};

describe('inference authored fields and effects', () => {
  it.each(['input', 'output'] as const)(
    'classifies only the failing %s transform after an earlier real structured callback',
    async (stage) => {
      const e = await createTestEngine();
      e.ports.structuredFake.respondWith(() => true);
      e.ports.harness.script([{ finalText: 'received', announceSession: false, accepted: false }]);
      const transforms = [repairBoolean, badExpression];
      const v = e.publish(
        inferenceLoop(
          'typed transform',
          stage === 'input' ? { input: transforms } : { output: { transforms } },
        ),
      );
      const run = await e.runToIdle(v.loopId);
      const output = stage === 'output';
      const details = {
        boundary: output ? 'inference.output.transforms' : 'inference.input',
        operationIndex: 1,
        operationKind: 'set',
        cause: {
          code: 'EXPRESSION_ERROR',
          message:
            'The expression could not evaluate this input. Check its input type and mapping.',
        },
        ...(output ? { phase: 'after-result' } : {}),
      };
      expect(run.failure).toMatchObject({
        code: 'MUTATION_ERROR',
        nodeId: 'infer',
        resumable: false,
      });
      expect(run.failure?.details).toEqual(details);
      expect(e.events(run.id).filter((x) => x.type === 'run.failed')).toMatchObject([
        { failure: run.failure },
      ]);
      expect(e.ports.structuredFake.requests).toHaveLength(1);
      expect(e.ports.harness.started).toHaveLength(output ? 1 : 0);
      const turns = e.events(run.id).filter((x) => x.type === 'harness.turn');
      expect(turns).toHaveLength(output ? 1 : 0);
      if (output) {
        expect(run.failure?.inference).toEqual({
          turnId: turns[0]!.turnId,
          visitId: turns[0]!.visitId,
          promptKind: 'authored',
          submission: 'delivery-uncertain',
        });
        expect(run.failure?.message).toContain(
          'GraphGoblin received the provider result before this step failed.',
        );
        expect(run.failure?.message).not.toContain('no usable session');
        expect(e.events(run.id).filter((x) => x.type === 'harness.submission')).toMatchObject([
          { submission: 'delivery-uncertain' },
        ]);
        expect(
          e
            .events(run.id)
            .filter((x) => x.type === 'harness.submission')
            .some((x) => x.marker),
        ).toBe(false);
      } else expect(run.failure?.inference).toBeUndefined();
      expect(await e.manager.getThread(run.id)).not.toHaveProperty(['vars', 'boolean']);
      expect(JSON.stringify([run.failure, e.ports.logger.lines])).not.toContain(
        'PRIVATE_EXPRESSION',
      );
      await expect(e.manager.resume(run.id)).rejects.toMatchObject({
        code: 'FAILURE_NOT_RESUMABLE',
      });
      expect(e.ports.harness.cancelled).toHaveLength(output ? 1 : 0);
    },
  );

  it.each([
    [{ op: 'append-message', content: badLiquid }, 'TEMPLATE_ERROR'],
    [
      { op: 'inject', position: 'end', messages: [{ role: 'user', content: badLiquid }] },
      'TEMPLATE_ERROR',
    ],
    [{ op: 'replace', pattern: '[', replacement: 'x', target: 'messages' }, 'MUTATION_ERROR'],
    [{ op: 'set', path: '/run/id', value: { kind: 'literal', value: 1 } }, 'MUTATION_ERROR'],
    [
      { op: 'set', path: '/vars/missing/leaf', value: { kind: 'literal', value: 1 } },
      'PATCH_ERROR',
    ],
    [{ ...repairBoolean, repair: { maxAttempts: 1, prompt: badLiquid } }, 'TEMPLATE_ERROR'],
  ] as const)('projects an inference input %j cause without author text', async (op, code) => {
    const e = await createTestEngine();
    const v = e.publish(inferenceLoop('operation cause', { input: [op] }));
    const run = await e.runToIdle(v.loopId);
    expect(run.failure).toMatchObject({
      nodeId: 'infer',
      code: 'MUTATION_ERROR',
      resumable: false,
      details: {
        boundary: 'inference.input',
        operationIndex: 0,
        operationKind: op.op,
        cause: { code },
      },
    });
    expect(run.failure?.message).not.toContain('PRIVATE');
    expect(e.ports.harness.started).toHaveLength(0);
  });

  it('preserves completed context bytes when a later file template fails before the first intent', async () => {
    const e = await createTestEngine();
    const dir = await mkdtemp(join(tmpdir(), 'graphgoblin-context-'));
    try {
      e.ports.workspace.writeFile = async (_cwd, path, content) => {
        const file = join(dir, path);
        await writeFile(file, content, 'utf8');
        return file;
      };
      const v = e.publish(
        inferenceLoop('file preparation', {
          contextFiles: [
            { path: 'first', template: 'retained {{ trigger.payload }}' },
            { path: 'private-second', template: badLiquid },
            { path: 'third', template: 'later' },
          ],
        }),
      );
      const run = await e.runToIdle(v.loopId, 'bytes');
      expect(run.failure).toMatchObject({
        code: 'TEMPLATE_ERROR',
        nodeId: 'infer',
        resumable: false,
        details: {
          boundary: 'inference.contextFiles.template',
          fileIndex: 1,
          cause: { code: 'TEMPLATE_ERROR' },
        },
      });
      expect(run.failure?.message).toContain('Inference context file template 2');
      expect(JSON.stringify(run.failure)).not.toMatch(/PRIVATE_TEMPLATE|private-second/);
      expect(await readdir(dir)).toEqual(['first']);
      expect(await readFile(join(dir, 'first'), 'utf8')).toBe('retained bytes');
      expect(e.eventTypes(run.id)).not.toContain('harness.turn');
      await expect(e.manager.resume(run.id)).rejects.toMatchObject({
        code: 'FAILURE_NOT_RESUMABLE',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(['primary', 'repair'] as const)(
    'attributes only the %s prompt render and reports the most recent actual turn',
    async (stage) => {
      const e = await createTestEngine();
      const repair = stage === 'repair';
      e.ports.harness.script([{ finalText: 'invalid', accepted: false }]);
      const v = e.publish(
        inferenceLoop(
          'prompt fault',
          repair
            ? {
                output: {
                  schema: {
                    jsonSchema: { type: 'number' },
                    repair: { enabled: true, maxAttempts: 1, prompt: badLiquid },
                  },
                },
              }
            : { prompt: { template: badLiquid } },
        ),
      );
      const run = await e.runToIdle(v.loopId);
      expect(run.failure).toMatchObject({
        nodeId: 'infer',
        code: 'TEMPLATE_ERROR',
        resumable: false,
        details: {
          boundary: repair ? 'inference.output.schema.repair.prompt' : 'inference.prompt.template',
          cause: { code: 'TEMPLATE_ERROR' },
          ...(repair ? { attempt: 1, phase: 'after-result' } : {}),
        },
      });
      const turns = e.events(run.id).filter((x) => x.type === 'harness.turn');
      expect(turns).toHaveLength(repair ? 1 : 0);
      expect(e.ports.harness.resumed).toHaveLength(0);
      if (repair) {
        expect(run.failure?.inference).toMatchObject({
          turnId: turns[0]!.turnId,
          visitId: turns[0]!.visitId,
          promptKind: 'authored',
          sessionId: 'fake-session-1',
          submission: 'delivery-uncertain',
        });
        expect(e.ports.harness.cancelled).toHaveLength(1);
      } else expect(run.failure?.inference).toBeUndefined();
      expect(JSON.stringify(run.failure)).not.toContain('PRIVATE_TEMPLATE');
    },
  );

  const genuine = new TemplateError('external marker');
  const lookalikes = [
    genuine,
    Object.assign(new Error('external marker'), { name: 'TemplateError' }),
    { code: 'TEMPLATE_ERROR', message: 'external marker' },
  ];
  for (const origin of [
    'model',
    'resolve',
    'file',
    'structured input',
    'structured output',
    'coerce resolver input',
    'coerce resolver output',
    'contextWindow',
    'fits',
    'start',
    'repair resume',
    'iterator',
    'result',
  ] as const) {
    it.each(lookalikes)(
      'keeps the external ' + origin + ' policy for %j',
      async (external: unknown) => {
        const e = await createTestEngine();
        const fail = () => {
          throw external;
        };
        const config: Record<string, unknown> = {};
        if (origin === 'model') e.ports.modelCatalog.list = fail;
        if (origin === 'resolve') e.ports.workspace.resolve = fail;
        if (origin === 'file') {
          config.contextFiles = [{ path: 'f', template: 'valid' }];
          e.ports.workspace.writeFile = fail;
        }
        if (origin.startsWith('structured') || origin.startsWith('coerce resolver')) {
          if (origin.endsWith('input')) config.input = [repairBoolean];
          else config.output = { transforms: [repairBoolean] };
          if (origin.startsWith('coerce resolver')) {
            let reads = 0;
            e.ports.modelCatalog.list = () =>
              ++reads === 1 ? Promise.resolve(e.ports.modelCatalog.entries) : fail();
          } else e.ports.structuredFake.respondWith(fail);
        }
        const fake = e.ports.harness;
        if (origin === 'repair resume') {
          fake.script([{ finalText: 'invalid' }]);
          config.output = {
            schema: {
              jsonSchema: { type: 'number' },
              repair: { maxAttempts: 1, prompt: 'Repair' },
            },
          };
        }
        if (
          origin === 'repair resume' ||
          origin === 'contextWindow' ||
          origin === 'fits' ||
          origin === 'start' ||
          origin === 'iterator' ||
          origin === 'result'
        ) {
          e.ports.harnesses.codex = {
            id: 'codex',
            preflight: () => fake.preflight(),
            resume: origin === 'repair resume' ? fail : (...args) => fake.resume(...args),
            contextWindow:
              origin === 'contextWindow'
                ? fail
                : () =>
                    Promise.resolve({
                      profile: 'test',
                      contextTokens: 4096,
                      outputReserveTokens: 1024,
                      fits: origin === 'fits' ? fail : () => true,
                    }),
            start:
              origin === 'start'
                ? fail
                : (...args) => {
                    const session = fake.start(...args);
                    if (origin === 'result') {
                      const result = Promise.resolve().then(fail);
                      void result.catch(() => undefined);
                      return {
                        ...session,
                        events: {
                          [Symbol.asyncIterator]: () => ({
                            next: () => Promise.resolve({ done: true as const, value: undefined }),
                          }),
                        },
                        result,
                      };
                    }
                    if (origin === 'iterator')
                      return { ...session, events: { [Symbol.asyncIterator]: fail } };
                    return session;
                  },
          };
        }
        const v = e.publish(inferenceLoop('external boundaries', config));
        const run = await e.runToIdle(v.loopId);
        const withHandle = origin === 'iterator' || origin === 'result';
        const noHandle = origin === 'start' || origin === 'repair resume';
        const harnessError =
          withHandle || noHandle || origin === 'contextWindow' || origin === 'fits';
        expect(run.failure?.code).toBe(
          withHandle
            ? 'HARNESS_DELIVERY_UNCERTAIN'
            : harnessError
              ? 'HARNESS_TURN_FAILED'
              : 'INTERNAL_ERROR',
        );
        expect(run.failure?.resumable).toBe(!withHandle);
        expect(JSON.stringify(run.failure?.details ?? {})).not.toMatch(/after-result|"boundary"/);
        if (harnessError) expect(run.failure?.message).toContain('external marker');
        if (noHandle || withHandle || origin.endsWith('output'))
          expect(run.failure?.inference?.submission).toBe(
            noHandle ? 'definitely-not-submitted' : 'delivery-uncertain',
          );
        else expect(run.failure?.inference).toBeUndefined();
      },
    );
  }

  it('keeps a genuine earlier evaluator error external on a partially completed write', async () => {
    const e = await createTestEngine();
    const error: unknown = await evaluateExpression('$error("PRIVATE_WRITE")', {}).catch(
      (fault: unknown) => fault,
    );
    const writes: string[] = [];
    e.ports.workspace.writeFile = (_dir, path) => {
      writes.push(path);
      throw error;
    };
    const v = e.publish(
      inferenceLoop('partial write', {
        contextFiles: [
          { path: 'first', template: 'valid' },
          { path: 'later', template: 'valid' },
        ],
      }),
    );
    const run = await e.runToIdle(v.loopId);
    expect(run.failure).toMatchObject({ code: 'INTERNAL_ERROR', resumable: true });
    expect(JSON.stringify(run.failure)).not.toContain('PRIVATE_WRITE');
    expect(writes).toEqual(['first']);
  });
});

it.each(['repair', 'continuation'] as const)(
  'attaches a post-result transform failure to the actual last %s turn',
  async (kind) => {
    const e = await createTestEngine();
    const config = {
      output: {
        transforms: [badExpression],
        ...(kind === 'repair'
          ? {
              schema: {
                jsonSchema: { type: 'number' },
                repair: { maxAttempts: 1, prompt: 'Repair' },
              },
            }
          : {}),
      },
    };
    const v = e.publish(inferenceLoop('last actual task', config));
    e.ports.harness.script(
      kind === 'repair'
        ? [{ finalText: 'invalid' }, { finalText: '42' }]
        : [
            {
              finalText: 'interrupted',
              accepted: true,
              error: { code: 'HARNESS_TURN_FAILED', message: 'lost result' },
              submission: 'delivery-uncertain',
            },
            { finalText: 'done' },
          ],
    );
    let run = await e.runToIdle(v.loopId);
    if (kind === 'continuation') {
      expect(run.failure?.resumable).toBe(true);
      await e.manager.resume(run.id);
      run = await e.settle(run.id);
    }
    const turns = e.events(run.id).filter((event) => event.type === 'harness.turn');
    expect(turns).toHaveLength(2);
    expect(run.failure).toMatchObject({
      code: 'MUTATION_ERROR',
      resumable: false,
      details: { phase: 'after-result' },
      inference: {
        visitId: turns[1]!.visitId,
        turnId: turns[1]!.turnId,
        sessionId: 'fake-session-1',
        promptKind: kind,
        submission: 'delivery-uncertain',
      },
    });
    expect(turns[0]!.turnId).not.toBe(turns[1]!.turnId);
    await expect(e.manager.resume(run.id)).rejects.toMatchObject({ code: 'FAILURE_NOT_RESUMABLE' });
    expect(e.ports.harness.resumed).toHaveLength(1);
  },
);
