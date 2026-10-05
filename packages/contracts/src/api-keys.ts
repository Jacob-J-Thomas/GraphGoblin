import { z } from 'zod';

/** API-key metadata: tokens and hashes are never included. */
export const ApiKeySchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  label: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
  revokedAt: z.string().optional(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

/** A request snapshot, never part of the stored record or key-creation response. */
export const ApiKeyListItemSchema = ApiKeySchema.extend({
  current: z.boolean(),
});
export type ApiKeyListItem = z.infer<typeof ApiKeyListItemSchema>;

export const ApiKeyListResponseSchema = z.object({ items: z.array(ApiKeyListItemSchema) });
export type ApiKeyListResponse = z.infer<typeof ApiKeyListResponseSchema>;
