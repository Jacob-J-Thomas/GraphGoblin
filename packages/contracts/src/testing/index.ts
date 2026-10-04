/**
 * Deterministic fixtures for tests across packages. Imported as `@graphgoblin/contracts/testing`.
 * These are data, not behaviour; they are covered by the tests that use them.
 */
import type { ContextThread, Invocation } from '../thread.js';
import type { LoopDefinitionInput } from '../loop.js';

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function fnv1a(seed: string, offset: number): number {
  let hash = offset >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/**
 * A stable, valid ULID derived from a seed string. Two independent 32-bit hashes drive the
 * 26 characters, so distinct seeds collide only with negligible probability.
 */
export function fakeUlid(seed: string): string {
  let a = fnv1a(seed, 2166136261);
  let b = fnv1a(`${seed.length}:${seed}`, 0x9e3779b9) ^ Math.imul(seed.length, 2654435761);
  let out = '';
  for (let i = 0; i < 26; i += 1) {
    const mixed = (a ^ (b >>> 7) ^ (b << 5)) >>> 0;
    out += ULID_ALPHABET[mixed % 32];
    a = (Math.imul(a, 1103515245) + 12345 + i) >>> 0;
    b = (Math.imul(b ^ (b >>> 13), 2246822519) + 0x165667b1) >>> 0;
  }
  return out;
}

export const FIXTURE_IDS = {
  loop: fakeUlid('loop'),
  version: fakeUlid('version'),
  run: fakeUlid('run'),
  invocation: fakeUlid('invocation'),
  childLoop: fakeUlid('child-loop'),
} as const;

export const FIXTURE_TS = '2026-10-02T12:00:00.000Z';

export function sampleInvocation(overrides: Partial<Invocation> = {}): Invocation {
  return {
    id: FIXTURE_IDS.invocation,
    source: 'manual.api',
    caller: { kind: 'api-key', id: 'test-key' },
    trigger: {
      nodeId: 'start',
      kind: 'manual',
      payload: { topic: 'hello' },
      receivedAt: FIXTURE_TS,
    },
    ...overrides,
  };
}

export function sampleThread(overrides: Partial<ContextThread> = {}): ContextThread {
  return {
    schemaVersion: 1,
    run: {
      id: FIXTURE_IDS.run,
      loopId: FIXTURE_IDS.loop,
      versionId: FIXTURE_IDS.version,
      iteration: 1,
    },
    invocation: sampleInvocation(),
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Write a haiku about loops.',
        nodeId: 'start',
        ts: FIXTURE_TS,
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Loops within loops turn.',
        nodeId: 'infer',
        ts: FIXTURE_TS,
      },
    ],
    vars: { topic: 'hello', count: 2 },
    artifacts: [],
    outputs: {},
    counters: {
      nodeVisits: { start: 1 },
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 },
    },
    ...overrides,
  };
}

/** The smallest valid loop: a manual trigger wired to an exit. */
export function minimalLoop(): LoopDefinitionInput {
  return {
    schemaVersion: 1,
    name: 'minimal',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  };
}

/** Genuine legacy input: no canonical parser has filled the inference harness. */
export function legacyHarnessLoop(): LoopDefinitionInput & {
  settings: { defaults: { harness: 'codex' } };
} {
  return {
    ...minimalLoop(),
    settings: { defaults: { harness: 'codex' as const } },
    nodes: [
      {
        id: 'start',
        kind: 'trigger' as const,
        label: 'Start',
        config: { subtype: 'manual' as const },
      },
      {
        id: 'infer',
        kind: 'inference' as const,
        label: 'Infer',
        config: { prompt: { template: 'Hello' } },
      },
      { id: 'done', kind: 'exit' as const, label: 'Done', config: {} },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
      { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

/** A loop using every node kind once, with a decision and an exit loop-back. */
export function kitchenSinkLoop(): LoopDefinitionInput {
  return {
    schemaVersion: 1,
    name: 'kitchen-sink',
    description: 'Every node kind, for tests.',
    settings: {
      workingDirectory: { kind: 'fixed', path: '/tmp/work' },
      defaults: { model: 'gpt-6-luna', effort: 'low' },
      maxIterations: 3,
    },
    variables: { topic: { type: 'string' } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      {
        id: 'nightly',
        kind: 'trigger',
        label: 'Nightly',
        config: { subtype: 'cron', expression: '0 2 * * *', timezone: 'UTC' },
      },
      {
        id: 'prep',
        kind: 'mutate',
        label: 'Prepare',
        config: {
          operations: [
            { op: 'set', path: '/vars/topic', value: { kind: 'literal', value: 'loops' } },
            { op: 'append-message', role: 'note', content: 'Topic is {{ vars.topic }}' },
          ],
        },
      },
      {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          prompt: { template: 'Write about {{ vars.topic }}.' },
          output: {
            schema: {
              jsonSchema: { type: 'object', required: ['ok'] },
              repair: { maxAttempts: 2 },
            },
          },
        },
      },
      {
        id: 'check',
        kind: 'script',
        label: 'Check',
        config: {
          command: 'node',
          args: ['check.js'],
          exitCodeRoutes: { '0': 'out', '3': 'retry' },
        },
      },
      {
        id: 'decide',
        kind: 'decision',
        label: 'Decide',
        config: {
          routes: [
            { label: 'good', description: 'Looks good' },
            { label: 'bad', description: 'Needs work' },
          ],
          question: 'Is the output acceptable?',
          strategy: ['expression'],
          expression: { jsonata: 'lastOutput.value.ok ? "good" : "bad"' },
        },
      },
      {
        id: 'sub',
        kind: 'subloop',
        label: 'Sub',
        config: { loopRef: { loopId: FIXTURE_IDS.childLoop } },
      },
      {
        id: 'approve',
        kind: 'wait',
        label: 'Approve',
        config: { mode: 'input', prompt: 'Approve?', timeoutSeconds: 3600 },
      },
      {
        id: 'poll',
        kind: 'heartbeat',
        label: 'Poll',
        config: { intervalSeconds: 60, maxBeats: 5 },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: {
          criteria: [{ when: 'max-iterations', value: 3 }],
          default: 'loop-back',
          loopBack: { targetNodeId: 'prep' },
          return: {
            mapping: '{ "topic": vars.topic }',
            channels: [{ kind: 'caller' }, { kind: 'log' }],
          },
        },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'prep' } },
      { id: 'e2', from: { node: 'nightly', port: 'out' }, to: { node: 'prep' } },
      { id: 'e3', from: { node: 'prep', port: 'out' }, to: { node: 'infer' } },
      { id: 'e4', from: { node: 'infer', port: 'out' }, to: { node: 'check' } },
      { id: 'e5', from: { node: 'check', port: 'out' }, to: { node: 'decide' } },
      { id: 'e5b', from: { node: 'check', port: 'retry' }, to: { node: 'infer' } },
      { id: 'e6', from: { node: 'decide', port: 'good' }, to: { node: 'sub' } },
      { id: 'e7', from: { node: 'decide', port: 'bad' }, to: { node: 'approve' } },
      { id: 'e8', from: { node: 'sub', port: 'out' }, to: { node: 'poll' } },
      { id: 'e9', from: { node: 'approve', port: 'out' }, to: { node: 'poll' } },
      { id: 'e10', from: { node: 'poll', port: 'out' }, to: { node: 'done' } },
      { id: 'e11', from: { node: 'done', port: 'loopBack' }, to: { node: 'prep' } },
    ],
  };
}
