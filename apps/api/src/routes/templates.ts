import { z } from 'zod';
import {
  SlugSchema,
  UlidSchema,
  TemplateCatalogEntrySchema,
  TemplateListResponseSchema,
  TemplatePrerequisiteReportSchema,
  TemplatePrerequisiteRequestSchema,
  TemplateInstantiateRequestSchema,
  TemplateInstantiateResponseSchema,
  TemplateInstanceSchema,
} from '@graphgoblin/contracts';
import type { ApiInstance } from '../types.js';
import type { Container } from '../container.js';
const TemplateParams = z.strictObject({ id: SlugSchema });
const InstanceParams = z.strictObject({ id: UlidSchema });
export function registerTemplateRoutes(app: ApiInstance, container: Container): void {
  app.get(
    '/templates',
    {
      schema: {
        tags: ['templates'],
        summary: 'List installed workflow templates',
        operationId: 'listTemplates',
        response: { 200: TemplateListResponseSchema },
      },
    },
    async (request) => ({ items: await container.templates.list(request.auth.ownerId) }),
  );
  app.get(
    '/templates/:id',
    {
      schema: {
        tags: ['templates'],
        summary: 'Read an installed workflow template',
        operationId: 'getTemplate',
        params: TemplateParams,
        response: { 200: TemplateCatalogEntrySchema },
      },
    },
    (request) => container.templates.entry(request.auth.ownerId, request.params.id),
  );
  app.post(
    '/templates/:id/prerequisites',
    {
      schema: {
        tags: ['templates'],
        summary: 'Check template prerequisites without creating loops',
        operationId: 'checkTemplatePrerequisites',
        params: TemplateParams,
        body: TemplatePrerequisiteRequestSchema,
        response: { 200: TemplatePrerequisiteReportSchema },
      },
    },
    (request) =>
      container.templates.check(request.auth.ownerId, request.params.id, request.body.settings),
  );
  app.post(
    '/templates/:id/instantiate',
    {
      schema: {
        tags: ['templates'],
        summary: 'Create an owner-bound template bundle',
        operationId: 'instantiateTemplate',
        params: TemplateParams,
        body: TemplateInstantiateRequestSchema,
        response: { 201: TemplateInstantiateResponseSchema },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await container.templates.instantiate(
            request.auth.ownerId,
            request.params.id,
            request.body,
          ),
        ),
  );
  app.get(
    '/template-instances/:id',
    {
      schema: {
        tags: ['templates'],
        summary: 'Read an owner-bound template instance',
        operationId: 'getTemplateInstance',
        params: InstanceParams,
        response: { 200: TemplateInstanceSchema },
      },
    },
    (request) => container.templates.get(request.auth.ownerId, request.params.id),
  );
}
