import { z } from 'zod';
import {
  TemplateInstanceSchema,
  TemplateSettingsSchemas,
  type TemplateCatalogEntry,
  type TemplateInstantiateRequest,
  type TemplateInstantiateResponse,
} from '@graphgoblin/contracts';
import { prepareTemplateBundle, stableHash } from '@graphgoblin/domain';
import type { ClockPort, IdPort } from '@graphgoblin/engine';
import type { SqliteTemplateInstances } from '@graphgoblin/infrastructure/sqlite';
import { TemplateBindingSchema, bindingJson, executionHash } from './binding.js';
import type { TemplateCatalog } from './catalog.js';
import type { TemplatePrerequisites } from './prerequisites.js';
import { TemplateError } from './errors.js';

export class TemplateInstances {
  constructor(
    readonly catalog: TemplateCatalog,
    readonly prerequisites: TemplatePrerequisites,
    readonly store: SqliteTemplateInstances,
    private readonly ids: IdPort,
    private readonly clock: ClockPort,
  ) {}
  async entry(ownerId: string, id: string): Promise<TemplateCatalogEntry> {
    const { bundle } = await this.catalog.get(id);
    const settings = await this.prerequisites.defaults(bundle.manifest);
    return {
      manifest: bundle.manifest,
      settingsSchema: z.toJSONSchema(TemplateSettingsSchemas[bundle.manifest.kind]),
      defaultSettings: settings,
      prerequisites: await this.prerequisites.check(ownerId, bundle.manifest, settings),
    };
  }
  async list(ownerId: string) {
    const entries = await this.catalog.list();
    return Promise.all(entries.map(({ bundle }) => this.entry(ownerId, bundle.manifest.id)));
  }
  async check(ownerId: string, id: string, settings: unknown) {
    return this.prerequisites.check(
      ownerId,
      (await this.catalog.get(id)).bundle.manifest,
      settings,
    );
  }
  async instantiate(
    ownerId: string,
    id: string,
    request: TemplateInstantiateRequest,
  ): Promise<TemplateInstantiateResponse> {
    const { bundle, support } = await this.catalog.get(id);
    const report = await this.prerequisites.check(ownerId, bundle.manifest, request.settings);
    if (!report.canInstantiate)
      throw new TemplateError(
        'TEMPLATE_PREREQUISITES_MISSING',
        'Complete the authoring prerequisites before creating this template.',
      );
    const instanceId = this.ids.next();
    const baseName = (request.name ?? bundle.manifest.title).trim();
    if (!baseName)
      throw new TemplateError('TEMPLATE_SETTINGS_INVALID', 'Choose a nonblank instance name.', 400);
    const allocations = Object.fromEntries(
      bundle.manifest.loops.map((loop) => [
        loop.key,
        {
          loopId: this.ids.next(),
          versionId: this.ids.next(),
          version: 1,
          name: baseName.slice(0, 75) + ' / ' + loop.key.slice(0, 12) + ' / ' + instanceId,
        },
      ]),
    );
    const prepared = prepareTemplateBundle(bundle, request.settings, allocations);
    const instance = TemplateInstanceSchema.parse({
      id: instanceId,
      ownerId,
      templateId: bundle.manifest.id,
      templateVersion: bundle.manifest.version,
      createdAt: this.clock.now().toISOString(),
      parentLoopId: prepared.parentLoopId,
      loops: prepared.loops.map(({ key, loopId, versionId, version, status }) => ({
        key,
        loopId,
        versionId,
        version,
        status,
      })),
      settings: prepared.settings,
    });
    const binding = TemplateBindingSchema.parse({
      instanceId,
      ownerId,
      manifest: prepared.manifest,
      settings: prepared.settings,
      loops: prepared.loops.map((loop) => ({
        key: loop.key,
        loopId: loop.loopId,
        versionId: loop.versionId,
        hash: executionHash(loop.definition),
        nodes: Object.fromEntries(
          loop.definition.nodes.map((node) => [
            node.id,
            { kind: node.kind, configHash: stableHash(node.config) },
          ]),
        ),
      })),
      ...(support ? { support } : {}),
    });
    await this.store.create(instance, bindingJson(binding), prepared.loops);
    return { instance, prerequisites: report };
  }
  async get(ownerId: string, id: string) {
    const stored = await this.store.get(ownerId, id);
    if (!stored)
      throw new TemplateError(
        'TEMPLATE_INSTANCE_NOT_FOUND',
        'This template instance was not found.',
        404,
      );
    return stored.instance;
  }
}
