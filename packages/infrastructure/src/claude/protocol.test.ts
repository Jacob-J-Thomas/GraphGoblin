import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HarnessOptionsSchema } from '@graphgoblin/contracts';
import { claudePolicy } from './policy.js';
import { CLAUDE_RECOVERY_HINT } from './errors.js';
import {
  ClaudeAccumulator,
  JsonLines,
  authCategory,
  verifyInstalledCapabilities,
} from './protocol.js';
const id = '11111111-1111-4111-8111-111111111111';
const policy = claudePolicy(
  HarnessOptionsSchema.parse({ sandbox: 'read-only' }),
  undefined,
  'win32',
);
const init = (extra: Record<string, unknown> = {}) => ({
  type: 'system',
  subtype: 'init',
  session_id: id,
  tools: ['Glob', 'Grep', 'Read'],
  permissionMode: 'dontAsk',
  model: 'claude-opus-5-5',
  apiKeySource: 'none',
  mcp_servers: [],
  plugins: [
    { name: 'cc-plugin-agents-md', path: 'builtin', source: 'cc-plugin-agents-md@builtin' },
  ],
  skills: ['verify'],
  ...extra,
});
const result = (extra: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: id,
  result: 'finished',
  usage: {
    input_tokens: 2,
    cache_creation_input_tokens: 3,
    cache_read_input_tokens: 5,
    output_tokens: 7,
  },
  modelUsage: { 'claude-opus-5-5': {} },
  ...extra,
});
const accumulator = (schema?: Record<string, unknown>, resumeId?: string) =>
  new ClaudeAccumulator({
    policy,
    model: 'claude-opus-5-5',
    mode: resumeId ? 'resumed' : 'fresh',
    ...(schema ? { schema } : {}),
    ...(resumeId ? { resumeId } : {}),
  });
// Derived from the exact restricted adapter environment capture. Identities, host paths,
// timestamp and account rate-limit values are synthetic; every original field is retained.
const capturedRecords = () => {
  const parser = new JsonLines();
  return [
    ...parser.push(readFileSync(new URL('./fixtures/cli-2.1.287.jsonl', import.meta.url))),
    ...parser.finish(),
  ];
};
describe('strict Claude auth/capability parsing', () => {
  it('retains only the accepted auth category', () => {
    expect(
      authCategory(
        JSON.stringify({ authMethod: 'claude.ai', email: 'PRIVATE', organizationId: 'PRIVATE' }),
      ),
    ).toBe('claude.ai');
    for (const method of [
      'api_key',
      'api_key_helper',
      'oauth_token',
      'third_party',
      'none',
      'unknown',
    ])
      expect(authCategory(JSON.stringify({ authMethod: method }))).toBeNull();
    for (const value of ['bad', 'null', '{}', '[]']) expect(authCategory(value)).toBeNull();
  });
  it('requires the minimum installed version and every policy flag', () => {
    const flags = [
      '--safe-mode',
      '--restricted',
      '--setting-sources',
      '--strict-mcp-config',
      '--tools',
      '--allowedTools',
      '--permission-mode',
      '--permission-prompts',
      '--effort',
      '--json-schema',
      '--output-format',
      '--input-format',
      '--model',
      '--verbose',
      '--print',
      '--no-session-persistence',
      '--resume',
    ];
    expect(verifyInstalledCapabilities('2.1.285 (Claude Code)', flags.join(' '))).toBe('2.1.285');
    expect(
      verifyInstalledCapabilities(
        '2.1.285 (Claude Code)',
        flags
          .map((flag) => (flag === '--allowedTools' ? '--allowedTools, --allowed-tools' : flag))
          .join(' '),
      ),
    ).toBe('2.1.285');
    for (const version of ['2.1.286', '2.1.287', '2.2.0', '3.0.0'])
      expect(verifyInstalledCapabilities(version + ' (Claude Code)', flags.join(' '))).toBe(
        version,
      );
    for (const version of ['1.9.999', '2.0.999', '2.1.284'])
      expect(() => verifyInstalledCapabilities(version, flags.join(' '))).toThrow(
        new RegExp(`${version.replaceAll('.', '\\.')}.*minimum version 2\\.1\\.285`),
      );
    for (const text of ['PRIVATE', '2.1', '2.1.287-beta', '9999999.1.1'])
      expect(() => verifyInstalledCapabilities(text, flags.join(' '))).toThrow(
        /version unknown.*version identification/,
      );
    for (const removed of flags)
      expect(() =>
        verifyInstalledCapabilities(
          '2.1.285 (Claude Code)',
          flags.filter((flag) => flag !== removed).join(' '),
        ),
      ).toThrow(new RegExp(`2\\.1\\.285.*capabilities unavailable: ${removed}`));
  });
});
describe('bounded JSONL parser', () => {
  it('handles byte-split UTF8, CRLF, empty lines and a valid trailing partial line', () => {
    const parser = new JsonLines();
    const bytes = Buffer.from(
      JSON.stringify({ text: '雪' }) + '\r\n\n' + JSON.stringify({ done: true }),
    );
    const parsed: unknown[] = [];
    for (const byte of bytes) parsed.push(...parser.push(Buffer.from([byte])));
    parsed.push(...parser.finish());
    expect(parsed).toEqual([{ text: '雪' }, { done: true }]);
  });
  it('rejects malformed JSON, nonobjects, excess line bytes, and bad final partial data safely', () => {
    for (const line of ['bad\n', 'null\n', '[]\n'])
      expect(() => new JsonLines().push(Buffer.from(line))).toThrow(/protocol/);
    expect(() => new JsonLines(8).push(Buffer.from('{"text":"too-long"}'))).toThrow(/limit/);
    const parser = new JsonLines();
    parser.push(Buffer.from('{'));
    expect(() => parser.finish()).toThrow(/protocol/);
  });
});
describe('Claude stream contract and honest execution evidence', () => {
  it('accepts verified init before session evidence and maps only safe content/usage fields', () => {
    const acc = accumulator();
    expect(acc.push(init())).toEqual([
      { type: 'session', sessionId: id, mode: 'fresh' },
      {
        type: 'item',
        item: expect.objectContaining({
          type: 'other',
          summary: expect.stringContaining('Claude account login'),
          detail: expect.objectContaining({
            inputTransport: 'text',
            promptDeliveryProof: 'unsupported',
          }),
        }),
      },
    ]);
    const events = acc.push({
      type: 'assistant',
      message: {
        id: 'message',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'thinking', thinking: 'reasoning' },
          {
            type: 'tool_use',
            id: 'read1',
            name: 'Read',
            input: { file_path: 'CANARY.txt', secret: 'PRIVATE' },
          },
        ],
      },
    });
    expect(events.map((event) => event.type)).toEqual(['item', 'item', 'item']);
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
    acc.push({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'read1',
            is_error: false,
            content: 'synthetic output',
          },
        ],
      },
    });
    expect(acc.push(result()).map((event) => event.type)).toEqual(['usage', 'turn-complete']);
    expect(acc.finish()).toMatchObject({
      finalText: 'finished',
      usage: { inputTokens: 10, outputTokens: 7, cachedInputTokens: 5, reasoningOutputTokens: 0 },
      items: expect.arrayContaining([
        expect.objectContaining({
          id: 'claude-policy',
          detail: expect.objectContaining({
            inputTransport: 'text',
            promptDeliveryProof: 'unsupported',
          }),
        }),
      ]),
    });
  });
  it('checks exact model, tool set, dontAsk, auth source and MCP before announcing a session', () => {
    for (const changed of [
      { model: 'opus' },
      { tools: ['Read', 'Bash', 'Grep'] },
      { tools: ['Read', 'Read', 'Grep'] },
      { permissionMode: 'bypassPermissions' },
      { apiKeySource: 'api_key' },
      { mcp_servers: [{ name: 'hostile', status: 'connected' }] },
      { skills: ['hostile-canary'] },
      { plugins: [{ name: 'project-plugin' }] },
      { session_id: 'bad' },
    ])
      expect(() => accumulator().push(init(changed))).toThrow(
        expect.objectContaining({
          code: changed.session_id ? 'HARNESS_PROTOCOL_ERROR' : 'HARNESS_UNSUPPORTED_POLICY',
        }),
      );
  });
  it('rejects out-of-order, duplicate init/result, unexpected tools and mismatched sessions', () => {
    expect(() => accumulator().push(result())).toThrow(/protocol/);
    const acc = accumulator();
    acc.push(init());
    expect(() => acc.push(init())).toThrow(/protocol/);
    const tools = accumulator();
    tools.push(init());
    expect(() =>
      tools.push({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'bad', name: 'Bash', input: { command: 'secret' } }],
        },
      }),
    ).toThrow(/unavailable tool/);
    const resumed = accumulator(undefined, id);
    expect(() =>
      resumed.push(init({ session_id: '22222222-2222-4222-8222-222222222222' })),
    ).toThrow(/session/);
    const mismatch = accumulator();
    mismatch.push(init());
    expect(() => mismatch.push(result({ session_id: 'other' }))).toThrow(/session/);
    const duplicate = accumulator();
    duplicate.push(init());
    duplicate.push(result());
    expect(() => duplicate.push(result())).toThrow(/protocol/);
    expect(() => accumulator().finish()).toThrow(/protocol/);
  });
  it('requires a successful final result and exact actual model usage; unknown failures contain no raw body', () => {
    for (const changed of [
      { is_error: true, subtype: 'error_during_execution', errors: ['TOKEN_PRIVATE'] },
      { modelUsage: { 'claude-sonnet-5': {} } },
      { usage: { input_tokens: -1 } },
      { result: 1 },
    ]) {
      const acc = accumulator();
      acc.push(init());
      try {
        acc.push(result(changed));
        expect.fail('expected failure');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(String(error)).not.toContain('TOKEN_PRIVATE');
      }
    }
  });
  it('returns native structured candidates for engine validation and never substitutes fallback final text', () => {
    const schema = {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    };
    const acc = accumulator(schema);
    acc.push(init({ tools: [...policy.tools, 'StructuredOutput'] }));
    acc.push(result({ structured_output: { ok: true } }));
    expect(acc.finish().structured).toEqual({ ok: true });
    for (const changed of [
      { result: '{"ok":true}' },
      { structured_output: { ok: 'wrong' } },
      { structured_output: { ok: true, extra: 'PRIVATE' } },
    ]) {
      const bad = accumulator(schema);
      bad.push(init({ tools: [...policy.tools, 'StructuredOutput'] }));
      bad.push(result(changed));
      expect(bad.finish()).toHaveProperty(
        'structured',
        'structured_output' in changed ? changed.structured_output : undefined,
      );
    }
  });
  it('retains benign metadata advertising verified built-ins, never claims all built-ins removed', () => {
    const acc = accumulator();
    acc.push(init());
    expect(acc.finish.bind(acc)).toThrow();
    expect(acc.policyEvidence).toMatchObject({
      authMethod: 'claude.ai',
      advertisedPluginCount: 1,
      advertisedSkillCount: 1,
      boundary: 'builtin-tools',
    });
  });
});

describe('conditional native structured-output carrier', () => {
  const schema = {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  };
  const schemaInit = (extra: Record<string, unknown> = {}) =>
    init({ tools: [...policy.tools, 'StructuredOutput'], ...extra });
  const carrier = (input: unknown = { ok: true }, toolId = 'schema1') => ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: toolId, name: 'StructuredOutput', input }] },
  });
  const settlement = (marker: Record<string, unknown> = {}, toolId = 'schema1') => ({
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: toolId, content: 'PRIVATE_RESULT', ...marker }],
    },
  });
  it.each([
    { marker: {}, status: 'ok' },
    { marker: { is_error: false }, status: 'ok' },
    { marker: { is_error: true }, status: 'failed' },
  ])(
    'records the requested schema carrier separately with $status settlement',
    ({ marker, status }) => {
      const acc = accumulator(schema);
      const announced = acc.push(schemaInit());
      expect(announced).toContainEqual({ type: 'session', sessionId: id, mode: 'fresh' });
      expect(announced).toMatchObject([
        {},
        { item: { detail: { tools: policy.tools, structuredOutputCarrier: 'StructuredOutput' } } },
      ]);
      expect(acc.policyEvidence.tools).toEqual(['Read', 'Glob', 'Grep']);
      const progress = acc.push(
        carrier({ ok: 'invalid candidate', file_path: 'PRIVATE_FILE', command: 'PRIVATE_COMMAND' }),
      );
      expect(progress).toEqual([
        {
          type: 'item',
          item: {
            id: 'schema1',
            type: 'other',
            summary: 'Claude structured output',
            status: 'running',
            detail: { carrier: 'StructuredOutput', kind: 'schema-output' },
          },
        },
      ]);
      const settled = acc.push(settlement(marker));
      expect(settled).toEqual([
        {
          type: 'item',
          item: {
            id: 'schema1',
            type: 'other',
            summary:
              status === 'failed'
                ? 'Claude structured output failed'
                : 'Claude structured output completed',
            status,
            detail: { carrier: 'StructuredOutput', kind: 'schema-output' },
          },
        },
      ]);
      acc.push(result({ structured_output: { ok: true } }));
      expect(acc.finish().structured).toEqual({ ok: true });
      expect(
        acc
          .finish()
          .items.filter((item) => item.id === 'schema1')
          .map((item) => item.status),
      ).toEqual(['running', status]);
      expect(JSON.stringify(acc.finish().items)).not.toContain('PRIVATE');
    },
  );
  it('rejects missing, duplicate, and extra init tools before announcing a schema session', () => {
    for (const tools of [
      policy.tools,
      [...policy.tools, 'StructuredOutput', 'StructuredOutput'],
      [...policy.tools, 'StructuredOutput', 'Bash'],
      [...policy.tools, 'OtherOutput'],
    ]) {
      const acc = accumulator(schema);
      expect(() => acc.push(schemaInit({ tools }))).toThrow(
        expect.objectContaining({ code: 'HARNESS_UNSUPPORTED_POLICY' }),
      );
      expect(() => acc.policyEvidence).toThrow();
      expect(() => acc.finish()).toThrow();
    }
  });
  it('rejects carrier advertisement/use without a requested schema and preserves ordinary execution tools', () => {
    expect(() => accumulator().push(schemaInit())).toThrow(
      expect.objectContaining({ code: 'HARNESS_UNSUPPORTED_POLICY' }),
    );
    const acc = accumulator();
    expect(acc.push(init())).toMatchObject([
      {},
      { item: { detail: { tools: policy.tools, structuredOutputCarrier: null } } },
    ]);
    expect(() => acc.push(carrier())).toThrow(
      expect.objectContaining({ code: 'HARNESS_UNSUPPORTED_POLICY' }),
    );
    const structured = accumulator(schema);
    structured.push(schemaInit());
    for (const name of ['Bash', 'Write', 'OtherOutput'])
      expect(() =>
        structured.push({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id: name, name, input: {} }] },
        }),
      ).toThrow(expect.objectContaining({ code: 'HARNESS_UNSUPPORTED_POLICY' }));
  });
  it('requires well-formed carrier IDs, object inputs, and matching result correlation', () => {
    for (const input of [null, [], 'PRIVATE_INPUT']) {
      const acc = accumulator(schema);
      acc.push(schemaInit());
      expect(() => acc.push(carrier(input))).toThrow(
        expect.objectContaining({ code: 'HARNESS_PROTOCOL_ERROR' }),
      );
    }
    const acc = accumulator(schema);
    acc.push(schemaInit());
    expect(() => acc.push(carrier({}, ''))).toThrow(
      expect.objectContaining({ code: 'HARNESS_PROTOCOL_ERROR' }),
    );
    acc.push(carrier());
    expect(() => acc.push(carrier())).toThrow(
      expect.objectContaining({ code: 'HARNESS_PROTOCOL_ERROR' }),
    );
    expect(() => acc.push(settlement({}, 'unmatched'))).toThrow(
      expect.objectContaining({ code: 'HARNESS_PROTOCOL_ERROR' }),
    );
    expect(() => acc.push(result({ structured_output: { ok: true } }))).toThrow(
      expect.objectContaining({ code: 'HARNESS_PROTOCOL_ERROR' }),
    );
    expect(() => acc.push(settlement({ is_error: 'PRIVATE_MARKER' }))).toThrow(
      expect.objectContaining({ code: 'HARNESS_PROTOCOL_ERROR' }),
    );
    acc.push(settlement());
    expect(() => acc.push(settlement())).toThrow(
      expect.objectContaining({ code: 'HARNESS_PROTOCOL_ERROR' }),
    );
    acc.push(result({ structured_output: { ok: true } }));
    expect(JSON.stringify(acc.finish().items)).not.toContain('PRIVATE');
  });
  it.each([{ ok: 'wrong' }, null, undefined])(
    'leaves final native candidate %j to engine validation without carrier fallback',
    (candidate) => {
      const acc = accumulator(schema);
      acc.push(schemaInit());
      acc.push(carrier({ ok: true }));
      acc.push(settlement());
      acc.push(
        result(
          candidate === undefined ? { result: '{"ok":true}' } : { structured_output: candidate },
        ),
      );
      expect(acc.finish()).toHaveProperty('structured', candidate);
    },
  );
});
describe('Claude transcript and error evidence limits', () => {
  it.each([
    { marker: {}, expected: 'ok' },
    { marker: { is_error: false }, expected: 'ok' },
    { marker: { is_error: true }, expected: 'failed' },
  ])('maps the valid tool-result marker $marker to $expected evidence', ({ marker, expected }) => {
    const acc = accumulator();
    acc.push(init());
    acc.push({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'read-marker', name: 'Read', input: {} }] },
    });
    const output = expected === 'failed' ? 'PRIVATE_ERROR_BODY' : 'safe tool output';
    const events = acc.push({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'read-marker', content: output, ...marker }],
      },
    });
    expect(events).toMatchObject([
      {
        type: 'item',
        item: {
          id: 'read-marker',
          type: 'tool-call',
          status: expected,
          summary: expected === 'failed' ? 'Read failed' : 'Read completed',
        },
      },
    ]);
    acc.push(result());
    const completed = acc.finish();
    expect(
      completed.items.filter((item) => item.id === 'read-marker').map((item) => item.status),
    ).toEqual(['running', expected]);
    if (expected === 'failed') {
      expect(JSON.stringify(events)).not.toContain('PRIVATE_ERROR_BODY');
      expect(JSON.stringify(completed)).not.toContain('PRIVATE_ERROR_BODY');
    } else expect(events).toMatchObject([{ item: { detail: { output } } }]);
  });

  it.each([
    { marker: 'true' },
    { marker: 'false' },
    { marker: null },
    { marker: 0 },
    { marker: 1 },
    { marker: { marker: 'PRIVATE_MARKER' } },
    { marker: ['PRIVATE_MARKER'] },
  ])(
    'refuses non-boolean tool-result is_error $marker without success evidence or private diagnostics',
    ({ marker }) => {
      const acc = accumulator();
      acc.push(init());
      acc.push({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'read-marker', name: 'Read', input: {} }] },
      });
      const [malformed] = new JsonLines().push(
        Buffer.from(
          JSON.stringify({
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'read-marker',
                  is_error: marker,
                  content: 'PRIVATE_TOOL_BODY',
                },
              ],
            },
          }) + '\n',
        ),
      );
      let emitted: ReturnType<ClaudeAccumulator['push']> = [];
      let refusal: unknown;
      try {
        emitted = acc.push(malformed!);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toMatchObject({
        code: 'HARNESS_PROTOCOL_ERROR',
        retriable: false,
        message: `Claude stream protocol is invalid or incomplete. ${CLAUDE_RECOVERY_HINT}`,
      });
      expect(String(refusal)).not.toContain('PRIVATE');
      expect(emitted).toEqual([]);
      expect(() => acc.push(result())).toThrow(
        expect.objectContaining({ code: 'HARNESS_PROTOCOL_ERROR' }),
      );
      expect(() => acc.finish()).toThrow(
        expect.objectContaining({ code: 'HARNESS_PROTOCOL_ERROR' }),
      );
      // Inspect bookkeeping after refusal only; the production harness aborts when push throws.
      // A malformed marker cannot settle a call or insert a false successful transcript item.
      acc.push({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'read-marker',
              is_error: false,
              content: 'valid replacement',
            },
          ],
        },
      });
      acc.push(result());
      const completed = acc.finish();
      expect(
        completed.items.filter((item) => item.id === 'read-marker').map((item) => item.status),
      ).toEqual(['running', 'ok']);
      expect(JSON.stringify(completed)).not.toContain('PRIVATE');
    },
  );

  it('allows non-execution status metadata after init and safely ignores unknown content block kinds', () => {
    const acc = accumulator();
    expect(() => acc.policyEvidence).toThrow();
    acc.push(init());
    expect(acc.push({ type: 'system', subtype: 'status', status: 'compacting' })).toEqual([]);
    expect(
      acc.push({
        type: 'assistant',
        message: { content: [{ type: 'unknown', secret: 'PRIVATE' }] },
      }),
    ).toEqual([]);
    expect(() => acc.push({ type: 'system', subtype: 'hook_started' })).toThrow(/hooks/);
  });
  it('rejects malformed content and tool correlations before accepting evidence', () => {
    for (const record of [
      { type: 'assistant' },
      { type: 'assistant', message: { content: [null] } },
      { type: 'user' },
      { type: 'user', message: { content: [null] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 1 }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'read', name: 'Read' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'missing' }] } },
    ]) {
      const acc = accumulator();
      acc.push(init());
      expect(() => acc.push(record)).toThrow(/protocol/);
    }
    const duplicate = accumulator();
    duplicate.push(init());
    const tool = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'same', name: 'Read', input: {} }] },
    };
    duplicate.push(tool);
    expect(() => duplicate.push(tool)).toThrow(/protocol/);
  });
  it('maps actual full-access command/file events with bounded detail and no invented exit code', () => {
    const full = claudePolicy(
      HarnessOptionsSchema.parse({ sandbox: 'danger-full-access' }),
      undefined,
      'win32',
    );
    const acc = new ClaudeAccumulator({ policy: full, model: 'claude-opus-5-5', mode: 'fresh' });
    acc.push(init({ tools: [...full.tools], plugins: [], skills: [] }));
    const events = acc.push({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'bash',
            name: 'Bash',
            input: { command: 'echo ' + 'x'.repeat(1000) },
          },
          {
            type: 'tool_use',
            id: 'write',
            name: 'Write',
            input: { file_path: 'output.txt', content: 'PRIVATE' },
          },
        ],
      },
    });
    expect(events).toMatchObject([
      { type: 'item', item: { type: 'command', commandPreview: expect.any(String) } },
      { type: 'item', item: { type: 'file-change' } },
    ]);
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
    const ended = acc.push({
      type: 'user',
      message: {
        content: [
          { type: 'text', text: 'ignored' },
          { type: 'tool_result', tool_use_id: 'bash', is_error: false, content: 'x'.repeat(20000) },
          { type: 'tool_result', tool_use_id: 'write', is_error: true, content: 'PRIVATE_ERROR' },
        ],
      },
    });
    expect(ended).toMatchObject([
      { type: 'item', item: { status: 'ok' } },
      { type: 'item', item: { status: 'failed' } },
    ]);
    expect(JSON.stringify(ended)).not.toContain('PRIVATE_ERROR');
    expect(JSON.stringify(ended)).not.toContain('exitCode');
  });
  it.each([
    { status: 401, code: 'HARNESS_NOT_AUTHENTICATED', retriable: false },
    { status: 403, code: 'HARNESS_NOT_AUTHENTICATED', retriable: false },
    { status: 429, code: 'HARNESS_QUOTA_EXHAUSTED', retriable: true },
    { status: 503, code: 'HARNESS_TURN_FAILED', retriable: true },
    { status: 400, code: 'HARNESS_TURN_FAILED', retriable: false },
  ])(
    'classifies known structured status $status without provider text',
    ({ code, retriable, status }) => {
      const acc = accumulator();
      acc.push(init());
      expect(() =>
        acc.push(
          result({
            is_error: true,
            subtype: 'error_during_execution',
            api_error_status: status,
            result: 'PRIVATE',
          }),
        ),
      ).toThrow(expect.objectContaining({ code, retriable }));
    },
  );
  it('rejects overlong lines, final text and transcript count without truncating final output silently', () => {
    expect(() => new JsonLines(8).push(Buffer.from('{"long":true}\n'))).toThrow(/limit/);
    const acc = accumulator();
    acc.push(init());
    expect(() => acc.push(result({ result: 'x'.repeat(512 * 1024 + 1) }))).toThrow(/limit/);
    const many = accumulator();
    many.push(init());
    for (let index = 0; index < 9999; index++)
      many.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } });
    expect(() =>
      many.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } }),
    ).toThrow(/item limit/);
  });
});

describe('Claude CLI 2.1.287 captured stream', () => {
  const metadata = (extra: Record<string, unknown> = {}) => ({
    type: 'system',
    subtype: 'ui_invalidate',
    event: 'ui.render',
    uuid: id,
    session_id: id,
    ...extra,
  });
  const otherId = '22222222-2222-4222-8222-222222222222';
  it('replays every captured record with exact result, model and aggregate usage', () => {
    const acc = accumulator();
    const records = capturedRecords();
    expect(records.map((record) => [record.type, record.subtype])).toEqual([
      ['system', 'ui_invalidate'],
      ['system', 'init'],
      ['assistant', undefined],
      ['rate_limit_event', undefined],
      ['result', 'success'],
    ]);
    expect(acc.push(records[0]!)).toEqual([]);
    expect(() => acc.policyEvidence).toThrow();
    expect(() => acc.finish()).toThrow();
    const announced = acc.push(records[1]!);
    expect(records[1]!.plugins).toEqual([
      { name: 'cc-plugin-agents-md', path: 'builtin', source: 'cc-plugin-agents-md@builtin' },
      {
        name: 'cc-plugin-plugin-authoring',
        path: 'builtin',
        source: 'cc-plugin-plugin-authoring@builtin',
      },
    ]);
    expect(announced).toMatchObject([
      { type: 'session', sessionId: id, mode: 'fresh' },
      { type: 'item', item: { detail: { requestedModel: 'claude-opus-5-5' } } },
    ]);
    expect(acc.push(records[2]!)).toMatchObject([
      { type: 'item', item: { type: 'message', summary: 'QA_OK' } },
    ]);
    expect(acc.push(records[3]!)).toEqual([]);
    expect(acc.push(records[4]!)).toMatchObject([{ type: 'usage' }, { type: 'turn-complete' }]);
    expect(acc.policyEvidence).toMatchObject({
      advertisedPluginCount: 2,
      advertisedSkillCount: 17,
    });
    expect(acc.finish()).toMatchObject({
      finalText: 'QA_OK',
      usage: {
        inputTokens: 4365,
        outputTokens: 7,
        cachedInputTokens: 2893,
        reasoningOutputTokens: 0,
      },
    });
    expect(acc.finish().items).toHaveLength(2);
    expect(JSON.stringify(acc.finish())).not.toMatch(/ui.render|rate_limit_info|req_synthetic/);
  });
  it('accepts bounded UI metadata before and after init without execution evidence', () => {
    const acc = accumulator();
    expect(acc.push(metadata({ event: 'x'.repeat(100) }))).toEqual([]);
    acc.push(init());
    expect(acc.push(metadata())).toEqual([]);
    acc.push(result());
    expect(acc.finish().items).toHaveLength(1);
    expect(JSON.stringify(acc.finish())).not.toContain('ui.render');
  });
  it.each([
    { event: undefined },
    { event: null },
    { event: 1 },
    { event: '' },
    { event: 'x'.repeat(101) },
    { uuid: 'bad' },
    { uuid: undefined },
    { session_id: 'bad' },
    { session_id: undefined },
  ])('refuses malformed UI metadata %j with safe record diagnostics', (extra) => {
    for (const initialized of [false, true]) {
      const acc = accumulator();
      if (initialized) acc.push(init());
      expect(() => acc.push(metadata({ ...extra, private: 'PRIVATE_BODY' }))).toThrow(
        expect.objectContaining({
          code: 'HARNESS_PROTOCOL_ERROR',
          message: expect.stringContaining(`record system/ui_invalidate). ${CLAUDE_RECOVERY_HINT}`),
        }),
      );
      expect(() => acc.finish()).toThrow();
    }
  });
  it('binds UI, command-cache and init metadata to the same session before and after init', () => {
    for (const first of [
      metadata(),
      { type: 'system', subtype: 'commands_changed', session_id: id, uuid: id, commands: [] },
      init(),
    ]) {
      const acc = accumulator();
      acc.push(first);
      expect(() => acc.push(metadata({ session_id: otherId }))).toThrow(
        expect.objectContaining({ code: 'HARNESS_PROTOCOL_ERROR' }),
      );
    }
    const acc = accumulator();
    acc.push(metadata());
    expect(() => acc.push(init({ session_id: otherId }))).toThrow(/record system\/init/);
    expect(() =>
      acc.push({
        type: 'system',
        subtype: 'commands_changed',
        session_id: otherId,
        uuid: id,
        commands: [],
      }),
    ).toThrow(/protocol/);
  });
  it.each([
    { plugins: [{ name: 'cc-plugin-hostile' }], name: 'cc-plugin-hostile', kind: 'plugin' },
    { skills: ['plugin-authoring-hostile'], name: 'plugin-authoring-hostile', kind: 'skill' },
    { tools: [...policy.tools, 'UnexpectedTool'], name: 'UnexpectedTool', kind: 'tool' },
  ])('names the unexpected $kind without exposing record bodies', ({ name, kind, ...extra }) => {
    const acc = accumulator();
    expect(() => acc.push(init({ ...extra, private: 'PRIVATE_BODY' }))).toThrow(
      expect.objectContaining({
        code: 'HARNESS_UNSUPPORTED_POLICY',
        message: `Claude advertised an unexpected ${kind}: ${name}. ${CLAUDE_RECOVERY_HINT}`,
      }),
    );
    expect(() => acc.policyEvidence).toThrow();
    expect(() => acc.finish()).toThrow();
  });
  it.each([
    { tools: null },
    { tools: [null] },
    { plugins: null },
    { plugins: [null] },
    { plugins: [{ name: null }] },
    { skills: null },
    { skills: [null] },
    { plugins: [{ name: 'unsafe\nPRIVATE_BODY' }] },
  ])('refuses malformed policy metadata %j without serializing it', (extra) => {
    expect(() => accumulator().push(init(extra))).toThrow(
      expect.objectContaining({
        code: 'HARNESS_UNSUPPORTED_POLICY',
        message: expect.not.stringContaining('PRIVATE_BODY'),
      }),
    );
  });
  it.each([
    { path: 'C:/Users/alice/private-plugin', source: 'cc-plugin-agents-md@builtin' },
    { path: 'builtin', source: 'alice@example.com' },
    { path: 'builtin', source: 'cc-plugin-plugin-authoring@builtin' },
    { path: undefined, source: 'cc-plugin-agents-md@builtin' },
    { path: 'builtin', source: undefined },
  ])('refuses an allowlisted plugin with unverified provenance %j', (provenance) => {
    const acc = accumulator();
    expect(() =>
      acc.push(init({ plugins: [{ name: 'cc-plugin-agents-md', ...provenance }] })),
    ).toThrow(
      expect.objectContaining({
        code: 'HARNESS_UNSUPPORTED_POLICY',
        message: `Claude advertised a plugin without built-in provenance: cc-plugin-agents-md. ${CLAUDE_RECOVERY_HINT}`,
      }),
    );
    expect(() => acc.policyEvidence).toThrow();
    expect(() => acc.finish()).toThrow();
  });
  it('names unknown pre-init records and redacts invalid record names', () => {
    for (const { record, identity } of [
      {
        record: { type: 'system', subtype: 'future_metadata', body: 'PRIVATE_BODY' },
        identity: 'system/future_metadata',
      },
      { record: { type: 'future_record', body: 'PRIVATE_BODY' }, identity: 'future_record' },
      {
        record: { type: 'bad\nPRIVATE_BODY', subtype: {}, body: 'PRIVATE_BODY' },
        identity: '<invalid>/<invalid>',
      },
    ]) {
      expect(() => accumulator().push(record)).toThrow(
        expect.objectContaining({
          code: 'HARNESS_PROTOCOL_ERROR',
          message: `Claude stream protocol is invalid or incomplete (record ${identity}). ${CLAUDE_RECOVERY_HINT}`,
        }),
      );
    }
  });
  it('ignores unknown post-init records without evidence, but refuses every record after result', () => {
    const records = [
      { type: 'system', subtype: 'future_metadata', body: 'PRIVATE_BODY' },
      { type: 'future_record', body: 'PRIVATE_BODY' },
      { type: 'rate_limit_event', body: 'PRIVATE_BODY' },
      { type: 'stream_event', body: 'PRIVATE_BODY' },
      { type: 'system', subtype: 'status', body: 'PRIVATE_BODY' },
    ];
    const acc = accumulator();
    acc.push(init());
    for (const record of records) expect(acc.push(record)).toEqual([]);
    acc.push(result());
    expect(acc.finish().items).toHaveLength(1);
    expect(JSON.stringify(acc.finish())).not.toContain('PRIVATE_BODY');
    for (const record of [...records, { type: 'system', subtype: 'hook_started' }])
      expect(() => acc.push(record)).toThrow(
        expect.objectContaining({ code: 'HARNESS_PROTOCOL_ERROR' }),
      );
  });
  it('keeps model, usage, native structured candidate and error checks despite new fields', () => {
    for (const extra of [
      { modelUsage: { 'claude-fable-5-1': {} } },
      { usage: { input_tokens: -1, output_tokens: 7 } },
      { usage: { input_tokens: 2, output_tokens: '7' } },
    ]) {
      const acc = accumulator();
      const records = capturedRecords();
      for (const record of records.slice(0, -1)) acc.push(record);
      expect(() => acc.push({ ...records[4], ...extra })).toThrow();
      expect(() => acc.finish()).toThrow();
    }
    const records = capturedRecords();
    const acc = accumulator({ type: 'object' });
    for (const record of records.slice(0, -1))
      acc.push(
        record.subtype === 'init'
          ? { ...record, tools: [...policy.tools, 'StructuredOutput'] }
          : record,
      );
    acc.push({ ...records[4], result: '{"ok":true}' });
    expect(acc.finish()).toHaveProperty('structured', undefined);
    const failed = accumulator();
    for (const record of records.slice(0, -1)) failed.push(record);
    expect(() =>
      failed.push({
        ...records[4],
        is_error: true,
        subtype: 'error_during_execution',
        api_error_status: 429,
        result: 'PRIVATE_BODY',
      }),
    ).toThrow(expect.objectContaining({ code: 'HARNESS_QUOTA_EXHAUSTED', retriable: true }));
    const assistantFailure = accumulator();
    assistantFailure.push(records[0]!);
    assistantFailure.push(records[1]!);
    expect(() => assistantFailure.push({ ...records[2], error: 'authentication_failed' })).toThrow(
      expect.objectContaining({ code: 'HARNESS_NOT_AUTHENTICATED' }),
    );
  });
});

describe('documented native assistant failure categories', () => {
  it.each([
    { category: 'authentication_failed', code: 'HARNESS_NOT_AUTHENTICATED', retriable: false },
    { category: 'rate_limit', code: 'HARNESS_QUOTA_EXHAUSTED', retriable: true },
    { category: 'server_error', code: 'HARNESS_TURN_FAILED', retriable: true },
    { category: 'billing_error', code: 'HARNESS_TURN_FAILED', retriable: false },
    { category: 'invalid_request', code: 'HARNESS_TURN_FAILED', retriable: false },
    { category: 'unknown', code: 'HARNESS_TURN_FAILED', retriable: false },
    { category: 'FUTURE_CATEGORY', code: 'HARNESS_TURN_FAILED', retriable: false },
  ])('maps $category before storing private error content', ({ category, code, retriable }) => {
    const acc = accumulator();
    acc.push(init());
    expect(() =>
      acc.push({
        type: 'assistant',
        error: category,
        message: { content: [{ type: 'text', text: 'PRIVATE_ERROR_BODY' }] },
      }),
    ).toThrow(expect.objectContaining({ code, retriable }));
  });
});

describe('documented command-cache bootstrap without execution evidence', () => {
  const metadata = (extra: Record<string, unknown> = {}) => ({
    type: 'system',
    subtype: 'commands_changed',
    session_id: id,
    uuid: id,
    commands: [
      { name: 'help', description: 'PRIVATE_DESCRIPTION', argumentHint: '', builtin: true },
    ],
    ...extra,
  });
  it('accepts explicitly built-in command metadata before/after init while withholding session/policy/result evidence', () => {
    const acc = accumulator();
    expect(acc.push(metadata())).toEqual([]);
    expect(() => acc.policyEvidence).toThrow();
    expect(() => acc.finish()).toThrow();
    expect(acc.push(init())).toContainEqual({ type: 'session', sessionId: id, mode: 'fresh' });
    expect(acc.push(metadata({ commands: [] }))).toEqual([]);
    acc.push(result());
    expect(JSON.stringify(acc.finish())).not.toContain('PRIVATE_DESCRIPTION');
  });
  it('refuses custom, missing-builtin and replaced command rows rather than trusting command names', () => {
    for (const builtin of [false, undefined])
      expect(() =>
        accumulator().push(
          metadata({ commands: [{ name: 'help', description: '', argumentHint: '', builtin }] }),
        ),
      ).toThrow(/customization/);
  });
  it('requires bounded valid metadata and matching stream identity', () => {
    for (const extra of [
      { uuid: 'bad' },
      { session_id: 'bad' },
      { commands: {} },
      { commands: [null] },
      { commands: [{ name: '', description: '', argumentHint: '', builtin: true }] },
      {
        commands: [
          { name: 'help', description: '', argumentHint: '', aliases: [1], builtin: true },
        ],
      },
    ])
      expect(() => accumulator().push(metadata(extra))).toThrow(/protocol/);
    const acc = accumulator();
    acc.push(metadata());
    expect(() => acc.push(init({ session_id: '22222222-2222-4222-8222-222222222222' }))).toThrow(
      /protocol/,
    );
    const other = accumulator();
    other.push(init());
    expect(() =>
      other.push(metadata({ session_id: '22222222-2222-4222-8222-222222222222' })),
    ).toThrow(/protocol/);
  });
  it('refuses hook/install execution before and after init, and keeps unknown bootstrap messages closed', () => {
    for (const subtype of ['hook_started', 'hook_response', 'hook_progress', 'plugin_install']) {
      expect(() => accumulator().push({ type: 'system', subtype })).toThrow(
        /hooks and plugin installation/,
      );
      const acc = accumulator();
      acc.push(init());
      expect(() => acc.push({ type: 'system', subtype })).toThrow(/hooks and plugin installation/);
    }
    expect(() => accumulator().push({ type: 'system', subtype: 'unknown' })).toThrow(/protocol/);
  });
  it('requires every observed tool call to settle before accepting final success', () => {
    const acc = accumulator();
    acc.push(init());
    acc.push({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'pending', name: 'Read', input: {} }] },
    });
    expect(() => acc.push(result())).toThrow(/protocol/);
  });
});
