import { describe, expect, it } from 'vitest';
import {
  ContextThreadSchema,
  DecisionConfigSchema,
  EffortSchema,
  ExitConfigSchema,
  HeartbeatConfigSchema,
  InferenceConfigSchema,
  JsonPatchSchema,
  JsonPointerSchema,
  LoopDefinitionSchema,
  LoopExportSchema,
  MutationOperationSchema,
  NodeConfigSchemas,
  NodeKindSchema,
  NodeSchema,
  RunEventSchema,
  RunRecordSchema,
  ScriptConfigSchema,
  SubloopConfigSchema,
  TriggerConfigSchema,
  UlidSchema,
  WaitConfigSchema,
} from './index.js';
import {
  FIXTURE_IDS,
  FIXTURE_TS,
  fakeUlid,
  kitchenSinkLoop,
  minimalLoop,
  sampleThread,
} from './testing/index.js';

describe('common schemas', () => {
  it('accepts valid ULIDs and rejects others', () => {
    expect(UlidSchema.safeParse(fakeUlid('x')).success).toBe(true);
    expect(UlidSchema.safeParse('not-a-ulid').success).toBe(false);
    expect(UlidSchema.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FAI').success).toBe(false); // I is not allowed
  });

  it('validates JSON pointers', () => {
    for (const ok of ['', '/vars', '/vars/a~1b', '/messages/0', '/a~0b']) {
      expect(JsonPointerSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['vars', '/vars/~', '/vars/~2']) {
      expect(JsonPointerSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('exposes the canonical effort scale', () => {
    expect(EffortSchema.options).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('parses JSON patch documents', () => {
    const patch = JsonPatchSchema.parse([
      { op: 'add', path: '/vars/x', value: 1 },
      { op: 'remove', path: '/messages/0' },
      { op: 'replace', path: '/vars/x', value: { nested: [true, null] } },
      { op: 'move', from: '/vars/x', path: '/vars/y' },
      { op: 'copy', from: '/vars/y', path: '/vars/z' },
      { op: 'test', path: '/vars/z', value: { nested: [true, null] } },
    ]);
    expect(patch).toHaveLength(6);
    expect(JsonPatchSchema.safeParse([{ op: 'explode', path: '/' }]).success).toBe(false);
  });
});

describe('loop definition', () => {
  it('parses the minimal loop and applies defaults', () => {
    const loop = LoopDefinitionSchema.parse(minimalLoop());
    expect(loop.settings.maxIterations).toBe(10);
    expect(loop.settings.workingDirectory).toEqual({ kind: 'temp' });
    expect(loop.settings.defaults).not.toHaveProperty('harness');
    const exit = loop.nodes.find((n) => n.kind === 'exit');
    expect(exit?.kind === 'exit' && exit.config.return.channels).toEqual([{ kind: 'caller' }]);
    expect(loop.edges[0]?.to.port).toBe('in');
  });

  it('parses the kitchen-sink loop with every node kind', () => {
    const loop = LoopDefinitionSchema.parse(kitchenSinkLoop());
    const kinds = new Set(loop.nodes.map((n) => n.kind));
    expect([...kinds].sort()).toEqual([...NodeKindSchema.options].sort());
    const infer = loop.nodes.find((n) => n.id === 'infer');
    expect(infer?.kind === 'inference' && infer.config.output.schema?.repair.maxAttempts).toBe(2);
    expect(infer?.kind === 'inference' && infer.config.harnessOptions.sandbox).toBe(
      'workspace-write',
    );
  });

  it('rejects unknown keys', () => {
    const loop = minimalLoop();
    (loop as Record<string, unknown>).extra = true;
    expect(LoopDefinitionSchema.safeParse(loop).success).toBe(false);
  });

  it('round-trips through the export format', () => {
    const exported = LoopExportSchema.parse({
      format: 'graphgoblin-loop',
      formatVersion: 1,
      exportedAt: FIXTURE_TS,
      loop: minimalLoop(),
    });
    expect(exported.loop.name).toBe('minimal');
  });

  it('has a config schema for every node kind', () => {
    expect(Object.keys(NodeConfigSchemas).sort()).toEqual([...NodeKindSchema.options].sort());
  });
});

describe('node config schemas', () => {
  it('decision requires unique routes and an expression block when used', () => {
    const base = {
      routes: [
        { label: 'a', description: 'A' },
        { label: 'a', description: 'A again' },
      ],
      question: 'q',
      strategy: ['expression'],
      expression: { jsonata: '"a"' },
    };
    expect(DecisionConfigSchema.safeParse(base).success).toBe(false);
    const dup = {
      ...base,
      routes: [
        { label: 'a', description: 'A' },
        { label: 'b', description: 'B' },
      ],
      strategy: ['jev', 'jev'],
    };
    expect(DecisionConfigSchema.safeParse(dup).success).toBe(false);
    const missingExpr = { ...dup, strategy: ['expression'], expression: undefined };
    expect(DecisionConfigSchema.safeParse(missingExpr).success).toBe(false);
    const ok = { ...dup, strategy: ['jev', 'codex'] };
    const parsed = DecisionConfigSchema.parse(ok);
    expect(parsed.context.messages).toBe('last');
    expect(parsed.recordAlternatives).toBe(true);
  });

  it('decision rejects a route named "in"', () => {
    expect(
      DecisionConfigSchema.safeParse({
        routes: [
          { label: 'in', description: 'x' },
          { label: 'b', description: 'y' },
        ],
        question: 'q',
        strategy: ['jev'],
      }).success,
    ).toBe(false);
  });

  it('inference applies nested defaults', () => {
    const cfg = InferenceConfigSchema.parse({ prompt: { template: 'hi' } });
    expect(cfg.harness).toBe('codex');
    expect(cfg.session).toEqual({ policy: 'fresh' });
    expect(cfg.output.captureTranscript).toBe('artifact');
    expect(cfg.output.toMessages).toBe('final');
    expect(cfg.harnessOptions.approval).toBe('never');
    expect(cfg.input).toEqual([]);
  });

  it('script accepts exit code routes and defaults', () => {
    const cfg = ScriptConfigSchema.parse({
      command: 'echo',
      exitCodeRoutes: { '0': 'out', '2': 'two' },
    });
    expect(cfg.stdin).toBe('thread');
    expect(cfg.stdout).toBe('last-output');
    expect(cfg.cwd).toBe('workspace');
    expect(
      ScriptConfigSchema.safeParse({ command: 'echo', exitCodeRoutes: { x: 'out' } }).success,
    ).toBe(false);
    expect(
      ScriptConfigSchema.safeParse({ command: 'echo', exitCodeRoutes: { '1': 'dup', '2': 'dup' } })
        .success,
    ).toBe(false);
  });

  it('subloop applies mapping defaults', () => {
    const cfg = SubloopConfigSchema.parse({ loopRef: { loopId: FIXTURE_IDS.childLoop } });
    expect(cfg.loopRef.version).toBe('latest');
    expect(cfg.input.mode).toBe('inherit');
    expect(cfg.output.mode).toBe('result-only');
    expect(cfg.output.resultTo.lastOutput).toBe(true);
    expect(cfg.output.usage).toBe('roll-up');
  });

  it('wait covers every mode and defaults onTimeout', () => {
    expect(WaitConfigSchema.parse({ mode: 'input', prompt: 'p' }).onTimeout).toBe('continue');
    expect(WaitConfigSchema.parse({ mode: 'duration', seconds: 5 }).mode).toBe('duration');
    expect(WaitConfigSchema.parse({ mode: 'until', timestamp: '{{ vars.t }}' }).mode).toBe('until');
    expect(WaitConfigSchema.parse({ mode: 'signal', name: 'go' }).mode).toBe('signal');
    expect(WaitConfigSchema.safeParse({ mode: 'nap' }).success).toBe(false);
  });

  it('heartbeat requires a stopping condition', () => {
    expect(HeartbeatConfigSchema.safeParse({ intervalSeconds: 10 }).success).toBe(false);
    const cfg = HeartbeatConfigSchema.parse({ intervalSeconds: 10, until: 'probe.status = 200' });
    expect(cfg.probe).toEqual({ kind: 'none' });
    expect(cfg.onExhausted).toBe('continue');
  });

  it('exit validates loop-back and predicate requirements', () => {
    expect(ExitConfigSchema.safeParse({ default: 'loop-back' }).success).toBe(false);
    expect(
      ExitConfigSchema.safeParse({
        criteria: [{ when: 'predicate', strategy: 'expression', outcome: 'success' }],
      }).success,
    ).toBe(false);
    expect(
      ExitConfigSchema.safeParse({
        criteria: [{ when: 'predicate', strategy: 'jev', outcome: 'success' }],
      }).success,
    ).toBe(false);
    const cfg = ExitConfigSchema.parse({
      criteria: [
        { when: 'predicate', strategy: 'jev', question: 'Done?', outcome: 'success' },
        { when: 'max-duration', seconds: 60 },
        { when: 'last-output-matches', jsonSchema: { type: 'object' } },
      ],
    });
    expect(cfg.default).toBe('success');
    expect(cfg.return.mapping).toBe('none');
  });

  it('trigger subtypes parse with defaults', () => {
    const manual = TriggerConfigSchema.parse({ subtype: 'manual' });
    expect(manual.subtype === 'manual' && manual.exposeTo).toEqual(['ui', 'api', 'mcp']);
    const cron = TriggerConfigSchema.parse({ subtype: 'cron', expression: '* * * * *' });
    expect(cron.subtype === 'cron' && cron.missedFirePolicy).toBe('skip');
    const hook = TriggerConfigSchema.parse({
      subtype: 'webhook',
      signature: { scheme: 'hmac-sha256', secretRef: 'hook-secret' },
    });
    expect(hook.subtype === 'webhook' && hook.replayWindowSeconds).toBe(300);
    expect(TriggerConfigSchema.parse({ subtype: 'event', eventType: 'issue-ready' }).subtype).toBe(
      'event',
    );
    const poll = TriggerConfigSchema.parse({
      subtype: 'poll',
      intervalSeconds: 30,
      probe: { kind: 'http', url: 'https://example.test/status' },
      fireWhen: 'probe.body.ready',
    });
    expect(poll.subtype === 'poll' && poll.probe.kind === 'http' && poll.probe.method).toBe('GET');
  });

  it('node envelope defaults ui position', () => {
    const node = NodeSchema.parse({
      id: 'n',
      kind: 'mutate',
      label: 'M',
      config: { operations: [{ op: 'delete', path: '/vars/x' }] },
    });
    expect(node.ui).toEqual({ x: 0, y: 0 });
  });
});

describe('mutation operations', () => {
  it('parses each operation with defaults', () => {
    const ops = [
      { op: 'set', path: '/vars/a', value: { kind: 'template', template: '{{ vars.b }}' } },
      { op: 'delete', path: '/vars/a' },
      { op: 'append-message', content: 'note' },
      { op: 'inject', position: 'start', messages: [{ content: 'x' }] },
      { op: 'truncate', keep: { last: 3 } },
      { op: 'drop', target: 'messages', where: 'role = "tool"' },
      { op: 'replace', target: 'messages', pattern: 'foo', replacement: 'bar' },
      { op: 'redact', patterns: ['sk-[a-z0-9]+'] },
      {
        op: 'coerce',
        source: '/lastOutput/value',
        jsonSchema: { type: 'object' },
        target: '/vars/result',
      },
    ];
    for (const op of ops) {
      const parsed = MutationOperationSchema.parse(op);
      expect(parsed.op).toBe(op.op);
    }
    const redact = MutationOperationSchema.parse({ op: 'redact', patterns: ['x'] });
    expect(redact.op === 'redact' && redact.replacement).toBe('[REDACTED]');
    const coerce = MutationOperationSchema.parse(ops[8]);
    expect(coerce.op === 'coerce' && coerce.repair.maxAttempts).toBe(1);
  });

  it('truncate requires a keep rule', () => {
    expect(MutationOperationSchema.safeParse({ op: 'truncate', keep: {} }).success).toBe(false);
  });

  it('replace rejects bad regex flags', () => {
    expect(
      MutationOperationSchema.safeParse({
        op: 'replace',
        target: 'vars',
        pattern: 'a',
        replacement: 'b',
        flags: 'q',
      }).success,
    ).toBe(false);
  });
});

describe('thread, run, and events', () => {
  it('parses the sample thread', () => {
    const thread = ContextThreadSchema.parse(sampleThread());
    expect(thread.messages).toHaveLength(2);
    expect(thread.counters.usage.inputTokens).toBe(0);
  });

  it('rejects a thread with an unknown top-level key', () => {
    const thread = { ...sampleThread(), bogus: 1 };
    expect(ContextThreadSchema.safeParse(thread).success).toBe(false);
  });

  it('parses run records', () => {
    const run = RunRecordSchema.parse({
      id: FIXTURE_IDS.run,
      ownerId: 'local',
      loopId: FIXTURE_IDS.loop,
      versionId: FIXTURE_IDS.version,
      invocationId: FIXTURE_IDS.invocation,
      status: 'waiting',
      iteration: 1,
      waiting: { nodeId: 'approve', kind: 'input', prompt: 'Approve?' },
      createdAt: FIXTURE_TS,
      lastEventSeq: 4,
    });
    expect(run.status).toBe('waiting');
  });

  it('parses run events of several types', () => {
    const base = { runId: FIXTURE_IDS.run, seq: 1, ts: FIXTURE_TS };
    const events = [
      { ...base, type: 'run.queued' },
      { ...base, type: 'run.queued', replayOf: { runId: FIXTURE_IDS.run, nodeId: 'n' } },
      {
        ...base,
        type: 'run.queued',
        subloopVersions: { [FIXTURE_IDS.childLoop]: FIXTURE_IDS.version },
      },
      { ...base, type: 'run.started', attempt: 1 },
      { ...base, type: 'node.started', nodeId: 'n', kind: 'mutate', attempt: 1, configHash: 'abc' },
      { ...base, type: 'node.finished', nodeId: 'n', patch: [], route: 'out', durationMs: 3 },
      {
        ...base,
        type: 'decision.made',
        nodeId: 'd',
        strategy: 'jev',
        route: 'good',
        confidence: 0.9,
      },
      {
        ...base,
        type: 'run.finished',
        status: 'succeeded',
        outcome: 'success',
        result: { ok: true },
      },
      { ...base, type: 'return.delivered', channel: { kind: 'caller' } },
      { ...base, type: 'heartbeat.beat', nodeId: 'h', beat: 1 },
    ];
    for (const ev of events) {
      expect(RunEventSchema.safeParse(ev).success, ev.type).toBe(true);
    }
    expect(RunEventSchema.safeParse({ ...base, type: 'run.exploded' }).success).toBe(false);
    expect(
      RunEventSchema.safeParse({
        ...base,
        type: 'run.queued',
        replayOf: { runId: 'x', nodeId: 'n' },
      }).success,
    ).toBe(false);
  });
});
