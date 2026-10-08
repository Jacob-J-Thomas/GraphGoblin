import { StringDecoder } from 'node:string_decoder';
import type { Effort, JsonSchema, Usage } from '@graphgoblin/contracts';
import { COMMAND_PREVIEW_MAX } from '@graphgoblin/contracts';
import type { HarnessEvent, HarnessItem, HarnessResult } from '@graphgoblin/engine';
import { ClaudeHarnessError, protocolError } from './errors.js';
import type { ClaudePolicy } from './policy.js';
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const SESSION = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validClaudeSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION.test(value);
}
export function authCategory(text: string): 'claude.ai' | null {
  try {
    const value: unknown = JSON.parse(text);
    return object(value) && value.authMethod === 'claude.ai' ? 'claude.ai' : null;
  } catch {
    return null;
  }
}
const REQUIRED_FLAGS = [
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
  '--no-session-persistence',
  '--resume',
];
/** Refuse an unverified CLI upgrade rather than silently changing its launch policy. */
export function verifyInstalledCapabilities(versionText: string, helpText: string): string {
  if (!/^2\.1\.285(?:\s|$)/.test(versionText.trim()))
    throw new ClaudeHarnessError(
      'HARNESS_UNSUPPORTED_POLICY',
      'Claude CLI version is not verified; this adapter requires 2.1.285',
    );
  const advertisedFlags = helpText.split(/\s+/).map((token) => token.replace(/,$/, ''));
  if (REQUIRED_FLAGS.some((flag) => !advertisedFlags.includes(flag)))
    throw new ClaudeHarnessError(
      'HARNESS_UNSUPPORTED_POLICY',
      'Claude CLI policy capabilities are unavailable',
    );
  return '2.1.285';
}
/** Bounded UTF-8 JSONL; parsing never retains invalid source text in an error. */
export class JsonLines {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  constructor(private readonly maxLineBytes = 1024 * 1024) {}
  push(chunk: Buffer): ObjectValue[] {
    this.pending += this.decoder.write(chunk);
    return this.consume(false);
  }
  finish(): ObjectValue[] {
    this.pending += this.decoder.end();
    return this.consume(true);
  }
  private consume(final: boolean): ObjectValue[] {
    const records: ObjectValue[] = [];
    let end = this.pending.indexOf('\n');
    while (end !== -1) {
      const line = this.pending.slice(0, end).replace(/\r$/, '');
      this.pending = this.pending.slice(end + 1);
      if (line.trim()) records.push(this.parse(line));
      end = this.pending.indexOf('\n');
    }
    if (Buffer.byteLength(this.pending) > this.maxLineBytes)
      throw new ClaudeHarnessError(
        'HARNESS_OUTPUT_LIMIT',
        'Claude output line exceeds the configured limit',
      );
    if (final && this.pending.trim()) {
      records.push(this.parse(this.pending));
      this.pending = '';
    }
    return records;
  }
  private parse(line: string): ObjectValue {
    if (Buffer.byteLength(line) > this.maxLineBytes)
      throw new ClaudeHarnessError(
        'HARNESS_OUTPUT_LIMIT',
        'Claude output line exceeds the configured limit',
      );
    try {
      const parsed: unknown = JSON.parse(line);
      if (!object(parsed)) throw protocolError();
      return parsed;
    } catch {
      throw protocolError();
    }
  }
}
const BUILTIN_SKILLS = new Set([
  'deep-research',
  'dataviz',
  'update-config',
  'verify',
  'debug',
  'code-review',
  'simplify',
  'batch',
  'fewer-permission-prompts',
  'doctor',
  'loop',
  'schedule',
  'claude-api',
  'workflow-authoring',
  'run',
  'run-skill-generator',
]);
const bounded = (text: string, max = 200) => text.replace(/\s+/g, ' ').trim().slice(0, max);
const outputText = (value: unknown): string => {
  if (typeof value !== 'string') throw protocolError();
  if (value.length > 512 * 1024)
    throw new ClaudeHarnessError(
      'HARNESS_OUTPUT_LIMIT',
      'Claude text exceeds the configured limit',
    );
  return value;
};
function usageFrom(value: unknown): Usage {
  if (!object(value)) throw protocolError();
  const n = (key: string, required = false): number => {
    const number = value[key];
    if (number === undefined && !required) return 0;
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0)
      throw protocolError();
    return number;
  };
  const cachedInputTokens = n('cache_read_input_tokens');
  return {
    inputTokens: n('input_tokens', true) + n('cache_creation_input_tokens') + cachedInputTokens,
    outputTokens: n('output_tokens', true),
    cachedInputTokens,
    reasoningOutputTokens: 0,
  };
}
/** Classify documented native category/status fields; never inspect provider message text. */
function nativeFailure(category: unknown, status?: unknown): ClaudeHarnessError {
  if (category === 'authentication_failed' || status === 401 || status === 403)
    return new ClaudeHarnessError('HARNESS_NOT_AUTHENTICATED', 'Claude authentication failed');
  if (category === 'rate_limit' || status === 429)
    return new ClaudeHarnessError(
      'HARNESS_QUOTA_EXHAUSTED',
      'Claude account rate limit reached',
      true,
    );
  const transient =
    category === 'server_error' ||
    (typeof status === 'number' && Number.isInteger(status) && status >= 500 && status <= 599);
  return new ClaudeHarnessError('HARNESS_TURN_FAILED', 'Claude turn failed', transient);
}
export interface ClaudePolicyEvidence extends ClaudePolicy {
  advertisedPluginCount: number;
  advertisedSkillCount: number;
}
export interface ClaudeAccumulatorOptions {
  policy: ClaudePolicy;
  model: string;
  effort?: Effort;
  mode: 'fresh' | 'resumed';
  resumeId?: string;
  schema?: JsonSchema;
}
/** Only verified init metadata can announce a session; no new delivery-proof/recovery contract. */
export class ClaudeAccumulator {
  private id: string | undefined;
  private bootstrapId: string | undefined;
  private completed: HarnessResult | undefined;
  private readonly items: HarnessItem[] = [];
  private readonly toolIds = new Map<string, string>();
  private serial = 0;
  private evidence: ClaudePolicyEvidence | undefined;
  constructor(private readonly options: ClaudeAccumulatorOptions) {}
  get policyEvidence(): ClaudePolicyEvidence {
    if (!this.evidence) throw protocolError();
    return this.evidence;
  }
  push(record: ObjectValue): HarnessEvent[] {
    if (this.completed) throw protocolError();
    if (record.type === 'system' && record.subtype === 'init') return this.initialize(record);
    if (
      record.type === 'system' &&
      typeof record.subtype === 'string' &&
      ['hook_started', 'hook_response', 'hook_progress', 'plugin_install'].includes(record.subtype)
    )
      throw new ClaudeHarnessError(
        'HARNESS_UNSUPPORTED_POLICY',
        'Claude hooks and plugin installation cannot run under this launch policy',
      );
    if (record.type === 'system' && record.subtype === 'commands_changed')
      return this.commandsChanged(record);
    if (!this.id) throw protocolError();
    if (record.type === 'assistant' && record.error !== undefined)
      throw nativeFailure(record.error);
    if (record.type === 'assistant') return this.assistant(record);
    if (record.type === 'user') return this.toolResults(record);
    if (record.type === 'result') return this.complete(record);
    // Non-execution status/partial-message events carry no stored evidence.
    return [];
  }
  finish(): HarnessResult {
    if (!this.completed) throw protocolError();
    return this.completed;
  }
  /** Documented command-cache metadata carries no execution evidence and may precede native init. */
  private commandsChanged(record: ObjectValue): HarnessEvent[] {
    if (
      !validClaudeSessionId(record.session_id) ||
      !validClaudeSessionId(record.uuid) ||
      !Array.isArray(record.commands) ||
      record.commands.length > 1000
    )
      throw protocolError();
    const expected = this.id ?? this.bootstrapId;
    if (expected !== undefined && expected !== record.session_id) throw protocolError();
    for (const command of record.commands) {
      if (
        !object(command) ||
        typeof command.name !== 'string' ||
        !command.name ||
        command.name.length > 100 ||
        typeof command.description !== 'string' ||
        command.description.length > 16384 ||
        typeof command.argumentHint !== 'string' ||
        command.argumentHint.length > 1000 ||
        (command.aliases !== undefined &&
          (!Array.isArray(command.aliases) ||
            command.aliases.some((alias) => typeof alias !== 'string' || alias.length > 100)))
      )
        throw protocolError();
      if (command.builtin !== true)
        throw new ClaudeHarnessError(
          'HARNESS_UNSUPPORTED_POLICY',
          'Claude command metadata includes an unverified customization',
        );
    }
    if (!this.id) this.bootstrapId = record.session_id;
    return [];
  }
  private initialize(record: ObjectValue): HarnessEvent[] {
    if (this.id) throw protocolError();
    if (!validClaudeSessionId(record.session_id)) throw protocolError();
    if (this.bootstrapId !== undefined && this.bootstrapId !== record.session_id)
      throw protocolError();
    if (this.options.resumeId !== undefined && record.session_id !== this.options.resumeId)
      throw new ClaudeHarnessError(
        'HARNESS_PROTOCOL_ERROR',
        'Claude resumed session does not match the requested session',
      );
    const expectedTools =
      this.options.schema === undefined
        ? this.options.policy.tools
        : [...this.options.policy.tools, 'StructuredOutput'];
    const tools = record.tools,
      plugins = record.plugins,
      skills = record.skills,
      mcp = record.mcp_servers;
    if (
      record.model !== this.options.model ||
      record.permissionMode !== 'dontAsk' ||
      record.apiKeySource !== 'none' ||
      !Array.isArray(tools) ||
      tools.length !== expectedTools.length ||
      new Set(tools).size !== tools.length ||
      tools.some((tool) => typeof tool !== 'string' || !expectedTools.includes(tool)) ||
      !Array.isArray(mcp) ||
      mcp.length ||
      !Array.isArray(plugins) ||
      plugins.some((plugin) => !object(plugin) || plugin.name !== 'cc-plugin-agents-md') ||
      !Array.isArray(skills) ||
      skills.some((skill) => typeof skill !== 'string' || !BUILTIN_SKILLS.has(skill))
    )
      throw new ClaudeHarnessError(
        'HARNESS_UNSUPPORTED_POLICY',
        'Claude effective model/auth/tool/customization policy differs from the requested policy',
      );
    this.id = record.session_id;
    this.evidence = {
      ...this.options.policy,
      advertisedPluginCount: plugins.length,
      advertisedSkillCount: skills.length,
    };
    const item: HarnessItem = {
      id: 'claude-policy',
      type: 'other',
      summary:
        'Claude account login; billing follows account settings; ' +
        (this.options.policy.boundary === 'builtin-tools'
          ? 'read-only built-in tools; no OS sandbox'
          : 'full access; commands unconfined'),
      detail: {
        sandbox: this.evidence.sandbox,
        approval: this.evidence.approval,
        permissionMode: this.evidence.permissionMode,
        tools: [...this.evidence.tools],
        structuredOutputCarrier: this.options.schema === undefined ? null : 'StructuredOutput',
        authMethod: this.evidence.authMethod,
        billingMode: this.evidence.billingMode,
        billingStatus: this.evidence.billingStatus,
        inputTransport: 'text',
        promptDeliveryProof: 'unsupported',
        requestedModel: this.options.model,
        requestedEffort: this.options.effort ?? null,
        effectiveEffort: null,
        boundary: this.evidence.boundary,
        network: this.evidence.network,
        advertisedPluginCount: this.evidence.advertisedPluginCount,
        advertisedSkillCount: this.evidence.advertisedSkillCount,
      },
    };
    this.items.push(item);
    return [
      { type: 'session', sessionId: this.id, mode: this.options.mode },
      { type: 'item', item },
    ];
  }
  private item(item: Omit<HarnessItem, 'id'>, id?: string): HarnessEvent {
    if (this.items.length >= 10000)
      throw new ClaudeHarnessError(
        'HARNESS_OUTPUT_LIMIT',
        'Claude transcript exceeds the configured item limit',
      );
    const next = { ...item, id: id ?? 'claude-' + String(++this.serial) };
    this.items.push(next);
    return { type: 'item', item: next };
  }
  /** The pinned native schema carrier is metadata transport, not an execution capability. */
  private isOutputCarrier(tool: string): boolean {
    return this.options.schema !== undefined && tool === 'StructuredOutput';
  }
  private assistant(record: ObjectValue): HarnessEvent[] {
    if (!object(record.message) || !Array.isArray(record.message.content)) throw protocolError();
    const events: HarnessEvent[] = [];
    for (const content of record.message.content) {
      if (!object(content)) throw protocolError();
      if (content.type === 'text' || content.type === 'thinking') {
        const text = outputText(content.type === 'text' ? content.text : content.thinking);
        events.push(
          this.item({
            type: content.type === 'text' ? 'message' : 'reasoning',
            summary: bounded(text),
            detail: { text: text.slice(0, 16 * 1024) },
          }),
        );
      } else if (content.type === 'tool_use') {
        if (
          typeof content.name !== 'string' ||
          (!this.options.policy.tools.includes(content.name) && !this.isOutputCarrier(content.name))
        )
          throw new ClaudeHarnessError(
            'HARNESS_UNSUPPORTED_POLICY',
            'Claude attempted an unavailable tool',
          );
        if (
          typeof content.id !== 'string' ||
          !content.id ||
          this.toolIds.has(content.id) ||
          !object(content.input)
        )
          throw protocolError();
        this.toolIds.set(content.id, content.name);
        if (this.isOutputCarrier(content.name)) {
          events.push(
            this.item(
              {
                type: 'other',
                summary: 'Claude structured output',
                status: 'running',
                detail: { carrier: 'StructuredOutput', kind: 'schema-output' },
              },
              content.id,
            ),
          );
          continue;
        }
        const file =
          typeof content.input.file_path === 'string'
            ? bounded(content.input.file_path)
            : undefined;
        const command =
          content.name === 'Bash' && typeof content.input.command === 'string'
            ? bounded(content.input.command, COMMAND_PREVIEW_MAX)
            : undefined;
        events.push(
          this.item(
            {
              type:
                content.name === 'Bash'
                  ? 'command'
                  : ['Write', 'Edit'].includes(content.name)
                    ? 'file-change'
                    : 'tool-call',
              summary: content.name + (file ? ' ' + file : ''),
              status: 'running',
              ...(command !== undefined ? { commandPreview: command } : {}),
              detail: {
                tool: content.name,
                ...(file ? { file } : {}),
                ...(command !== undefined ? { command } : {}),
              },
            },
            content.id,
          ),
        );
      }
    }
    return events;
  }
  private toolResults(record: ObjectValue): HarnessEvent[] {
    if (!object(record.message) || !Array.isArray(record.message.content)) throw protocolError();
    const events: HarnessEvent[] = [];
    for (const content of record.message.content) {
      if (!object(content)) throw protocolError();
      if (content.type !== 'tool_result') continue;
      if (typeof content.tool_use_id !== 'string' || !this.toolIds.has(content.tool_use_id))
        throw protocolError();
      if (Object.hasOwn(content, 'is_error') && typeof content.is_error !== 'boolean')
        throw protocolError();
      const tool = this.toolIds.get(content.tool_use_id)!;
      this.toolIds.delete(content.tool_use_id);
      const failed = content.is_error === true;
      if (this.isOutputCarrier(tool)) {
        events.push(
          this.item(
            {
              type: 'other',
              summary: 'Claude structured output' + (failed ? ' failed' : ' completed'),
              status: failed ? 'failed' : 'ok',
              detail: { carrier: 'StructuredOutput', kind: 'schema-output' },
            },
            content.tool_use_id,
          ),
        );
        continue;
      }
      events.push(
        this.item(
          {
            type:
              tool === 'Bash'
                ? 'command'
                : ['Write', 'Edit'].includes(tool)
                  ? 'file-change'
                  : 'tool-call',
            summary: tool + (failed ? ' failed' : ' completed'),
            status: failed ? 'failed' : 'ok',
            detail: {
              tool,
              ...(!failed && typeof content.content === 'string'
                ? { output: content.content.slice(0, 16 * 1024) }
                : {}),
            },
          },
          content.tool_use_id,
        ),
      );
    }
    return events;
  }
  private complete(record: ObjectValue): HarnessEvent[] {
    if (record.session_id !== this.id)
      throw new ClaudeHarnessError(
        'HARNESS_PROTOCOL_ERROR',
        'Claude result session does not match the announced session',
      );
    if (record.is_error !== false || record.subtype !== 'success') {
      throw nativeFailure(undefined, record.api_error_status);
    }
    if (this.toolIds.size > 0) throw protocolError();
    if (
      !object(record.modelUsage) ||
      Object.keys(record.modelUsage).length !== 1 ||
      !Object.hasOwn(record.modelUsage, this.options.model)
    )
      throw new ClaudeHarnessError(
        'HARNESS_UNSUPPORTED_POLICY',
        'Claude actual model differs from the requested model',
      );
    const finalText = outputText(record.result),
      usage = usageFrom(record.usage);
    // The engine owns schema validation and the authored repair policy. A missing native field
    // remains an explicit undefined candidate, so valid-looking final text cannot replace it.
    const structured = record.structured_output;
    this.completed = {
      finalText,
      usage,
      items: this.items,
      ...(this.options.schema ? { structured } : {}),
    };
    return [{ type: 'usage', usage }, { type: 'turn-complete' }];
  }
}
