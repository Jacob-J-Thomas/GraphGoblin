import {
  ClassifierModelSummarySchema,
  ClassifierModelPutSchema,
  ContextThreadSchema,
  JsonValueSchema,
  LoopDefinitionSchema,
  LoopExportSchema,
  LoopRecordSchema,
  LoopVersionRecordSchema,
  ReturnChannelSchema,
  RunEventSchema,
  RunFailureSchema,
  RunRecordSchema,
  RunStatusSchema,
  WaitSpecSchema,
} from '@graphgoblin/contracts';
import { z } from 'zod';

/**
 * Contract schemas emitted as named OpenAPI components instead of being inlined at every use.
 *
 * Recursive schemas must be registered: `JsonValue` is self-referential, and when it is inlined
 * fastify-type-provider-zod emits `$ref`s to a component it never writes, which leaves the document
 * unresolvable for generators such as openapi-typescript. Naming the large shared schemas also keeps
 * the document small and gives the generated client readable type names.
 *
 * A dedicated registry, not `z.globalRegistry`, so other `z.toJSONSchema` callers are unaffected.
 * Input-side components get an `Input` suffix (for example `LoopDefinitionInput`).
 */
export const openApiRegistry = z.registry<{ id: string }>();

const COMPONENTS: ReadonlyArray<[z.ZodType, string]> = [
  [ClassifierModelSummarySchema, 'ClassifierModelSummary'],
  [ClassifierModelPutSchema, 'ClassifierModelPut'],
  [JsonValueSchema, 'JsonValue'],
  [LoopDefinitionSchema, 'LoopDefinition'],
  [LoopExportSchema, 'LoopExport'],
  [LoopRecordSchema, 'LoopRecord'],
  [LoopVersionRecordSchema, 'LoopVersionRecord'],
  [RunStatusSchema, 'RunStatus'],
  [RunFailureSchema, 'RunFailure'],
  [WaitSpecSchema, 'WaitSpec'],
  [RunRecordSchema, 'RunRecord'],
  [RunEventSchema, 'RunEvent'],
  [ReturnChannelSchema, 'ReturnChannel'],
  [ContextThreadSchema, 'ContextThread'],
];
for (const [schema, id] of COMPONENTS) openApiRegistry.add(schema, { id });
