import type {
  JsonValue,
  LoopRecord,
  LoopVersionRecord,
  Node,
  Probe,
  RunRecord,
} from '@graphgoblin/contracts';
import {
  evaluateExpression,
  evaluatePredicate,
  nodesOfKind,
  renderTemplate,
} from '@graphgoblin/domain';
import type { ClockPort, HttpProbePort, Logger, RunManager, ScriptPort } from '@graphgoblin/engine';

type PollConfig = Extract<Extract<Node, { kind: 'trigger' }>['config'], { subtype: 'poll' }>;

export interface PollTarget {
  ownerId: string;
  loopId: string;
  versionId: string;
  triggerNodeId: string;
  intervalSeconds: number;
  /** Next probe time (UTC ISO). */
  nextPollAt: string;
}

interface Armed extends PollTarget {
  config: PollConfig;
}

export interface PollTriggersDeps {
  probes: HttpProbePort;
  scripts: ScriptPort;
  manager: Pick<RunManager, 'startRun'>;
  /** Whether this trigger node already started a run with this dedupe key. */
  hasDedupe(loopId: string, triggerNodeId: string, dedupeKey: string): Promise<boolean>;
  clock: ClockPort;
  logger: Logger;
  /** Working directory for script probes. */
  scriptCwd: string;
  /** How often to look for due polls. Default 1000 ms. */
  tickMs?: number;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonOrText(text: string): JsonValue {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return text;
  }
}

/**
 * `poll` triggers (docs/08): run the node's probe every `intervalSeconds` and start a run when
 * `fireWhen` holds and, if the node has a `dedupeKey`, the key is new for that trigger node.
 * Schedules live in memory and are rebuilt whenever a version is armed, including at boot; seen
 * dedupe keys live in the runs they started, so they survive restarts. The first probe happens one
 * interval after arming.
 */
export class PollTriggers {
  private readonly armed = new Map<string, Armed>();
  private interval: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(private readonly deps: PollTriggersDeps) {}

  /** Replace the loop's poll targets with the enabled poll triggers of `version`. */
  arm(loop: LoopRecord, version: LoopVersionRecord): void {
    this.disarm(loop.id);
    const now = this.deps.clock.now().getTime();
    for (const node of nodesOfKind(version.definition, 'trigger')) {
      const config = node.config;
      if (config.subtype !== 'poll' || !config.enabled) continue;
      this.armed.set(`${loop.id}/${node.id}`, {
        ownerId: loop.ownerId,
        loopId: loop.id,
        versionId: version.id,
        triggerNodeId: node.id,
        intervalSeconds: config.intervalSeconds,
        nextPollAt: new Date(now + config.intervalSeconds * 1000).toISOString(),
        config,
      });
    }
  }

  disarm(loopId: string): void {
    for (const [key, target] of this.armed) {
      if (target.loopId === loopId) this.armed.delete(key);
    }
  }

  list(loopId: string): PollTarget[] {
    return [...this.armed.values()]
      .filter((t) => t.loopId === loopId)
      .map(({ config: _config, ...target }) => target);
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      void this.poll();
    }, this.deps.tickMs ?? 1000);
    this.interval.unref();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
  }

  /** Probe every due target once. Returns the runs started. Overlapping calls are skipped. */
  async poll(): Promise<RunRecord[]> {
    if (this.busy) return [];
    this.busy = true;
    const started: RunRecord[] = [];
    try {
      const now = this.deps.clock.now();
      for (const target of [...this.armed.values()]) {
        if (new Date(target.nextPollAt).getTime() > now.getTime()) continue;
        target.nextPollAt = new Date(now.getTime() + target.intervalSeconds * 1000).toISOString();
        const run = await this.check(target, now);
        if (run) started.push(run);
      }
    } finally {
      this.busy = false;
    }
    return started;
  }

  private async check(target: Armed, now: Date): Promise<RunRecord | undefined> {
    const context = { loopId: target.loopId, nodeId: target.triggerNodeId };
    try {
      const base = { now: now.toISOString() };
      const probe = await this.probe(target.config.probe, base);
      const view = { ...base, probe };
      if (!(await evaluatePredicate(target.config.fireWhen, view))) return undefined;
      const value = target.config.dedupeKey
        ? await evaluateExpression(target.config.dedupeKey, view)
        : undefined;
      const dedupeKey =
        value === undefined || value === null
          ? undefined
          : (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 512);
      if (
        dedupeKey &&
        (await this.deps.hasDedupe(target.loopId, target.triggerNodeId, dedupeKey))
      ) {
        return undefined;
      }
      return await this.deps.manager.startRun({
        ownerId: target.ownerId,
        loopId: target.loopId,
        versionId: target.versionId,
        triggerNodeId: target.triggerNodeId,
        triggerKind: 'poll',
        source: 'poll',
        caller: { kind: 'system', id: `poll:${target.loopId}/${target.triggerNodeId}` },
        payload: probe,
        ...(dedupeKey ? { dedupeKey } : {}),
      });
    } catch (error) {
      this.deps.logger.warn({ ...context, error: describe(error) }, 'poll trigger failed');
      return undefined;
    }
  }

  private async probe(spec: Probe, view: Record<string, unknown>): Promise<JsonValue> {
    switch (spec.kind) {
      case 'http': {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(spec.headers ?? {})) {
          headers[name] = await renderTemplate(value, view);
        }
        const response = await this.deps.probes.fetch(
          {
            method: spec.method,
            url: await renderTemplate(spec.url, view),
            headers,
            ...(spec.body !== undefined ? { body: await renderTemplate(spec.body, view) } : {}),
            timeoutMs: spec.timeoutSeconds * 1000,
          },
          AbortSignal.timeout(spec.timeoutSeconds * 1000),
        );
        const body = response.body.slice(0, 65_536);
        return {
          status: response.status,
          headers: response.headers,
          body,
          json: response.json !== undefined ? (response.json as JsonValue) : jsonOrText(body),
        };
      }
      case 'script': {
        const args: string[] = [];
        for (const arg of spec.args) args.push(await renderTemplate(arg, view));
        const result = await this.deps.scripts.run({
          command: spec.command,
          args,
          cwd: this.deps.scriptCwd,
          env: {},
          timeoutMs: spec.timeoutSeconds * 1000,
          signal: AbortSignal.timeout(spec.timeoutSeconds * 1000 + 1000),
        });
        return {
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 65_536),
          stderr: result.stderr.slice(-4000),
          json: jsonOrText(result.stdout),
          timedOut: result.timedOut,
        };
      }
      default:
        // `signal-count` needs a run to count signals on, and `none` has nothing to probe.
        return null;
    }
  }
}
