import { randomBytes } from 'node:crypto';
import type {
  JsonValue,
  LoopDefinition,
  LoopRecord,
  LoopVersionRecord,
  Node,
  RunRecord,
} from '@graphgoblin/contracts';
import {
  evaluateExpression,
  evaluatePredicate,
  nodesOfKind,
  type ValidationIssue,
} from '@graphgoblin/domain';
import type { ClockPort, IdPort, Logger, RunManager, SecretsPort } from '@graphgoblin/engine';
import { TIMESTAMP_HEADER, verifySignature } from '@graphgoblin/infrastructure/http';
import {
  CronScheduler,
  type CronFire,
  type ScheduleRecord,
} from '@graphgoblin/infrastructure/scheduler';
import type {
  InboundEventRecord,
  ScheduleDraft,
  SqliteInboundEvents,
  SqliteLoopRepository,
  SqliteRunRepository,
  SqliteScheduleStore,
  SqliteWebhookEndpoints,
  WebhookEndpointDraft,
  WebhookEndpointRecord,
} from '@graphgoblin/infrastructure/sqlite';
import type { InboundEvent, InboundEventBus } from '../event-bus.js';
import type { PollTarget, PollTriggers } from './poll.js';
import { FixedWindowRateLimiter } from './rate-limit.js';

type TriggerNode = Extract<Node, { kind: 'trigger' }>;
type Config<S extends TriggerNode['config']['subtype']> = Extract<
  TriggerNode['config'],
  { subtype: S }
>;

/**
 * An event may start at most this many runs in a row through event triggers. Together with the
 * loop-chain rule (an event never starts a loop that is already in the chain that emitted it) it
 * keeps loops that publish what they listen for from running forever.
 */
export const MAX_EVENT_CHAIN = 8;

/** Webhook bodies above this size are rejected with 413 before any work is done. */
export const WEBHOOK_BODY_LIMIT = 1024 * 1024;

export interface TriggerServiceDeps {
  loops: SqliteLoopRepository;
  runs: SqliteRunRepository;
  schedules: SqliteScheduleStore;
  endpoints: SqliteWebhookEndpoints;
  inbound: SqliteInboundEvents;
  manager: Pick<RunManager, 'startRun'>;
  cron: CronScheduler;
  bus: InboundEventBus;
  secretsFor(ownerId: string): Pick<SecretsPort, 'resolve'>;
  clock: ClockPort;
  ids: IdPort;
  logger: Logger;
  /** Requests per endpoint per minute. Default 60. */
  webhookRateLimit?: number;
  /** Poll triggers; armed and disarmed alongside schedules and endpoints. */
  polls: PollTriggers;
}

export type WebhookOutcome =
  | { kind: 'error'; status: number; code: string; detail: string; retryAfterSeconds?: number }
  | {
      kind: 'accepted';
      event: InboundEventRecord;
      runId?: string;
      filtered: boolean;
    };

export interface EventIngest {
  ownerId: string;
  type: string;
  payload: JsonValue;
  dedupeKey?: string;
  /** `api` for `POST /events`, `run:<runId>` for an exit node's `event` return channel. */
  source: string;
  /** The run whose exit published the event, for the chain guard. */
  emitterRunId?: string;
}

export interface EventIngestResult {
  event: InboundEventRecord;
  runIds: string[];
  duplicate: boolean;
}

export interface LoopTriggers {
  schedules: ScheduleRecord[];
  webhooks: (Omit<WebhookEndpointRecord, 'token'> & { path: string })[];
  polls: PollTarget[];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function headerValue(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** ISO 8601 (what GraphGoblin's own deliveries send) or Unix seconds. */
function parseTimestamp(value: string): number {
  return /^\d{1,12}$/.test(value) ? Number(value) * 1000 : Date.parse(value);
}

function stringKey(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const key = typeof value === 'string' ? value : JSON.stringify(value);
  return key.length > 0 ? key.slice(0, 512) : undefined;
}

/**
 * Everything between an external signal and `RunManager.startRun`: arming schedules and webhook
 * endpoints when a version is published, verifying webhook deliveries, matching inbound events to
 * event triggers, and turning cron fires into runs. See docs/08-triggers-and-integrations.md.
 */
export class TriggerService {
  private readonly limiter: FixedWindowRateLimiter;
  private unsubscribe: (() => void)[] = [];

  constructor(private readonly deps: TriggerServiceDeps) {
    this.limiter = new FixedWindowRateLimiter(deps.clock, deps.webhookRateLimit ?? 60);
  }

  /** Subscribe to cron fires and the inbound event bus. Idempotent. */
  start(): void {
    if (this.unsubscribe.length > 0) return;
    this.unsubscribe = [
      this.deps.cron.onFire(async (fire) => {
        await this.onCronFire(fire);
      }),
      this.deps.bus.subscribe((event) => this.onBusEvent(event)),
    ];
  }

  stop(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
  }

  // ---------------------------------------------------------------------------
  // Arming
  // ---------------------------------------------------------------------------

  /** Problems that would stop a definition's triggers from arming: bad cron expressions or zones. */
  checkDefinition(definition: LoopDefinition): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const node of nodesOfKind(definition, 'trigger')) {
      if (node.config.subtype !== 'cron') continue;
      const problem = CronScheduler.validate(node.config.expression, node.config.timezone);
      if (problem) {
        issues.push({
          code: 'CRON_INVALID',
          severity: 'error',
          message: `cron trigger "${node.id}": ${problem.message}`,
          nodeId: node.id,
          path: `config.${problem.field}`,
        });
      }
    }
    return issues;
  }

  /**
   * Make `version` the loop's armed version: one schedule per cron trigger node and one endpoint
   * per webhook trigger node, with rows of earlier versions disabled. Idempotent for the same
   * version, so boot can call it for every loop.
   */
  async armVersion(loop: LoopRecord, version: LoopVersionRecord): Promise<LoopTriggers> {
    const now = this.deps.clock.now();
    const triggers = nodesOfKind(version.definition, 'trigger');
    const cronDrafts: ScheduleDraft[] = [];
    const hookDrafts: WebhookEndpointDraft[] = [];
    for (const node of triggers) {
      const config = node.config;
      if (config.subtype === 'cron') {
        let next: Date | undefined;
        try {
          next = config.enabled
            ? CronScheduler.nextFire(config.expression, config.timezone, now)
            : undefined;
        } catch (error) {
          this.deps.logger.warn(
            { loopId: loop.id, nodeId: node.id, error: describe(error) },
            'cron trigger not armed',
          );
        }
        cronDrafts.push({
          ownerId: loop.ownerId,
          triggerNodeId: node.id,
          expression: config.expression,
          timezone: config.timezone,
          missedFirePolicy: config.missedFirePolicy,
          enabled: config.enabled && next !== undefined,
          nextFireAt: next?.toISOString(),
        });
      } else if (config.subtype === 'webhook') {
        hookDrafts.push({
          ownerId: loop.ownerId,
          triggerNodeId: node.id,
          secretRef: config.signature.secretRef,
          signatureHeader: config.signature.header.toLowerCase(),
          replayWindowSeconds: config.replayWindowSeconds,
        });
      }
    }
    await this.deps.schedules.replaceForVersion(loop.id, version.id, cronDrafts);
    await this.deps.endpoints.replaceForVersion(loop.id, version.id, hookDrafts, () =>
      randomBytes(32).toString('base64url'),
    );
    this.deps.polls.arm(loop, version);
    return this.listForLoop(loop.id);
  }

  /** Re-arm every loop's current version; called at boot so upgrades and restores keep firing. */
  async armAll(): Promise<number> {
    let armed = 0;
    for (const loop of await this.deps.loops.listPublished()) {
      try {
        const version = await this.deps.loops.getVersion(loop.currentVersionId as string);
        if (!version) continue;
        await this.armVersion(loop, version);
        armed += 1;
      } catch (error) {
        this.deps.logger.error({ loopId: loop.id, error: describe(error) }, 'trigger arm failed');
      }
    }
    return armed;
  }

  async disarmLoop(loopId: string): Promise<void> {
    await this.deps.schedules.disableLoop(loopId);
    await this.deps.endpoints.disableLoop(loopId);
    this.deps.polls.disarm(loopId);
  }

  async listForLoop(loopId: string): Promise<LoopTriggers> {
    const schedules = await this.deps.schedules.listForLoop(loopId);
    const endpoints = await this.deps.endpoints.listForLoop(loopId);
    return {
      schedules,
      webhooks: endpoints.map(({ token, ...rest }) => ({ ...rest, path: `/hooks/${token}` })),
      polls: this.deps.polls.list(loopId),
    };
  }

  // ---------------------------------------------------------------------------
  // Cron
  // ---------------------------------------------------------------------------

  async onCronFire(fire: CronFire): Promise<RunRecord | undefined> {
    const { schedule } = fire;
    try {
      return await this.deps.manager.startRun({
        ownerId: schedule.ownerId,
        loopId: schedule.loopId,
        versionId: schedule.versionId,
        triggerNodeId: schedule.triggerNodeId,
        triggerKind: 'cron',
        source: 'cron',
        caller: { kind: 'system', id: `cron:${schedule.id}` },
        payload: { scheduledFor: fire.scheduledFor, catchUp: fire.catchUp },
        dedupeKey: `cron:${schedule.id}:${fire.scheduledFor}`,
      });
    } catch (error) {
      this.deps.logger.error(
        { scheduleId: schedule.id, loopId: schedule.loopId, error: describe(error) },
        'cron run failed to start',
      );
      return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  /**
   * Verify and act on one delivery to `/hooks/<token>`. Order: endpoint lookup (404), rate limit
   * (429), timestamp window (401), secret (503), signature (401), JSON (400), expressions (422),
   * replay (409), then record and start the run unless the filter rejects it.
   */
  async handleWebhook(
    token: string,
    rawBody: string,
    headers: Record<string, unknown>,
  ): Promise<WebhookOutcome> {
    const fail = (status: number, code: string, detail: string): WebhookOutcome => ({
      kind: 'error',
      status,
      code,
      detail,
    });
    const endpoint = await this.deps.endpoints.findByToken(token);
    if (!endpoint || !endpoint.enabled) return fail(404, 'HOOK_NOT_FOUND', 'unknown webhook');

    const decision = this.limiter.hit(endpoint.id);
    if (!decision.allowed) {
      return {
        kind: 'error',
        status: 429,
        code: 'RATE_LIMITED',
        detail: 'too many deliveries to this endpoint; retry later',
        retryAfterSeconds: decision.retryAfterSeconds,
      };
    }

    const now = this.deps.clock.now();
    const timestamp = headerValue(headers, TIMESTAMP_HEADER);
    const at = timestamp ? parseTimestamp(timestamp) : NaN;
    if (!timestamp || Number.isNaN(at)) {
      return fail(401, 'TIMESTAMP_MISSING', `the ${TIMESTAMP_HEADER} header is missing or invalid`);
    }
    if (Math.abs(now.getTime() - at) > endpoint.replayWindowSeconds * 1000) {
      return fail(401, 'TIMESTAMP_OUT_OF_WINDOW', 'the delivery timestamp is outside the window');
    }

    const secret = await this.deps.secretsFor(endpoint.ownerId).resolve(endpoint.secretRef);
    if (secret === undefined) {
      this.deps.logger.warn(
        { endpointId: endpoint.id, secretRef: endpoint.secretRef },
        'webhook secret is not set',
      );
      return fail(503, 'HOOK_NOT_READY', 'the endpoint has no signing secret configured');
    }
    const signature = headerValue(headers, endpoint.signatureHeader);
    if (!signature || !verifySignature(secret, timestamp, rawBody, signature)) {
      return fail(401, 'SIGNATURE_INVALID', 'the signature does not match');
    }

    let payload: JsonValue;
    try {
      payload = rawBody.trim().length === 0 ? null : (JSON.parse(rawBody) as JsonValue);
    } catch {
      return fail(400, 'BODY_INVALID', 'the body is not valid JSON');
    }

    const node = await this.triggerNode(endpoint.versionId, endpoint.triggerNodeId, 'webhook');
    if (!node) return fail(404, 'HOOK_NOT_FOUND', 'unknown webhook');
    const bindings = { headers: this.lowerHeaders(headers) };
    let dedupeKey: string;
    let passes: boolean;
    try {
      dedupeKey =
        (node.dedupeKey
          ? stringKey(await evaluateExpression(node.dedupeKey, payload, { bindings }))
          : undefined) ?? `sig:${signature}`;
      passes = node.filter ? await evaluatePredicate(node.filter, payload, { bindings }) : true;
    } catch (error) {
      return fail(422, 'EXPRESSION_FAILED', describe(error));
    }

    const source = `webhook:${endpoint.id}`;
    const record: InboundEventRecord = {
      id: this.deps.ids.next(),
      ownerId: endpoint.ownerId,
      type: 'webhook',
      payload,
      dedupeKey,
      source,
      receivedAt: now.toISOString(),
      runIds: [],
    };
    const inserted = await this.deps.inbound.insertUnlessDuplicate(record, {
      ownerId: endpoint.ownerId,
      source,
      dedupeKey,
      since: new Date(now.getTime() - endpoint.replayWindowSeconds * 1000).toISOString(),
    });
    if (inserted.duplicate) {
      return fail(409, 'REPLAYED', 'this delivery was already received');
    }
    if (!passes) return { kind: 'accepted', event: record, filtered: true };

    const run = await this.deps.manager.startRun({
      ownerId: endpoint.ownerId,
      loopId: endpoint.loopId,
      versionId: endpoint.versionId,
      triggerNodeId: endpoint.triggerNodeId,
      triggerKind: 'webhook',
      source: 'webhook',
      caller: { kind: 'system', id: source },
      payload,
      dedupeKey,
    });
    await this.deps.inbound.setRunIds(record.id, [run.id]);
    return {
      kind: 'accepted',
      event: { ...record, runIds: [run.id] },
      runId: run.id,
      filtered: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  /**
   * Record an event and fire every matching event trigger of the owner's published loops.
   * An event whose `(type, dedupeKey)` was seen before is a duplicate and fires nothing.
   */
  async ingestEvent(input: EventIngest): Promise<EventIngestResult> {
    const record: InboundEventRecord = {
      id: this.deps.ids.next(),
      ownerId: input.ownerId,
      type: input.type,
      payload: input.payload,
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      source: input.source,
      receivedAt: this.deps.clock.now().toISOString(),
      runIds: [],
    };
    const inserted = await this.deps.inbound.insertUnlessDuplicate(
      record,
      input.dedupeKey
        ? { ownerId: input.ownerId, type: input.type, dedupeKey: input.dedupeKey }
        : undefined,
    );
    if (inserted.duplicate) {
      return { event: inserted.duplicate, runIds: inserted.duplicate.runIds, duplicate: true };
    }

    const chain = input.emitterRunId
      ? await this.chainOf(input.emitterRunId)
      : { loopIds: new Set<string>(), length: 0 };
    const runIds: string[] = [];
    for (const { loop, version, node } of await this.eventTriggers(input.ownerId, input.type)) {
      const context = { loopId: loop.id, nodeId: node.id, eventId: record.id };
      if (chain.loopIds.has(loop.id)) {
        this.deps.logger.warn(context, 'event trigger skipped: loop is already in the chain');
        continue;
      }
      if (chain.length >= MAX_EVENT_CHAIN) {
        this.deps.logger.warn(context, 'event trigger skipped: chain limit reached');
        continue;
      }
      try {
        const config = node.config as Config<'event'>;
        if (config.filter && !(await evaluatePredicate(config.filter, input.payload))) continue;
        const nodeKey = config.dedupeKey
          ? stringKey(await evaluateExpression(config.dedupeKey, input.payload))
          : undefined;
        if (nodeKey && (await this.deps.runs.hasTriggerDedupe(loop.id, node.id, nodeKey))) {
          continue;
        }
        const dedupeKey = nodeKey ?? input.dedupeKey;
        const run = await this.deps.manager.startRun({
          ownerId: input.ownerId,
          loopId: loop.id,
          versionId: version.id,
          triggerNodeId: node.id,
          triggerKind: 'event',
          source: 'event',
          caller: input.emitterRunId
            ? { kind: 'run', id: input.emitterRunId }
            : { kind: 'system', id: `event:${record.id}` },
          payload: input.payload,
          ...(dedupeKey ? { dedupeKey } : {}),
        });
        runIds.push(run.id);
      } catch (error) {
        this.deps.logger.error({ ...context, error: describe(error) }, 'event trigger failed');
      }
    }
    if (runIds.length > 0) await this.deps.inbound.setRunIds(record.id, runIds);
    return { event: { ...record, runIds }, runIds, duplicate: false };
  }

  private async onBusEvent(event: InboundEvent): Promise<void> {
    const payload = event.payload;
    const emitter =
      payload !== null &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      typeof payload['runId'] === 'string'
        ? payload['runId']
        : undefined;
    try {
      await this.ingestEvent({
        ownerId: event.ownerId,
        type: event.type,
        payload,
        ...(event.dedupeKey ? { dedupeKey: event.dedupeKey } : {}),
        source: emitter ? `run:${emitter}` : 'bus',
        ...(emitter ? { emitterRunId: emitter } : {}),
      });
    } catch (error) {
      this.deps.logger.error({ type: event.type, error: describe(error) }, 'event ingest failed');
    }
  }

  /**
   * The loops of the run chain that ends at `runId`: the run itself, then whichever run started it
   * through an event trigger, or its parent for a subloop, and so on.
   */
  private async chainOf(runId: string): Promise<{ loopIds: Set<string>; length: number }> {
    const loopIds = new Set<string>();
    let length = 0;
    let current: string | undefined = runId;
    const seen = new Set<string>();
    while (current && !seen.has(current) && length <= MAX_EVENT_CHAIN) {
      seen.add(current);
      const run = await this.deps.runs.get(current);
      if (!run) break;
      loopIds.add(run.loopId);
      length += 1;
      const thread = await this.deps.runs.getInitialThread(current);
      const caller = thread?.invocation.caller;
      current =
        thread?.invocation.source === 'event' && caller?.kind === 'run'
          ? caller.id
          : run.parentRunId;
    }
    return { loopIds, length };
  }

  private async eventTriggers(
    ownerId: string,
    type: string,
  ): Promise<{ loop: LoopRecord; version: LoopVersionRecord; node: TriggerNode }[]> {
    const matches: { loop: LoopRecord; version: LoopVersionRecord; node: TriggerNode }[] = [];
    for (const loop of await this.deps.loops.listLoops(ownerId)) {
      if (!loop.currentVersionId) continue;
      const version = await this.deps.loops.getVersion(loop.currentVersionId);
      if (!version) continue;
      for (const node of nodesOfKind(version.definition, 'trigger')) {
        if (node.config.subtype === 'event' && node.config.eventType === type) {
          matches.push({ loop, version, node });
        }
      }
    }
    return matches;
  }

  private async triggerNode<S extends 'webhook'>(
    versionId: string,
    nodeId: string,
    subtype: S,
  ): Promise<Config<S> | undefined> {
    const version = await this.deps.loops.getVersion(versionId);
    const node = version
      ? nodesOfKind(version.definition, 'trigger').find((n) => n.id === nodeId)
      : undefined;
    return node?.config.subtype === subtype ? (node.config as Config<S>) : undefined;
  }

  /** Header values as strings, for the `$headers` binding. Node already lowercases names. */
  private lowerHeaders(headers: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of Object.keys(headers)) {
      const text = headerValue(headers, name);
      if (text !== undefined) out[name] = text;
    }
    return out;
  }
}
