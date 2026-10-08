import { describe, expect, it } from 'vitest';
import { type JsonValue, PollItemsSchema } from '@graphgoblin/contracts';
import { preparePollItems } from './poll-items.js';
const now = '2026-10-07T12:00:00.000Z';
const config = (select = 'probe', dedupeKey = 'item.key') =>
  PollItemsSchema.parse({ select, dedupeKey });

describe('complete poll-items preparation', () => {
  it('keeps every curated item and stable key in order without applying the dispatch cap early', async () => {
    const probe = Array.from({ length: 200 }, (_, index) => ({
      key: 'item-' + index,
      value: index,
    }));
    const prepared = await preparePollItems(config(), { now, probe });
    expect(prepared).toHaveLength(200);
    expect(prepared[0]).toEqual({ item: probe[0], index: 0, dedupeKey: 'item-0' });
    expect(prepared[199]).toEqual({ item: probe[199], index: 199, dedupeKey: 'item-199' });
    expect(await preparePollItems(config(), { now, probe: [] })).toEqual([]);
  });

  it('evaluates selectors with now/probe and keys with the original item/index', async () => {
    expect(
      await preparePollItems(config('probe.items', 'now & ":" & $string(index) & ":" & item.key'), {
        now,
        probe: { items: [{ key: 'one' }, { key: 'two' }] },
      }),
    ).toMatchObject([
      { index: 0, dedupeKey: now + ':0:one' },
      { index: 1, dedupeKey: now + ':1:two' },
    ]);
  });

  it('refuses nonarrays and overlarge unpartitioned results, without silently selecting their first items', async () => {
    for (const probe of [null, true, 'x', 1, { key: 'x' }] as JsonValue[])
      await expect(preparePollItems(config(), { now, probe })).rejects.toMatchObject({
        reason: 'NOT_ARRAY',
        path: 'items.select',
      });
    await expect(
      preparePollItems(config(), {
        now,
        probe: Array.from({ length: 201 }, (_, index) => ({ key: String(index) })),
      }),
    ).rejects.toMatchObject({ reason: 'TOO_MANY_ITEMS' });
  });

  it('refuses every invalid key, including one past the default5 dispatch cap, before returning a partial plan', async () => {
    for (const key of [null, true, 1, {}, [], '', ' \t', 'x'.repeat(513)] as JsonValue[]) {
      const probe = [...Array.from({ length: 5 }, (_, index) => ({ key: String(index) })), { key }];
      await expect(preparePollItems(config(), { now, probe })).rejects.toMatchObject({
        reason: 'KEY_INVALID',
        path: 'items.dedupeKey',
        itemIndex: 5,
      });
    }
    const key = 'x'.repeat(512);
    expect(await preparePollItems(config(), { now, probe: [{ key }] })).toHaveLength(1);
  });

  it('refuses repeated keys and replaces raw selector/key evaluator diagnostics with safe codes', async () => {
    await expect(
      preparePollItems(config(), { now, probe: [{ key: 'same' }, { key: 'same' }] }),
    ).rejects.toMatchObject({ reason: 'KEY_DUPLICATE', itemIndex: 1 });
    for (const [select, dedupeKey, reason, path] of [
      ['$error("private selector token")', 'item.key', 'SELECTOR_FAILED', 'items.select'],
      ['probe', '$error("private key token")', 'KEY_FAILED', 'items.dedupeKey'],
    ]) {
      try {
        await preparePollItems(config(select, dedupeKey), { now, probe: [{ key: 'one' }] });
        throw new Error('expected refusal');
      } catch (error) {
        expect(error).toMatchObject({ code: 'POLL_ITEMS_INVALID', reason, path });
        expect(JSON.stringify(error)).not.toContain('private');
        expect(error).not.toHaveProperty('cause');
      }
    }
  });

  it('refuses selected non-JSON functions instead of carrying executable values into trigger input', async () => {
    await expect(
      preparePollItems(config('[function(){true}]'), { now, probe: [] }),
    ).rejects.toMatchObject({ reason: 'ITEM_INVALID', itemIndex: 0 });
  });
});
