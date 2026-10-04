import {
  EffortSchema,
  JsonValueSchema,
  UlidSchema,
  ModelCatalogEntrySchema,
  ModelCatalogSourceSchema,
} from '@graphgoblin/contracts';
import { z } from 'zod';
import type { Container } from '../container.js';
import { hasScope } from '../plugins/auth.js';
import { problem } from '../plugins/errors.js';
import type { ApiInstance } from '../types.js';

const SecretSummarySchema = z.object({
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ApiKeySchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  label: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
  revokedAt: z.string().optional(),
});
const ModelEntrySchema = ModelCatalogEntrySchema;

/** Settings the engine reads (the run defaults); other keys are stored as given. */
const KnownSettingsSchema = z.looseObject({
  defaultModel: z.string().trim().min(1).max(256).optional(),
  defaultEffort: EffortSchema.optional(),
});

export function registerSettingsRoutes(app: ApiInstance, container: Container): void {
  const { repos } = container;

  // Settings -----------------------------------------------------------------
  app.get(
    '/settings',
    {
      schema: {
        tags: ['settings'],
        summary: 'Owner settings',
        response: { 200: z.record(z.string(), JsonValueSchema) },
      },
    },
    (request) => repos.settings.getAll(request.auth.ownerId),
  );

  app.put(
    '/settings',
    {
      schema: {
        tags: ['settings'],
        summary: 'Update owner settings',
        body: z.record(z.string(), JsonValueSchema),
        response: { 200: z.record(z.string(), JsonValueSchema) },
      },
    },
    async (request, reply) => {
      const known = KnownSettingsSchema.safeParse(request.body);
      if (!known.success) {
        return problem(
          reply,
          400,
          'VALIDATION_FAILED',
          'a known setting has an invalid value',
          known.error.issues.map((i) => ({ path: `/${i.path.join('/')}`, message: i.message })),
        );
      }
      for (const [key, value] of Object.entries(request.body))
        await repos.settings.set(request.auth.ownerId, key, value);
      return repos.settings.getAll(request.auth.ownerId);
    },
  );

  app.delete(
    '/settings/:key',
    {
      schema: {
        tags: ['settings'],
        summary: 'Reset one setting to its default',
        params: z.object({ key: z.string() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const deleted = await repos.settings.delete(request.auth.ownerId, request.params.key);
      if (!deleted)
        return problem(reply, 404, 'SETTING_NOT_FOUND', `setting ${request.params.key} not found`);
      return reply.status(204).send(null);
    },
  );

  // Secrets ------------------------------------------------------------------
  app.get(
    '/secrets',
    {
      schema: {
        tags: ['secrets'],
        summary: 'List secret names (values are never returned)',
        response: { 200: z.object({ items: z.array(SecretSummarySchema) }) },
      },
    },
    async (request) => ({
      items: await repos.secretsFor(request.auth.ownerId).list(),
    }),
  );

  app.put(
    '/secrets/:name',
    {
      schema: {
        tags: ['secrets'],
        summary: 'Create or replace a secret',
        params: z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/) }),
        body: z.object({ value: z.string().min(1).max(65_536) }),
        response: { 200: SecretSummarySchema },
      },
    },
    async (request) => {
      const summary = await repos
        .secretsFor(request.auth.ownerId)
        .set(request.params.name, request.body.value);
      await container.onSecretChanged(request.auth.ownerId, request.params.name);
      return summary;
    },
  );

  app.delete(
    '/secrets/:name',
    {
      schema: {
        tags: ['secrets'],
        summary: 'Delete a secret',
        params: z.object({ name: z.string() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const deleted = await repos.secretsFor(request.auth.ownerId).delete(request.params.name);
      if (!deleted)
        return problem(reply, 404, 'SECRET_NOT_FOUND', `secret ${request.params.name} not found`);
      await container.onSecretChanged(request.auth.ownerId, request.params.name);
      return reply.status(204).send(null);
    },
  );

  // API keys -----------------------------------------------------------------
  app.get(
    '/api-keys',
    {
      schema: {
        tags: ['api-keys'],
        summary: 'List API keys',
        response: { 200: z.object({ items: z.array(ApiKeySchema) }) },
      },
    },
    async (request) => ({
      items: await repos.apiKeys.list(request.auth.ownerId),
    }),
  );

  app.post(
    '/api-keys',
    {
      schema: {
        tags: ['api-keys'],
        summary: 'Create an API key; the token is shown once',
        description:
          'Requires api-keys:write. Scoped callers must list scopes explicitly (400 VALIDATION_FAILED) ' +
          'and may grant only scopes they hold; write implies read. Wildcard or unheld scopes return ' +
          '403 SCOPE_NOT_DELEGABLE with offending scopes in errors.scopes. Local trusted mode and ' +
          'wildcard callers may grant any scopes; only they may omit scopes to default to ["*"].',
        body: z.object({
          label: z.string().min(1).max(120),
          scopes: z.array(z.string()).optional(),
        }),
        response: { 201: z.object({ key: ApiKeySchema, token: z.string() }) },
      },
    },
    async (request, reply) => {
      const scopes = request.body.scopes;
      if (!hasScope(request.auth.scopes, '*')) {
        if (scopes === undefined) {
          return problem(
            reply,
            400,
            'VALIDATION_FAILED',
            'scoped API keys must list scopes explicitly when creating a key',
            [{ path: '/scopes', message: 'scopes is required for scoped API-key callers' }],
          );
        }
        const offendingScopes = scopes.filter((scope) => !hasScope(request.auth.scopes, scope));
        if (offendingScopes.length > 0) {
          return problem(
            reply,
            403,
            'SCOPE_NOT_DELEGABLE',
            `this key cannot grant the following scopes: ${offendingScopes.join(', ')}`,
            { scopes: offendingScopes },
          );
        }
      }
      const { record, token } = await repos.apiKeys.create(
        request.auth.ownerId,
        request.body.label,
        scopes ?? ['*'],
      );
      reply.status(201);
      return { key: record, token };
    },
  );

  app.delete(
    '/api-keys/:id',
    {
      schema: {
        tags: ['api-keys'],
        summary: 'Revoke an API key',
        params: z.object({ id: UlidSchema }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const revoked = await repos.apiKeys.revoke(request.auth.ownerId, request.params.id);
      if (!revoked)
        return problem(reply, 404, 'API_KEY_NOT_FOUND', `api key ${request.params.id} not found`);
      return reply.status(204).send(null);
    },
  );

  // Model catalog ------------------------------------------------------------
  app.get(
    '/model-catalog',
    {
      schema: {
        tags: ['settings'],
        summary: 'The model catalog',
        response: { 200: z.object({ items: z.array(ModelEntrySchema) }) },
      },
    },
    async () => ({ items: await repos.catalog.list() }),
  );

  app.put(
    '/model-catalog/:harness/:model',
    {
      schema: {
        tags: ['settings'],
        summary: 'Edit a LiteLLM catalog entry',
        description:
          'Harness entries return 409 MODEL_MANAGED_BY_HARNESS. New LiteLLM entries return 409 LITELLM_NOT_CONFIGURED until a provider is configured. Existing source is immutable; omitting enabled preserves its current value.',
        params: z.object({ harness: z.string(), model: z.string() }),
        body: z.object({
          displayName: z.string().min(1),
          efforts: z.array(EffortSchema).min(1),
          defaultEffort: EffortSchema,
          enabled: z.boolean().optional(),
          source: ModelCatalogSourceSchema.optional(),
        }),
        response: { 200: ModelEntrySchema },
      },
    },
    async (request, reply) => {
      const existing = await repos.catalog.findOne(request.params.harness, request.params.model);
      const source = existing?.source ?? request.body.source ?? 'harness';
      if (source === 'harness')
        return problem(
          reply,
          409,
          'MODEL_MANAGED_BY_HARNESS',
          existing
            ? 'Harness models can only be enabled or disabled'
            : 'Models for this harness come from the harness and cannot be added',
        );
      if (!existing)
        return problem(
          reply,
          409,
          'LITELLM_NOT_CONFIGURED',
          'LiteLLM is not configured; adding local models is not available yet',
        );
      if (request.body.source !== undefined && request.body.source !== source)
        return problem(reply, 400, 'INVALID_INPUT', 'catalog source cannot be changed');
      if (!request.body.efforts.includes(request.body.defaultEffort))
        return problem(reply, 400, 'INVALID_INPUT', 'defaultEffort must be one of efforts');
      const entry = {
        harness: request.params.harness,
        model: request.params.model,
        ...request.body,
        source,
        enabled: request.body.enabled ?? existing.enabled,
      };
      await repos.catalog.upsert(entry);
      return entry;
    },
  );

  app.patch(
    '/model-catalog/:harness/:model',
    {
      schema: {
        tags: ['settings'],
        summary: 'Enable or disable a catalog entry',
        description:
          'Requires settings:write. Updates only enabled for either source; 404 MODEL_NOT_FOUND when absent.',
        params: z.object({ harness: z.string(), model: z.string() }),
        body: z.strictObject({ enabled: z.boolean() }),
        response: { 200: ModelEntrySchema },
      },
    },
    async (request, reply) => {
      const entry = await repos.catalog.setEnabled(
        request.params.harness,
        request.params.model,
        request.body.enabled,
      );
      if (!entry) return problem(reply, 404, 'MODEL_NOT_FOUND', 'model not in catalog');
      return entry;
    },
  );

  app.delete(
    '/model-catalog/:harness/:model',
    {
      schema: {
        tags: ['settings'],
        summary: 'Remove a LiteLLM catalog entry',
        description:
          'Harness entries return 409 MODEL_MANAGED_BY_HARNESS; absent entries return 404 MODEL_NOT_FOUND.',
        params: z.object({ harness: z.string(), model: z.string() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const entry = await repos.catalog.findOne(request.params.harness, request.params.model);
      if (entry?.source === 'harness')
        return problem(
          reply,
          409,
          'MODEL_MANAGED_BY_HARNESS',
          'Harness models can only be enabled or disabled',
        );
      const deleted = await repos.catalog.delete(request.params.harness, request.params.model);
      if (!deleted) return problem(reply, 404, 'MODEL_NOT_FOUND', 'model not in catalog');
      return reply.status(204).send(null);
    },
  );
}
