import { z } from 'zod';
import { ExpressionSchema } from './common.js';
import { field } from './meta.js';

const dedupeKey = ExpressionSchema.optional().meta(
  field('JSONata producing a key; a repeated key does not start another run.'),
);
const filter = ExpressionSchema.optional().meta(
  field('JSONata predicate; payloads that fail it are recorded and ignored.'),
);

/** Existing timestamp signing retains its top-level window and defaults. */
export const TimestampWebhookConfigSchema = z
  .strictObject({
    subtype: z.literal('webhook'),
    signature: z
      .strictObject({
        scheme: z.literal('hmac-sha256'),
        header: z.string().min(1).max(128).default('x-graphgoblin-signature'),
        secretRef: z.string().min(1).max(128),
      })
      .meta(field('HMAC of the timestamp and body using the selected secret.')),
    replayWindowSeconds: z
      .number()
      .int()
      .positive()
      .max(86_400)
      .default(300)
      .meta(field('How far the signed timestamp may be from the server clock.')),
    dedupeKey,
    filter,
  })
  .meta(
    field('Webhook authenticated by a signed timestamp and body.', {
      title: 'webhook (timestamp)',
    }),
  );

/** Body signatures have indefinite raw-content replay suppression and no timestamp window. */
export const BodyWebhookConfigSchema = z
  .strictObject({
    subtype: z.literal('webhook'),
    signature: z
      .strictObject({
        scheme: z.literal('hmac-sha256-body'),
        header: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
          .default('x-hub-signature-256'),
        secretRef: z.string().min(1).max(128),
      })
      .meta(field('HMAC of the exact raw request body using the selected secret.')),
    dedupeKey,
    filter,
  })
  .meta(
    field('Webhook authenticated by exact body bytes; repeated content remains consumed.', {
      title: 'webhook (body)',
    }),
  );

export const WebhookConfigSchema = z.union([TimestampWebhookConfigSchema, BodyWebhookConfigSchema]);
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
