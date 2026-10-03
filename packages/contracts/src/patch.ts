import { z } from 'zod';
import { JsonPointerSchema, JsonValueSchema } from './common.js';

/** RFC 6902 JSON Patch operations. Nodes change the context thread only through these. */
export const PatchOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add'), path: JsonPointerSchema, value: JsonValueSchema }),
  z.strictObject({ op: z.literal('remove'), path: JsonPointerSchema }),
  z.strictObject({ op: z.literal('replace'), path: JsonPointerSchema, value: JsonValueSchema }),
  z.strictObject({ op: z.literal('move'), from: JsonPointerSchema, path: JsonPointerSchema }),
  z.strictObject({ op: z.literal('copy'), from: JsonPointerSchema, path: JsonPointerSchema }),
  z.strictObject({ op: z.literal('test'), path: JsonPointerSchema, value: JsonValueSchema }),
]);
export type PatchOperation = z.infer<typeof PatchOperationSchema>;

export const JsonPatchSchema = z.array(PatchOperationSchema);
export type JsonPatch = z.infer<typeof JsonPatchSchema>;
