/**
 * Deterministic fixtures for tests across packages. Imported as `@graphgoblin/contracts/testing`.
 * These are data, not behaviour; they are covered by the tests that use them.
 */
import type { ContextThread, Invocation } from '../thread.js';
import type { RepairPolicyInput } from '../common.js';
import type { RunPin } from '../run.js';
import { CURRENT_DEFINITION_FORMAT, type LoopDefinitionInput } from '../loop.js';

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

/** A published-version pin with empty inherited defaults, for run records built by hand. */
export function samplePin(overrides: Partial<RunPin> = {}): RunPin {
  return {
    source: 'published',
    version: 1,
    name: 'Minimal',
    label: 'Minimal v1',
    defaults: { owner: { byHarness: {} }, process: { byHarness: {} } },
    classifiers: {},
    limits: { maxNodeVisits: 10, runDeadlineSeconds: null },
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
    gates: {},
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
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'minimal',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  };
}

/**
 * A loop that sets every config field of every node kind, every type, mode, and operation, so
 * a test can check that parsing it (and exporting and importing it) gives the same value before
 * and after a change to the schemas' metadata. It is schema-valid, not a runnable graph.
 */
export function everyFieldLoop(): LoopDefinitionInput {
  const repair: RepairPolicyInput = {
    enabled: true,
    maxAttempts: 2,
    prompt: 'Fix it.',
    onFailure: 'continue-raw',
  };
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'every-field',
    description: 'Every config field of every node kind, for parse checks.',
    settings: {
      workingDirectory: { kind: 'template', template: '/work/{{ trigger.payload.repo }}' },
      defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'medium' } } },
      maxNodeVisits: 7,
      subloopDepthLimit: 4,
    },
    variables: { topic: { type: 'string' }, count: { type: 'number' } },
    nodes: [
      {
        id: 'manual',
        kind: 'trigger',
        label: 'Manual',
        ui: { x: 10, y: 20 },
        config: { type: 'manual', inputSchema: { type: 'object' }, exposeTo: ['ui', 'mcp'] },
      },
      {
        id: 'cron',
        kind: 'trigger',
        label: 'Cron',
        config: {
          type: 'cron',
          expression: '*/5 * * * *',
          timezone: 'Europe/Paris',
          missedFirePolicy: 'run-each',
          enabled: false,
        },
      },
      {
        id: 'hook',
        kind: 'trigger',
        label: 'Hook',
        config: {
          type: 'webhook',
          authentication: {
            type: 'hmac-sha256',
            message: 'timestamp-body',
            header: 'x-sig',
            secretRef: 'hook-secret',
            windowSeconds: 120,
          },
          body: { type: 'json' },
          eventType: { source: 'constant', value: 'webhook' },
          dedupeKey: 'payload.id',
        },
      },
      {
        id: 'event',
        kind: 'trigger',
        label: 'Event',
        config: {
          type: 'event',
          eventType: 'build-done',
          dedupeKey: 'payload.id',
        },
      },
      {
        id: 'poller',
        kind: 'trigger',
        label: 'Poller',
        config: {
          type: 'poll',
          intervalSeconds: 30,
          probe: {
            kind: 'http',
            method: 'POST',
            url: 'https://example.test/{{ vars.topic }}',
            headers: { accept: 'application/json' },
            body: '{"q": 1}',
            timeoutSeconds: 10,
          },
          fireWhen: 'probe.status = 200',
          dedupeKey: 'probe.body.id',
          enabled: false,
        },
      },
      {
        id: 'github-hook',
        kind: 'trigger',
        label: 'GitHub hook',
        config: {
          type: 'webhook',
          authentication: {
            type: 'hmac-sha256',
            message: 'body',
            header: 'x-hub-signature-256',
            secretRef: 'github-secret',
          },
          dedupeKey: 'issue.number',
        },
      },
      {
        id: 'items-poller',
        kind: 'trigger',
        label: 'Items poller',
        config: {
          type: 'poll',
          intervalSeconds: 30,
          probe: { kind: 'script', command: 'gh', args: ['api'], timeoutSeconds: 10 },
          fireWhen: 'true',
          items: { select: 'probe.json', dedupeKey: '$string(item.number)', maxRunsPerPoll: 5 },
          enabled: false,
        },
      },
      {
        id: 'expression-decision',
        kind: 'decision',
        label: 'Expression',
        config: {
          kind: 'expression',
          maxPasses: 7,
          maxRunTimeSeconds: 3600,
          jsonata: '"good"',
          routes: [
            { id: 'good', label: 'Good' },
            { id: 'bad', label: 'Bad', repeat: true },
          ],
        },
      },
      {
        id: 'classifier-decision',
        kind: 'decision',
        label: 'Classifier',
        config: {
          kind: 'classifier',
          maxPasses: 7,
          maxRunTimeSeconds: 3600,
          model: 'jev',
          question: 'Choose',
          answer: {
            type: 'noul',
            true: { id: 'good', label: 'Good', criteria: 'Pass' },
            false: { id: 'bad', label: 'Bad', criteria: 'Fail', repeat: true },
          },
          truthThreshold: 0.7,
          context: { messages: 'all', vars: ['topic'], includeLastOutput: true },
          minConfidence: 0.5,
          recordAlternatives: false,
        },
      },
      {
        id: 'decide',
        kind: 'decision',
        label: 'Decide',
        config: {
          kind: 'llm',
          maxPasses: 7,
          maxRunTimeSeconds: 3600,
          harness: 'codex',
          model: { mode: 'explicit', value: 'gpt-6-sol' },
          effort: { mode: 'explicit', value: 'high' },
          instructions: 'Is {{ vars.topic }} done?',
          context: { messages: 3, vars: ['topic'], includeLastOutput: false },
          routes: [
            { id: 'good', label: 'good', criteria: 'Looks good' },
            { id: 'bad', label: 'bad', criteria: 'Needs work', repeat: true },
          ].map(({ id, label, repeat }) => ({ id, label, ...(repeat ? { repeat } : {}) })),
        },
      },
      {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          harness: 'codex',
          model: 'gpt-6-sol',
          effort: 'xhigh',
          session: { policy: 'resume-named', key: 'main' },
          prompt: { template: 'Write about {{ vars.topic }}.' },
          input: [{ op: 'truncate', keep: { last: 4 } }],
          contextFiles: [{ path: 'notes/context.md', template: '# {{ vars.topic }}' }],
          harnessOptions: {
            sandbox: 'read-only',
            approval: 'on-request',
            networkAccess: true,
            webSearch: false,
            configOverrides: { model_verbosity: 'low' },
          },
          capabilities: { mcpServers: ['github'], plugins: ['lint'], skills: ['review'] },
          output: {
            captureTranscript: 'none',
            toMessages: 'final-and-notes',
            transforms: [{ op: 'redact', patterns: ['sk-[a-z0-9]+'] }],
            schema: { jsonSchema: { type: 'object' }, native: false, repair },
          },
          timeoutSeconds: 900,
        },
      },
      {
        id: 'run-script',
        kind: 'script',
        label: 'Script',
        config: {
          command: 'node',
          args: ['check.js', '{{ vars.topic }}'],
          cwd: '/srv/checks',
          env: { TOKEN: 'secret:gh-token', MODE: 'strict' },
          stdin: 'last-output',
          stdout: 'patch',
          exitCodeRoutes: { '3': 'retry', '4': 'skip' },
          timeoutSeconds: 60,
        },
      },
      {
        id: 'shape',
        kind: 'mutate',
        label: 'Shape',
        config: {
          operations: [
            { op: 'set', path: '/vars/a', value: { kind: 'literal', value: { n: [1, null] } } },
            { op: 'set', path: '/vars/b', value: { kind: 'template', template: '{{ vars.a }}' } },
            { op: 'set', path: '/vars/c', value: { kind: 'expression', jsonata: 'vars.a.n' } },
            { op: 'delete', path: '/vars/c' },
            { op: 'append-message', role: 'user', content: 'Hello', tags: ['greeting'] },
            {
              op: 'inject',
              position: 1,
              messages: [{ role: 'system', content: 'Be brief.', tags: ['style'] }],
            },
            {
              op: 'truncate',
              keep: { first: 1, last: 2, maxEstimatedTokens: 4000 },
              where: 'role = "tool"',
            },
            { op: 'drop', target: 'artifacts', where: 'name = "tmp"' },
            {
              op: 'replace',
              target: 'vars',
              where: 'true',
              pattern: 'foo',
              flags: 'gi',
              replacement: 'bar',
            },
            { op: 'redact', target: 'messages', patterns: ['\\d{16}'], replacement: '[CARD]' },
            {
              op: 'coerce',
              source: '/lastOutput/value',
              jsonSchema: { type: 'object' },
              repair,
              target: '/vars/coerced',
            },
          ],
        },
      },
      {
        id: 'sub',
        kind: 'subloop',
        label: 'Sub',
        config: {
          loopRef: { loopId: FIXTURE_IDS.childLoop, version: 3 },
          input: {
            mode: 'project',
            exclude: ['artifacts', 'outputs'],
            vars: { childTopic: 'vars.topic' },
            messages: { where: 'role = "user"' },
            artifacts: 'all',
            inject: [{ role: 'note', content: 'From the parent.', tags: ['parent'] }],
            trigger: { payload: '{ "topic": vars.topic }' },
          },
          output: {
            mode: 'custom',
            resultTo: { lastOutput: false, var: 'childResult' },
            vars: { strategy: 'explicit', map: { topic: 'child.vars.topic' } },
            messages: 'last',
            artifacts: { where: 'true' },
            custom: { patch: '[]' },
            usage: 'separate',
          },
          depthLimitOverride: 2,
        },
      },
      {
        id: 'ask',
        kind: 'wait',
        label: 'Ask',
        config: {
          mode: 'input',
          prompt: 'Approve {{ vars.topic }}?',
          inputSchema: { type: 'boolean' },
          exposeTo: ['ui'],
          timeoutSeconds: 600,
          onTimeout: 'fail-run',
        },
      },
      {
        id: 'pause',
        kind: 'wait',
        label: 'Pause',
        config: { mode: 'duration', seconds: 30, timeoutSeconds: 40, onTimeout: 'continue' },
      },
      {
        id: 'later',
        kind: 'wait',
        label: 'Later',
        config: {
          mode: 'until',
          timestamp: '{{ vars.when }}',
          timeoutSeconds: 86400,
          onTimeout: 'fail-run',
        },
      },
      {
        id: 'signal',
        kind: 'wait',
        label: 'Signal',
        config: {
          mode: 'signal',
          name: 'go',
          filter: 'payload.ok',
          timeoutSeconds: 5,
          onTimeout: 'continue',
        },
      },
      {
        id: 'beat',
        kind: 'heartbeat',
        label: 'Beat',
        config: {
          intervalSeconds: 15,
          probe: { kind: 'script', command: 'check', args: ['--fast'], timeoutSeconds: 20 },
          until: 'probe.exitCode = 0',
          maxBeats: 40,
          deadline: '{{ vars.deadline }}',
          onExhausted: 'fail-run',
          record: 'full',
        },
      },
      {
        id: 'count',
        kind: 'heartbeat',
        label: 'Count',
        config: { intervalSeconds: 5, probe: { kind: 'signal-count', name: 'tick' }, maxBeats: 3 },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: {
          outcome: 'success',
          returns: '{ "topic": vars.topic }',
          destinations: [
            { kind: 'caller' },
            { kind: 'webhook', url: 'https://example.test/done', secretRef: 'hook-secret' },
            { kind: 'file', path: 'out/result.md', format: 'markdown' },
            { kind: 'log' },
          ],
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        from: { node: 'manual', port: 'out' },
        to: { node: 'decide' },
        ui: { route: [240, 360, 420] },
      },
    ],
  };
}

/** A loop using every node kind once, with a decision and terminal exit. */
export function kitchenSinkLoop(): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'kitchen-sink',
    description: 'Every node kind, for tests.',
    settings: {
      workingDirectory: { kind: 'fixed', path: '/tmp/work' },
      defaults: { byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' } } },
      maxNodeVisits: 3,
    },
    variables: { topic: { type: 'string' } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'nightly',
        kind: 'trigger',
        label: 'Nightly',
        config: { type: 'cron', expression: '0 2 * * *', timezone: 'UTC' },
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
          kind: 'expression',
          jsonata: 'lastOutput.value.ok ? "good" : "bad"',
          routes: [
            { id: 'good', label: 'good', criteria: 'Looks good' },
            { id: 'bad', label: 'bad', criteria: 'Needs work' },
          ].map(({ id, label }) => ({ id, label })),
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
          outcome: 'success',
          returns: '{ "topic": vars.topic }',
          destinations: [{ kind: 'caller' }, { kind: 'log' }],
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
    ],
  };
}
