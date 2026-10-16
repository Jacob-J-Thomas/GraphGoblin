import { describe, expect, it } from 'vitest';
import {
  WebhookConfigSchema,
  WebhookAuthenticationSchema,
  PollItemsSchema,
  HeaderNameSchema,
  EventNameSchema,
  WebhookPointerSchema,
} from './trigger-integrations.js';

describe('general webhook configuration', () => {
  it('defaults nested objects and recipe-specific fields', () => {
    expect(WebhookConfigSchema.parse({ type: 'webhook' })).toEqual({
      type: 'webhook',
      authentication: { type: 'none' },
      body: { type: 'json' },
      eventType: { source: 'constant', value: 'webhook' },
    });
    expect(
      WebhookAuthenticationSchema.parse({
        type: 'hmac-sha256',
        message: 'body',
        secretRef: 'hook',
      }),
    ).toEqual({
      type: 'hmac-sha256',
      message: 'body',
      secretRef: 'hook',
      header: 'x-hub-signature-256',
    });
    expect(
      WebhookAuthenticationSchema.parse({
        type: 'hmac-sha256',
        message: 'timestamp-body',
        secretRef: 'hook',
      }),
    ).toEqual({
      type: 'hmac-sha256',
      message: 'timestamp-body',
      secretRef: 'hook',
      header: 'x-graphgoblin-signature',
      windowSeconds: 300,
    });
  });
  it('accepts modes and extraction choices, retaining filter and key', () => {
    for (const type of ['json', 'text', 'bytes'])
      expect(
        WebhookConfigSchema.parse({
          type: 'webhook',
          body: { type },
          dedupeKey: 'id',
          filter: 'true',
        }).body.type,
      ).toBe(type);
    for (const eventType of [
      { source: 'header', name: 'x-event' },
      { source: 'json-pointer', pointer: '/a~1b/~0/0' },
      { source: 'json-pointer', pointer: '' },
    ])
      expect(WebhookConfigSchema.parse({ type: 'webhook', eventType }).eventType).toMatchObject({
        ...eventType,
        fallback: 'webhook',
      });
    for (const windowSeconds of [1, 86400])
      expect(
        WebhookAuthenticationSchema.parse({
          type: 'hmac-sha256',
          message: 'timestamp-body',
          secretRef: 'hook',
          windowSeconds,
        }),
      ).toHaveProperty('windowSeconds', windowSeconds);
  });
  it('refuses flat/unknown shapes and incompatible body/pointer configuration', () => {
    for (const extra of [
      { signature: { scheme: 'hmac-sha256' } },
      { replayWindowSeconds: 300 },
      { unknown: true },
      { authentication: { type: 'none', secretRef: 'key' } },
      { authentication: { type: 'hmac-sha256', message: 'body' } },
      {
        authentication: {
          type: 'hmac-sha256',
          message: 'body',
          secretRef: 'key',
          windowSeconds: 300,
        },
      },
      { body: { type: 'xml' } },
      { body: { type: 'text' }, eventType: { source: 'json-pointer', pointer: '/a' } },
    ])
      expect(WebhookConfigSchema.safeParse({ type: 'webhook', ...extra }).success).toBe(false);
    for (const windowSeconds of [0, 86401, 1.5])
      expect(
        WebhookConfigSchema.safeParse({
          type: 'webhook',
          authentication: {
            type: 'hmac-sha256',
            message: 'timestamp-body',
            secretRef: 'key',
            windowSeconds,
          },
        }).success,
      ).toBe(false);
  });
  it('bounds RFC header names, event names and RFC6901 pointers', () => {
    for (const value of ['', 'X-event', 'x event', 'x\r\nnext', 'x'.repeat(129)])
      expect(HeaderNameSchema.safeParse(value).success).toBe(false);
    expect(HeaderNameSchema.parse("x-!#$%&'*+.^_`|~012")).toBeDefined();
    for (const value of ['', ' ', '\t', 'a\u0000b', '\u007f', '\u0080', 'x'.repeat(129)])
      expect(EventNameSchema.safeParse(value).success).toBe(false);
    expect(EventNameSchema.parse(' issues ')).toBe(' issues ');
    for (const value of ['a', '/~', '/~2', '/'.repeat(33), '/' + 'a'.repeat(1024)])
      expect(WebhookPointerSchema.safeParse(value).success).toBe(false);
    for (const value of ['', '/~01', '/'.repeat(32), '/' + 'a'.repeat(1023)])
      expect(WebhookPointerSchema.safeParse(value).success).toBe(true);
  });
});

describe('bounded poll-items authoring', () => {
  it('requires the selector and per-item key, defaulting only the dispatch cap', () => {
    expect(PollItemsSchema.parse({ select: 'probe.json', dedupeKey: '$string(item.id)' })).toEqual({
      select: 'probe.json',
      dedupeKey: '$string(item.id)',
      maxRunsPerPoll: 5,
    });
    expect(
      PollItemsSchema.parse({ select: 'probe.json', dedupeKey: 'item.key', maxRunsPerPoll: 25 })
        .maxRunsPerPoll,
    ).toBe(25);
  });

  it('refuses absent/blank source fields, out-of-range/fractional caps and extra inputs', () => {
    for (const input of [
      {},
      { select: 'probe.json' },
      { select: '', dedupeKey: 'item.key' },
      { select: 'probe.json', dedupeKey: '' },
      ...[0, 26, 1.5].map((maxRunsPerPoll) => ({
        select: 'probe.json',
        dedupeKey: 'item.key',
        maxRunsPerPoll,
      })),
      { select: 'probe.json', dedupeKey: 'item.key', unknown: true },
    ])
      expect(PollItemsSchema.safeParse(input).success).toBe(false);
  });
});
