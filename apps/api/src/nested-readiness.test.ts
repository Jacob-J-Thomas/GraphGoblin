import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexHarness } from '@graphgoblin/adapter-codex';
import { ClaudeHarness } from '@graphgoblin/infrastructure/claude';
import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  type HarnessId,
  type HarnessPreflight,
  type LoopDefinition,
  type LoopDefinitionInput,
  type LoopVersionRecord,
  type RunEvent,
  type RunRecord,
} from '@graphgoblin/contracts';
import { readinessFailure } from '@graphgoblin/domain';
import { FakeHarness } from '@graphgoblin/engine/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

class CountingHarness extends FakeHarness {
  probes = 0;
  beforeProbe?: () => Promise<void>;
  readinessProbe?: () => Promise<HarnessPreflight>;
  override async preflight() {
    this.probes++;
    await this.beforeProbe?.();
    return this.readinessProbe ? this.readinessProbe() : super.preflight();
  }
}

type Step = LoopDefinitionInput['nodes'][number];
function graph(name: string, steps: Step[], depth = 8): LoopDefinition {
  const nodes: Step[] = [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    ...steps,
    { id: 'done', kind: 'exit', label: 'Done', config: {} },
  ];
  return LoopDefinitionSchema.parse({
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    settings: { subloopDepthLimit: depth },
    nodes,
    edges: nodes.slice(1).map((node, i) => ({
      id: 'edge-' + i,
      from: { node: nodes[i]!.id, port: 'out' },
      to: { node: node.id },
    })),
  });
}
const inference = (harness: HarnessId, id = 'think'): Step => ({
  id,
  kind: 'inference',
  label: 'Think',
  config: {
    harness,
    model: harness === 'claude' ? 'claude-opus-5-5' : 'gpt-6-luna',
    effort: 'high',
    harnessOptions: { sandbox: 'read-only', approval: 'never' },
    prompt: { template: 'Fake turn only' },
  },
});
const child = (loopId: string, id = 'child', version: 'latest' | number = 'latest'): Step => ({
  id,
  kind: 'subloop',
  label: 'Child',
  config: { loopRef: { loopId, version } },
});
const mutation: Step = {
  id: 'mutate',
  kind: 'mutate',
  label: 'Preceding effect',
  config: { operations: [{ op: 'append-message', content: 'PARENT_EFFECT_MARKER' }] },
};
let t: TestApp;
let claude: CountingHarness;
let codex: CountingHarness;
let dataDir: string;
afterEach(async () => {
  await t?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});
async function open() {
  claude = new CountingHarness([], 'claude');
  codex = new CountingHarness([], 'codex');
  dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-f1-nested-'));
  t = await createTestApp({ harnesses: { claude, codex }, env: { GG_DATA_DIR: dataDir } });
}
function reset() {
  claude.probes = 0;
  codex.probes = 0;
}
const start = (id: string) =>
  t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
async function save(id: string, definition: LoopDefinition) {
  const response = await t.app.inject({
    method: 'PUT',
    url: `/loops/${id}/draft`,
    payload: { definition },
  });
  expect(response.statusCode, response.body).toBe(200);
}
async function publish(id: string): Promise<LoopVersionRecord> {
  const response = await t.app.inject({ method: 'POST', url: `/loops/${id}/publish` });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ version: LoopVersionRecord }>().version;
}

describe('manual admission over pinned nested definitions', () => {
  it('rejects a signed-out child before the parent mutation or any run is recorded', async () => {
    await open();
    const childId = await t.publishLoop(graph('Inference child', [inference('claude')]));
    const parentId = await t.publishLoop(graph('Effect parent', [mutation, child(childId)]));
    claude.preflightResult = readinessFailure('claude', 'auth');
    reset();
    expect((await start(childId)).statusCode).toBe(422);
    expect(claude.probes).toBe(1);
    reset();
    const rejected = await start(parentId);
    // On the old path this is 202, with zero probes and a durable preceding mutation.
    if (rejected.statusCode === 202) {
      await t.idle();
      const run = rejected.json<{ run: RunRecord }>().run;
      const events = await t.container.repos.events.read(run.id);
      expect({
        status: rejected.statusCode,
        probes: claude.probes,
        parentEffect: JSON.stringify(events).includes('PARENT_EFFECT_MARKER'),
      }).toEqual({ status: 422, probes: 1, parentEffect: false });
    }
    expect(rejected.statusCode, rejected.body).toBe(422);
    expect(rejected.json()).toMatchObject({
      code: 'HARNESS_NOT_READY',
      errors: [
        expect.objectContaining({
          code: 'HARNESS_READINESS_AUTH',
          loopId: childId,
          nodeId: 'think',
          message: expect.stringContaining('Inference child'),
        }),
      ],
    });
    expect(claude.probes).toBe(1);
    expect(codex.probes).toBe(0);
    expect((await t.app.inject('/runs')).json().items).toEqual([]);
    expect(claude.started).toEqual([]);
  });

  it('checks both the unready parent and ready child in one admission', async () => {
    await open();
    const childId = await t.publishLoop(graph('Codex child', [inference('codex')]));
    const parentId = await t.publishLoop(
      graph('Claude parent', [inference('claude'), child(childId)]),
    );
    claude.preflightResult = readinessFailure('claude', 'quota');
    reset();
    const rejected = await start(parentId);
    expect(rejected.statusCode).toBe(422);
    expect(rejected.body).toContain('HARNESS_READINESS_QUOTA');
    expect([claude.probes, codex.probes]).toEqual([1, 1]);
    expect((await t.app.inject('/runs')).json().items).toEqual([]);
  });

  it('shares one probe between same-harness parent and child nodes', async () => {
    await open();
    const childId = await t.publishLoop(graph('Claude child', [inference('claude')]));
    const parentId = await t.publishLoop(
      graph('Claude parent', [inference('claude'), child(childId)]),
    );
    reset();
    expect((await start(parentId)).statusCode).toBe(202);
    await t.idle();
    expect([claude.probes, codex.probes]).toEqual([1, 0]);
    expect(claude.started).toHaveLength(2);
  });

  it('starts probes for distinct parent/child harnesses concurrently', async () => {
    await open();
    const childId = await t.publishLoop(graph('Claude child', [inference('claude')]));
    const parentId = await t.publishLoop(
      graph('Codex parent', [inference('codex'), child(childId)]),
    );
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    claude.beforeProbe = codex.beforeProbe = () => barrier;
    reset();
    const response = Promise.resolve(start(parentId));
    try {
      await vi.waitFor(() => expect([claude.probes, codex.probes]).toEqual([1, 1]));
      expect((await t.app.inject('/runs')).json().items).toEqual([]);
    } finally {
      release();
      await response;
    }
    expect((await response).statusCode).toBe(202);
    await t.idle();
  });

  it('checks the published child, ignoring an unready-harness draft', async () => {
    await open();
    const childId = await t.publishLoop(graph('Published Claude', [inference('claude')]));
    await save(childId, graph('Draft Codex', [inference('codex')]));
    const parentId = await t.publishLoop(graph('Parent', [child(childId)]));
    codex.preflightResult = readinessFailure('codex', 'auth');
    reset();
    const response = await start(parentId);
    expect(response.statusCode).toBe(202);
    await t.idle();
    expect([claude.probes, codex.probes]).toEqual([1, 0]);
    expect(claude.started).toHaveLength(1);
  });

  it('checks a numbered child version instead of its newer publication', async () => {
    await open();
    const childId = await t.publishLoop(graph('Claude v1', [inference('claude')]));
    await save(childId, graph('Codex v2', [inference('codex')]));
    await publish(childId);
    const parentId = await t.publishLoop(graph('Parent', [child(childId, 'child', 1)]));
    claude.preflightResult = readinessFailure('claude', 'auth');
    reset();
    const response = await start(parentId);
    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('Claude v1');
    expect([claude.probes, codex.probes]).toEqual([1, 0]);
  });

  it.each([1, 2])('honors the configured nesting limit %s', async (limit) => {
    await open();
    const leaf = await t.publishLoop(graph('Leaf', [inference('claude')]));
    const middle = await t.publishLoop(graph('Middle', [child(leaf)], limit));
    const root = await t.publishLoop(graph('Root', [child(middle)], limit));
    claude.preflightResult = readinessFailure('claude', 'auth');
    reset();
    const response = await start(root);
    expect(response.statusCode).toBe(limit === 1 ? 202 : 422);
    expect(claude.probes).toBe(limit === 1 ? 0 : 1);
    await t.idle();
    expect(claude.started).toEqual([]);
  });

  it.each(['ready', 'auth'] as const)(
    'checks a twice-referenced child once when %s',
    async (state) => {
      await open();
      const childId = await t.publishLoop(graph('Repeated child', [inference('claude')]));
      const root = await t.publishLoop(
        graph('Root', [child(childId, 'first'), child(childId, 'second')]),
      );
      if (state === 'auth') claude.preflightResult = readinessFailure('claude', state);
      reset();
      const response = await start(root);
      expect(response.statusCode).toBe(state === 'ready' ? 202 : 422);
      expect(claude.probes).toBe(1);
      await t.idle();
      expect(claude.started).toHaveLength(state === 'ready' ? 2 : 0);
    },
  );

  it('keeps the child pin when a new version publishes while its probe is pending', async () => {
    await open();
    const childId = await t.publishLoop(graph('Claude v1', [inference('claude')]));
    const old = await t.container.repos.loops.getLatestPublished(childId);
    const root = await t.publishLoop(graph('Root', [child(childId)]));
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    claude.beforeProbe = () => barrier;
    reset();
    const pending = Promise.resolve(start(root));
    try {
      await vi.waitFor(() => expect(claude.probes).toBe(1));
      await save(childId, graph('Codex v2', [inference('codex')]));
      const latest = await publish(childId);
      expect(latest.id).not.toBe(old!.id);
      expect(codex.probes).toBe(1); // The independent publish request, not root admission.
      codex.probes = 0;
    } finally {
      release();
      await pending;
    }
    const response = await pending;
    expect(response.statusCode).toBe(202);
    const run = response.json<{ run: RunRecord }>().run;
    await t.idle();
    const events = (await t.app.inject(`/runs/${run.id}/events`)).json<{ items: RunEvent[] }>()
      .items;
    expect(events[0]).toMatchObject({ subloopVersions: { [childId]: old!.id } });
    expect((await t.container.repos.runs.listChildren(run.id))[0]!.versionId).toBe(old!.id);
    expect([claude.probes, codex.probes]).toEqual([1, 0]);
  });

  it('freezes a draft root before probing and executes that same snapshot', async () => {
    await open();
    const created = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: {
        definition: graph('Original draft', [inference('claude')]),
      },
    });
    const { loop, draft } = created.json<{ loop: { id: string }; draft: { id: string } }>();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    claude.beforeProbe = () => barrier;
    reset();
    const pending = Promise.resolve(
      t.app.inject({
        method: 'POST',
        url: `/loops/${loop.id}/runs`,
        payload: { versionId: draft.id, allowDraft: true },
      }),
    );
    try {
      await vi.waitFor(() => expect(claude.probes).toBe(1));
      await save(loop.id, graph('Edited draft', [inference('codex')]));
    } finally {
      release();
      await pending;
    }
    const response = await pending;
    expect(response.statusCode).toBe(202);
    const run = response.json<{ run: RunRecord }>().run;
    expect(run.versionId).not.toBe(draft.id);
    expect(run.pinned.name).toBe('Original draft');
    await t.idle();
    expect([claude.probes, codex.probes]).toEqual([1, 0]);
    expect(claude.started).toHaveLength(1);
    expect(codex.started).toEqual([]);
  });

  it.each(['root', 'child'] as const)(
    'does not hold the pin lock while probing; rechecks a deleted %s',
    async (target) => {
      await open();
      const childId = await t.publishLoop(graph('Child', [inference('claude')]));
      const root = await t.publishLoop(graph('Root', [child(childId)]));
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      claude.beforeProbe = () => barrier;
      reset();
      const pending = Promise.resolve(start(root));
      try {
        await vi.waitFor(() => expect(claude.probes).toBe(1));
        // Deletion needs the same pin lock. It must complete before the probe is released.
        const deleted = await t.app.inject({
          method: 'DELETE',
          url: `/loops/${target === 'root' ? root : childId}`,
        });
        expect(deleted.statusCode).toBe(204);
      } finally {
        release();
        await pending;
      }
      const response = await pending;
      expect(response.statusCode).toBe(404);
      expect(response.body).toContain('LOOP_NOT_FOUND');
      expect((await t.app.inject('/runs')).json().items).toEqual([]);
      expect(claude.started).toEqual([]);
    },
  );

  it('honors a node depth override when collecting executable descendants', async () => {
    await open();
    const leaf = await t.publishLoop(graph('Leaf', [inference('claude')]));
    const middleDefinition = graph('Middle', [child(leaf)], 1);
    const reference = middleDefinition.nodes.find((node) => node.kind === 'subloop')!;
    if (reference.kind !== 'subloop') throw new Error('Missing reference');
    reference.config.depthLimitOverride = 2;
    const middle = await t.publishLoop(middleDefinition);
    const root = await t.publishLoop(graph('Root', [child(middle)], 1));
    claude.preflightResult = readinessFailure('claude', 'auth');
    reset();
    expect((await start(root)).statusCode).toBe(422);
    expect(claude.probes).toBe(1);
  });

  it('protects cycles while checking a nested harness once', async () => {
    await open();
    const a = await t.publishLoop(graph('A', []));
    const b = await t.publishLoop(graph('B', [inference('claude'), child(a)]));
    await save(a, graph('A', [child(b)]));
    await publish(a);
    claude.preflightResult = readinessFailure('claude', 'auth');
    reset();
    const response = await start(a);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toHaveLength(1);
    expect(claude.probes).toBe(1);
  });

  it('collects a nested LLM decision harness as well as inference nodes', async () => {
    await open();
    const decision = graph('Decision child', [
      {
        id: 'choose',
        kind: 'decision',
        label: 'Choose',
        config: {
          kind: 'llm',
          harness: 'codex',
          instructions: 'Choose',
          model: { mode: 'explicit', value: 'gpt-6-luna' },
          effort: { mode: 'explicit', value: 'high' },
          routes: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
        },
      },
    ]);
    decision.edges.find((edge) => edge.from.node === 'choose')!.from.port = 'yes';
    decision.edges.push({
      id: 'no',
      from: { node: 'choose', port: 'no' },
      to: { node: 'done', port: 'in' },
    });
    const childId = await t.publishLoop(decision);
    const root = await t.publishLoop(graph('Root', [child(childId)]));
    codex.preflightResult = readinessFailure('codex', 'transport');
    reset();
    const response = await start(root);
    expect(response.statusCode).toBe(422);
    expect(response.json().errors).toMatchObject([
      { nodeId: 'choose', code: 'HARNESS_READINESS_TRANSPORT' },
    ]);
    expect([claude.probes, codex.probes]).toEqual([0, 1]);
  });

  it.each(['claude', 'codex'] as const)(
    'uses the %s executable fixture through public nested admission',
    async (id) => {
      await open();
      let scenario = 'ready';
      const commands: string[][] = [];
      const fixture = fileURLToPath(
        new URL(
          id === 'claude'
            ? '../../../packages/infrastructure/src/claude/fixtures/readiness-cli.mjs'
            : '../../../packages/adapter-codex/src/fixtures/readiness-cli.mjs',
          import.meta.url,
        ),
      );
      async function runFixture(args: readonly string[], cwd: string) {
        commands.push([...args]);
        const childProcess = spawn(process.execPath, [fixture, scenario, ...args], {
          cwd,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        childProcess.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        childProcess.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
        const [code] = await once(childProcess, 'close');
        return { code: typeof code === 'number' ? code : null, stdout, stderr };
      }
      const probe =
        id === 'claude'
          ? new ClaudeHarness({
              platform: 'win32',
              runner: async (request) => {
                const result = await runFixture(request.args, request.cwd);
                return {
                  exitCode: result.code,
                  stdout: result.stdout,
                  timedOut: false,
                  aborted: false,
                  overflow: false,
                };
              },
            })
          : new CodexHarness({
              codexBinary: process.execPath,
              cliRunner: async (cli, args) => {
                const result = await runFixture(args, cli.cwd!);
                return { code: result.code, output: result.stdout + result.stderr };
              },
            });
      const harness = id === 'claude' ? claude : codex;
      harness.readinessProbe = () => probe.preflight();
      const childId = await t.publishLoop(graph('Executable child', [inference(id)]));
      const root = await t.publishLoop(graph('Root', [mutation, child(childId)]));
      scenario = 'auth';
      commands.length = 0;
      reset();
      const response = await start(root);
      expect(response.statusCode).toBe(422);
      expect(response.body).toContain('HARNESS_READINESS_AUTH');
      expect(harness.probes).toBe(1);
      expect(commands.filter((args) => args.includes('--version'))).toHaveLength(1);
      expect(
        commands.every(
          (args) =>
            args.includes('--version') || args.includes('--help') || args.includes('status'),
        ),
      ).toBe(true);
      expect((await t.app.inject('/runs')).json().items).toEqual([]);
      expect(harness.started).toEqual([]);
    },
  );
});
