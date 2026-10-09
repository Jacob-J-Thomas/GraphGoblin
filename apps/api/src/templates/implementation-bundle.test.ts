import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  ContextThreadSchema,
  ImplementationTemplateSettingsSchema,
  JsonSchemaSchema,
  LoopExportSchema,
  TemplateManifestSchema,
  type JsonValue,
  type TemplateBundle,
} from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import {
  prepareTemplateBundle,
  renderTemplate,
  validateJson,
  validateTemplateBundle,
} from '@graphgoblin/domain';
import { createTestEngine, type ScriptedTurn } from '@graphgoblin/engine/testing';
import {
  ImplementationPlanSchema,
  ImplementationPlanEnvelopeSchema,
  PrProposalSchema,
  SupportActionSchema,
  WorkerResultSchema,
  type SupportAction,
} from './github/protocol.js';

const fixtureRoot = new URL('../../templates/implementation/', import.meta.url);
const sha = 'a'.repeat(40);
const settings = ImplementationTemplateSettingsSchema.parse({
  kind: 'implementation',
  repository: { path: 'C:/fixture/repo', owner: 'Fixture', name: 'repo', baseBranch: 'main' },
  supportReadKey: 'support-reader',
  roles: { implementer: { harness: 'codex', model: 'gpt-6-sol', effort: 'high' } },
});
const directPlan = {
  mode: 'direct',
  instructions: 'Implement the acceptance criteria and check them.',
};
const splitPlan = {
  mode: 'split',
  tasks: [
    { id: 'first', title: 'First task', instructions: 'Implement the shared behavior.' },
    { id: 'second', title: 'Second task', instructions: 'Use the first task and test the result.' },
  ],
};
const prProposal = {
  title: 'Implement the fixture issue',
  summary: 'Implemented the fixture acceptance criteria.',
  changes: ['Bounded fixture change'],
  tests: ['Configured gate passed'],
  risks: ['No additional risks identified in the fixture'],
};

async function jsonFile(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8'));
}
async function authored(): Promise<TemplateBundle> {
  const manifest = TemplateManifestSchema.parse(await jsonFile('manifest.json'));
  const loops = Object.fromEntries(
    await Promise.all(
      manifest.loops.map(async (loop) => [
        loop.key,
        LoopExportSchema.parse(await jsonFile(loop.file)).loop,
      ]),
    ),
  );
  return validateTemplateBundle({ manifest, loops }).bundle;
}
async function prepared(maxIterations = 100) {
  const bundle = await authored();
  const allocations = Object.fromEntries(
    bundle.manifest.loops.map((loop) => [
      loop.key,
      {
        loopId: fakeUlid(`implementation-loop-${loop.key}`),
        versionId: fakeUlid(`implementation-version-${loop.key}`),
        version: 3,
        name: `Fixture ${loop.key}`,
      },
    ]),
  );
  return prepareTemplateBundle(
    bundle,
    { ...settings, limits: { ...settings.limits, maxIterations } },
    allocations,
  );
}

interface Scenario {
  plan?: unknown;
  gates?: boolean[];
  blockedAt?: SupportAction;
  malformedAt?: SupportAction;
  turns?: ScriptedTurn[];
  maxIterations?: number;
}

/** Execute real authored definitions over fake ports only; support effects are separately tested. */
async function execute(options: Scenario = {}) {
  const engine = await createTestEngine({ maxConcurrentRuns: 4 });
  const bundle = await prepared(options.maxIterations);
  for (const loop of bundle.loops)
    engine.publish(loop.definition, { loopId: loop.loopId, version: loop.version });
  engine.ports.workspace.resolve = async (spec, view) =>
    spec.kind === 'template'
      ? renderTemplate(spec.template, view)
      : spec.kind === 'fixed'
        ? spec.path
        : 'C:/fixture/temp';
  const plan = options.plan ?? directPlan;
  const tasks = ImplementationPlanSchema.safeParse(plan);
  const workerCount = tasks.success && tasks.data.mode === 'split' ? tasks.data.tasks.length : 1;
  const gateResults = options.gates ?? [true];
  const fixCount = gateResults.length - 1;
  engine.ports.harness.script(
    options.turns ?? [
      { structured: { plan } },
      ...Array.from({ length: workerCount + fixCount }, (_, index) => ({
        structured: { summary: `Completed fixture worker ${index + 1}.` },
      })),
      { structured: prProposal },
    ],
  );
  const actions: SupportAction[] = [];
  const inputs: {
    action: SupportAction;
    task: JsonValue | undefined;
    result: JsonValue | undefined;
  }[] = [];
  let index = 0;
  let gateCalls = 0;
  let taskList: { id: string; title: string; instructions: string }[] = [];
  const workspace = {
    type: 'ImplementationWorkspace',
    repository: 'fixture/repo',
    issue: 42,
    attempt: 1,
    branch: 'graphgoblin/issue-42-attempt-1',
    cwd: 'C:/fixture/issue-42',
    title: 'Fixture issue',
    body: 'Implement the bounded fixture acceptance criteria.',
  };
  engine.ports.scripts.respondWith((request) => {
    expect(request.command).toBe('graphgoblin-template-support');
    expect(request.args).toHaveLength(1);
    const action = SupportActionSchema.parse(request.args[0]);
    actions.push(action);
    const thread = ContextThreadSchema.parse(JSON.parse(request.stdin ?? 'null'));
    inputs.push({ action, task: thread.vars['task'], result: thread.vars['workerResult'] });
    const blocked = { type: 'SupportBlocked', code: 'FIXTURE_REFUSAL', message: 'Stopped safely.' };
    let value: JsonValue;
    if (action === options.blockedAt) value = blocked;
    else if (action === options.malformedAt) value = { type: 'UnexpectedSupportResult' };
    else {
      switch (action) {
        case 'claim':
          value = { type: 'ClaimRecord', repository: 'fixture/repo', issue: 42, attempt: 1 };
          break;
        case 'prepare':
          value = workspace;
          break;
        case 'plan': {
          const parsed = ImplementationPlanEnvelopeSchema.safeParse(thread.lastOutput?.value);
          if (!parsed.success) value = blocked;
          else {
            taskList =
              parsed.data.plan.mode === 'direct'
                ? [
                    {
                      id: 'direct',
                      title: workspace.title,
                      instructions: parsed.data.plan.instructions,
                    },
                  ]
                : parsed.data.plan.tasks;
            value =
              taskList.length > settings.limits.maxTasks
                ? blocked
                : {
                    type: 'ImplementationPlan',
                    mode: parsed.data.plan.mode,
                    tasks: taskList,
                    taskIndex: 0,
                  };
          }
          break;
        }
        case 'task-prepare': {
          const task = taskList[index];
          value = task
            ? { type: 'ImplementationTask', ...task, cwd: `C:/fixture/task-${index}`, index }
            : blocked;
          break;
        }
        case 'task-complete':
          expect(WorkerResultSchema.parse(thread.vars['workerResult'])).toMatchObject({
            summary: expect.any(String),
          });
          index += 1;
          value = {
            type: 'TaskComplete',
            taskIndex: index,
            remaining: index < taskList.length,
            head: sha,
          };
          break;
        case 'gate': {
          const fixes = gateCalls++;
          value = {
            type: 'GateResult',
            passed: gateResults[fixes] ?? false,
            fixes,
            canFix: fixes < settings.limits.gateFixes,
            summary: 'Configured fixture gates failed; repair the tested behavior.',
          };
          break;
        }
        case 'pr-intent':
          expect(PrProposalSchema.parse(thread.lastOutput?.value)).toEqual(prProposal);
          value = {
            type: 'PrIntent',
            head: sha,
            branch: workspace.branch,
            title: prProposal.title,
            body: 'Closes #42',
          };
          break;
        case 'pr-created':
          value = {
            type: 'PrCreated',
            repository: 'fixture/repo',
            issue: 42,
            attempt: 1,
            pullRequest: 7,
            head: sha,
          };
          break;
        case 'complete':
          value = { type: 'ImplementationComplete', pullRequest: 7, head: sha };
          break;
        case 'block':
          value = {
            type: 'ImplementationBlocked',
            code: 'FIXTURE_REFUSAL',
            message: 'Stopped safely.',
          };
          break;
        case 'poll':
          throw new Error('The fake run never launches a poll probe.');
      }
    }
    return { exitCode: 0, stdout: JSON.stringify(value), stderr: '', timedOut: false };
  });
  const run = await engine.runToIdle(bundle.parentLoopId, { id: 42, payload: { issue: 42 } });
  return { engine, run, bundle, actions, inputs };
}

describe('authored implementation template bundle', () => {
  it('validates current exports, dependencies and pinned published workers before its draft parent', async () => {
    const source = await authored();
    expect(validateTemplateBundle(source).order).toEqual(['worker', 'parent']);
    const result = await prepared(5);
    expect(
      result.loops.map((loop) => [loop.key, loop.status, loop.definition.settings.maxIterations]),
    ).toEqual([
      ['worker', 'published', 5],
      ['parent', 'draft', 5],
    ]);
    for (const child of result.loops[1]!.definition.nodes.filter(
      (node) => node.kind === 'subloop',
    )) {
      expect(child.config.loopRef).toEqual({ loopId: result.loops[0]!.loopId, version: 3 });
      expect(child.config.input).toMatchObject({ mode: 'fresh' });
      expect(child.config.output).toMatchObject({
        mode: 'result-only',
        resultTo: { var: 'workerResult' },
      });
    }
    expect(source.manifest.requiredSecrets).toEqual([
      { key: 'supportReadKey', scopes: ['runs:read'] },
    ]);
    expect(source.manifest.supportEntry).toBe('dist/templates/github/entry.js');
    expect(source.manifest.prerequisites.every((check) => check.blocking === 'authoring')).toBe(
      true,
    );
  });

  it('declares bounded poll-items with one candidate per poll and literal support commands', async () => {
    const source = await authored();
    const trigger = source.loops['parent']!.nodes.find((node) => node.kind === 'trigger');
    expect(trigger?.config).toMatchObject({
      subtype: 'poll',
      intervalSeconds: 60,
      items: { select: 'probe.json.items', dedupeKey: '$string(item.id)', maxRunsPerPoll: 1 },
      probe: { command: 'graphgoblin-template-support', args: ['poll'] },
    });
    for (const node of source.loops['parent']!.nodes.filter((node) => node.kind === 'script')) {
      expect(node.config).toMatchObject({
        command: 'graphgoblin-template-support',
        args: [node.id],
        cwd: '.',
        stdin: 'thread',
        stdout: 'last-output',
        timeoutSeconds: node.id === 'gate' ? 86400 : 120,
      });
      expect(node.config.env).toBeUndefined();
      expect(SupportActionSchema.safeParse(node.config.args[0]).success).toBe(true);
    }
  });

  it('keeps all model outputs strict, finite and identical to shipped schemas and prompts', async () => {
    const source = await authored();
    for (const [key, id, schemaName, promptName] of [
      ['parent', 'planner', 'plan.schema.json', 'planner.md'],
      ['parent', 'pr-writer', 'pr.schema.json', 'pr-writer.md'],
      ['worker', 'implementer', 'worker.schema.json', 'worker.md'],
    ]) {
      const node = source.loops[key!]!.nodes.find((candidate) => candidate.id === id);
      if (node?.kind !== 'inference') throw new Error('Expected mapped inference node.');
      expect(node.config.session).toEqual({ policy: 'fresh' });
      expect(node.config.timeoutSeconds).toBeGreaterThan(0);
      expect(node.config.output.schema).toMatchObject({
        native: true,
        repair: { enabled: true, maxAttempts: 1, onFailure: 'fail-run' },
      });
      expect(node.config.output.schema?.jsonSchema).toEqual(await jsonFile(schemaName!));
      expect(node.config.prompt.template.trim()).toBe(
        (await readFile(new URL(promptName!, fixtureRoot), 'utf8')).trim(),
      );
    }
  });

  it.each([
    ['plan.schema.json', { plan: directPlan }, true],
    ['plan.schema.json', { plan: splitPlan }, true],
    ['plan.schema.json', { plan: { mode: 'split', tasks: splitPlan.tasks.slice(0, 1) } }, false],
    ['plan.schema.json', { plan: { mode: 'direct', instructions: '   ' } }, false],
    ['plan.schema.json', { plan: { ...directPlan, command: 'untrusted' } }, false],
    ['plan.schema.json', directPlan, false],
    ['plan.schema.json', {}, false],
    ['plan.schema.json', { unknown: directPlan }, false],
    ['plan.schema.json', { plan: directPlan, unknown: true }, false],
    ['worker.schema.json', { summary: 'Actual work and checks.' }, true],
    ['worker.schema.json', { summary: '', head: sha }, false],
    ['pr.schema.json', prProposal, true],
    ['pr.schema.json', { ...prProposal, title: '-unsafe' }, false],
    ['pr.schema.json', { ...prProposal, title: 'unsafe\nsecond line' }, false],
    ['pr.schema.json', { ...prProposal, title: '   ' }, false],
    ['pr.schema.json', { ...prProposal, title: ' -unsafe' }, false],
    ['pr.schema.json', { ...prProposal, tests: [] }, false],
    ['pr.schema.json', { ...prProposal, body: 'Closes #999' }, false],
  ] as const)('validates bounded structured output %s (%j)', async (file, value, ok) => {
    expect(validateJson(JsonSchemaSchema.parse(await jsonFile(file)), value).ok).toBe(ok);
  });

  it('keeps the native planner schema in the root-object subset with a nested typed union', async () => {
    const schema = JsonSchemaSchema.parse(await jsonFile('plan.schema.json'));
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['plan'],
      properties: {
        plan: {
          anyOf: [
            { properties: { mode: { type: 'string', enum: ['direct'] } } },
            { properties: { mode: { type: 'string', enum: ['split'] } } },
          ],
        },
      },
    });
    expect(schema).not.toHaveProperty('anyOf');
    const inspect = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) inspect(item);
        return;
      }
      if (value === null || typeof value !== 'object') return;
      expect(value).not.toHaveProperty('oneOf');
      if ('properties' in value) {
        const properties = value.properties;
        if (properties === null || typeof properties !== 'object' || Array.isArray(properties))
          throw new Error('Expected native object properties.');
        expect(value).toHaveProperty('type', 'object');
        expect(value).toHaveProperty('additionalProperties', false);
        if (!('required' in value) || !Array.isArray(value.required))
          throw new Error('Expected every native object property to be required.');
        expect([...value.required].sort()).toEqual(Object.keys(properties).sort());
      }
      for (const child of Object.values(value)) inspect(child);
    };
    inspect(schema);
  });

  it('runs one direct fresh task after claim and gates before PR effects', async () => {
    const { engine, run, actions } = await execute();
    expect(run.status).toBe('succeeded');
    expect(run.result).toEqual({ type: 'ImplementationComplete', pullRequest: 7, head: sha });
    expect(actions).toEqual([
      'claim',
      'prepare',
      'plan',
      'task-prepare',
      'task-complete',
      'gate',
      'pr-intent',
      'pr-created',
      'complete',
    ]);
    expect(engine.ports.harness.started).toHaveLength(3);
    expect(engine.ports.harness.resumed).toEqual([]);
    expect(engine.ports.harness.started.map((request) => request.workingDirectory)).toEqual([
      'C:/fixture/issue-42',
      'C:/fixture/task-0',
      'C:/fixture/issue-42',
    ]);
  });

  it('stores settings as literal JSON without generating support args, prompts or executable text', async () => {
    const source = await authored();
    const initial = structuredClone(source);
    const allocations = Object.fromEntries(
      source.manifest.loops.map((loop) => [
        loop.key,
        {
          loopId: fakeUlid(`literal-loop-${loop.key}`),
          versionId: fakeUlid(`literal-version-${loop.key}`),
          version: 1,
          name: `Literal ${loop.key}`,
        },
      ]),
    );
    const value = {
      ...settings,
      gate: { ...settings.gate, args: ['check', '{{ never_render }}', '$(never-run)'] },
    };
    const result = prepareTemplateBundle(source, value, allocations);
    for (const loop of result.loops) {
      const node = loop.definition.nodes.find((candidate) => candidate.id === 'settings');
      if (node?.kind !== 'mutate') throw new Error('Expected mapped settings mutation.');
      expect(node.config.operations).toEqual([
        { op: 'set', path: '/vars/templateSettings', value: { kind: 'literal', value } },
      ]);
      for (const script of loop.definition.nodes.filter((candidate) => candidate.kind === 'script'))
        expect(script.config.args).toEqual([script.id]);
      for (const inference of loop.definition.nodes.filter(
        (candidate) => candidate.kind === 'inference',
      )) {
        const original = initial.loops[loop.key]!.nodes.find(
          (candidate) => candidate.id === inference.id,
        );
        if (original?.kind !== 'inference') throw new Error('Expected authored inference node.');
        expect(inference.config.prompt).toEqual(original.config.prompt);
      }
    }
    expect(source).toEqual(initial);
  });

  it.each(['duplicate task IDs', 'configured task cap'] as const)(
    'refuses a plan with %s in trusted support before any worker',
    async (reason) => {
      const plan =
        reason === 'duplicate task IDs'
          ? { mode: 'split', tasks: [splitPlan.tasks[0], { ...splitPlan.tasks[1], id: 'first' }] }
          : {
              mode: 'split',
              tasks: Array.from({ length: 9 }, (_, index) => ({
                id: `task-${index}`,
                title: `Task ${index}`,
                instructions: 'Bounded task.',
              })),
            };
      const { engine, run, actions } = await execute({ plan });
      expect(run.outcome).toBe('failure');
      expect(actions).toEqual(['claim', 'prepare', 'plan', 'block']);
      expect(engine.ports.harness.started).toHaveLength(1);
    },
  );

  it('runs at least two split children sequentially with separate cwd and fresh native sessions', async () => {
    const { engine, run, inputs } = await execute({ plan: splitPlan });
    expect(run.status).toBe('succeeded');
    const sequence = inputs.filter(({ action }) =>
      ['task-prepare', 'task-complete'].includes(action),
    );
    expect(sequence.map(({ action }) => action)).toEqual([
      'task-prepare',
      'task-complete',
      'task-prepare',
      'task-complete',
    ]);
    expect(
      sequence.filter(({ action }) => action === 'task-complete').map(({ task }) => task),
    ).toMatchObject([
      { id: 'first', cwd: 'C:/fixture/task-0', index: 0 },
      { id: 'second', cwd: 'C:/fixture/task-1', index: 1 },
    ]);
    const starts = engine.events(run.id).filter((event) => event.type === 'child_run.started');
    const finishes = engine.events(run.id).filter((event) => event.type === 'child_run.finished');
    expect(starts).toHaveLength(2);
    expect(finishes).toHaveLength(2);
    expect(finishes[0]!.seq).toBeLessThan(starts[1]!.seq);
    expect(new Set(starts.map((event) => event.childRunId)).size).toBe(2);
    const sessionIds = [...engine.ports.runs.runs.keys()].flatMap((id) =>
      engine
        .events(id)
        .filter((event) => event.type === 'harness.session')
        .map((event) => event.sessionId),
    );
    expect(new Set(sessionIds).size).toBe(4);
    expect(engine.ports.harness.resumed).toEqual([]);
  });

  it('repairs gates through a fresh issue-workspace child without completing another plan task', async () => {
    const { engine, run, actions, inputs } = await execute({ gates: [false, true] });
    expect(run.status).toBe('succeeded');
    expect(actions.filter((action) => action === 'task-complete')).toHaveLength(1);
    expect(actions.filter((action) => action === 'gate')).toHaveLength(2);
    expect(
      inputs.find(
        ({ action, task }) =>
          action === 'gate' &&
          typeof task === 'object' &&
          task !== null &&
          !Array.isArray(task) &&
          task['id'] === 'gate-fix',
      )?.task,
    ).toMatchObject({ cwd: 'C:/fixture/issue-42', index: 0 });
    expect(engine.ports.harness.started).toHaveLength(4);
    expect(engine.ports.harness.resumed).toEqual([]);
  });

  it('exhausts the finite gate-fix allowance with a blocked failure and no PR', async () => {
    const { engine, run, actions } = await execute({ gates: [false, false, false] });
    expect(run.status).toBe('failed');
    expect(run.outcome).toBe('failure');
    expect(actions.filter((action) => action === 'gate')).toHaveLength(3);
    expect(engine.ports.harness.started).toHaveLength(4);
    expect(actions.at(-1)).toBe('block');
    expect(actions).not.toContain('pr-intent');
    expect(actions).not.toContain('pr-created');
  });

  it.each([
    'prepare',
    'plan',
    'task-prepare',
    'task-complete',
    'gate',
    'pr-intent',
    'pr-created',
    'complete',
  ] as const)(
    'routes typed %s refusal into a blocked failed result without later effects',
    async (blockedAt) => {
      const { run, actions } = await execute({ blockedAt });
      expect(run.status).toBe('failed');
      expect(run.outcome).toBe('failure');
      expect(actions.at(-1)).toBe('block');
      expect(actions.slice(actions.indexOf(blockedAt) + 1)).toEqual(['block']);
      expect(run.result).toMatchObject({ type: 'ImplementationBlocked' });
    },
  );

  it('returns the original refused claim without prepare, block or any model turn', async () => {
    const { engine, run, actions } = await execute({ blockedAt: 'claim' });
    expect(run.status).toBe('failed');
    expect(run.outcome).toBe('failure');
    expect(run.result).toMatchObject({ type: 'SupportBlocked', code: 'FIXTURE_REFUSAL' });
    expect(actions).toEqual(['claim']);
    expect(engine.ports.harness.started).toEqual([]);
  });
  it('refuses unexpected support output before launching any model', async () => {
    const { engine, run, actions } = await execute({ malformedAt: 'prepare' });
    expect(run.status).toBe('failed');
    expect(engine.ports.harness.started).toEqual([]);
    expect(actions).toEqual(['claim', 'prepare', 'block']);
  });

  it('routes a failed child into block and never commits its task or creates a PR', async () => {
    const { run, actions } = await execute({
      turns: [
        { structured: { plan: directPlan } },
        { error: { code: 'WORKER_REFUSED', message: 'Fixture worker refused.' } },
      ],
    });
    expect(run.status).toBe('failed');
    expect(actions).toEqual(['claim', 'prepare', 'plan', 'task-prepare', 'block']);
  });

  it('bounds malformed plan repair and never reaches task or PR effects', async () => {
    const { engine, run, actions } = await execute({
      turns: [
        { structured: { plan: { mode: 'unknown' } } },
        { structured: { plan: { mode: 'unknown' } } },
      ],
    });
    expect(run.failure?.code).toBe('OUTPUT_SCHEMA_MISMATCH');
    expect(engine.ports.harness.started).toHaveLength(1);
    expect(engine.ports.harness.resumed).toHaveLength(1);
    expect(actions).toEqual(['claim', 'prepare']);
  });

  it('halts a cycling graph at the owner-configured visit bound before PR creation', async () => {
    const { run, actions } = await execute({ plan: splitPlan, maxIterations: 1 });
    expect(run.failure?.code).toBe('MAX_ITERATIONS');
    expect(actions.filter((action) => action === 'task-prepare')).toHaveLength(1);
    expect(actions).not.toContain('pr-intent');
  });
});
