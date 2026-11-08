import { describe, expect, it } from 'vitest';
import {
  CHAT_PROTOCOL,
  ChatAudioInputJsonSchema,
  ChatNormalizedInputJsonSchema,
  ChatResponseJsonSchema,
  ChatTextInputJsonSchema,
  LoopDefinitionSchema,
  NodeSchema,
  type HarnessId,
  type LoopDefinition,
  type Node,
} from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import {
  createSystemChatDefinition,
  disableChatAudio,
  enableChatAudio,
  evaluateExpression,
  parseChatNormalizedInput,
  parseChatResult,
  selectSystemChatHarness,
  systemChatCapabilities,
  systemChatIssues,
  systemChatLockedIssues,
  SYSTEM_CHAT_SCRIPT_NORMALIZE_EXPRESSION,
  SYSTEM_CHAT_SUBLOOP_NORMALIZE_EXPRESSION,
  SYSTEM_CHAT_TEXT_PROMPT,
  SYSTEM_CHAT_SCRIPT_PROMPT,
  SYSTEM_CHAT_SUBLOOP_PROMPT,
} from './index.js';
import { validateLoop } from './graph.js';
import { validateJson } from './json-schema.js';
import { renderTemplate } from './template.js';

const seed = () => createSystemChatDefinition({ name: 'Gateway', harness: 'codex' });
const script = () =>
  NodeSchema.parse({
    id: 'chat-normalize',
    kind: 'script',
    label: 'Normalize',
    config: { command: 'transcribe', stdin: 'thread', stdout: 'last-output' },
  });
const subloop = () =>
  NodeSchema.parse({
    id: 'chat-normalize',
    kind: 'subloop',
    label: 'Normalize',
    config: {
      loopRef: { loopId: fakeUlid('normalizer') },
      output: { mode: 'result-only', resultTo: { lastOutput: true } },
    },
  });
function audioDefinition(normalizer: Node = script()): LoopDefinition {
  const valid = normalizer.kind === 'subloop' ? subloop() : script();
  if (valid.kind !== 'script' && valid.kind !== 'subloop') throw new Error('fixture normalizer');
  const def = enableChatAudio(seed(), valid);
  def.nodes[def.nodes.findIndex((node) => node.id === 'chat-normalize')] = normalizer;
  return def;
}
function issuesAfter(edit: (def: LoopDefinition) => void, audio = false) {
  const def = audio ? audioDefinition() : seed();
  edit(def);
  return systemChatIssues(def);
}
const output = (value: unknown) => ({
  'chat-normalize': { nodeId: 'chat-normalize', at: FIXTURE_TS, value },
});

describe('system chat seed', () => {
  it.each(['codex', 'claude', 'ollama'] satisfies HarnessId[])(
    'creates a native valid isolated %s seed without explicit model or effort',
    async (harness) => {
      const def = createSystemChatDefinition({ name: 'System chat', harness });
      expect(LoopDefinitionSchema.parse(def)).toEqual(def);
      expect(validateLoop(def)).toEqual([]);
      expect(systemChatIssues(def)).toEqual([]);
      expect(systemChatCapabilities(def)).toEqual({ audio: false });
      expect(def.settings.workingDirectory).toEqual({ kind: 'temp' });
      const inference = def.nodes.find((node) => node.kind === 'inference')!;
      expect(inference.config.session).toEqual({ policy: 'fresh' });
      expect(inference.config.model).toBeUndefined();
      expect(inference.config.effort).toBeUndefined();
      expect(inference.config.capabilities).toBeUndefined();
      expect(inference.config.output.schema?.jsonSchema).toEqual(ChatResponseJsonSchema);
      if (harness === 'ollama') {
        expect(inference.config.harnessOptions).toEqual({
          sandbox: 'read-only',
          approval: 'never',
        });
        expect(inference.config.output.schema?.repair.enabled).toBe(false);
      }
      expect(inference.config.output.transforms).toEqual([
        {
          op: 'set',
          path: '/vars/chatResponse',
          value: { kind: 'expression', jsonata: 'lastOutput.value' },
        },
      ]);
      const prompt = await renderTemplate(inference.config.prompt.template, {
        trigger: {
          payload: {
            input: { text: 'Current question' },
            history: [
              { role: 'user', text: 'Earlier question' },
              { role: 'assistant', text: 'Actual earlier answer' },
            ],
            path: '/hidden',
            apiKey: 'private',
          },
        },
        vars: { private: 'not included' },
      });
      expect(prompt).toContain('user: Current question');
      expect(prompt).toContain('assistant: Actual earlier answer');
      expect(prompt).not.toMatch(/\/hidden|private|not included/);
    },
  );

  it('creates independent definitions, without sharing canonical mutable schema objects', () => {
    const first = seed();
    const second = seed();
    first.variables['chatResponse']!['additionalProperties'] = true;
    expect(second.variables['chatResponse']).toEqual(ChatResponseJsonSchema);
    expect(systemChatIssues(first)).not.toEqual([]);
  });

  it('chooses one configured owner harness before considering process defaults', () => {
    const empty = { byHarness: {} };
    expect(selectSystemChatHarness({ ownerDefaults: empty, processDefaults: empty })).toBe('codex');
    expect(
      selectSystemChatHarness({
        ownerDefaults: { byHarness: { codex: { effort: 'high' }, claude: { model: 'owner' } } },
        processDefaults: { byHarness: { codex: { model: 'process' } } },
      }),
    ).toBe('claude');
    expect(
      selectSystemChatHarness({
        ownerDefaults: { byHarness: { claude: { model: 'a' }, codex: { model: 'b' } } },
        processDefaults: empty,
      }),
    ).toBe('codex');
    expect(
      selectSystemChatHarness({
        ownerDefaults: empty,
        processDefaults: { byHarness: { claude: { model: 'a' }, codex: { model: 'b' } } },
      }),
    ).toBe('codex');
    expect(
      selectSystemChatHarness({
        ownerDefaults: empty,
        processDefaults: { byHarness: { claude: { model: 'a' } } },
      }),
    ).toBe('claude');
    expect(
      selectSystemChatHarness({
        ownerDefaults: { byHarness: { ollama: { model: 'qwen:installed' } } },
        processDefaults: { byHarness: { codex: { model: 'process' } } },
      }),
    ).toBe('ollama');
    expect(
      selectSystemChatHarness({
        ownerDefaults: {
          byHarness: { ollama: { model: 'qwen:installed' }, claude: { model: 'owner' } },
        },
        processDefaults: empty,
      }),
    ).toBe('claude');
    expect(
      selectSystemChatHarness({
        ownerDefaults: empty,
        processDefaults: { byHarness: { ollama: { model: 'qwen:installed' } } },
      }),
    ).toBe('ollama');
  });
});

describe('protected system chat boundary', () => {
  it('compares normalized JSON schema objects, accepting reordered properties and ordinary interior edits', () => {
    const def = seed();
    const trigger = def.nodes[0]!;
    if (trigger.kind !== 'trigger' || trigger.config.type !== 'manual')
      throw new Error('fixture trigger');
    trigger.config.inputSchema = Object.fromEntries(
      Object.entries(ChatTextInputJsonSchema).reverse(),
    );
    trigger.config.exposeTo.reverse();
    const infer = def.nodes[1]!;
    if (infer.kind !== 'inference') throw new Error('fixture inference');
    infer.config.prompt.template = 'An owner-authored prompt.';
    infer.config.model = 'owner-choice';
    expect(systemChatIssues(def)).toEqual([]);
  });

  it('rejects a missing, renamed, duplicate or nonmanual boundary trigger', () => {
    for (const edit of [
      (def: LoopDefinition) => {
        def.nodes = def.nodes.filter((node) => node.kind !== 'trigger');
      },
      (def: LoopDefinition) => {
        def.nodes[0]!.id = 'renamed';
      },
      (def: LoopDefinition) => {
        def.nodes.push(structuredClone(def.nodes[0]!));
      },
      (def: LoopDefinition) => {
        def.nodes[0] = NodeSchema.parse({
          id: 'chat-input',
          label: 'Event',
          kind: 'trigger',
          config: { type: 'event', eventType: 'event' },
        });
      },
    ])
      expect(issuesAfter(edit)[0]?.message).toMatch(/exactly one manual trigger/);
  });

  it('rejects changed trigger exposure, incoming paths, schemas and response variables', () => {
    expect(
      issuesAfter((def) => {
        const trigger = def.nodes[0]!;
        if (trigger.kind === 'trigger' && trigger.config.type === 'manual')
          trigger.config.exposeTo.push('mcp');
      }),
    ).toContainEqual(expect.objectContaining({ nodeId: 'chat-input', path: 'config.exposeTo' }));
    expect(
      issuesAfter((def) => {
        def.edges.push({
          id: 'cycle',
          from: { node: 'respond', port: 'out' },
          to: { node: 'chat-input', port: 'in' },
        });
      }),
    ).toContainEqual(expect.objectContaining({ message: expect.stringContaining('revisited') }));
    for (const inputSchema of [undefined, { type: 'object' }])
      expect(
        issuesAfter((def) => {
          const trigger = def.nodes[0]!;
          if (trigger.kind === 'trigger' && trigger.config.type === 'manual') {
            if (inputSchema === undefined) delete trigger.config.inputSchema;
            else trigger.config.inputSchema = inputSchema;
          }
        }),
      ).toContainEqual(expect.objectContaining({ path: 'config.inputSchema' }));
    expect(
      issuesAfter((def) => {
        delete def.variables['chatResponse'];
      }),
    ).toContainEqual(expect.objectContaining({ path: 'variables.chatResponse' }));
  });

  it('protects every successful return and destination, while allowing canonical failure or quiet failure', () => {
    for (const returns of ['none', 'lastOutput.value', '"fake"'])
      expect(
        issuesAfter((def) => {
          const exit = def.nodes[2]!;
          if (exit.kind === 'exit') exit.config.returns = returns;
        }),
      ).toContainEqual(expect.objectContaining({ path: 'config.returns' }));
    for (const destinations of [[], [{ kind: 'caller' as const }, { kind: 'log' as const }]])
      expect(
        issuesAfter((def) => {
          const exit = def.nodes[2]!;
          if (exit.kind === 'exit') exit.config.destinations = destinations;
        }),
      ).toContainEqual(expect.objectContaining({ path: 'config.destinations' }));
    for (const outcome of ['failure', 'exhausted'] as const) {
      expect(
        issuesAfter((def) => {
          const exit = def.nodes[2]!;
          if (exit.kind === 'exit') {
            exit.config.outcome = outcome;
            exit.config.returns = 'none';
          }
        }),
      ).toEqual([]);
      expect(
        issuesAfter((def) => {
          const exit = def.nodes[2]!;
          if (exit.kind === 'exit') exit.config.outcome = outcome;
        }),
      ).toEqual([]);
    }
    expect(
      issuesAfter((def) => {
        def.nodes.push(
          NodeSchema.parse({ kind: 'exit', id: 'alternate', label: 'Alternate', config: {} }),
        );
      }),
    ).toContainEqual(expect.objectContaining({ nodeId: 'alternate', path: 'config.returns' }));
  });
});

describe('configured audio boundary', () => {
  it.each([script, subloop])(
    'recognizes an ordinary normalizer with a single mandatory route',
    (createNormalizer) => {
      const def = audioDefinition(createNormalizer());
      expect(systemChatIssues(def)).toEqual([]);
      expect(systemChatCapabilities(def)).toEqual({ audio: true });
      expect(validateLoop(def)).toEqual([]);
    },
  );

  it('rejects missing, duplicate and unsupported normalizer nodes', () => {
    for (const edit of [
      (def: LoopDefinition) => {
        def.nodes = def.nodes.filter((node) => node.id !== 'chat-normalize');
      },
      (def: LoopDefinition) => {
        def.nodes.push(script());
      },
      (def: LoopDefinition) => {
        const normalizer = def.nodes.find((node) => node.id === 'chat-normalize')!;
        Object.assign(
          normalizer,
          NodeSchema.parse({
            id: 'chat-normalize',
            kind: 'wait',
            label: 'Wrong',
            config: { mode: 'duration', seconds: 1 },
          }),
        );
      },
    ])
      expect(issuesAfter(edit, true)).toContainEqual(
        expect.objectContaining({ message: expect.stringContaining('Script or Subloop') }),
      );
  });

  it('requires native Script input/output and no conditional alternative route', () => {
    for (const config of [
      { stdin: 'none' },
      { stdout: 'ignore' },
      { exitCodeRoutes: { '3': 'retry' } },
    ]) {
      const normalizer = NodeSchema.parse({
        ...script(),
        config: { ...script().config, ...config },
      });
      expect(systemChatIssues(audioDefinition(normalizer))).toContainEqual(
        expect.objectContaining({ path: 'config' }),
      );
    }
    const normalizer = script();
    if (normalizer.kind === 'script') normalizer.config.exitCodeRoutes = { '0': 'out' };
    expect(systemChatIssues(audioDefinition(normalizer))).toEqual([]);
  });

  it('requires native result-only Subloop output to lastOutput', () => {
    for (const edit of ['mode', 'lastOutput']) {
      const normalizer = subloop();
      if (normalizer.kind === 'subloop') {
        if (edit === 'mode') normalizer.config.output.mode = 'merge';
        else normalizer.config.output.resultTo.lastOutput = false;
      }
      expect(systemChatIssues(audioDefinition(normalizer))).toContainEqual(
        expect.objectContaining({ path: 'config.output' }),
      );
    }
  });

  it('rejects every bypass, extra root, missing/out-of-port edge and reentry cycle', () => {
    for (const edit of [
      (def: LoopDefinition) => {
        def.edges = def.edges.filter((edge) => edge.id !== 'chat-start');
      },
      (def: LoopDefinition) => {
        def.edges[0]!.from.port = 'other';
      },
      (def: LoopDefinition) => {
        def.edges[0]!.to.node = 'respond';
      },
      (def: LoopDefinition) => {
        def.edges.push({
          id: 'bypass',
          from: { node: 'chat-input', port: 'out' },
          to: { node: 'respond', port: 'in' },
        });
      },
      (def: LoopDefinition) => {
        def.edges.push({
          id: 'cycle',
          from: { node: 'respond', port: 'out' },
          to: { node: 'chat-normalize', port: 'in' },
        });
      },
      (def: LoopDefinition) => {
        def.edges = def.edges.filter((edge) => edge.id !== 'chat-normalize-checked');
      },
      (def: LoopDefinition) => {
        def.edges.find((edge) => edge.id === 'chat-normalize-checked')!.from.port = 'conditional';
      },
      (def: LoopDefinition) => {
        def.edges.push({
          id: 'alternative',
          from: { node: 'chat-normalize', port: 'out' },
          to: { node: 'chat-return', port: 'in' },
        });
      },
    ]) {
      const def = audioDefinition();
      edit(def);
      expect(systemChatIssues(def).length).toBeGreaterThan(0);
      expect(systemChatCapabilities(def).audio).toBe(false);
    }
  });
});

describe('canonical native chat projection', () => {
  it('accepts actual response objects and rejects aliases with bounded public errors', () => {
    const response = { protocol: CHAT_PROTOCOL, reply: 'The actual response.' };
    expect(parseChatResult(response)).toEqual(response);
    for (const invalid of [
      'text',
      null,
      { text: 'alias' },
      { protocol: CHAT_PROTOCOL, reply: ' ' },
      { ...response, secret: 'do not reveal' },
    ]) {
      expect(() => parseChatResult(invalid)).toThrow(
        expect.objectContaining({
          code: 'CHAT_RESPONSE_INVALID',
          message: 'The chat workflow did not return a valid response.',
          details: undefined,
        }),
      );
    }
  });

  it('extracts only strict Script output or the pinned successful native Subloop envelope', () => {
    expect(
      parseChatNormalizedInput(audioDefinition(), output({ text: 'Exact transcript' })),
    ).toEqual({ text: 'Exact transcript' });
    const envelope = {
      status: 'succeeded',
      outcome: 'success',
      result: { text: 'Child transcript' },
      childRunId: fakeUlid('child-run'),
    };
    expect(parseChatNormalizedInput(audioDefinition(subloop()), output(envelope))).toEqual({
      text: 'Child transcript',
    });
    for (const invalid of [
      undefined,
      [],
      {},
      output({ text: '' }),
      output({ text: ' \n' }),
      output({ text: 'x'.repeat(16_001) }),
      output({ text: 'transcript', reply: 'extra' }),
      output(envelope),
      { 'chat-normalize': { value: { text: 'unrecorded' } } },
      { 'chat-normalize': { nodeId: 'other', at: FIXTURE_TS, value: { text: 'wrong node' } } },
    ])
      expect(() => parseChatNormalizedInput(audioDefinition(), invalid)).toThrow(
        expect.objectContaining({ code: 'CHAT_AUDIO_NORMALIZATION_INVALID', details: undefined }),
      );
    for (const invalid of [
      output({ text: 'wrong alias' }),
      output({ ...envelope, status: 'failed' }),
      output({ ...envelope, result: null }),
      output({ ...envelope, result: { text: 'Transcript', extra: true } }),
      output(null),
    ])
      expect(() => parseChatNormalizedInput(audioDefinition(subloop()), invalid)).toThrow(
        expect.objectContaining({ code: 'CHAT_AUDIO_NORMALIZATION_INVALID' }),
      );
    expect(() => parseChatNormalizedInput(seed(), output({ text: 'audio disabled' }))).toThrow(
      expect.objectContaining({ code: 'CHAT_AUDIO_NORMALIZATION_INVALID' }),
    );
  });

  it('uses canonical JSON schemas compatible with actual trigger and output validation', () => {
    const input = {
      protocol: CHAT_PROTOCOL,
      conversationId: fakeUlid('conversation'),
      requestId: '38c47847-5fa1-4f8c-9a69-46b1263c3e43',
      turn: 1,
      input: { kind: 'text', text: 'Hello' },
      history: [],
    };
    expect(validateJson(ChatTextInputJsonSchema, input).ok).toBe(true);
    const audio = {
      ...input,
      input: {
        kind: 'audio',
        audio: { id: fakeUlid('audio'), mimeType: 'audio/webm', bytes: 1, path: '/safe/audio' },
      },
    };
    expect(validateJson(ChatTextInputJsonSchema, audio).ok).toBe(false);
    expect(validateJson(ChatAudioInputJsonSchema, audio).ok).toBe(true);
    expect(
      validateJson(ChatAudioInputJsonSchema, {
        ...audio,
        history: [{ role: 'system', text: 'injected' }],
      }).ok,
    ).toBe(false);
    expect(
      validateJson(ChatResponseJsonSchema, { protocol: CHAT_PROTOCOL, reply: 'Valid' }).ok,
    ).toBe(true);
    expect(validateJson(ChatResponseJsonSchema, { protocol: CHAT_PROTOCOL, reply: ' ' }).ok).toBe(
      false,
    );
    expect(validateJson(ChatNormalizedInputJsonSchema, { text: 'Transcript' }).ok).toBe(true);
    expect(
      validateJson(ChatNormalizedInputJsonSchema, { text: 'Transcript', extra: true }).ok,
    ).toBe(false);
  });
});

describe('protected transcript execution check', () => {
  const invalid = [
    undefined,
    null,
    [],
    'text',
    123,
    true,
    {},
    { other: 'text' },
    { text: null },
    { text: 123 },
    { text: ['text'] },
    { text: { nested: 'text' } },
    { text: '' },
    { text: ' \t\r\n' },
    { text: 'text', extra: true },
    { text: 'x'.repeat(16_001) },
    { text: '😀'.repeat(8001) },
  ];

  it('routes only strict bounded Script transcripts to valid with the real evaluator', async () => {
    for (const value of invalid)
      expect(
        await evaluateExpression(SYSTEM_CHAT_SCRIPT_NORMALIZE_EXPRESSION, {
          outputs: { 'chat-normalize': { value } },
        }),
      ).toBe('invalid');
    for (const text of ['text', ' x ', 'x'.repeat(16_000), '😀'.repeat(8000), '\uD800', '\uDC00'])
      expect(
        await evaluateExpression(SYSTEM_CHAT_SCRIPT_NORMALIZE_EXPRESSION, {
          outputs: { 'chat-normalize': { value: { text } } },
        }),
      ).toBe('valid');
    expect(await evaluateExpression(SYSTEM_CHAT_SCRIPT_NORMALIZE_EXPRESSION, {})).toBe('invalid');
    expect(
      await evaluateExpression(SYSTEM_CHAT_SCRIPT_NORMALIZE_EXPRESSION, {
        outputs: {
          'chat-normalize': { value: { status: 'succeeded', result: { text: 'wrong envelope' } } },
        },
      }),
    ).toBe('invalid');
  });

  it('requires a successful native Subloop envelope and the same strict transcript', async () => {
    for (const result of invalid)
      expect(
        await evaluateExpression(SYSTEM_CHAT_SUBLOOP_NORMALIZE_EXPRESSION, {
          outputs: { 'chat-normalize': { value: { status: 'succeeded', result } } },
        }),
      ).toBe('invalid');
    for (const value of [
      null,
      [],
      'bad',
      { text: 'alias' },
      { status: 'failed', result: { text: 'no action' } },
      { status: ['succeeded'], result: { text: 'no coercion' } },
    ])
      expect(
        await evaluateExpression(SYSTEM_CHAT_SUBLOOP_NORMALIZE_EXPRESSION, {
          outputs: { 'chat-normalize': { value } },
        }),
      ).toBe('invalid');
    for (const text of ['Child transcript', '😀'.repeat(8000)])
      expect(
        await evaluateExpression(SYSTEM_CHAT_SUBLOOP_NORMALIZE_EXPRESSION, {
          outputs: {
            'chat-normalize': {
              value: {
                status: 'succeeded',
                outcome: 'success',
                result: { text },
                childRunId: fakeUlid('child'),
              },
            },
          },
        }),
      ).toBe('valid');
    expect(await evaluateExpression(SYSTEM_CHAT_SUBLOOP_NORMALIZE_EXPRESSION, {})).toBe('invalid');
  });

  it('protects canonical check/failure configs while permitting visual edits', () => {
    for (const edit of [
      (def: LoopDefinition) => {
        def.nodes = def.nodes.filter((node) => node.id !== 'chat-normalize-check');
      },
      (def: LoopDefinition) => {
        def.nodes.push(
          structuredClone(def.nodes.find((node) => node.id === 'chat-normalize-check')!),
        );
      },
      (def: LoopDefinition) => {
        Object.assign(
          def.nodes.find((node) => node.id === 'chat-normalize-check')!,
          script(),
        );
        def.nodes.find((node) => node.id === 'chat-normalize')!.id = 'chat-normalize-check';
      },
      (def: LoopDefinition) => {
        const check = def.nodes.find((node) => node.id === 'chat-normalize-check')!;
        if (check.kind === 'decision' && check.config.kind === 'expression')
          check.config.jsonata = '"valid"';
      },
      (def: LoopDefinition) => {
        const check = def.nodes.find((node) => node.id === 'chat-normalize-check')!;
        if (check.kind === 'decision' && check.config.kind === 'expression')
          check.config.routes[0]!.repeat = true;
      },
      (def: LoopDefinition) => {
        def.nodes = def.nodes.filter((node) => node.id !== 'chat-normalize-invalid');
      },
      (def: LoopDefinition) => {
        def.nodes.push(
          structuredClone(def.nodes.find((node) => node.id === 'chat-normalize-invalid')!),
        );
      },
      (def: LoopDefinition) => {
        const failure = def.nodes.find((node) => node.id === 'chat-normalize-invalid')!;
        if (failure.kind === 'exit') failure.config.destinations = [{ kind: 'caller' }];
      },
      (def: LoopDefinition) => {
        const failure = def.nodes.find((node) => node.id === 'chat-normalize-invalid')!;
        if (failure.kind === 'exit') failure.config.outcome = 'exhausted';
      },
    ]) {
      const def = audioDefinition();
      edit(def);
      expect(systemChatIssues(def).length).toBeGreaterThan(0);
      expect(systemChatLockedIssues(def)).toEqual([]);
    }
    const def = audioDefinition();
    for (const node of def.nodes) {
      node.label = 'Owner label';
      node.ui = { x: 999, y: 999 };
    }
    expect(systemChatIssues(def)).toEqual([]);
  });

  it('blocks bypasses and backedges throughout the protected chain', () => {
    for (const edit of [
      (def: LoopDefinition) => {
        def.edges.push({
          id: 'check-reentry',
          from: { node: 'respond', port: 'out' },
          to: { node: 'chat-normalize-check', port: 'in' },
        });
      },
      (def: LoopDefinition) => {
        def.edges = def.edges.filter((edge) => edge.id !== 'chat-normalize-valid');
      },
      (def: LoopDefinition) => {
        def.edges = def.edges.filter((edge) => edge.id !== 'chat-normalize-rejected');
      },
      (def: LoopDefinition) => {
        def.edges.push({
          id: 'extra',
          from: { node: 'chat-normalize-check', port: 'other' },
          to: { node: 'respond', port: 'in' },
        });
      },
      (def: LoopDefinition) => {
        def.edges.find((edge) => edge.id === 'chat-normalize-rejected')!.to.node = 'respond';
      },
      ...[
        'chat-input',
        'chat-normalize',
        'chat-normalize-check',
        'chat-normalize-invalid',
        'missing',
      ].map((target) => (def: LoopDefinition) => {
        def.edges.find((edge) => edge.id === 'chat-normalize-valid')!.to.node = target;
      }),
      (def: LoopDefinition) => {
        def.edges.push({
          id: 'failure-in',
          from: { node: 'respond', port: 'out' },
          to: { node: 'chat-normalize-invalid', port: 'in' },
        });
      },
      (def: LoopDefinition) => {
        def.edges.push({
          id: 'failure-out',
          from: { node: 'chat-normalize-invalid', port: 'out' },
          to: { node: 'respond', port: 'in' },
        });
      },
    ]) {
      const def = audioDefinition();
      edit(def);
      expect(systemChatIssues(def).length).toBeGreaterThan(0);
      expect(systemChatLockedIssues(def)).toEqual([]);
    }
  });
});

describe('atomic system chat audio edits', () => {
  it.each([script, subloop])(
    'round-trips canonical seed wiring and prompt as one pure definition edit',
    async (createNormalizer) => {
      const def = seed();
      const normalizer = createNormalizer();
      if (normalizer.kind !== 'script' && normalizer.kind !== 'subloop') throw new Error('fixture');
      normalizer.id = 'owner-supplied-name';
      const before = structuredClone(def);
      const originalNormalizer = structuredClone(normalizer);
      const enabled = enableChatAudio(def, normalizer);
      expect(def).toEqual(before);
      expect(normalizer).toEqual(originalNormalizer);
      expect(systemChatIssues(enabled)).toEqual([]);
      expect(validateLoop(enabled)).toEqual([]);
      const respond = enabled.nodes.find((node) => node.id === 'respond')!;
      if (respond.kind !== 'inference') throw new Error('fixture');
      expect(respond.config.prompt.template).toBe(
        normalizer.kind === 'script' ? SYSTEM_CHAT_SCRIPT_PROMPT : SYSTEM_CHAT_SUBLOOP_PROMPT,
      );
      const value =
        normalizer.kind === 'script'
          ? { text: 'Actual normalized text' }
          : { status: 'succeeded', result: { text: 'Actual normalized text' } };
      const rendered = await renderTemplate(respond.config.prompt.template, {
        trigger: { payload: { input: { text: 'raw ignored' }, history: [] } },
        outputs: { 'chat-normalize': { value } },
      });
      expect(rendered).toContain('user: Actual normalized text');
      expect(rendered).not.toContain('raw ignored');
      const enabledBefore = structuredClone(enabled);
      const disabled = disableChatAudio(enabled);
      expect(enabled).toEqual(enabledBefore);
      expect(disabled).toEqual({
        ...before,
        edges: [
          before.edges[1],
          {
            id: 'chat-text-continuation',
            from: { node: 'chat-input', port: 'out' },
            to: { node: 'respond', port: 'in' },
          },
        ],
      });
      expect(systemChatIssues(disabled)).toEqual([]);
    },
  );

  it('preserves arbitrary authored prompts, incomplete ordinary interiors and the selected successor', () => {
    const def = seed();
    const respond = def.nodes.find((node) => node.id === 'respond')!;
    if (respond.kind !== 'inference') throw new Error('fixture');
    respond.config.prompt.template = 'Owner content {{ vars.topic }}';
    const exit = def.nodes.find((node) => node.kind === 'exit')!;
    exit.config.returns = 'none';
    expect(systemChatIssues(def).length).toBeGreaterThan(0);
    expect(systemChatLockedIssues(def)).toEqual([]);
    const normalizer = script();
    if (normalizer.kind !== 'script') throw new Error('fixture');
    const enabled = enableChatAudio(def, normalizer);
    expect(enabled.nodes.find((node) => node.id === 'respond')).toEqual(respond);
    expect(disableChatAudio(enabled)).toEqual({
      ...def,
      edges: [
        def.edges[1],
        {
          id: 'chat-text-continuation',
          from: { node: 'chat-input', port: 'out' },
          to: { node: 'respond', port: 'in' },
        },
      ],
    });
    const mismatched = audioDefinition(subloop());
    const mismatchedRespond = mismatched.nodes.find((node) => node.id === 'respond')!;
    if (mismatchedRespond.kind !== 'inference') throw new Error('fixture');
    mismatchedRespond.config.prompt.template = SYSTEM_CHAT_SCRIPT_PROMPT;
    const disabled = disableChatAudio(mismatched);
    const restored = disabled.nodes.find((node) => node.id === 'respond')!;
    if (restored.kind !== 'inference') throw new Error('fixture');
    expect(restored.config.prompt.template).toBe(SYSTEM_CHAT_TEXT_PROMPT);
    expect(SYSTEM_CHAT_TEXT_PROMPT).not.toBe(SYSTEM_CHAT_SCRIPT_PROMPT);
  });

  it('refuses ambiguous topology, invalid normalizers and reserved collisions without mutation', () => {
    for (const edit of [
      (def: LoopDefinition) => {
        delete def.variables['chatResponse'];
      },
      (def: LoopDefinition) => {
        def.edges = [];
      },
      (def: LoopDefinition) => {
        def.edges[0]!.from.port = 'other';
      },
      (def: LoopDefinition) => {
        def.edges[0]!.to.node = 'missing';
      },
      (def: LoopDefinition) => {
        def.edges.push({
          id: 'extra',
          from: { node: 'chat-input', port: 'out' },
          to: { node: 'chat-return', port: 'in' },
        });
      },
      (def: LoopDefinition) => {
        def.edges.push({
          id: 'cycle',
          from: { node: 'respond', port: 'out' },
          to: { node: 'chat-input', port: 'in' },
        });
      },
      (def: LoopDefinition) => {
        def.edges[1]!.id = 'chat-normalize-checked';
      },
      (def: LoopDefinition) => {
        const trigger = def.nodes[0]!;
        if (trigger.kind === 'trigger' && trigger.config.type === 'manual')
          trigger.config.inputSchema = structuredClone(ChatAudioInputJsonSchema);
      },
      ...['chat-normalize', 'chat-normalize-check', 'chat-normalize-invalid'].map(
        (id) => (def: LoopDefinition) => {
          const node = script();
          node.id = id;
          def.nodes.push(node);
        },
      ),
    ]) {
      const def = seed();
      edit(def);
      const before = structuredClone(def);
      const normalizer = script();
      if (normalizer.kind !== 'script') throw new Error('fixture');
      expect(() => enableChatAudio(def, normalizer)).toThrow(
        expect.objectContaining({ code: 'SYSTEM_CHAT_CONTRACT_INVALID' }),
      );
      expect(def).toEqual(before);
    }
    for (const invalid of ['', 'bad-policy']) {
      const normalizer = script();
      if (normalizer.kind !== 'script') throw new Error('fixture');
      if (invalid === '') normalizer.config.command = '';
      else normalizer.config.stdin = 'none';
      expect(() => enableChatAudio(seed(), normalizer)).toThrow(
        expect.objectContaining({ code: 'SYSTEM_CHAT_CONTRACT_INVALID' }),
      );
    }
    const wrong = NodeSchema.parse({
      id: 'wrong',
      kind: 'wait',
      label: 'Wrong',
      config: { mode: 'duration', seconds: 1 },
    });
    // @ts-expect-error Runtime callers also cannot insert another node kind as a normalizer.
    expect(() => enableChatAudio(seed(), wrong)).toThrow(
      expect.objectContaining({ code: 'SYSTEM_CHAT_CONTRACT_INVALID' }),
    );
    const oversized = seed();
    for (let index = 0; index < 495; index++) {
      const node = script();
      node.id = `extra${index}`;
      oversized.nodes.push(node);
    }
    const normalizer = script();
    if (normalizer.kind !== 'script') throw new Error('fixture');
    expect(() => enableChatAudio(oversized, normalizer)).toThrow(
      expect.objectContaining({ code: 'SYSTEM_CHAT_CONTRACT_INVALID' }),
    );
  });

  it('returns an independent unchanged clone when audio is already fully off', () => {
    const def = seed();
    const disabled = disableChatAudio(def);
    expect(disabled).toEqual(def);
    expect(disabled).not.toBe(def);
    expect(disabled.nodes).not.toBe(def.nodes);
  });

  it('repairs partial reserved nodes and wiring using only one valid continuation', () => {
    for (const edit of [
      ...['chat-normalize', 'chat-normalize-check', 'chat-normalize-invalid'].map(
        (id) => (def: LoopDefinition) => {
          def.nodes = def.nodes.filter((node) => node.id !== id);
        },
      ),
      (def: LoopDefinition) => {
        def.edges = def.edges.filter((edge) => edge.id !== 'chat-normalize-checked');
      },
      (def: LoopDefinition) => {
        def.edges.push({
          id: 'extra-start',
          from: { node: 'chat-input', port: 'out' },
          to: { node: 'chat-return', port: 'in' },
        });
      },
      (def: LoopDefinition) => {
        const trigger = def.nodes[0]!;
        if (trigger.kind === 'trigger' && trigger.config.type === 'manual')
          trigger.config.inputSchema = structuredClone(ChatTextInputJsonSchema);
      },
    ]) {
      const def = audioDefinition();
      edit(def);
      const before = structuredClone(def);
      const disabled = disableChatAudio(def);
      expect(def).toEqual(before);
      expect(disabled.nodes.map((node) => node.id)).toEqual([
        'chat-input',
        'respond',
        'chat-return',
      ]);
      expect(disabled.edges.filter((edge) => edge.from.node === 'chat-input')).toEqual([
        {
          id: 'chat-text-continuation',
          from: { node: 'chat-input', port: 'out' },
          to: { node: 'respond', port: 'in' },
        },
      ]);
      expect(systemChatIssues(disabled)).toEqual([]);
      const respond = disabled.nodes.find((node) => node.id === 'respond')!;
      if (respond.kind !== 'inference') throw new Error('fixture');
      expect(respond.config.prompt.template).toBe(SYSTEM_CHAT_TEXT_PROMPT);
    }
  });

  it('requires an explicit ordinary target for missing, ambiguous or invalid continuations', () => {
    for (const edit of [
      (def: LoopDefinition) => {
        def.edges = def.edges.filter((edge) => edge.id !== 'chat-normalize-valid');
      },
      (def: LoopDefinition) => {
        def.edges.push({
          id: 'other-valid',
          from: { node: 'chat-normalize-check', port: 'valid' },
          to: { node: 'chat-return', port: 'in' },
        });
      },
      ...[
        'chat-input',
        'chat-normalize',
        'chat-normalize-check',
        'chat-normalize-invalid',
        'unknown',
      ].map((node) => (def: LoopDefinition) => {
        def.edges.find((edge) => edge.id === 'chat-normalize-valid')!.to.node = node;
      }),
    ]) {
      const def = audioDefinition();
      edit(def);
      const before = structuredClone(def);
      expect(() => disableChatAudio(def)).toThrow(
        expect.objectContaining({ code: 'SYSTEM_CHAT_CONTINUATION_REQUIRED' }),
      );
      expect(def).toEqual(before);
      const disabled = disableChatAudio(def, { continuationNodeId: 'chat-return' });
      expect(disabled.edges.filter((edge) => edge.from.node === 'chat-input')).toEqual([
        {
          id: 'chat-text-continuation',
          from: { node: 'chat-input', port: 'out' },
          to: { node: 'chat-return', port: 'in' },
        },
      ]);
      expect(disabled.nodes.map((node) => node.id)).toEqual([
        'chat-input',
        'respond',
        'chat-return',
      ]);
    }
    for (const continuationNodeId of [
      'unknown',
      'chat-input',
      'chat-normalize',
      'chat-normalize-check',
      'chat-normalize-invalid',
    ])
      expect(() => disableChatAudio(audioDefinition(), { continuationNodeId })).toThrow(
        expect.objectContaining({ code: 'SYSTEM_CHAT_CONTINUATION_REQUIRED' }),
      );
  });

  it('preserves ordinary nodes and edges and chooses a deterministic unused edge id', () => {
    const def = audioDefinition();
    const respond = def.nodes.find((node) => node.id === 'respond')!;
    if (respond.kind !== 'inference') throw new Error('fixture');
    respond.config.prompt.template = 'Custom {{ vars.authored }}';
    const ordinary = script();
    ordinary.id = 'authored-action';
    def.nodes.push(ordinary);
    def.edges.push(
      {
        id: 'chat-text-continuation',
        from: { node: 'respond', port: 'out' },
        to: { node: 'authored-action', port: 'in' },
      },
      {
        id: 'chat-text-continuation-2',
        from: { node: 'authored-action', port: 'out' },
        to: { node: 'chat-return', port: 'in' },
      },
    );
    const disabled = disableChatAudio(def);
    expect(disabled.nodes.find((node) => node.id === 'authored-action')).toEqual(ordinary);
    expect(disabled.nodes.find((node) => node.id === 'respond')).toEqual(respond);
    expect(disabled.edges.filter((edge) => edge.from.node !== 'chat-input')).toEqual(
      def.edges.filter((edge) => ['respond', 'authored-action'].includes(edge.from.node)),
    );
    expect(disabled.edges.find((edge) => edge.from.node === 'chat-input')?.id).toBe(
      'chat-text-continuation-3',
    );
    expect(disableChatAudio(def)).toEqual(disabled);
    const invalid = audioDefinition();
    delete invalid.variables['chatResponse'];
    const before = structuredClone(invalid);
    expect(() => disableChatAudio(invalid, { continuationNodeId: 'respond' })).toThrow(
      expect.objectContaining({ code: 'SYSTEM_CHAT_CONTRACT_INVALID' }),
    );
    expect(invalid).toEqual(before);
    const duplicateBoundary = audioDefinition();
    const ordinaryWithReservedId = script();
    ordinaryWithReservedId.id = 'chat-input';
    duplicateBoundary.nodes.unshift(ordinaryWithReservedId);
    expect(() => disableChatAudio(duplicateBoundary, { continuationNodeId: 'respond' })).toThrow(
      expect.objectContaining({ code: 'SYSTEM_CHAT_CONTRACT_INVALID' }),
    );
  });

  it('repairs orphaned reserved edges and refuses an edit exceeding definition limits', () => {
    const partial = seed();
    partial.edges.push({
      id: 'orphan-valid',
      from: { node: 'chat-normalize-check', port: 'valid' },
      to: { node: 'respond', port: 'in' },
    });
    const repaired = disableChatAudio(partial);
    expect(systemChatIssues(repaired)).toEqual([]);
    expect(repaired.nodes).toEqual(seed().nodes);
    const crowded = seed();
    const trigger = crowded.nodes[0]!;
    if (trigger.kind !== 'trigger' || trigger.config.type !== 'manual') throw new Error('fixture');
    trigger.config.inputSchema = structuredClone(ChatAudioInputJsonSchema);
    crowded.edges = Array.from({ length: 2000 }, (_, index) => ({
      id: `edge${index}`,
      from: { node: 'respond', port: 'out' },
      to: { node: 'chat-return', port: 'in' as const },
    }));
    expect(() => disableChatAudio(crowded, { continuationNodeId: 'respond' })).toThrow(
      expect.objectContaining({ code: 'SYSTEM_CHAT_CONTRACT_INVALID' }),
    );
    expect(crowded.edges).toHaveLength(2000);
  });
});
