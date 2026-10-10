import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fieldMeta } from './meta.js';
import {
  BodyWebhookConfigSchema,
  PollItemsSchema,
  TimestampWebhookConfigSchema,
  WebhookConfigSchema,
} from './trigger-integrations.js';

describe('strict webhook signing branches', () => {
  it('preserves existing timestamp field placement, defaults, filter and dedupe', () => {
    const config = {
      subtype: 'webhook',
      signature: { scheme: 'hmac-sha256', secretRef: 'hook-key' },
      filter: 'payload.action = "opened"',
      dedupeKey: 'headers."x-github-delivery"',
    };
    expect(WebhookConfigSchema.parse(config)).toEqual({
      ...config,
      signature: { ...config.signature, header: 'x-graphgoblin-signature' },
      replayWindowSeconds: 300,
    });
    expect(WebhookConfigSchema.parse({ ...config, replayWindowSeconds: 42 })).toHaveProperty(
      'replayWindowSeconds',
      42,
    );
    expect(fieldMeta(TimestampWebhookConfigSchema).title).toBe('webhook (timestamp)');
  });

  it('defaults the body header while refusing any timestamp-window field', () => {
    const config = {
      subtype: 'webhook',
      signature: { scheme: 'hmac-sha256-body', secretRef: 'hook-key' },
    };
    expect(WebhookConfigSchema.parse(config)).toEqual({
      ...config,
      signature: { ...config.signature, header: 'x-hub-signature-256' },
    });
    expect(WebhookConfigSchema.safeParse({ ...config, replayWindowSeconds: 300 }).success).toBe(
      false,
    );
    expect(
      WebhookConfigSchema.safeParse({ ...config, replayWindowSeconds: undefined }).success,
    ).toBe(false);
    expect(fieldMeta(BodyWebhookConfigSchema).title).toBe('webhook (body)');
  });

  it('rejects unsupported schemes, missing secrets, injected headers and unknown fields', () => {
    for (const signature of [
      { scheme: 'sha1', secretRef: 'key' },
      { scheme: 'hmac-sha256-body' },
      { scheme: 'hmac-sha256-body', secretRef: '' },
      { scheme: 'hmac-sha256-body', secretRef: 'key', header: 'x-signature\r\nAuthorization' },
      { scheme: 'hmac-sha256-body', secretRef: 'key', header: 'x signature' },
      { scheme: 'hmac-sha256-body', secretRef: 'key', replayWindowSeconds: 1 },
    ])
      expect(WebhookConfigSchema.safeParse({ subtype: 'webhook', signature }).success).toBe(false);
    expect(
      WebhookConfigSchema.safeParse({
        subtype: 'webhook',
        signature: { scheme: 'hmac-sha256-body', secretRef: 'key' },
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it('exports distinct strict JSON-schema branches so the body form cannot author a window', () => {
    const timestamp = z.toJSONSchema(TimestampWebhookConfigSchema);
    const body = z.toJSONSchema(BodyWebhookConfigSchema);
    expect(timestamp).toHaveProperty('properties.replayWindowSeconds.default', 300);
    expect(body).not.toHaveProperty('properties.replayWindowSeconds');
    expect(body.additionalProperties).toBe(false);
    expect(timestamp.additionalProperties).toBe(false);
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
