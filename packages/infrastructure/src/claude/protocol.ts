import { StringDecoder } from 'node:string_decoder';
import type { Effort, JsonSchema, Usage } from '@graphgoblin/contracts';
import { COMMAND_PREVIEW_MAX } from '@graphgoblin/contracts';
import type { HarnessEvent, HarnessItem, HarnessResult } from '@graphgoblin/engine';
import {
  CLAUDE_RECOVERY_HINT,
  ClaudeHarnessError,
  claudeDiagnosticName,
  protocolError,
} from './errors.js';
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
  '--input-format',
  '--model',
  '--verbose',
  '--print',
  '--no-session-persistence',
  '--resume',
];
export const MINIMUM_CLAUDE_VERSION = '2.1.285';
/** Only retain the numeric identity, never arbitrary executable output in public diagnostics. */
export function installedClaudeVersion(text: string): string | undefined {
  return /^(\d{1,6}\.\d{1,6}\.\d{1,6})(?:\s|$)/.exec(text.trim())?.[1];
}
/** Newer releases must still advertise every capability required by the launch policy. */
export function verifyInstalledCapabilities(versionText: string, helpText: string): string {
  const version = installedClaudeVersion(versionText);
  if (!version)
    throw new ClaudeHarnessError(
      'HARNESS_UNSUPPORTED_POLICY',
      'Claude CLI version unknown: required capability version identification is unavailable',
    );
  const parts = version.split('.').map(Number);
  const minimum = MINIMUM_CLAUDE_VERSION.split('.').map(Number);
  const difference = parts.map((part, index) => part - minimum[index]!).find((part) => part !== 0);
  if (difference !== undefined && difference < 0)
    throw new ClaudeHarnessError(
      'HARNESS_UNSUPPORTED_POLICY',
      `Claude CLI ${version}: required capability minimum version ${MINIMUM_CLAUDE_VERSION} is unavailable`,
    );
  const advertisedFlags = helpText.split(/\s+/).map((token) => token.replace(/,$/, ''));
  const missing = REQUIRED_FLAGS.filter((flag) => !advertisedFlags.includes(flag));
  if (missing.length)
    throw new ClaudeHarnessError(
      'HARNESS_UNSUPPORTED_POLICY',
      `Claude CLI ${version}: required capabilities unavailable: ${missing.join(', ')}`,
    );
  return version;
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
const BUILTIN_PLUGINS = new Set(['cc-plugin-agents-md', 'cc-plugin-plugin-authoring']);
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
  'plugin-authoring',
]);
const policyError = (message: string): ClaudeHarnessError =>
  new ClaudeHarnessError('HARNESS_UNSUPPORTED_POLICY', `${message}. ${CLAUDE_RECOVERY_HINT}`);
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
    if (this.completed) throw protocolError(record);
    if (record.type === 'system' && record.subtype === 'init') return this.initialize(record);
    if (
      record.type === 'system' &&
      typeof record.subtype === 'string' &&
      ['hook_started', 'hook_response', 'hook_progress', 'plugin_install'].includes(record.subtype)
    )
      throw policyError(
        `Claude hooks and plugin installation cannot run under this launch policy (record system/${claudeDiagnosticName(record.subtype)})`,
      );
    if (record.type === 'system' && record.subtype === 'commands_changed')
      return this.commandsChanged(record);
    if (record.type === 'system' && record.subtype === 'ui_invalidate')
      return this.uiInvalidate(record);
    if (!this.id) throw protocolError(record);
    if (record.type === 'assistant' && record.error !== undefined)
      throw nativeFailure(record.error);
    if (record.type === 'assistant') return this.assistant(record);
    if (record.type === 'user') return this.toolResults(record);
    if (record.type === 'result') return this.complete(record);
    // Other post-init records carry no stored execution evidence, including future status events.
    return [];
  }
  finish(): HarnessResult {
    if (!this.completed) throw protocolError();
    return this.completed;
  }
  /** UI cache invalidation is metadata, never session, prompt-delivery or execution evidence. */
  private uiInvalidate(record: ObjectValue): HarnessEvent[] {
    if (
      typeof record.event !== 'string' ||
      !record.event ||
      record.event.length > 100 ||
      !validClaudeSessionId(record.uuid) ||
      !validClaudeSessionId(record.session_id)
    )
      throw protocolError(record);
    const expected = this.id ?? this.bootstrapId;
    if (expected !== undefined && expected !== record.session_id) throw protocolError(record);
    if (!this.id) this.bootstrapId = record.session_id;
    return [];
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
        throw policyError(
          `Claude command metadata includes an unverified customization: ${claudeDiagnosticName(command.name)}`,
        );
    }
    if (!this.id) this.bootstrapId = record.session_id;
    return [];
  }
  private initialize(record: ObjectValue): HarnessEvent[] {
    if (this.id) throw protocolError(record);
    if (!validClaudeSessionId(record.session_id)) throw protocolError(record);
    if (this.bootstrapId !== undefined && this.bootstrapId !== record.session_id)
      throw protocolError(record);
    if (this.options.resumeId !== undefined && record.session_id !== this.options.resumeId)
      throw new ClaudeHarnessError(
        'HARNESS_PROTOCOL_ERROR',
        `Claude resumed session does not match the requested session. ${CLAUDE_RECOVERY_HINT}`,
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
      !Array.isArray(mcp) ||
      mcp.length
    )
      throw policyError(
        'Claude effective model/auth/tool/customization policy differs from the requested policy',
      );
    if (!Array.isArray(tools) || !tools.every((tool): tool is string => typeof tool === 'string'))
      throw policyError('Claude tool policy metadata is invalid');
    for (const tool of tools)
      if (!expectedTools.includes(tool))
        throw policyError(`Claude advertised an unexpected tool: ${claudeDiagnosticName(tool)}`);
    if (tools.length !== expectedTools.length || new Set(tools).size !== tools.length)
      throw policyError('Claude advertised tool set differs from the requested policy');
    if (!Array.isArray(plugins)) throw policyError('Claude plugin policy metadata is invalid');
    for (const plugin of plugins) {
      if (!object(plugin) || typeof plugin.name !== 'string')
        throw policyError('Claude plugin policy metadata is invalid');
      if (!BUILTIN_PLUGINS.has(plugin.name))
        throw policyError(
          `Claude advertised an unexpected plugin: ${claudeDiagnosticName(plugin.name)}`,
        );
    }
    if (!Array.isArray(skills)) throw policyError('Claude skill policy metadata is invalid');
    for (const skill of skills) {
      if (typeof skill !== 'string') throw policyError('Claude skill policy metadata is invalid');
      if (!BUILTIN_SKILLS.has(skill))
        throw policyError(`Claude advertised an unexpected skill: ${claudeDiagnosticName(skill)}`);
    }
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
        'Claude account login; ' +
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
          throw policyError(
            `Claude attempted an unavailable tool: ${claudeDiagnosticName(content.name)}`,
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
        `Claude result session does not match the announced session. ${CLAUDE_RECOVERY_HINT}`,
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
      throw policyError('Claude actual model differs from the requested model');
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
