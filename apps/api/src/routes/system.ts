import { ShutdownActionSchema, ShutdownStateSchema, ShutdownTransitionError } from '../shutdown.js';
import { readinessOperation } from '../readiness-operation.js';
import { z } from 'zod';
import {
  HarnessPreflightSchema,
  HarnessIdSchema,
  HarnessDefaultsSchema,
} from '@graphgoblin/contracts';
import type { Container } from '../container.js';
import { PreflightReportSchema, containerPreflightSources, runPreflight } from '../preflight.js';
import { API_VERSION, type ApiInstance } from '../types.js';

const PreflightSchema = HarnessPreflightSchema.extend({ harness: HarnessIdSchema });

export function registerSystemRoutes(app: ApiInstance, container: Container): void {
  app.get(
    '/system/model-defaults',
    {
      schema: {
        tags: ['system'],
        summary: 'Process model and effort defaults, before loop and owner overrides',
        response: { 200: HarnessDefaultsSchema },
      },
    },
    () => container.config.defaults,
  );
  app.get(
    '/system/shutdown',
    {
      schema: {
        tags: ['system'],
        summary: 'Observe gateway drain and force-stop state',
        response: { 200: ShutdownStateSchema },
      },
    },
    () => container.shutdown.state(),
  );
  app.post(
    '/system/shutdown',
    {
      schema: {
        tags: ['system'],
        summary: 'Drain, keep waiting, or explicitly force-stop the gateway',
        body: z.strictObject({ action: ShutdownActionSchema }),
        response: { 202: ShutdownStateSchema, 409: ShutdownStateSchema },
      },
    },
    async (request, reply) => {
      try {
        const state = await container.requestShutdown(request.body.action);
        reply.status(202);
        return state;
      } catch (error) {
        if (!(error instanceof ShutdownTransitionError)) throw error;
        reply.status(409);
        return error.state;
      }
    },
  );
  app.get(
    '/healthz',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness check',
        response: { 200: z.object({ status: z.literal('ok') }) },
      },
    },
    () => ({ status: 'ok' as const }),
  );

  app.get(
    '/version',
    {
      schema: {
        tags: ['system'],
        summary: 'API name and version',
        response: { 200: z.object({ name: z.string(), version: z.string() }) },
      },
    },
    () => ({ name: 'graphgoblin-api', version: API_VERSION }),
  );

  app.get(
    '/system/preflight',
    {
      schema: {
        tags: ['system'],
        summary:
          'First-run preflight: Node, data directory, master key, database, harnesses, Jev, default model',
        response: { 200: PreflightReportSchema },
      },
    },
    () => runPreflight(containerPreflightSources(container)),
  );

  app.get(
    '/harness/preflight',
    {
      schema: {
        tags: ['system'],
        summary: 'Is each configured harness installed and authenticated?',
        response: { 200: z.object({ items: z.array(PreflightSchema) }) },
      },
    },
    async () => {
      const readiness = readinessOperation(container.ports.harnesses);
      const items = await Promise.all(
        Object.entries(container.ports.harnesses)
          .filter(([, adapter]) => adapter !== undefined)
          .map(async ([id]) => {
            const harness = HarnessIdSchema.parse(id);
            return { harness, ...(await readiness.probe(harness)) };
          }),
      );
      if (items.length === 0)
        items.push({
          harness: 'codex',
          state: 'cli-missing',
          ok: false,
          problems: ['no harness adapter is configured'],
        });
      return { items };
    },
  );
}
