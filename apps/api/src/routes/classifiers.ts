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

/** One chain of PUTs per owner and classifier id, so a create-only check and its write never interleave. */
const classifierWrites = new Map<string, Promise<unknown>>();

function serializeClassifierWrite<T>(key: string, job: () => Promise<T>): Promise<T> {
  const next = (classifierWrites.get(key) ?? Promise.resolve()).then(job, job);
  const settled = next.catch(() => undefined);
  classifierWrites.set(key, settled);
  void settled.then(() => {
    if (classifierWrites.get(key) === settled) classifierWrites.delete(key);
  });
  return next;
}

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
          'Requires settings:write, and secrets:write when secretRef is supplied. New entries start disabled; edits preserve enabled. Omitted secretRef clears authentication. Built-in Jev returns 409 CLASSIFIER_MANAGED_BY_SYSTEM. Send `If-None-Match: *` to create only: an existing id then answers 409 CLASSIFIER_EXISTS and nothing changes.',
        params,
        headers: z.object({ 'if-none-match': z.literal('*').optional() }),
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
      const { ownerId } = request.auth;
      const { id } = request.params;
      const createOnly = request.headers['if-none-match'] === '*';
      // The existence check and the write run in one chain per entry, so of two create-only
      // requests for the same id exactly one creates it.
      const entry = await serializeClassifierWrite(`${ownerId}\n${id}`, async () => {
        if (createOnly && (await classifiers.findOne(ownerId, id))) return undefined;
        return classifiers.upsert(ownerId, id, request.body);
      });
      if (!entry)
        return problem(reply, 409, 'CLASSIFIER_EXISTS', `Classifier '${id}' already exists`);
      await container.onClassifierChanged(ownerId, entry.id);
      return container.classifierRegistry.summarize(ownerId, entry);
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
