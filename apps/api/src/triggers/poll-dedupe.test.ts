import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  type JsonValue,
  type RunRecord,
} from '@graphgoblin/contracts';
import { samplePin } from '@graphgoblin/contracts/testing';
import type { StartRunInput } from '@graphgoblin/engine';
import { CapturingLogger, FakeClock, FakeProbes, FakeScripts } from '@graphgoblin/engine/testing';
import { PollTriggers } from './poll.js';

async function pollOnce(body: JsonValue, dedupeKey?: string, seen = false) {
  const clock = new FakeClock();
  const logger = new CapturingLogger();
  const now = clock.now().toISOString();
  const run: RunRecord = {
    id: 'run',
    ownerId: 'local',
    loopId: 'loop',
    versionId: 'version',
    pinned: samplePin(),
    invocationId: 'invocation',
    status: 'queued',
    iteration: 1,
    createdAt: now,
    lastEventSeq: 1,
  };
  const startRun = vi.fn((_input: StartRunInput) => Promise.resolve(run));
  const hasDedupe = vi.fn(() => Promise.resolve(seen));
  const polls = new PollTriggers({
    clock,
    logger,
    probes: new FakeProbes(() => ({ status: 200, headers: {}, body: JSON.stringify(body) })),
    scripts: new FakeScripts(),
    manager: {
      startRun,
      startPollItem: () => Promise.reject(new Error('unexpected items-mode admission')),
      assertAdmissionOpen: () => undefined,
    },
    hasDedupe,
    findSeen: () => Promise.reject(new Error('unexpected items-mode lookup')),
    scriptCwd: process.cwd(),
  });
  const definition = LoopDefinitionSchema.parse({
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Single-result key',
    nodes: [
      {
        id: 'poll',
        kind: 'trigger',
        label: 'Poll',
        config: {
          type: 'poll',
          intervalSeconds: 5,
          probe: { kind: 'http', url: 'http://127.0.0.1/' },
          fireWhen: 'true',
          ...(dedupeKey === undefined ? {} : { dedupeKey }),
        },
      },
    ],
    edges: [],
  });
  polls.arm(
    { id: 'loop', name: 'Single-result key', ownerId: 'local', createdAt: now, updatedAt: now },
    {
      id: 'version',
      loopId: 'loop',
      version: 1,
      status: 'published',
      definition,
      createdAt: now,
    },
  );
  clock.advance(5000);
  const runs = await polls.poll();
  return { runs, run, startRun, hasDedupe, warnings: logger.lines };
}

describe('single-result poll dedupe identities', () => {
  const prefix = 'x'.repeat(511);
  const pair = '\uD83D\uDE00';
  const expression = 'probe.json.key';

  it.each([
    { label: 'a lone high surrogate', key: 'private-high\uD800' },
    { label: 'a lone low surrogate', key: 'private-low\uDC00' },
    { label: 'a pair split by the 512-unit slice', key: prefix + pair },
  ])('refuses $label before any lookup or admission', async ({ key }) => {
    const { runs, startRun, hasDedupe, warnings } = await pollOnce(
      { key, marker: 'private payload' },
      expression,
    );

    expect(hasDedupe).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
    expect(runs).toEqual([]);
    expect(warnings).toEqual([
      {
        level: 'warn',
        msg: 'poll trigger failed',
        obj: {
          loopId: 'loop',
          nodeId: 'poll',
          code: 'POLL_DEDUPE_KEY_INVALID',
          reason: 'MALFORMED_DEDUPE_KEY',
        },
      },
    ]);
  });

  it.each([
    {
      label: 'literal replacement character',
      key: 'replacement\uFFFD',
      expected: 'replacement\uFFFD',
    },
    {
      label: 'complete pair at the boundary',
      key: prefix.slice(1) + pair + 'tail',
      expected: prefix.slice(1) + pair,
    },
    { label: 'independently supplied short prefix', key: prefix, expected: prefix },
    {
      label: 'a malformed unit outside the derived slice',
      key: prefix + 'x' + '\uD800',
      expected: prefix + 'x',
    },
    { label: 'JSON stringification', key: { value: 7 }, expected: '{"value":7}' },
  ])('preserves the exact derived key for $label', async ({ key, expected }) => {
    const { runs, run, startRun, hasDedupe, warnings } = await pollOnce(
      { key, marker: 'outside-identity\uD800' },
      expression,
    );

    expect(hasDedupe).toHaveBeenCalledOnce();
    expect(hasDedupe).toHaveBeenCalledWith('loop', 'poll', expected);
    expect(startRun).toHaveBeenCalledOnce();
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: expected }));
    expect(runs).toEqual([run]);
    expect(warnings).toEqual([]);
  });

  it('skips a previously seen exact key', async () => {
    const { runs, startRun, hasDedupe, warnings } = await pollOnce({ key: pair }, expression, true);

    expect(hasDedupe).toHaveBeenCalledWith('loop', 'poll', pair);
    expect(startRun).not.toHaveBeenCalled();
    expect(runs).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it.each([
    { label: 'no expression', dedupeKey: undefined, body: { key: '\uD800' } },
    { label: 'an undefined result', dedupeKey: expression, body: {} },
    { label: 'a null result', dedupeKey: expression, body: { key: null } },
    { label: 'an empty result', dedupeKey: expression, body: { key: '' } },
  ])('preserves unkeyed admission for $label', async ({ dedupeKey, body }) => {
    const { runs, run, startRun, hasDedupe, warnings } = await pollOnce(body, dedupeKey);

    expect(hasDedupe).not.toHaveBeenCalled();
    expect(startRun).toHaveBeenCalledOnce();
    expect(startRun.mock.calls[0]?.[0]).not.toHaveProperty('dedupeKey');
    expect(runs).toEqual([run]);
    expect(warnings).toEqual([]);
  });
});
