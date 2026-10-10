import { z } from 'zod';
import { HarnessPreflightSchema, HarnessIdSchema } from '@graphgoblin/contracts';
import type { Container } from '../container.js';
import { PreflightReportSchema, containerPreflightSources, runPreflight } from '../preflight.js';
import { API_VERSION, type ApiInstance } from '../types.js';

const PreflightSchema = HarnessPreflightSchema.extend({ harness: HarnessIdSchema });

export function registerSystemRoutes(app: ApiInstance, container: Container): void {
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
      const items: z.infer<typeof PreflightSchema>[] = [];
      for (const [id, harness] of Object.entries(container.ports.harnesses)) {
        if (!harness) continue;
        const harnessId = HarnessIdSchema.parse(id);
        try {
          const result = await harness.preflight();
          items.push({ harness: harnessId, ...result });
        } catch (error) {
          items.push({
            harness: harnessId,
            ok: false,
            authenticated: false,
            problems: [
              id === 'claude'
                ? 'Claude preflight failed'
                : error instanceof Error
                  ? error.message
                  : String(error),
            ],
          });
        }
      }
      if (items.length === 0)
        items.push({
          harness: 'codex',
          ok: false,
          authenticated: false,
          problems: ['no harness adapter is configured'],
        });
      return { items };
    },
  );
}
