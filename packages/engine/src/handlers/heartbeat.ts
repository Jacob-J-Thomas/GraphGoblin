import type { JsonValue } from '@graphgoblin/contracts';
import { evaluatePredicate, renderTemplate, threadView } from '@graphgoblin/domain';
import { RunFailureError } from '../errors.js';
import type { NodeContext, NodeHandler } from '../handler.js';
import { jsonOrText, outputPatch, toJson } from './common.js';

async function probe(
  ctx: NodeContext<'heartbeat'>,
  view: Record<string, unknown>,
): Promise<JsonValue> {
  const { probe: spec } = ctx.config;
  switch (spec.kind) {
    case 'none':
      return null;
    case 'http': {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(spec.headers ?? {}))
        headers[k] = await renderTemplate(v, view);
      const response = await ctx.ports.probes.fetch(
        {
          method: spec.method,
          url: await renderTemplate(spec.url, view),
          headers,
          ...(spec.body !== undefined ? { body: await renderTemplate(spec.body, view) } : {}),
          timeoutMs: spec.timeoutSeconds * 1000,
        },
        ctx.signal,
      );
      return toJson({
        status: response.status,
        headers: response.headers,
        body: response.body.slice(0, 65_536),
        json: response.json ?? jsonOrText(response.body),
      });
    }
    case 'script': {
      const args: string[] = [];
      for (const arg of spec.args) args.push(await renderTemplate(arg, view));
      const result = await ctx.ports.scripts.run({
        command: spec.command,
        args,
        cwd: await ctx.services.workingDirectory(),
        env: {},
        timeoutMs: spec.timeoutSeconds * 1000,
        signal: ctx.signal,
      });
      return toJson({
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 65_536),
        stderr: result.stderr.slice(-4000),
        json: jsonOrText(result.stdout),
        timedOut: result.timedOut,
      });
    }
    case 'signal-count': {
      const events = await ctx.services.events();
      const startIndex = events
        .map((e) => e.type === 'node.started' && e.nodeId === ctx.node.id)
        .lastIndexOf(true);
      const since = events.slice(
        Math.max(
          0,
          events.findIndex(
            (e, i) => i >= 0 && e.type === 'node.started' && e.nodeId === ctx.node.id,
          ),
        ),
      );
      void startIndex;
      const count = since.filter(
        (e) => e.type === 'signal.received' && e.name === spec.name,
      ).length;
      return toJson({ name: spec.name, count });
    }
  }
}

export const heartbeatHandler: NodeHandler<'heartbeat'> = {
  kind: 'heartbeat',
  async execute(ctx) {
    const { config } = ctx;
    const view = threadView(ctx.thread) as unknown as Record<string, unknown>;
    const beat = (ctx.previousWait?.beat ?? 0) + 1;
    const nowIso = ctx.services.now();
    const now = Date.parse(nowIso);

    const result = await probe(ctx, view);
    await ctx.services.record({
      type: 'heartbeat.beat',
      nodeId: ctx.node.id,
      beat,
      ...(config.record === 'full' ? { result } : {}),
    });

    const probeView = { probe: result, thread: view, beat, now: nowIso };
    if (config.until !== undefined && (await evaluatePredicate(config.until, probeView))) {
      return {
        kind: 'done',
        patch: outputPatch(
          ctx.thread,
          ctx.node.id,
          toJson({ beat, probe: result, satisfied: true }),
          nowIso,
        ),
        route: 'out',
      };
    }

    let deadline: number | undefined;
    if (config.deadline !== undefined) {
      const rendered = await renderTemplate(config.deadline, view);
      deadline = Date.parse(rendered.trim());
      if (Number.isNaN(deadline)) {
        throw new RunFailureError(
          'TEMPLATE_ERROR',
          `heartbeat deadline rendered "${rendered}", which is not a timestamp`,
          { nodeId: ctx.node.id },
        );
      }
    }
    const exhausted =
      (config.maxBeats !== undefined && beat >= config.maxBeats) ||
      (deadline !== undefined && now >= deadline);
    if (exhausted) {
      if (config.onExhausted === 'fail-run') {
        throw new RunFailureError(
          'HEARTBEAT_EXHAUSTED',
          `heartbeat exhausted after ${beat} beats`,
          { nodeId: ctx.node.id, details: { beat, probe: result } },
        );
      }
      return {
        kind: 'done',
        patch: outputPatch(
          ctx.thread,
          ctx.node.id,
          toJson({ beat, probe: result, exhausted: true }),
          nowIso,
        ),
        route: 'out',
      };
    }

    const next = new Date(now + config.intervalSeconds * 1000);
    await ctx.ports.timers.schedule(ctx.run.id, 'heartbeat', next);
    return {
      kind: 'park',
      patch: [],
      wait: { nodeId: ctx.node.id, kind: 'heartbeat', until: next.toISOString(), beat },
    };
  },
};
