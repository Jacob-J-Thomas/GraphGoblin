import { ContextThreadSchema, JsonValueSchema, type JsonValue } from '@graphgoblin/contracts';
import { stableHash } from '@graphgoblin/domain';
import {
  RunFailureError,
  type ScriptPort,
  type ScriptRunRequest,
  type SecretsPort,
} from '@graphgoblin/engine';
import type { SqliteApiKeys } from '@graphgoblin/infrastructure/sqlite';
import { TemplateBindingSchema, assertBoundVersion } from './binding.js';
import { checkedEvents } from './authority.js';
import { parseSubject } from './subjects.js';
import type { TemplateInstances } from './instances.js';

function refuse(): never {
  throw new RunFailureError(
    'TEMPLATE_AUTHORITY_REFUSED',
    'The installed private support request was refused.',
    { resumable: false },
  );
}
export function sanitizeSupport(value: JsonValue, credential: string): JsonValue {
  const scrub = (text: string) => text.split(credential).join('[redacted]');
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeSupport(item, credential));
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, item]) => [scrub(key), sanitizeSupport(item, credential)] as const,
    );
    if (new Set(entries.map(([key]) => key)).size !== entries.length) refuse();
    return Object.fromEntries(entries);
  }
  return value;
}
export interface PrivateSupportDeps {
  instances: TemplateInstances;
  raw: ScriptPort;
  apiKeys: Pick<SqliteApiKeys, 'authenticate'>;
  secretsFor(ownerId: string): SecretsPort;
  environment?: NodeJS.ProcessEnv;
}
/** All raw output is consumed here. Nothing reaches normal script progress until whole-output validation. */
export class PrivateTemplateScripts implements ScriptPort {
  constructor(private readonly deps: PrivateSupportDeps) {}
  async run(request: ScriptRunRequest) {
    if (request.command !== 'graphgoblin-template-support') return this.deps.raw.run(request);
    try {
      return await this.privateRun(request);
    } catch {
      return refuse();
    }
  }
  private async privateRun(request: ScriptRunRequest) {
    const identity = request.executionIdentity;
    if (!identity || Object.keys(request.env).length) refuse();
    const stored = await this.deps.instances.store.bindingForLoop(
      identity.ownerId,
      identity.loopId,
    );
    if (!stored) refuse();
    const binding = TemplateBindingSchema.parse(stored.binding);
    if (
      !binding.support ||
      binding.ownerId !== identity.ownerId ||
      !('supportReadKey' in binding.settings)
    )
      refuse();
    const installed = await this.deps.instances.catalog.get(binding.manifest.id);
    if (
      installed.bundle.manifest.version !== binding.manifest.version ||
      installed.support?.path !== binding.support.path ||
      installed.support.hash !== binding.support.hash
    )
      refuse();
    const version = await this.deps.instances.store.version(identity.versionId);
    if (!version) refuse();
    const bound = assertBoundVersion(
      binding,
      identity.loopId,
      identity.versionId,
      version.definition,
    );
    const node = version.definition.nodes.find((item) => item.id === identity.nodeId);
    if (!node) refuse();
    let args: readonly string[];
    if (identity.kind === 'poll') {
      if (
        version.status !== 'published' ||
        node.kind !== 'trigger' ||
        node.config.subtype !== 'poll' ||
        node.config.probe.kind !== 'script' ||
        node.config.probe.command !== request.command
      )
        refuse();
      args = node.config.probe.args;
      if (args[0] !== 'poll') refuse();
    } else {
      if (
        node.kind !== 'script' ||
        node.config.command !== request.command ||
        node.config.stdout !== 'last-output' ||
        node.config.stdin !== 'thread'
      )
        refuse();
      args = node.config.args;
      const row = await this.deps.instances.store.run(identity.runId);
      if (
        !row ||
        row.run.ownerId !== identity.ownerId ||
        row.run.loopId !== identity.loopId ||
        row.run.versionId !== identity.versionId ||
        row.run.currentNodeId !== identity.nodeId ||
        !['running', 'waiting', 'paused'].includes(row.run.status) ||
        !row.subject
      )
        refuse();
      const subject = parseSubject(row.subject);
      if (
        subject.instanceId !== binding.instanceId ||
        subject.templateVersion !== binding.manifest.version
      )
        refuse();
      const thread = ContextThreadSchema.safeParse(
        request.stdin === undefined ? undefined : JSON.parse(request.stdin),
      );
      if (
        !thread.success ||
        thread.data.run.id !== identity.runId ||
        thread.data.run.loopId !== identity.loopId ||
        thread.data.run.versionId !== identity.versionId
      )
        refuse();
      const events = checkedEvents(await this.deps.instances.store.events(identity.runId));
      let latest: number | undefined;
      for (const event of events) {
        if (!('nodeId' in event) || event.nodeId !== identity.nodeId) continue;
        if (event.type === 'node.finished') latest = undefined;
        if (event.type === 'node.started') {
          if (
            event.kind !== 'script' ||
            event.configHash !== bound.nodes[identity.nodeId]?.configHash
          )
            refuse();
          latest = event.seq;
        }
      }
      if (latest !== identity.startedSeq) refuse();
    }
    if (
      stableHash(args) !== stableHash(request.args) ||
      args.some((arg) => arg.includes('{{') || arg.includes('{%'))
    )
      refuse();
    const credential = await this.deps
      .secretsFor(identity.ownerId)
      .resolve(binding.settings.supportReadKey);
    if (!credential) refuse();
    const key = await this.deps.apiKeys.authenticate(credential);
    if (
      !key ||
      key.ownerId !== identity.ownerId ||
      key.scopes.length !== 1 ||
      key.scopes[0] !== 'runs:read'
    )
      refuse();
    let input: JsonValue = null;
    if (request.stdin !== undefined) input = JsonValueSchema.parse(JSON.parse(request.stdin));
    const env: Record<string, string> = {};
    const allowed = new Set([
      'PATH',
      'PATHEXT',
      'SYSTEMROOT',
      'TEMP',
      'TMP',
      'USERPROFILE',
      'HOME',
      'APPDATA',
      'LOCALAPPDATA',
    ]);
    for (const [name, value] of Object.entries(this.deps.environment ?? process.env))
      if (allowed.has(name.toUpperCase()) && value !== undefined && !value.includes(credential))
        env[name] = value;
    const result = await this.deps.raw.run({
      command: process.execPath,
      args: [binding.support.path, ...request.args],
      cwd: binding.settings.repository.path,
      env,
      inheritEnv: false,
      stdin: JSON.stringify({ settings: binding.settings, input, credential }),
      timeoutMs: request.timeoutMs ?? 60_000,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 8192,
      signal: request.signal,
    });
    if (
      result.exitCode !== 0 ||
      result.timedOut ||
      result.stdoutOverflow !== false ||
      result.stderrOverflow !== false ||
      Buffer.byteLength(result.stdout) > 65_536 ||
      Buffer.byteLength(result.stderr) > 8192
    )
      refuse();
    const parsed = JsonValueSchema.parse(JSON.parse(result.stdout));
    const stdout = JSON.stringify(sanitizeSupport(parsed, credential));
    if (Buffer.byteLength(stdout) > 65_536) refuse();
    return {
      exitCode: 0,
      stdout,
      stderr: '',
      timedOut: false,
      stdoutOverflow: false,
      stderrOverflow: false,
    };
  }
}
