import { randomBytes } from 'node:crypto';
import type {
  JsonValue,
  LoopDefinition,
  LoopRecord,
  LoopVersionRecord,
  Node,
  RunRecord,
  WebhookConfig,
} from '@graphgoblin/contracts';
import {
  stableStringify,
  evaluateExpression,
  evaluatePredicate,
  nodesOfKind,
  type ValidationIssue,
} from '@graphgoblin/domain';
import type { ClockPort, IdPort, Logger, RunManager, SecretsPort } from '@graphgoblin/engine';
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
import { extractWebhookEventType, verifyWebhookBody } from './webhook-body.js';

type TriggerNode = Extract<Node, { kind: 'trigger' }>;
type Config<S extends TriggerNode['config']['type']> = Extract<TriggerNode['config'], { type: S }>;

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
  manager: Pick<RunManager, 'startRun' | 'receiveWebhook'>;
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
  webhooks: WebhookEndpointSummary[];
  polls: PollTarget[];
}

export type WebhookEndpointSummary = Omit<WebhookEndpointRecord, 'token'> & {
  path: string;
  configurationAvailable: boolean;
  body?: WebhookConfig['body'];
  eventType?: WebhookConfig['eventType'];
  dedupeKey?: string;
  filter?: string;
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringKey(value: unknown, strict = false): string | undefined {
  if (value === undefined || value === null) return undefined;
  const key = typeof value === 'string' ? value : JSON.stringify(value);
  if (strict && key.length > 512) throw new Error('Webhook business key exceeds 512 characters');
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
      if (node.config.type !== 'cron') continue;
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
      if (config.type === 'cron') {
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
      } else if (config.type === 'webhook') {
        hookDrafts.push({
          ownerId: loop.ownerId,
          triggerNodeId: node.id,
          authentication: config.authentication,
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
      webhooks: await Promise.all(endpoints.map((endpoint) => this.describeWebhook(endpoint))),
      polls: this.deps.polls.list(loopId),
    };
  }

  private async describeWebhook(endpoint: WebhookEndpointRecord): Promise<WebhookEndpointSummary> {
    const { token, ...rest } = endpoint;
    const config = await this.webhookConfig(endpoint);
    const matches =
      config !== undefined &&
      stableStringify(config.authentication) === stableStringify(endpoint.authentication);
    if (!matches && endpoint.enabled)
      throw new Error('Enabled webhook configuration does not match its pinned definition');
    return {
      ...rest,
      path: `/hooks/${token}`,
      configurationAvailable: matches,
      ...(matches
        ? {
            body: config.body,
            eventType: config.eventType,
            ...(config.dedupeKey ? { dedupeKey: config.dedupeKey } : {}),
            ...(config.filter ? { filter: config.filter } : {}),
          }
        : {}),
    };
  }

  async describeInbound(
    event: InboundEventRecord,
  ): Promise<InboundEventRecord & { webhook?: WebhookEndpointSummary }> {
    if (event.type !== 'webhook' || !event.source.startsWith('webhook:')) return event;
    const endpoint = await this.deps.endpoints.get(event.source.slice('webhook:'.length));
    if (!endpoint || endpoint.ownerId !== event.ownerId) return event;
    return { ...event, webhook: await this.describeWebhook(endpoint) };
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
   * (429), pinned configuration, optional authentication, decoding (400), extraction/expressions,
   * then acknowledge saved or already consumed input. All receipts dispatch asynchronously.
   */
  async handleWebhook(
    token: string,
    rawBody: Uint8Array,
    headers: Record<string, unknown>,
    rawHeaders?: readonly string[],
  ): Promise<WebhookOutcome> {
    const fail = (status: number, code: string, detail: string): WebhookOutcome => ({
      kind: 'error',
      status,
      code,
      detail,
    });
    if (rawBody.byteLength > WEBHOOK_BODY_LIMIT)
      return fail(413, 'BODY_TOO_LARGE', 'the webhook body exceeds 1 MiB');
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
    const node = await this.webhookConfig(endpoint);
    if (!node || stableStringify(node.authentication) !== stableStringify(endpoint.authentication))
      return fail(
        503,
        'HOOK_NOT_READY',
        'the endpoint configuration does not match its pinned definition',
      );
    const authentication = endpoint.authentication;
    const secret =
      authentication.type === 'none'
        ? undefined
        : await this.deps.secretsFor(endpoint.ownerId).resolve(authentication.secretRef);
    const verified = verifyWebhookBody(
      authentication,
      rawBody,
      headers,
      now,
      secret,
      rawHeaders,
      node.body,
    );
    if (!verified.ok) {
      if (verified.code === 'HOOK_NOT_READY')
        this.deps.logger.warn(
          {
            endpointId: endpoint.id,
            secretRef: authentication.type === 'none' ? undefined : authentication.secretRef,
          },
          'webhook secret is not set',
        );
      return fail(verified.status, verified.code, verified.detail);
    }
    const payload = verified.payload;
    const extracted = extractWebhookEventType(node.eventType, payload, headers, rawHeaders);
    if (!extracted.ok) return fail(extracted.status, extracted.code, extracted.detail);
    const bindings = {
      headers: this.expressionHeaders(
        headers,
        authentication.type === 'none' ? undefined : authentication.header,
      ),
    };
    let dedupeKey: string | undefined;
    let passes: boolean;
    try {
      dedupeKey = node.dedupeKey
        ? stringKey(
            await evaluateExpression(node.dedupeKey, payload, { bindings }),
            authentication.type === 'hmac-sha256' && authentication.message === 'body',
          )
        : undefined;
      passes = node.filter ? await evaluatePredicate(node.filter, payload, { bindings }) : true;
    } catch {
      return fail(422, 'EXPRESSION_FAILED', 'the webhook filter or dedupe expression failed');
    }

    const source = `webhook:${endpoint.id}`;
    const record: InboundEventRecord = {
      id: this.deps.ids.next(),
      ownerId: endpoint.ownerId,
      type: 'webhook',
      payload,
      ...(dedupeKey ? { dedupeKey } : {}),
      source,
      receivedAt: now.toISOString(),
      runIds: [],
    };
    const start = {
      ownerId: endpoint.ownerId,
      loopId: endpoint.loopId,
      versionId: endpoint.versionId,
      triggerNodeId: endpoint.triggerNodeId,
      triggerKind: 'webhook' as const,
      source: 'webhook' as const,
      eventType: extracted.eventType,
      caller: { kind: 'system' as const, id: source },
      payload,
      ...(dedupeKey ? { dedupeKey } : {}),
    };
    try {
      const outcome = await this.deps.manager.receiveWebhook(
        {
          id: this.deps.ids.next(),
          ownerId: endpoint.ownerId,
          loopId: endpoint.loopId,
          triggerNodeId: endpoint.triggerNodeId,
          contentHash: verified.contentHash,
          inbound: record,
        },
        start,
        !passes,
      );
      return {
        kind: 'accepted',
        event: record,
        ...(outcome.receipt.intent ? { runId: outcome.receipt.intent.run.id } : {}),
        filtered: outcome.state === 'filtered',
      };
    } catch {
      return fail(
        503,
        'WEBHOOK_ADMISSION_FAILED',
        'the delivery could not be admitted; retry later',
      );
    }
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
        if (node.config.type === 'event' && node.config.eventType === type) {
          matches.push({ loop, version, node });
        }
      }
    }
    return matches;
  }

  /** Endpoint rows own authentication; the exact pinned definition owns payload configuration. */
  private async webhookConfig(endpoint: WebhookEndpointRecord): Promise<WebhookConfig | undefined> {
    const version = await this.deps.loops.getVersion(endpoint.versionId);
    const loop = await this.deps.loops.getLoop(endpoint.loopId);
    if (
      !version ||
      version.loopId !== endpoint.loopId ||
      version.status !== 'published' ||
      loop?.ownerId !== endpoint.ownerId
    )
      return undefined;
    const node = nodesOfKind(version.definition, 'trigger').find(
      (node) => node.id === endpoint.triggerNodeId,
    );
    return node?.config.type === 'webhook' ? node.config : undefined;
  }

  /** String header metadata for expressions; the configured signing credential stays private. */
  private expressionHeaders(
    headers: Record<string, unknown>,
    signingHeader: string | undefined,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === signingHeader?.toLowerCase()) continue;
      const value = headers[name];
      const text =
        typeof value === 'string'
          ? value
          : Array.isArray(value) && typeof value[0] === 'string'
            ? value[0]
            : undefined;
      if (text !== undefined) out[name] = text;
    }
    return out;
  }
}
