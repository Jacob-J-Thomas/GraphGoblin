import {
  DeletionConfirmationSchema,
  DeletionPreviewSchema,
  DeletionSelectionSchema,
} from '@graphgoblin/contracts';
import type { Container } from '../container.js';
import { problem } from '../plugins/errors.js';
import type { ApiInstance } from '../types.js';

export function registerDeletionEligibilityRoutes(app: ApiInstance, container: Container): void {
  app.post(
    '/runs/deletion-eligibility/preview',
    {
      schema: {
        tags: ['runs'],
        summary: 'Review an explicit history selection without approving or deleting it',
        body: DeletionSelectionSchema,
        response: { 200: DeletionPreviewSchema },
      },
    },
    async (request) =>
      container.repos.deletionEligibility.preview(request.auth.ownerId, request.body.runIds),
  );

  app.post(
    '/runs/deletion-eligibility',
    {
      schema: {
        tags: ['runs'],
        summary:
          'Confirm or withdraw deletion eligibility for exactly the reviewed selection; deletes nothing',
        body: DeletionConfirmationSchema,
        response: { 200: DeletionPreviewSchema },
      },
    },
    async (request, reply) => {
      const result = await container.repos.deletionEligibility.confirm(
        request.auth.ownerId,
        request.body,
        {
          confirmedAt: container.ports.clock.now().toISOString(),
          confirmedBy: {
            ownerId: request.auth.ownerId,
            kind: request.auth.actor.kind,
            id: request.auth.actor.id,
          },
        },
      );
      if (result.conflict)
        return problem(
          reply,
          409,
          `DELETION_SELECTION_${result.conflict.toUpperCase()}`,
          'No history changed. Review the selection again; protected or stale records cannot be silently omitted.',
          result.items,
        );
      return { token: result.token, items: result.items };
    },
  );
}
