import { UnreadableRunHistoryError } from '@graphgoblin/engine';
import { UlidSchema } from '@graphgoblin/contracts';
import { z } from 'zod';
import type { Container } from '../container.js';
import type { ApiInstance } from '../types.js';

// Bound every request: 20 run records, two threads per run, and 100 events per run.
// A long history resumes within that run before moving to the next identity.
const RUN_PAGE = 20;
const EVENT_PAGE = 100;
const Cursor = z
  .string()
  .max(48)
  .refine((value) => {
    const [id, seq, extra] = value.split(':');
    return (
      extra === undefined &&
      UlidSchema.safeParse(id).success &&
      seq !== undefined &&
      /^(0|[1-9][0-9]*)$/.test(seq) &&
      Number.isSafeInteger(Number(seq))
    );
  }, 'Use the nextCursor returned by diagnostics.');

/** Read-only diagnostics, including runs whose row cannot supply an ordinary run snapshot. */
export function registerRunDiagnosticRoutes(app: ApiInstance, container: Container): void {
  app.get(
    '/runs/diagnostics',
    {
      schema: {
        tags: ['runs'],
        summary: 'Identify unreadable run history for manual repair or explicit deletion',
        querystring: z.strictObject({ cursor: Cursor.optional() }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                runId: z.string(),
                code: z.literal('HISTORY_UNREADABLE'),
                reason: z.string(),
              }),
            ),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => {
      const items: { runId: string; code: 'HISTORY_UNREADABLE'; reason: string }[] = [];
      const [atOrAfter, seq] = request.query.cursor?.split(':') ?? [];
      const identities = await container.repos.runs.listIdentities(request.auth.ownerId, atOrAfter);
      for (const { id } of identities.slice(0, RUN_PAGE)) {
        try {
          await container.repos.runs.get(id);
          await container.repos.runs.getInitialThread(id);
          await container.repos.runs.getThreadCheckpoint(id);
          const events = await container.repos.events.read(
            id,
            id === atOrAfter ? Number(seq) : 0,
            EVENT_PAGE,
          );
          if (events.length === EVENT_PAGE)
            return { items, nextCursor: `${id}:${events.at(-1)!.seq}` };
        } catch (error) {
          if (!(error instanceof UnreadableRunHistoryError)) throw error;
          items.push({ runId: error.runId, code: error.code, reason: error.message });
        }
      }
      const next = identities[RUN_PAGE];
      return { items, nextCursor: next ? `${next.id}:0` : null };
    },
  );
}
