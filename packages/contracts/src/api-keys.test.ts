import { describe, expect, it } from 'vitest';
import { ApiKeySchema, ApiKeyListItemSchema, ApiKeyListResponseSchema } from './index.js';

const metadata = {
  id: 'key-id',
  ownerId: 'local',
  label: 'client',
  scopes: ['api-keys:read'],
  createdAt: '2026-10-04T00:00:00.000Z',
};

describe('API-key contracts', () => {
  it.each([true, false])('requires and preserves current=%s on list items', (current) => {
    const item = { ...metadata, current };
    expect(ApiKeyListItemSchema.parse(item)).toEqual(item);
    expect(ApiKeyListResponseSchema.parse({ items: [item] })).toEqual({ items: [item] });
  });

  it.each([undefined, null, 'true', 1])('rejects invalid or missing current=%s', (current) => {
    expect(ApiKeyListItemSchema.safeParse({ ...metadata, current }).success).toBe(false);
    expect(ApiKeyListResponseSchema.safeParse({ items: [metadata] }).success).toBe(false);
  });

  it('keeps metadata free of current, tokens, and hashes', () => {
    expect(ApiKeySchema.parse(metadata)).toEqual(metadata);
    expect(
      ApiKeySchema.parse({ ...metadata, current: true, token: 'secret', hash: 'hash' }),
    ).toEqual(metadata);
    expect(ApiKeyListResponseSchema.parse({ items: [] })).toEqual({ items: [] });
    expect(
      ApiKeyListItemSchema.parse({ ...metadata, current: false, token: 'secret', hash: 'hash' }),
    ).toEqual({ ...metadata, current: false });
  });
});
