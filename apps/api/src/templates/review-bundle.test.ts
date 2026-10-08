import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ContextThreadSchema,
  JsonValueSchema,
  JsonSchemaSchema,
  LoopExportSchema,
  ReviewTemplateSettingsSchema,
  TemplateManifestSchema,
  type JsonValue,
  type ReviewTemplateSettings,
  type RunEvent,
} from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import {
  prepareTemplateBundle,
  renderTemplate,
  validateJson,
  validateTemplateBundle,
  validateLoop,
} from '@graphgoblin/domain';
import { createTestEngine, type TestEngine } from '@graphgoblin/engine/testing';

const directory = new URL('../../templates/review/', import.meta.url);
async function asset(name: string): Promise<JsonValue> {
  return JsonValueSchema.parse(JSON.parse(await readFile(new URL(name, directory), 'utf8')));
}
async function authoredBundle() {
  const loop = LoopExportSchema.parse(await asset('parent.json')).loop;
  expect(validateLoop(loop).filter((issue) => issue.severity === 'error')).toEqual([]);
  return validateTemplateBundle({
    manifest: TemplateManifestSchema.parse(await asset('manifest.json')),
    loops: { parent: loop },
  }).bundle;
}
const role = { harness: 'codex', model: 'gpt-6-sol', effort: 'high' } as const;
function settings(overrides: Partial<ReviewTemplateSettings> = {}) {
  return ReviewTemplateSettingsSchema.parse({
    kind: 'review',
    repository: { path: '/repos/example', owner: 'owner', name: 'example', baseBranch: 'main' },
    supportReadKey: 'reader-key',
    roles: { reviewer: role, fixer: { ...role, model: 'gpt-6-luna', effort: 'low' } },
    ...overrides,
  });
}
const allocation = {
  parent: {
    loopId: fakeUlid('review-parent'),
    versionId: fakeUlid('review-version'),
    version: 1,
    name: 'Review example',
  },
};
const approved = {
  verdict: 'approved',
  summary: 'No blocking findings at the prepared head.',
  findings: [],
};
const changes = {
  verdict: 'changes',
  summary: 'One bounded correction is required.',
  findings: [
    {
      id: 'bounds',
      path: 'src/example.ts',
      line: 4,
      severity: 'blocking',
      message: 'Reject the out-of-range input.',
    },
  ],
};
const engines: TestEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.manager.stop();
});

interface ScenarioOptions {
  settings?: Partial<ReviewTemplateSettings>;
  verdicts?: unknown[];
  fixerOutputs?: unknown[];
  issue?: number | null;
  labelHuman?: boolean;
  gatePasses?: boolean[];
  blockAction?: string;
  malformedAction?: string;
  unavailable?: boolean;
  payload?: JsonValue;
}
/** Offline deterministic support double. Its journal and effects live outside authored thread data.
 * This tests graph wiring against the agreed protocol; native authority/actuation remain runtime tests. */
async function scenario(options: ScenarioOptions = {}) {
  const config = settings(options.settings);
  const prepared = prepareTemplateBundle(await authoredBundle(), config, allocation);
  const engine = await createTestEngine();
  engines.push(engine);
  engine.ports.workspace.resolve = async (spec, view) =>
    spec.kind === 'template' ? renderTemplate(spec.template, view) : '/repos/example';
  engine.publish(prepared.loops[0]!.definition, { loopId: prepared.parentLoopId });
  if (options.unavailable) delete engine.ports.harnesses.codex;
  const verdicts = options.verdicts ?? [approved];
  engine.ports.harness.script([
    ...verdicts.map((structured) => ({
      structured,
      match: (request: { prompt: string }) => request.prompt.startsWith('PR reviewer'),
    })),
    ...(
      options.fixerOutputs ??
      Array.from({ length: 8 }, () => ({
        summary: 'Applied the bounded correction and focused checks.',
      }))
    ).map((structured) => ({
      structured,
      match: (request: { prompt: string }) => request.prompt.startsWith('PR fixer'),
    })),
  ]);
  const journal = {
    head: 'a'.repeat(40),
    automaticCycles: 0,
    extraCycles: 0,
    reminders: 0,
    extraPending: false,
    gates: true,
    stale: false,
    checks: true,
    protection: true,
    inputSeq: 0,
  };
  const issue = options.issue === undefined ? 7 : options.issue;
  const attempt = issue === null ? null : 1;
  const gates = [...(options.gatePasses ?? [true])];
  const actions: string[] = [];
  const effects: {
    action: string;
    head?: string;
    issue?: number | null;
    matchHeadCommit?: string;
  }[] = [];
  const inputProofs: { inputSeq: number; wakeSeq: number; startedSeq: number; nodeId: string }[] =
    [];
  const next = (route: string) => ({
    type: 'ReviewNext',
    route,
    head: journal.head,
    automaticCycles: journal.automaticCycles,
    extraCycles: journal.extraCycles,
    reminders: journal.reminders,
    canExtra: journal.extraCycles < config.limits.extraCycles,
    mergeAllowed: journal.gates && journal.checks && journal.protection && !journal.stale,
    summary: 'Current journal summary.',
  });
  const blocked = () => ({
    type: 'SupportBlocked',
    code: 'REVIEW_REFUSED',
    message: 'The current PR state does not permit this action.',
  });
  engine.ports.scripts.respondWith((request) => {
    const action = request.args[0]!;
    actions.push(action);
    expect(request.command).toBe('graphgoblin-template-support');
    expect(request.args).toEqual([action]);
    expect(request.env).toEqual({});
    const thread = ContextThreadSchema.parse(JSON.parse(request.stdin ?? 'null'));
    const output = (): JsonValue => {
      if (action === options.blockAction) return blocked();
      if (action === options.malformedAction) return { type: 'Unexpected', route: 'merge' };
      switch (action) {
        case 'claim':
          return { type: 'ClaimRecord', repository: 'owner/example', issue, attempt };
        case 'prepare':
          return {
            type: 'ReviewWorkspace',
            repository: 'owner/example',
            pullRequest: 11,
            issue,
            attempt,
            head: journal.head,
            cwd: '/repos/example',
            title: 'Bounded change',
            body: 'Untrusted PR description',
            humanRequired: config.requireHumanBeforeMerge || options.labelHuman === true,
          };
        case 'gate':
          journal.gates = gates.shift() ?? true;
          return {
            type: 'ReviewGate',
            head: journal.head,
            passed: journal.gates,
            summary: journal.gates
              ? 'Gates passed at the exact head.'
              : 'Gates failed. Merge remains unavailable.',
          };
        case 'verdict': {
          const candidate = thread.lastOutput?.value;
          if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
            return blocked();
          if (journal.extraPending) {
            journal.extraPending = false;
            return next('wait');
          }
          journal.automaticCycles++;
          return next(
            candidate.verdict === 'approved'
              ? config.requireHumanBeforeMerge || options.labelHuman === true
                ? 'wait'
                : 'merge'
              : journal.automaticCycles < config.limits.automaticCycles
                ? 'fix'
                : 'wait',
          );
        }
        case 'fix-prepare':
          return {
            type: 'ReviewFix',
            head: journal.head,
            cwd: '/repos/example',
            instructions: 'Address the one trusted bounded finding, then stop.',
          };
        case 'fixer-head':
          journal.head = (
            journal.head[0] === 'a' ? 'b' : journal.head[0] === 'b' ? 'c' : 'd'
          ).repeat(40);
          effects.push({ action: 'push', head: journal.head });
          return {
            type: 'FixerHead',
            repository: 'owner/example',
            issue,
            attempt,
            pullRequest: 11,
            head: journal.head,
          };
        case 'summary':
          return {
            type: 'ReviewWait',
            head: journal.head,
            canExtra: journal.extraCycles < config.limits.extraCycles,
            mergeAllowed: journal.gates && journal.checks && journal.protection && !journal.stale,
            summary: `Automatic ${journal.automaticCycles}; extra ${journal.extraCycles}; reminders ${journal.reminders}. Merge requires current passing gates and exact head.`,
          };
        case 'human': {
          const events = engine.events(thread.run.id);
          const input = events.findLast((event) => event.type === 'input.received');
          if (
            input?.type !== 'input.received' ||
            input.seq <= journal.inputSeq ||
            !['human-wait', 'human-wait-capped'].includes(input.nodeId)
          )
            return blocked();
          const parked = events.findLast(
            (event) =>
              event.type === 'run.waiting' &&
              event.nodeId === input.nodeId &&
              event.seq < input.seq,
          );
          const started = events.findLast(
            (event) =>
              event.type === 'node.started' &&
              event.nodeId === input.nodeId &&
              event.seq < input.seq,
          );
          const wake = events.find((event) => event.seq === input.seq + 1);
          if (
            parked?.type !== 'run.waiting' ||
            started?.type !== 'node.started' ||
            parked.wait.startedSeq !== started.seq ||
            wake?.type !== 'run.woken' ||
            wake.reason !== 'input' ||
            wake.nodeId !== input.nodeId ||
            JSON.stringify(wake.payload) !== JSON.stringify(input.payload)
          )
            return blocked();
          const payload = input.payload;
          if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
            return blocked();
          journal.inputSeq = input.seq;
          inputProofs.push({
            inputSeq: input.seq,
            wakeSeq: wake.seq,
            startedSeq: started.seq,
            nodeId: input.nodeId,
          });
          if (payload.decision === 'another-cycle') {
            if (journal.extraCycles >= config.limits.extraCycles) return blocked();
            journal.extraCycles++;
            journal.extraPending = true;
            return next('fix');
          }
          return next(payload.decision === 'close' ? 'close' : 'merge');
        }
        case 'reminder':
          if (journal.reminders < config.limits.reminders) {
            journal.reminders++;
            effects.push({ action: 'reminder' });
          }
          return {
            type: 'ReviewReminder',
            route: journal.reminders < config.limits.reminders ? 'wait' : 'timeout',
            reminders: journal.reminders,
            summary: 'Reply through an exposed input surface.',
          };
        case 'merge':
          if (!journal.gates || journal.stale || !journal.checks || !journal.protection)
            return blocked();
          effects.push({ action: 'merge', head: journal.head, matchHeadCommit: journal.head });
          return { type: 'ReviewMerged', pullRequest: 11, head: journal.head };
        case 'close':
          effects.push({ action: 'close', issue });
          if (issue !== null) effects.push({ action: 'needs-human', issue });
          return { type: 'ReviewClosed', pullRequest: 11, issue };
        case 'timeout':
          if (issue !== null) effects.push({ action: 'needs-human', issue });
          return { type: 'ReviewTimedOut', reason: 'HUMAN_REVIEW_TIMEOUT', pullRequest: 11, issue };
        case 'block':
          return {
            type: 'ReviewBlocked',
            code: 'REVIEW_REFUSED',
            message: 'Review stopped safely.',
          };
        default:
          throw new Error(`unexpected fake action ${action}`);
      }
    };
    return { exitCode: 0, stdout: JSON.stringify(output()), stderr: '', timedOut: false };
  });
  const started = await engine.start(
    prepared.parentLoopId,
    options.payload ?? { pullRequest: 11, head: journal.head },
  );
  const run = await engine.settle(started.id);
  return {
    engine,
    run,
    actions,
    effects,
    journal,
    inputProofs,
    prepared,
    async input(payload: JsonValue) {
      await engine.manager.provideInput(run.id, payload);
      return engine.settle(run.id);
    },
    async timeout() {
      await engine.ports.timers.fire(run.id, 'timeout');
      return engine.settle(run.id);
    },
  };
}
function sessions(events: RunEvent[]) {
  return events.filter((event) => event.type === 'harness.session');
}

describe('review bundle integrity and preparation', () => {
  it('validates the current-format poll bundle with only static private actions and fresh declared roles', async () => {
    const bundle = await authoredBundle();
    expect(bundle.manifest.supportEntry).toBe('dist/templates/github/review-entry.js');
    expect(bundle.manifest.roles).toEqual([
      { id: 'reviewer', label: 'Reviewer', access: 'read-only' },
      { id: 'fixer', label: 'Fixer', access: 'write' },
    ]);
    const loop = bundle.loops.parent!;
    const trigger = loop.nodes.find((node) => node.kind === 'trigger')!;
    expect(trigger.config).toMatchObject({
      subtype: 'poll',
      items: { dedupeKey: "$string(item.id) & ':' & item.payload.head", maxRunsPerPoll: 1 },
      probe: { command: 'graphgoblin-template-support', args: ['poll'] },
    });
    expect(
      loop.nodes.filter((node) => node.kind === 'script').map((node) => node.config.args),
    ).toEqual(
      [
        'claim',
        'prepare',
        'gate',
        'verdict',
        'fix-prepare',
        'fixer-head',
        'summary',
        'human',
        'reminder',
        'merge',
        'close',
        'timeout',
        'block',
      ].map((action) => [action]),
    );
    expect(bundle.manifest.requiredSecrets).toEqual([
      { key: 'supportReadKey', scopes: ['runs:read'] },
    ]);
    expect(bundle.manifest.loops[0]?.subloops).toEqual([]);
  });
  it('keeps prompt/schema files identical to embedded assets and exposes only valid input choices', async () => {
    const loop = (await authoredBundle()).loops.parent!;
    for (const [id, file] of [
      ['reviewer', 'verdict'],
      ['fixer', 'fixer'],
    ] as const) {
      const node = loop.nodes.find(
        (candidate) => candidate.kind === 'inference' && candidate.id === id,
      )!;
      if (node.kind !== 'inference') throw new Error('missing role');
      expect(node.config.prompt.template).toBe(
        await readFile(new URL(`${id}.md`, directory), 'utf8'),
      );
      expect(node.config.output.schema?.jsonSchema).toEqual(await asset(`${file}.schema.json`));
      expect(node.config.session).toEqual({ policy: 'fresh' });
      expect(node.config.output.schema?.repair).toEqual({
        enabled: true,
        maxAttempts: 1,
        onFailure: 'fail-run',
      });
    }
    for (const [id, file, choices] of [
      ['human-wait', 'human-input', ['merge', 'another-cycle', 'close']],
      ['human-wait-capped', 'human-input-capped', ['merge', 'close']],
    ] as const) {
      const node = loop.nodes.find(
        (candidate) => candidate.kind === 'wait' && candidate.id === id,
      )!;
      if (node.kind !== 'wait' || node.config.mode !== 'input') throw new Error('missing wait');
      expect(node.config.inputSchema).toEqual(await asset(`${file}.schema.json`));
      expect(node.config.exposeTo).toEqual(['ui', 'api', 'mcp']);
      for (const decision of choices)
        expect(validateJson(node.config.inputSchema!, { decision }).ok).toBe(true);
      expect(validateJson(node.config.inputSchema!, { decision: 'merge', timedOut: true }).ok).toBe(
        false,
      );
      expect(node.config.prompt).toContain('A stale or failing head cannot be overridden.');
    }
  });
  it.each([
    {},
    { automaticCycles: 1, extraCycles: 0, reminders: 0, waitHours: 1 },
    { automaticCycles: 3, extraCycles: 3, reminders: 3, waitHours: 168 },
  ])(
    'binds actual wait bounds and counters without mutating authored JSON (%j)',
    async (limits) => {
      const bundle = await authoredBundle();
      const original = structuredClone(bundle);
      const config = settings({ limits: settings().limits });
      config.limits = { ...config.limits, ...limits };
      const prepared = prepareTemplateBundle(bundle, config, allocation);
      const loop = prepared.loops[0]!.definition;
      expect(loop.settings.maxIterations).toBe(
        config.limits.automaticCycles + config.limits.extraCycles + config.limits.reminders + 2,
      );
      for (const node of loop.nodes.filter((node) => node.kind === 'wait'))
        expect(node.config.timeoutSeconds).toBe(config.limits.waitHours * 3600);
      expect(prepared.loops[0]?.status).toBe('draft');
      expect(bundle).toEqual(original);
      const mutate = loop.nodes.find((node) => node.id === 'settings' && node.kind === 'mutate');
      if (mutate?.kind !== 'mutate') throw new Error('missing settings');
      expect(mutate.config.operations[0]).toEqual({
        op: 'set',
        path: '/vars/templateSettings',
        value: { kind: 'literal', value: config },
      });
    },
  );
  it.each([
    { verdict: 'approved', summary: 'OK', findings: [], decision: 'merge' },
    { verdict: 'merge', summary: 'OK', findings: [] },
    { verdict: 'approved', summary: ' ', findings: [] },
    { verdict: 'changes', summary: 'Bounded', findings: [{ ...changes.findings[0], line: 0 }] },
    {
      verdict: 'changes',
      summary: 'Bounded',
      findings: Array.from({ length: 33 }, () => changes.findings[0]),
    },
  ])(
    'refuses malformed or human-shaped reviewer proposals before support (%j)',
    async (proposal) => {
      expect(
        validateJson(JsonSchemaSchema.parse(await asset('verdict.schema.json')), proposal).ok,
      ).toBe(false);
    },
  );
});

describe('review graph execution over fake ports', () => {
  it('merges the first default approval at the exact SHA after gates and configured read-only review', async () => {
    const s = await scenario();
    expect(s.run.status).toBe('succeeded');
    expect(s.actions).toEqual(['claim', 'prepare', 'gate', 'verdict', 'merge']);
    expect(s.effects).toEqual([
      { action: 'merge', head: 'a'.repeat(40), matchHeadCommit: 'a'.repeat(40) },
    ]);
    expect(s.engine.ports.harness.started[0]).toMatchObject({
      model: 'gpt-6-sol',
      effort: 'high',
      workingDirectory: '/repos/example',
      options: { sandbox: 'read-only' },
    });
    expect(s.inputProofs).toEqual([]);
  });
  it('performs at most three automatic reviews and two separate fixes, then parks unmerged', async () => {
    const s = await scenario({ verdicts: [changes, changes, changes] });
    expect(s.run.status).toBe('waiting');
    expect(s.run.iteration).toBe(3);
    expect(s.actions.filter((action) => action === 'verdict')).toHaveLength(3);
    expect(s.actions.filter((action) => action === 'fixer-head')).toHaveLength(2);
    expect(s.effects.filter((effect) => effect.action === 'merge')).toEqual([]);
    const records = sessions(s.engine.events(s.run.id));
    expect(records.map((event) => event.nodeId)).toEqual([
      'reviewer',
      'fixer',
      'reviewer',
      'fixer',
      'reviewer',
    ]);
    expect(new Set(records.map((event) => event.sessionId)).size).toBe(5);
    expect(records.every((event) => event.mode === 'fresh')).toBe(true);
    expect(
      records
        .filter((event) => event.nodeId === 'fixer')
        .every((event) => event.model === 'gpt-6-luna' && event.effort === 'low'),
    ).toBe(true);
    expect(s.engine.ports.harness.resumed).toEqual([]);
  });
  it.each(['setting', 'label'] as const)(
    'requires persisted human input for %s policy despite an approved model output',
    async (policy) => {
      const s = await scenario({
        settings: { requireHumanBeforeMerge: policy === 'setting' },
        labelHuman: policy === 'label',
        payload: { decision: 'merge', pullRequest: 11 },
      });
      expect(s.run.status).toBe('waiting');
      expect(s.effects).toEqual([]);
      const final = await s.input({ decision: 'merge', note: 'I reviewed the current evidence.' });
      expect(final.status).toBe('succeeded');
      expect(s.inputProofs).toHaveLength(1);
      expect(s.inputProofs[0]?.wakeSeq).toBe(s.inputProofs[0]!.inputSeq + 1);
      expect(s.inputProofs[0]?.nodeId).toBe('human-wait');
      await expect(s.input({ decision: 'merge' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    },
  );
  it('admits a standalone PR without inventing linked issue or implementation provenance', async () => {
    const s = await scenario({ issue: null });
    expect(s.run.status).toBe('succeeded');
    const thread = await s.engine.ports.runs.getThread(s.run.id);
    expect(thread?.outputs.claim?.value).toEqual({
      type: 'ClaimRecord',
      repository: 'owner/example',
      issue: null,
      attempt: null,
    });
    expect(s.actions).not.toContain('pr-created');
  });
  it('executes exactly one fix/review per human extra cycle, even on approval, and caps the next schema', async () => {
    const s = await scenario({
      settings: { requireHumanBeforeMerge: true },
      verdicts: [approved, approved, approved, approved],
    });
    for (let index = 1; index <= 3; index++) {
      const run = await s.input({ decision: 'another-cycle' });
      expect(run.status).toBe('waiting');
      expect(run.iteration).toBe(index + 1);
      expect(s.actions.filter((action) => action === 'fixer-head')).toHaveLength(index);
      expect(s.actions.filter((action) => action === 'verdict')).toHaveLength(index + 1);
    }
    const capped = await s.engine.settle(s.run.id);
    expect(capped.waiting?.nodeId).toBe('human-wait-capped');
    expect(s.effects.filter((effect) => effect.action === 'merge')).toEqual([]);
    await expect(s.input({ decision: 'another-cycle' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect((await s.input({ decision: 'merge' })).status).toBe('succeeded');
    expect(s.inputProofs.map((proof) => proof.nodeId)).toEqual([
      'human-wait',
      'human-wait',
      'human-wait',
      'human-wait-capped',
    ]);
  });
  it.each([7, null])(
    'closes PR unmerged and labels only an existing linked issue (%s)',
    async (issue) => {
      const s = await scenario({ issue, settings: { requireHumanBeforeMerge: true } });
      expect((await s.input({ decision: 'close' })).status).toBe('succeeded');
      expect(s.effects).toEqual(
        issue === null
          ? [{ action: 'close', issue: null }]
          : [
              { action: 'close', issue },
              { action: 'needs-human', issue },
            ],
      );
    },
  );
  it('refuses malformed and unknown wait input without a wake or changed durable state', async () => {
    const s = await scenario({ settings: { requireHumanBeforeMerge: true } });
    const before = s.engine.events(s.run.id);
    for (const input of [
      { decision: 'approve' },
      { decision: 'merge', unknown: true },
      { decision: 'merge', note: 'x'.repeat(4001) },
    ])
      await expect(s.input(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(s.engine.events(s.run.id)).toEqual(before);
    expect((await s.engine.settle(s.run.id)).status).toBe('waiting');
    expect(s.effects).toEqual([]);
  });
  it.each([0, 1, 3])(
    'posts at most %s reminders then fails open/unmerged without input authority',
    async (reminders) => {
      const s = await scenario({
        settings: { requireHumanBeforeMerge: true, limits: { ...settings().limits, reminders } },
      });
      for (let index = 0; index < Math.max(reminders, 1); index++) {
        const run = await s.timeout();
        expect(run.status).toBe(index + 1 < reminders ? 'waiting' : 'failed');
      }
      expect(s.effects.filter((effect) => effect.action === 'reminder')).toHaveLength(reminders);
      expect(s.effects.some((effect) => ['merge', 'close'].includes(effect.action))).toBe(false);
      expect(s.actions).not.toContain('human');
      expect(s.inputProofs).toEqual([]);
      expect((await s.engine.ports.runs.getThread(s.run.id))?.vars.finalResult).toMatchObject({
        type: 'ReviewTimedOut',
        reason: 'HUMAN_REVIEW_TIMEOUT',
      });
      expect(
        s.engine
          .events(s.run.id)
          .filter((event) => event.type === 'run.woken')
          .every((event) => event.reason === 'timeout'),
      ).toBe(true);
    },
  );
  it('keeps merge unavailable on gate failure and refuses a human override', async () => {
    const s = await scenario({ gatePasses: [false] });
    expect(s.run.status).toBe('waiting');
    expect(s.engine.ports.harness.started).toEqual([]);
    expect(s.run.waiting?.prompt).toContain('Merge available: false');
    expect(s.run.waiting?.prompt).toContain('Merge remains unavailable until current gates');
    expect((await s.input({ decision: 'merge' })).status).toBe('failed');
    expect(s.effects).toEqual([]);
    expect(s.actions.slice(-2)).toEqual(['merge', 'block']);
  });
  it.each(['stale', 'checks', 'protection'] as const)(
    'rechecks %s at human actuation rather than trusting an earlier approval',
    async (guard) => {
      const s = await scenario({ settings: { requireHumanBeforeMerge: true } });
      if (guard === 'stale') s.journal.stale = true;
      else s.journal[guard] = false;
      expect((await s.input({ decision: 'merge' })).status).toBe('failed');
      expect(s.effects).toEqual([]);
    },
  );
  it('checks gates again before review of a pushed fixer head', async () => {
    const s = await scenario({ verdicts: [changes, approved], gatePasses: [true, false] });
    expect(s.run.status).toBe('waiting');
    expect(s.actions.filter((action) => action === 'verdict')).toHaveLength(1);
    expect(s.effects).toEqual([{ action: 'push', head: 'b'.repeat(40) }]);
    expect(s.journal.head).toBe('b'.repeat(40));
    expect(s.run.waiting?.prompt).toContain('b'.repeat(40));
  });
  it.each(['claim', 'prepare', 'gate', 'verdict', 'merge'])(
    'routes a typed %s refusal to a bounded failure without PR effects',
    async (blockAction) => {
      const s = await scenario({ blockAction });
      expect(s.run.status).toBe('failed');
      expect(s.actions.at(-1)).toBe('block');
      expect(s.effects).toEqual([]);
    },
  );
  it.each(['claim', 'prepare', 'gate', 'verdict', 'merge'])(
    'routes malformed %s support output to failure',
    async (malformedAction) => {
      const s = await scenario({ malformedAction });
      expect(s.run.status).toBe('failed');
      expect(s.actions.at(-1)).toBe('block');
      expect(s.effects).toEqual([]);
    },
  );
  it('fails malformed reviewer output after exactly one repair and never reaches verdict/merge', async () => {
    const s = await scenario({
      verdicts: [
        { ...approved, decision: 'merge' },
        { ...approved, decision: 'merge' },
      ],
    });
    expect(s.run.status).toBe('failed');
    expect(s.actions).toEqual(['claim', 'prepare', 'gate']);
    expect(s.engine.ports.harness.started).toHaveLength(1);
    expect(s.engine.ports.harness.resumed).toHaveLength(1);
    expect(s.effects).toEqual([]);
  });
  it('runs no turn when the selected reviewer harness is unavailable', async () => {
    const s = await scenario({ unavailable: true });
    expect(s.run.status).toBe('failed');
    expect(s.engine.ports.harness.started).toEqual([]);
    expect(s.effects).toEqual([]);
  });
  it('can recover failing gates through one authorized extra fix and returns to human review', async () => {
    const s = await scenario({ gatePasses: [false, true], verdicts: [approved] });
    const run = await s.input({ decision: 'another-cycle' });
    expect(run.status).toBe('waiting');
    expect(s.actions.filter((action) => action === 'fixer-head')).toHaveLength(1);
    expect(s.actions.filter((action) => action === 'verdict')).toHaveLength(1);
    expect(s.journal.extraCycles).toBe(1);
    expect(s.effects.filter((effect) => effect.action === 'merge')).toEqual([]);
  });
  it('uses only new persisted input after an earlier timeout wake', async () => {
    const s = await scenario({ settings: { requireHumanBeforeMerge: true } });
    expect((await s.timeout()).status).toBe('waiting');
    expect(s.inputProofs).toEqual([]);
    expect((await s.input({ decision: 'merge' })).status).toBe('succeeded');
    expect(s.inputProofs).toHaveLength(1);
    const timeout = s.engine
      .events(s.run.id)
      .find((event) => event.type === 'run.woken' && event.reason === 'timeout')!;
    expect(s.inputProofs[0]!.startedSeq).toBeGreaterThan(timeout.seq);
    expect(s.inputProofs[0]!.inputSeq).toBeGreaterThan(s.inputProofs[0]!.startedSeq);
  });
  it('covers the maximum automatic, extra and reminder sequence within prepared finite visits', async () => {
    const s = await scenario({ verdicts: [changes, changes, changes, changes, changes, changes] });
    for (let index = 0; index < 3; index++)
      expect((await s.input({ decision: 'another-cycle' })).status).toBe('waiting');
    for (let index = 0; index < 3; index++)
      expect((await s.timeout()).status).toBe(index === 2 ? 'failed' : 'waiting');
    expect(s.journal).toMatchObject({ automaticCycles: 3, extraCycles: 3, reminders: 3 });
    expect(s.actions.filter((action) => action === 'verdict')).toHaveLength(6);
    expect(s.actions.filter((action) => action === 'fixer-head')).toHaveLength(5);
    expect(s.effects.some((effect) => effect.action === 'merge')).toBe(false);
    const run = await s.engine.settle(s.run.id);
    expect(run.iteration).toBe(6);
    expect((await s.engine.ports.runs.getThread(run.id))?.vars.finalResult).toMatchObject({
      reason: 'HUMAN_REVIEW_TIMEOUT',
    });
    expect(run.failure?.code).not.toBe('MAX_ITERATIONS');
  });
  it('never labels a nonexistent linked issue on timeout', async () => {
    const s = await scenario({
      issue: null,
      settings: { requireHumanBeforeMerge: true, limits: { ...settings().limits, reminders: 0 } },
    });
    expect((await s.timeout()).status).toBe('failed');
    expect(s.effects).toEqual([]);
  });
  it('fails a human-shaped fixer response after one repair without push or merge', async () => {
    const s = await scenario({
      verdicts: [changes],
      fixerOutputs: [{ summary: 'Changed', decision: 'merge' }],
    });
    expect(s.run.status).toBe('failed');
    expect(s.actions).not.toContain('fixer-head');
    expect(s.actions).not.toContain('merge');
    expect(s.engine.ports.harness.started).toHaveLength(2);
    expect(s.engine.ports.harness.resumed).toHaveLength(1);
    expect(s.effects).toEqual([]);
  });
});
