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
import { checkedEvents, readAuthority, ClaimRecordSchema } from './authority.js';
import type { TemplateSubject } from './subjects.js';
import { createRequire } from 'node:module';
import { implementationPollKeys } from './github/poll.js';
import { readReviewWake } from './github/review-wake.js';
import type { ReviewWake } from './github/review-protocol.js';
import { parseSubject } from './subjects.js';
import type { TemplateInstances } from './instances.js';
import { qaPollKeys } from './github/qa-authority.js';
import type { QaHistory } from './github/qa-history.js';
import type { TemplateAuthoritySource } from './runtime.js';

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
  instances: Pick<TemplateInstances, 'store' | 'catalog'>;
  raw: ScriptPort;
  apiKeys: Pick<SqliteApiKeys, 'authenticate'>;
  secretsFor(ownerId: string): SecretsPort;
  environment?: NodeJS.ProcessEnv;
  qaAuthority?: TemplateAuthoritySource;
  qaHistory?: Pick<QaHistory, 'snapshot'>;
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
    let trustedSubject: TemplateSubject | null = null;
    let claim: ReturnType<typeof ClaimRecordSchema.parse> | null = null;
    let visit: number | null = null;
    let wake: ReviewWake | null = null;
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
      trustedSubject = subject;
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
        if (event.type === 'node.finished') {
          latest = undefined;
          visit = null;
        }
        if (event.type === 'node.started') {
          if (
            event.kind !== 'script' ||
            event.configHash !== bound.nodes[identity.nodeId]?.configHash
          )
            refuse();
          latest = event.seq;
          visit ??= event.seq;
        }
      }
      if (latest !== identity.startedSeq) refuse();
      wake = readReviewWake(
        binding,
        identity.loopId,
        version.definition,
        events,
        identity.startedSeq,
      );
      const source = await readAuthority(
        this.deps.instances.store,
        binding,
        subject.role === 'worker' ? subject.parentRunId : identity.runId,
      );
      if (
        subject.role === 'worker' &&
        !['running', 'waiting', 'paused'].includes(source.run.status)
      )
        refuse();
      const claims = source.facts.filter((fact) => fact.type === 'ClaimRecord');
      if (claims.length > 1 || (args[0] !== 'claim' && claims.length !== 1)) refuse();
      if (claims[0]) claim = ClaimRecordSchema.parse(claims[0]);
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
    const history =
      binding.manifest.kind === 'qa' && identity.kind === 'node'
        ? await (this.deps.qaHistory ?? refuse()).snapshot(binding, identity.runId)
        : null;
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
      args: [
        ...(binding.support.path.endsWith('.ts')
          ? [createRequire(import.meta.url).resolve('tsx/cli')]
          : []),
        binding.support.path,
        ...request.args,
      ],
      cwd: binding.settings.repository.path,
      env,
      inheritEnv: false,
      stdin: JSON.stringify({
        settings: binding.settings,
        input,
        credential,
        identity,
        subject: trustedSubject,
        claim,
        visit,
        ...(binding.manifest.kind === 'review' ? { wake } : {}),
        ...(binding.manifest.kind === 'qa' ? { history } : {}),
      }),
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
    const safe = sanitizeSupport(parsed, credential);
    const output =
      identity.kind === 'poll'
        ? binding.manifest.kind === 'qa'
          ? await qaPollKeys(binding, safe, this.deps.qaAuthority ?? refuse())
          : await implementationPollKeys(this.deps.instances.store, binding, safe)
        : safe;
    const stdout = JSON.stringify(output);
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
