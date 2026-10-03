import { z } from 'zod';
import type { Container } from '../container.js';
import { PreflightReportSchema, containerPreflightSources, runPreflight } from '../preflight.js';
import { API_VERSION, type ApiInstance } from '../types.js';

const PreflightSchema = z.object({
  harness: z.string(),
  ok: z.boolean(),
  version: z.string().optional(),
  authenticated: z.boolean(),
  problems: z.array(z.string()),
});

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
      const items = [];
      for (const [id, harness] of Object.entries(container.ports.harnesses)) {
        if (!harness) continue;
        try {
          const result = await harness.preflight();
          items.push({ harness: id, ...result });
        } catch (error) {
          items.push({
            harness: id,
            ok: false,
            authenticated: false,
            problems: [error instanceof Error ? error.message : String(error)],
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
