import {
  ClassifierModelIdSchema,
  ClassifierModelPutSchema,
  ClassifierModelPatchSchema,
  ClassifierModelSummarySchema,
} from '@graphgoblin/contracts';
import { z } from 'zod';
import type { Container } from '../container.js';
import { problem } from '../plugins/errors.js';
import { hasScope } from '../plugins/auth.js';
import type { ApiInstance } from '../types.js';

export function registerClassifierRoutes(app: ApiInstance, container: Container): void {
  const { classifiers } = container.repos;
  const params = z.object({ id: ClassifierModelIdSchema });
  const response = { 200: ClassifierModelSummarySchema };
  app.get(
    '/classifier-models',
    {
      schema: {
        tags: ['settings'],
        summary: 'List owner classifier models with local configuration status',
        response: { 200: z.object({ items: z.array(ClassifierModelSummarySchema) }) },
      },
    },
    async (request) => ({ items: await container.classifierRegistry.list(request.auth.ownerId) }),
  );

  app.put(
    '/classifier-models/:id',
    {
      schema: {
        tags: ['settings'],
        summary: 'Create or replace custom HTTP classifier metadata',
        description:
          'Requires settings:write, and secrets:write when secretRef is supplied. New entries start disabled; edits preserve enabled. Omitted secretRef clears authentication. Built-in Jev returns 409 CLASSIFIER_MANAGED_BY_SYSTEM.',
        params,
        body: ClassifierModelPutSchema,
        response,
      },
      preValidation: async (request, reply) => {
        if (request.params.id === 'jev')
          return problem(
            reply,
            409,
            'CLASSIFIER_MANAGED_BY_SYSTEM',
            'Built-in Jev can only be enabled or disabled',
          );
      },
    },
    async (request, reply) => {
      if (request.body.secretRef !== undefined && !hasScope(request.auth.scopes, 'secrets:write'))
        return problem(
          reply,
          403,
          'FORBIDDEN',
          'Attaching a classifier secret requires the secrets:write scope',
        );
      const entry = await classifiers.upsert(request.auth.ownerId, request.params.id, request.body);
      await container.onClassifierChanged(request.auth.ownerId, entry.id);
      return container.classifierRegistry.summarize(request.auth.ownerId, entry);
    },
  );
  app.patch(
    '/classifier-models/:id',
    {
      schema: {
        tags: ['settings'],
        summary: 'Enable or disable a classifier model',
        params,
        body: ClassifierModelPatchSchema,
        response,
      },
    },
    async (request, reply) => {
      const entry = await classifiers.setEnabled(
        request.auth.ownerId,
        request.params.id,
        request.body.enabled,
      );
      if (!entry)
        return problem(
          reply,
          404,
          'CLASSIFIER_MODEL_NOT_FOUND',
          `Classifier '${request.params.id}' not found`,
        );
      await container.onClassifierChanged(request.auth.ownerId, entry.id);
      return container.classifierRegistry.summarize(request.auth.ownerId, entry);
    },
  );
  app.delete(
    '/classifier-models/:id',
    {
      schema: {
        tags: ['settings'],
        summary: 'Remove a custom classifier, preserving secrets and loop references',
        params,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      if (request.params.id === 'jev')
        return problem(
          reply,
          409,
          'CLASSIFIER_MANAGED_BY_SYSTEM',
          'Built-in Jev can only be enabled or disabled',
        );
      if (!(await classifiers.delete(request.auth.ownerId, request.params.id)))
        return problem(
          reply,
          404,
          'CLASSIFIER_MODEL_NOT_FOUND',
          `Classifier '${request.params.id}' not found`,
        );
      await container.onClassifierChanged(request.auth.ownerId, request.params.id);
      return reply.status(204).send(null);
    },
  );
}
