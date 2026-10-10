import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RunEventSchema, V2RunEventSchema } from '@graphgoblin/contracts';
import { FIXTURE_IDS, FIXTURE_TS, sampleThread } from '@graphgoblin/contracts/testing';
import { upgradeRunHistoryCurrent } from './upgrade-history-current.js';
import { upgradeRunHistoryV1 } from './upgrade-history.js';

// Exact payload keys from the stopped-store rehearsal; IDs and text are sanitised.
const fixtures = JSON.parse(
  readFileSync(new URL('./upgrade-fixtures/pre-cutover-events.json', import.meta.url), 'utf8'),
) as { progress: Record<string, unknown>[]; decisions: Record<string, unknown>[] };
const event = (seq: number, type: string, payload: Record<string, unknown>) => ({
  runId: FIXTURE_IDS.run,
  ts: FIXTURE_TS,
  nodeId: 'decide',
  seq,
  type,
  ...payload,
});
const convert = (events: unknown[]) =>
  upgradeRunHistoryCurrent({ initialThread: sampleThread(), events, decisionNodeIds: ['decide'] });

describe('pre-cutover recorded history', () => {
  it.each([1, 2] as const)(
    'converts format %i facts with full and checkpoint replay equality',
    (sourceVersion) => {
      const fact = fixtures.decisions[1]!;
      const output = { nodeId: 'decide', at: FIXTURE_TS, value: fact };
      const events = [
        event(1, 'node.started', { kind: 'decision', attempt: 1, configHash: 'fixture' }),
        ...fixtures.progress.map((progress, index) =>
          event(index + 2, 'node.progress', { progress }),
        ),
        event(6, 'decision.made', fact),
        event(7, 'node.finished', {
          durationMs: 1,
          route: 'plannerB',
          patch: [
            { op: 'add', path: '/outputs/decide', value: output },
            { op: 'add', path: '/lastOutput', value: output },
          ],
        }),
      ];
      const initialThread = sampleThread();
      const snapshot = {
        ...initialThread,
        counters: {
          ...initialThread.counters,
          nodeVisits: { ...initialThread.counters.nodeVisits, decide: 1 },
        },
      };
      const result = upgradeRunHistoryCurrent({
        sourceVersion,
        initialThread,
        events,
        decisionNodeIds: ['decide'],
        snapshot,
        snapshotSeq: 5,
      });
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      expect(result.value.events[1]).toEqual(
        event(2, 'node.progress', {
          progress: { item: { id: 'item-1', type: 'other', summary: 'Command completed' } },
        }),
      );
      for (const index of [2, 3, 4]) expect(result.value.events[index]).toEqual(events[index]);
      expect(result.value.events[5]).toEqual(
        event(6, 'decision.made', {
          answer: { type: 'choice', optionId: 'plannerB', confidence: 1, probabilities: null },
          portId: 'plannerB',
          provenance: {
            kind: 'classifier',
            provider: null,
            classifierId: 'jev',
            model: null,
            effort: null,
          },
          diagnostics: [],
        }),
      );
      const made = result.value.events[5]!;
      if (made.type !== 'decision.made') throw new Error('decision fixture missing');
      expect(result.value.finalThread.outputs.decide?.value).toEqual({
        answer: made.answer,
        portId: made.portId,
        provenance: made.provenance,
      });
      expect(result.value.finalThread.lastOutput?.value).toEqual(
        result.value.finalThread.outputs.decide?.value,
      );
      expect(result.value.snapshot).toEqual(snapshot);
      expect(events[1]).toEqual(event(2, 'node.progress', { progress: fixtures.progress[0] }));
    },
  );
  it('represents unrecorded expression confidence and provenance with canonical nulls', () => {
    const result = convert([event(1, 'decision.made', fixtures.decisions[0]!)]);
    if (!result.ok) throw new Error('fixture refused');
    expect(result.value.events[0]).toMatchObject({
      answer: { optionId: 'pass', confidence: null, probabilities: null },
      provenance: {
        kind: 'expression',
        provider: null,
        classifierId: null,
        model: null,
        effort: null,
      },
      diagnostics: [],
    });
  });
  it('keeps recorded skip diagnostics and strict command lifecycle facts', () => {
    const progress = {
      item: {
        id: 'current',
        type: 'command',
        summary: 'Recorded failure',
        status: 'failed',
        commandPreview: 'node example.mjs',
        exitCode: 2,
      },
    };
    const events = [
      event(1, 'node.progress', { progress }),
      event(2, 'decision.made', {
        ...fixtures.decisions[0],
        skipped: [{ strategy: 'codex', code: 'PROVIDER_UNAVAILABLE', message: 'Not configured' }],
      }),
    ];
    const result = convert(events);
    if (!result.ok) throw new Error('fixture refused');
    expect(result.value.events[0]).toEqual(events[0]);
    expect(result.value.events[1]).toMatchObject({
      diagnostics: [{ code: 'PROVIDER_UNAVAILABLE', message: 'Not configured' }],
    });
  });
  it('does not broaden runtime parsing or already-current store validation', () => {
    for (const raw of [
      event(1, 'node.progress', { progress: fixtures.progress[0] }),
      ...fixtures.decisions.map((fact) => event(1, 'decision.made', fact)),
    ]) {
      expect(RunEventSchema.safeParse(raw).success).toBe(false);
      expect(V2RunEventSchema.safeParse(raw).success).toBe(false);
      expect(
        upgradeRunHistoryCurrent({
          sourceVersion: 3,
          initialThread: sampleThread(),
          events: [raw],
          decisionNodeIds: ['decide'],
        }).ok,
      ).toBe(false);
      expect(
        upgradeRunHistoryV1({
          initialThread: sampleThread(),
          events: [raw],
          decisionNodeIds: ['decide'],
        }).ok,
      ).toBe(true);
    }
  });
  it.each([
    { item: { id: 'x', type: 'command' } },
    { item: { id: '', type: 'command', summary: '' } },
    { item: { id: 'x', type: 'command', summary: '', status: null } },
    { item: { id: 'x', type: 'command', summary: '', status: 'unknown' } },
    { item: { id: 'x', type: 'command', summary: '', commandPreview: 'unshipped shape' } },
    { item: { id: 'x', type: 'command', summary: '', exitCode: 0 } },
    { item: { id: 'x', type: 'unknown', summary: '' } },
    { item: { id: 'x', type: 'command', summary: '' }, extra: true },
  ])('refuses malformed or unestablished historical progress %j', (progress) => {
    expect(convert([event(1, 'node.progress', { progress })]).ok).toBe(false);
  });
  it.each([
    { ...fixtures.decisions[0], skipped: null },
    { ...fixtures.decisions[0], skipped: [{}] },
    { ...fixtures.decisions[0], strategy: 'unknown' },
    { ...fixtures.decisions[0], confidence: 2 },
    { strategy: 'expression' },
    { ...fixtures.decisions[0], unknown: true },
  ])('refuses malformed historical decisions %j', (fact) => {
    expect(convert([event(1, 'decision.made', fact)]).ok).toBe(false);
  });
});
