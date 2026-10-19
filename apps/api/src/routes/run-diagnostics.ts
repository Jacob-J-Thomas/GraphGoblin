import { UnreadableRunHistoryError } from '@graphgoblin/engine';
import { z } from 'zod';
import type { Container } from '../container.js';
import type { ApiInstance } from '../types.js';

/** Read-only diagnostics, including runs whose row cannot supply an ordinary run snapshot. */
export function registerRunDiagnosticRoutes(app: ApiInstance, container: Container): void {
  app.get(
    '/runs/diagnostics',
    {
      schema: {
        tags: ['runs'],
        summary: 'Identify unreadable run history for manual repair or explicit deletion',
        response: {
          200: z.object({
            items: z.array(
              z.object({
                runId: z.string(),
                code: z.literal('HISTORY_UNREADABLE'),
                reason: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const items: { runId: string; code: 'HISTORY_UNREADABLE'; reason: string }[] = [];
      for (const { id } of await container.repos.runs.listIdentities(request.auth.ownerId)) {
        try {
          await container.repos.runs.get(id);
          await container.repos.events.read(id);
          await container.repos.runs.getInitialThread(id);
          await container.repos.runs.getThread(id);
          await container.repos.runs.getThreadCheckpoint(id);
        } catch (error) {
          if (!(error instanceof UnreadableRunHistoryError)) throw error;
          items.push({ runId: error.runId, code: error.code, reason: error.message });
        }
      }
      return { items };
    },
  );
}
