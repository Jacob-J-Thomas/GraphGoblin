import { z } from 'zod';

/** Installation-local catalog id. `jev` is reserved for the system-managed built-in. */
export const ClassifierModelIdSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);
export const ClassifierSecretRefSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/);
export const ClassifierPrimitiveSchema = z.enum(['choice', 'noul', 'score']);
export const ClassifierPrimitivesSchema = z
  .array(ClassifierPrimitiveSchema)
  .min(1)
  .max(3)
  .refine((values) => new Set(values).size === values.length, 'primitives must be unique');
export const ClassifierEndpointSchema = z
  .url({ protocol: /^https?$/ })
  .max(4096)
  .refine(
    (value) => /^https?:\/\/[^\s/?#@\\]+(?:\/[^\s?#\\]*)?$/i.test(value),
    'endpoint must be an HTTP(S) API root without credentials, query, or fragment',
  )
  .refine((value) => !/^https?:\/\/[^/]*:0+(?:\/|$)/i.test(value), 'endpoint must not use port 0')
  .refine((value) => {
    try {
      return !/\s/.test(decodeURI(value));
    } catch {
      return false;
    }
  }, 'endpoint must not contain whitespace or malformed encoding')
  .refine(
    (value) => !/\/v1\/systemone\/*$/i.test(value),
    'endpoint must be an API root, without the /v1/systemone request path',
  );

const HttpsEndpointSchema = z.url({ protocol: /^https$/ });
const LoopbackEndpointSchema = z.url({
  hostname: /^(?:localhost|127(?:\.[0-9]{1,3}){3}|\[::1\])$/i,
});
function safeBearerEndpoint(entry: { endpoint: string; secretRef?: string | undefined }): boolean {
  return (
    entry.secretRef === undefined ||
    HttpsEndpointSchema.safeParse(entry.endpoint).success ||
    LoopbackEndpointSchema.safeParse(entry.endpoint).success
  );
}
const bearerEndpointIssue = {
  message:
    'An endpoint with secretRef must use HTTPS unless its host is loopback (localhost, 127.0.0.0/8, or [::1])',
  path: ['endpoint'],
};

const Metadata = {
  displayName: z.string().trim().min(1).max(120),
  providerModel: z.string().trim().min(1).max(256),
  primitives: ClassifierPrimitivesSchema,
  endpoint: ClassifierEndpointSchema,
  secretRef: ClassifierSecretRefSchema.optional(),
};

export const ClassifierModelEntrySchema = z
  .strictObject({
    id: ClassifierModelIdSchema,
    ...Metadata,
    source: z.enum(['builtin', 'custom']),
    provider: z.enum(['typesafe', 'http']),
    enabled: z.boolean(),
  })
  .refine(safeBearerEndpoint, bearerEndpointIssue)
  .refine(
    (entry) =>
      entry.source === 'builtin'
        ? entry.id === 'jev' && entry.provider === 'typesafe'
        : entry.id !== 'jev' && entry.provider === 'http',
    'jev/typesafe is system-managed; custom entries must use HTTP and another id',
  );

export const ClassifierModelSummarySchema = ClassifierModelEntrySchema.safeExtend({
  configured: z.boolean(),
  configurationReason: z.string().optional(),
});
/** PUT replaces custom metadata; credentials, ownership, and enabled state are never input. */
export const ClassifierModelPutSchema = z
  .strictObject({
    ...Metadata,
    provider: z.literal('http'),
  })
  .refine(safeBearerEndpoint, bearerEndpointIssue);
export const ClassifierModelPatchSchema = z.strictObject({ enabled: z.boolean() });

/** Minimum Choice response; providers may attach model and usage metadata. */
export const ClassifierChoiceResponseSchema = z.object({
  model: z.string().optional(),
  usage: z.unknown().optional(),
  answers: z.object({
    answer: z.object({
      type: z.literal('choice'),
      choice: z.string(),
      confidence: z.number().min(0).max(1).optional(),
      probabilities: z.record(z.string(), z.number().min(0).max(1)),
    }),
  }),
});

export type ClassifierModelId = z.infer<typeof ClassifierModelIdSchema>;
export type ClassifierModelEntry = z.infer<typeof ClassifierModelEntrySchema>;
export type ClassifierModelSummary = z.infer<typeof ClassifierModelSummarySchema>;
export type ClassifierModelPut = z.infer<typeof ClassifierModelPutSchema>;
