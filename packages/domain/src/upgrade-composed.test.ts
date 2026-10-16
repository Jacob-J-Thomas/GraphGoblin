import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema, V3LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { minimalLoopV3 } from './__fixtures__/upgrade-v3.js';
import { convertDefinitionV3ToV4, definitionReviewHash } from './convert-v3-v4/index.js';
import { upgradeLoopToV3 } from './upgrade-v2-v3.js';
import {
  upgradeLoopCurrent,
  upgradeExportCurrent,
  validateUpgradeCurrentResolutions,
  type UpgradeCurrentResolutions,
} from './upgrade-current.js';

const envelope = (loop: { schemaVersion: number }) => ({
  format: 'graphgoblin-loop',
  formatVersion: loop.schemaVersion,
  exportedAt: FIXTURE_TS,
  loop,
});
const pending = () => {
  const source = minimalLoopV3();
  return {
    ...source,
    nodes: [
      source.nodes[0],
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config: {
          answer: {
            type: 'choice',
            options: [
              { id: 'yes', label: 'Yes', criteria: 'Ready' },
              { id: 'no', label: 'No', criteria: 'Pending' },
            ],
          },
          evaluation: {
            kind: 'llm',
            harness: 'codex',
            model: { mode: 'inherit' },
            effort: { mode: 'inherit' },
            question: 'Ready?',
          },
        },
      },
      source.nodes[1],
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
      ...['yes', 'no'].map((port) => ({
        id: port,
        from: { node: 'pick', port },
        to: { node: 'done' },
      })),
    ],
  };
};

describe('composed format-4 definition and export conversion', () => {
  it.each([1, 2, 3])(
    'matches the frozen stages and complete golden for v%s',
    async (schemaVersion) => {
      const input = { ...minimalLoopV3(), schemaVersion };
      const frozen = upgradeLoopToV3(input);
      if (!frozen.ok) throw new Error(JSON.stringify(frozen));
      const e2 = await convertDefinitionV3ToV4(
        frozen.value,
        {},
        'portable:' + (await definitionReviewHash(frozen.value)),
      );
      if (!e2.ok || !e2.ready) throw new Error(JSON.stringify(e2));
      const result = await upgradeLoopCurrent(input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result));
      expect(result.value).toEqual(e2.value);
      expect(LoopDefinitionSchema.parse(result.value)).toEqual(result.value);
      expect(result).toMatchSnapshot();
      expect(await upgradeExportCurrent(envelope(input))).toEqual({
        ...result,
        value: { ...envelope(input), formatVersion: 4, loop: result.value },
      });
      expect(input.schemaVersion).toBe(schemaVersion);
    },
  );

  it('uses E2 frozen shipped fixture reviews and hashes without changing them', async () => {
    const document = JSON.parse(
      readFileSync(
        new URL('./convert-v3-v4/fixtures/starter.v3.json', import.meta.url),
        'utf8',
      ).replace(/^\uFEFF/, ''),
    ) as { loop: unknown };
    const parsed = V3LoopDefinitionSchema.parse(document.loop);
    const e2 = await convertDefinitionV3ToV4(
      parsed,
      {},
      'portable:' + (await definitionReviewHash(parsed)),
    );
    const result = await upgradeLoopCurrent(document.loop);
    expect(result.reviewItems).toEqual(e2.reviewItems);
    expect(result).toMatchSnapshot();
  });

  it('withholds the candidate, lists ids/hashes/reasons, and accepts exact v3 approvals', async () => {
    const source = pending();
    const result = await upgradeLoopCurrent(source);
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(String),
          hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          message: expect.any(String),
        }),
      ]),
    });
    expect(result).not.toHaveProperty('value');
    const v3 = Object.fromEntries(
      result.reviewItems
        .filter((item) => item.status === 'pending')
        .map((item) => [
          item.id,
          { hash: item.hash, action: 'approve' as const, reason: 'Reviewed exact proposal' },
        ]),
    );
    expect((await upgradeLoopCurrent(source, { v3 })).ok).toBe(true);
    expect((await upgradeLoopCurrent({ ...source, name: 'changed' }, { v3 })).ok).toBe(false);
    expect(
      (
        await upgradeLoopCurrent(source, {
          v3: { unused: { hash: 'old', action: 'approve', reason: 'Reviewed' } },
        })
      ).ok,
    ).toBe(false);
    const id = Object.keys(v3)[0]!;
    expect(
      (
        await upgradeLoopCurrent(source, {
          v3: { [id]: { ...v3[id]!, extra: true } },
        } as unknown as UpgradeCurrentResolutions)
      ).ok,
    ).toBe(false);
  });

  it('keeps the earlier resolution namespaces separate and refuses unused stages', async () => {
    const base = minimalLoopV3();
    const old = {
      ...base,
      schemaVersion: 2,
      nodes: [
        base.nodes[0],
        {
          ...base.nodes[1],
          config: {
            criteria: [
              {
                when: 'predicate',
                strategy: 'expression',
                jsonata: 'vars.done',
                outcome: 'success',
              },
            ],
          },
        },
      ],
    };
    expect((await upgradeLoopCurrent(old)).ok).toBe(false);
    const v2 = { predicates: { '/nodes/1/config/criteria/0': { jsonata: 'vars.done = true' } } };
    const result = await upgradeLoopCurrent(old, { v2 });
    expect(result.reviewItems.some((item) => item.status === 'pending')).toBe(true);
    expect(result.notices.some((item) => item.code === 'UPGRADE_OWNER_EXIT')).toBe(true);
    for (const input of [minimalLoop(), minimalLoopV3(), { ...base, schemaVersion: 2 }]) {
      expect((await upgradeLoopCurrent(input, { v1: { sources: { '/unused': 'true' } } })).ok).toBe(
        false,
      );
    }
    expect((await upgradeLoopCurrent(minimalLoopV3(), { v2 })).ok).toBe(false);
    expect(
      (
        await upgradeLoopCurrent(
          { ...base, schemaVersion: 1 },
          { v1: { sources: { '/unused': 'true' } } },
        )
      ).ok,
    ).toBe(false);
  });

  it('binds portable filter reviews to source content and can complete their offline conversion', async () => {
    const source = minimalLoopV3();
    const filtered = {
      ...source,
      nodes: [
        {
          id: 'start',
          kind: 'trigger',
          label: 'Start',
          config: { subtype: 'event', eventType: 'ready', filter: 'ready = true' },
        },
        source.nodes[1],
      ],
    };
    const first = await upgradeLoopCurrent(filtered);
    expect(first.ok).toBe(false);
    const item = first.reviewItems.find((entry) => entry.kind === 'trigger-filter')!;
    expect(item.oldValue).toMatchObject({
      versionId: expect.stringMatching(/^portable:[a-f0-9]{64}$/),
    });
    const v3 = {
      [item.id]: {
        hash: item.hash,
        action: 'approve' as const,
        reason: 'Reviewed quiet run and consumed key behavior',
      },
    };
    expect((await upgradeLoopCurrent(filtered, { v3 })).ok).toBe(true);
    expect((await upgradeLoopCurrent({ ...filtered, name: 'changed' }, { v3 })).ok).toBe(false);
  });

  it('validates current definitions and exports, and rejects malformed envelopes or resolutions', async () => {
    expect(await upgradeLoopCurrent(minimalLoop())).toMatchObject({
      ok: true,
      value: { schemaVersion: 4 },
      notices: [],
      reviewItems: [],
    });
    expect((await upgradeExportCurrent(envelope(minimalLoop()))).ok).toBe(true);
    expect((await upgradeLoopCurrent({ ...minimalLoop(), unknown: true })).ok).toBe(false);
    for (const invalid of [
      null,
      [],
      { predicates: {} },
      { v1: null },
      { v2: [] },
      { v2: { sources: {} } },
      { v2: { predicates: { bad: {} } } },
      { v3: [] },
    ]) {
      expect(validateUpgradeCurrentResolutions(invalid).length).toBeGreaterThan(0);
      expect(
        (await upgradeLoopCurrent(minimalLoop(), invalid as UpgradeCurrentResolutions)).ok,
      ).toBe(false);
    }
    for (const invalid of [
      null,
      {},
      { ...envelope(minimalLoopV3()), formatVersion: 2 },
      { ...envelope(minimalLoopV3()), exportedAt: 'bad' },
      { ...envelope(minimalLoopV3()), resolutions: {} },
    ])
      expect((await upgradeExportCurrent(invalid)).ok).toBe(false);
    expect((await upgradeLoopCurrent(null)).ok).toBe(false);
  });
});
