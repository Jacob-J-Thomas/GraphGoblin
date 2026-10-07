import type { PatchOperation } from '@graphgoblin/contracts';
import { JsonPatchSchema, SCRIPT_PROGRESS_STDERR_MAX } from '@graphgoblin/contracts';
import { MUTABLE_REGIONS, pointerStartsWith, threadView } from '@graphgoblin/domain';
import { RunCancelledError, RunFailureError } from '../errors.js';
import type { NodeHandler } from '../handler.js';
import { jsonOrText, outputPatch, withTimeout } from './common.js';
import { renderTemplate } from '@graphgoblin/domain';

const SECRET_PREFIX = 'secret:';

export const scriptHandler: NodeHandler<'script'> = {
  kind: 'script',
  async execute(ctx) {
    const { config } = ctx;
    const view = threadView(ctx.thread) as unknown as Record<string, unknown>;
    const cwd = config.cwd === 'workspace' ? await ctx.services.workingDirectory() : config.cwd;

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.env ?? {})) {
      if (value.startsWith(SECRET_PREFIX)) {
        const name = value.slice(SECRET_PREFIX.length);
        const resolved = await ctx.ports.secrets.resolve(name);
        if (resolved === undefined) {
          throw new RunFailureError(
            'SECRET_MISSING',
            `secret "${name}" referenced by env ${key} is not configured`,
            { nodeId: ctx.node.id },
          );
        }
        env[key] = resolved;
      } else {
        env[key] = value;
      }
    }

    const args: string[] = [];
    for (const arg of config.args) args.push(await renderTemplate(arg, view));

    const stdin =
      config.stdin === 'thread'
        ? JSON.stringify(ctx.thread)
        : config.stdin === 'last-output'
          ? JSON.stringify(ctx.thread.lastOutput?.value ?? null)
          : undefined;

    const timeout = withTimeout(
      ctx.signal,
      config.timeoutSeconds,
      () => new Error('script timeout'),
    );
    let result;
    try {
      result = await ctx.ports.scripts.run({
        command: config.command,
        args,
        cwd,
        env,
        ...(stdin !== undefined ? { stdin } : {}),
        ...(config.timeoutSeconds !== undefined ? { timeoutMs: config.timeoutSeconds * 1000 } : {}),
        signal: timeout.signal,
      });
    } finally {
      timeout.dispose();
    }
    if (ctx.signal.aborted) throw new RunCancelledError();
    if (result.timedOut || timeout.timedOut()) {
      throw new RunFailureError(
        'SCRIPT_TIMEOUT',
        `script exceeded ${config.timeoutSeconds ?? 0}s`,
        { nodeId: ctx.node.id },
      );
    }

    const exitCode = result.exitCode ?? -1;
    const route = config.exitCodeRoutes?.[String(exitCode)] ?? (exitCode === 0 ? 'out' : undefined);
    await ctx.services.record({
      type: 'node.progress',
      nodeId: ctx.node.id,
      progress: {
        exitCode,
        stderr: result.stderr.slice(-SCRIPT_PROGRESS_STDERR_MAX),
        stdoutBytes: result.stdout.length,
      },
    });
    if (!route) {
      throw new RunFailureError('SCRIPT_EXIT_CODE', `script exited with code ${exitCode}`, {
        nodeId: ctx.node.id,
        details: {
          exitCode,
          stderr: result.stderr.slice(-4000),
          stdout: result.stdout.slice(-4000),
        },
      });
    }

    let patch: PatchOperation[] = [];
    if (config.stdout === 'patch') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.stdout);
      } catch (error) {
        throw new RunFailureError(
          'SCRIPT_EXIT_CODE',
          `script stdout is not a JSON patch: ${error instanceof Error ? error.message : String(error)}`,
          { nodeId: ctx.node.id },
        );
      }
      const checked = JsonPatchSchema.safeParse(parsed);
      if (!checked.success) {
        throw new RunFailureError(
          'SCRIPT_EXIT_CODE',
          `script stdout is not a valid JSON patch: ${checked.error.issues.map((i) => i.message).join('; ')}`,
          { nodeId: ctx.node.id },
        );
      }
      for (const op of checked.data) {
        if (!MUTABLE_REGIONS.some((region) => pointerStartsWith(op.path, region))) {
          throw new RunFailureError(
            'SCRIPT_EXIT_CODE',
            `script patch touches "${op.path}", outside the mutable regions`,
            { nodeId: ctx.node.id },
          );
        }
      }
      patch = checked.data;
    } else if (config.stdout === 'last-output') {
      patch = outputPatch(ctx.thread, ctx.node.id, jsonOrText(result.stdout), ctx.services.now());
    }
    return { kind: 'done', patch, route };
  },
};
