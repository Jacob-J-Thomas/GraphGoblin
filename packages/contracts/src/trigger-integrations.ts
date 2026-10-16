import { z } from 'zod';
import { ExpressionSchema } from './common.js';
import { field } from './meta.js';

const dedupeKey = ExpressionSchema.optional().meta(
  field('JSONata producing a key; a repeated key does not start another run.'),
);
const filter = ExpressionSchema.optional().meta(
  field('JSONata predicate; payloads that fail it are recorded and ignored.'),
);

/** Lowercase HTTP field-name (RFC 9110 token). */
export const HeaderNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[!#$%&'*+.^_`|~0-9a-z-]+$/);
export type HeaderName = z.infer<typeof HeaderNameSchema>;
/** Metadata preserves authored whitespace, but cannot be blank or contain controls. */
export const EventNameSchema = z
  .string()
  .min(1)
  .max(128)
  // eslint-disable-next-line no-control-regex -- Event names explicitly exclude control characters.
  .regex(/^(?!\s*$)[^\u0000-\u001f\u007f-\u009f]+$/u);
export type EventName = z.infer<typeof EventNameSchema>;
const SecretNameSchema = z.string().min(1).max(128);

export const WebhookAuthenticationSchema = z.union([
  z
    .strictObject({ type: z.literal('none').default('none') })
    .meta(field('No authenticated sender identity.', { title: 'None' })),
  z
    .strictObject({
      type: z.literal('hmac-sha256'),
      message: z.literal('body'),
      header: HeaderNameSchema.default('x-hub-signature-256').meta(
        field('Header carrying the raw-body HMAC.'),
      ),
      secretRef: SecretNameSchema.meta(
        field('Name in the owner secret store; never the secret value.'),
      ),
    })
    .meta(field('HMAC of exact raw request bytes.', { title: 'Body HMAC' })),
  z
    .strictObject({
      type: z.literal('hmac-sha256'),
      message: z.literal('timestamp-body'),
      header: HeaderNameSchema.default('x-graphgoblin-signature').meta(
        field('Header carrying the timestamp/body HMAC.'),
      ),
      secretRef: SecretNameSchema.meta(
        field('Name in the owner secret store; never the secret value.'),
      ),
      windowSeconds: z
        .number()
        .int()
        .min(1)
        .max(86400)
        .default(300)
        .meta(field('Allowed timestamp distance from the server clock, in seconds.')),
    })
    .meta(
      field('HMAC of timestamp, dot and exact raw bytes.', { title: 'Timestamp and body HMAC' }),
    ),
]);
export type WebhookAuthentication = z.infer<typeof WebhookAuthenticationSchema>;
export const WebhookBodySchema = z.strictObject({
  type: z
    .enum(['json', 'text', 'bytes'])
    .default('json')
    .meta(field('Decode JSON, UTF-8 text or base64 bytes.', { title: 'Body mode' })),
});
export type WebhookBody = z.infer<typeof WebhookBodySchema>;
export const WebhookPointerSchema = z
  .string()
  .max(1024)
  .regex(/^(?:\/(?:[^~]|~[01])*)?$/)
  .refine((value) => value.split('/').length - 1 <= 32, 'At most 32 JSON pointer segments');
export const WebhookEventTypeSchema = z.union([
  z
    .strictObject({
      source: z.literal('constant').default('constant'),
      value: EventNameSchema.default('webhook').meta(field('Constant event metadata.')),
    })
    .meta(field('Use one event name.', { title: 'Constant' })),
  z
    .strictObject({
      source: z.literal('header'),
      name: HeaderNameSchema.meta(field('Header containing the event name.')),
      fallback: EventNameSchema.default('webhook').meta(
        field('Used when the selected value is absent, blank or nonscalar.'),
      ),
    })
    .meta(field('Read an HTTP header.', { title: 'Header' })),
  z
    .strictObject({
      source: z.literal('json-pointer'),
      pointer: WebhookPointerSchema.meta(
        field('RFC 6901 pointer into a JSON body; empty selects the root.'),
      ),
      fallback: EventNameSchema.default('webhook').meta(
        field('Used when the selected value is absent, blank or nonscalar.'),
      ),
    })
    .meta(field('Read a JSON body value.', { title: 'JSON pointer' })),
]);
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;
export const WebhookConfigSchema = z
  .strictObject({
    type: z.literal('webhook'),
    authentication: WebhookAuthenticationSchema.prefault({}).meta(
      field('How the sender authenticates the raw request.'),
    ),
    body: WebhookBodySchema.prefault({}).meta(field('Representation of the trigger payload.')),
    eventType: WebhookEventTypeSchema.prefault({}).meta(
      field('Invocation metadata; does not publish an Event.'),
    ),
    dedupeKey,
    filter,
  })
  .refine((value) => value.eventType.source !== 'json-pointer' || value.body.type === 'json', {
    path: ['eventType', 'pointer'],
    message: 'JSON pointers require JSON body mode',
  });
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

/** Optional bounded fanout over a curated JSON probe result. */
export const PollItemsSchema = z.strictObject({
  select: ExpressionSchema.meta(
    field('JSONata over {now,probe}; return at most 200 curated items.'),
  ),
  dedupeKey: ExpressionSchema.meta(
    field(
      "JSONata over {now,probe,item,index}; return each item's nonblank unique string key, at most 512 characters.",
    ),
  ),
  maxRunsPerPoll: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(5)
    .meta(
      field(
        'Maximum unseen items admitted per poll; previously seen keys do not consume this cap.',
      ),
    ),
});
export type PollItems = z.infer<typeof PollItemsSchema>;
