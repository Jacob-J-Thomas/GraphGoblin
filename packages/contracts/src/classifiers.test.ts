import { describe, expect, it } from 'vitest';
import { fakeUlid, FIXTURE_TS } from './testing/index.js';
import {
  ClassifierModelEntrySchema,
  ClassifierModelIdSchema,
  ClassifierModelPatchSchema,
  ClassifierModelPutSchema,
  ClassifierModelSummarySchema,
  DecisionConfigSchema,
  RunEventSchema,
} from './index.js';

const metadata = {
  displayName: 'Local Kev',
  provider: 'http' as const,
  providerModel: 'kev-4b',
  primitives: ['choice'],
  endpoint: 'http://127.0.0.1:9000',
  secretRef: 'kev-key',
};
describe('classifier contracts', () => {
  it('accepts built-in/custom metadata and separate derived state', () => {
    const custom = { id: 'kev.local-1', source: 'custom', ...metadata, enabled: false };
    expect(ClassifierModelEntrySchema.parse(custom)).toEqual(custom);
    expect(
      ClassifierModelSummarySchema.parse({
        ...custom,
        configured: false,
        configurationReason: "Missing secret 'kev-key'",
      }),
    ).toHaveProperty('configured', false);
    expect(
      ClassifierModelEntrySchema.parse({
        ...custom,
        id: 'jev',
        source: 'builtin',
        provider: 'typesafe',
        providerModel: 'jev-latest',
      }),
    ).toHaveProperty('id', 'jev');
    expect(
      ClassifierModelPutSchema.parse({ ...metadata, secretRef: undefined }),
    ).not.toHaveProperty('source');
    expect(ClassifierModelPatchSchema.parse({ enabled: true })).toEqual({ enabled: true });
  });
  it.each(['', '1model', '../kev', 'kev/path', 'white space', 'x'.repeat(65)])(
    'rejects invalid id %s',
    (id) => {
      expect(ClassifierModelIdSchema.safeParse(id).success).toBe(false);
    },
  );
  it.each([
    { source: 'custom' },
    { configured: true },
    { enabled: true },
    { apiKey: 'credential' },
    { secret: 'credential' },
    { displayName: ' ' },
    { providerModel: '' },
    { provider: 'typesafe' },
    { primitives: [] },
    { primitives: ['choice', 'choice'] },
    { primitives: ['classification'] },
    { endpoint: 'ftp://host' },
    { endpoint: 'https://user:password@host' },
    { endpoint: 'https://user@host' },
    { endpoint: 'https://host?token=secret' },
    { endpoint: 'https://host/#fragment' },
    { endpoint: 'not a URL' },
    { secretRef: '../key' },
    { secretRef: '' },
  ])('rejects unsafe/unsupported custom input %j', (change) => {
    expect(ClassifierModelPutSchema.safeParse({ ...metadata, ...change }).success).toBe(false);
  });
  it('reserves Jev and enforces ownership/provider combinations', () => {
    for (const change of [{ id: 'jev' }, { provider: 'typesafe' }, { source: 'builtin' }]) {
      expect(
        ClassifierModelEntrySchema.safeParse({
          id: 'kev',
          source: 'custom',
          ...metadata,
          enabled: true,
          ...change,
        }).success,
      ).toBe(false);
    }
    expect(
      ClassifierModelPatchSchema.safeParse({ enabled: true, displayName: 'rename' }).success,
    ).toBe(false);
    expect(ClassifierModelPatchSchema.safeParse({}).success).toBe(false);
  });
  it('round-trips optional selection and event provenance without materializing the default', () => {
    const input = {
      routes: [
        { label: 'yes', description: '' },
        { label: 'no', description: '' },
      ],
      question: 'Q',
      strategy: ['jev'],
    };
    expect(DecisionConfigSchema.parse(input)).not.toHaveProperty('jev');
    const selected = DecisionConfigSchema.parse({ ...input, jev: { model: 'kev' } });
    expect(DecisionConfigSchema.parse(JSON.parse(JSON.stringify(selected)))).toEqual(selected);
    expect(selected.jev).toEqual({ primitive: 'choice', model: 'kev' });
    const event = {
      runId: fakeUlid('run'),
      seq: 1,
      ts: FIXTURE_TS,
      type: 'decision.made',
      nodeId: 'choose',
      strategy: 'jev',
      route: 'yes',
    };
    expect(RunEventSchema.parse(event)).toEqual(event);
    expect(RunEventSchema.parse({ ...event, classifierModel: 'kev' })).toHaveProperty(
      'classifierModel',
      'kev',
    );
  });
});
