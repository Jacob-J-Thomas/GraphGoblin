import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ContextThreadSchema,
  JsonSchemaSchema,
  JsonValueSchema,
  LoopExportSchema,
  QaTemplateSettingsSchema,
  TemplateManifestSchema,
  type JsonValue,
  type QaTemplateSettings,
} from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import {
  prepareTemplateBundle,
  renderTemplate,
  validateJson,
  validateLoop,
  validateTemplateBundle,
} from '@graphgoblin/domain';
import { createTestEngine, type TestEngine } from '@graphgoblin/engine/testing';

const directory = new URL('../../templates/qa/', import.meta.url);
async function asset(name: string): Promise<JsonValue> {
  return JsonValueSchema.parse(JSON.parse(await readFile(new URL(name, directory), 'utf8')));
}
async function bundle() {
  const manifest = TemplateManifestSchema.parse(await asset('manifest.json'));
  const loops = Object.fromEntries(
    await Promise.all(
      manifest.loops.map(
        async (loop) => [loop.key, LoopExportSchema.parse(await asset(loop.file)).loop] as const,
      ),
    ),
  );
  for (const loop of Object.values(loops))
    expect(validateLoop(loop).filter((issue) => issue.severity === 'error')).toEqual([]);
  return validateTemplateBundle({ manifest, loops }).bundle;
}
const role = { harness: 'codex', model: 'gpt-6-sol', effort: 'high' } as const;
function settings(overrides: Partial<QaTemplateSettings> = {}) {
  return QaTemplateSettingsSchema.parse({
    kind: 'qa',
    repository: {
      path: '/repos/forbidden-repository',
      owner: 'owner',
      name: 'example',
      baseBranch: 'main',
    },
    supportReadKey: 'reader-key',
    roles: { qa: role, adversary: { ...role, model: 'gpt-6-astra', effort: 'xhigh' } },
    ...overrides,
  });
}
const allocations = Object.fromEntries(
  ['parent', 'adversary'].map((key) => [
    key,
    {
      loopId: fakeUlid(`qa-${key}`),
      versionId: fakeUlid(`qa-version-${key}`),
      version: 3,
      name: `QA ${key}`,
    },
  ]),
);
const originalIssue = {
  number: 7,
  title: 'Bounded result',
  body: 'Acceptance: reject invalid input and preserve valid output.',
};
function criteria(depth = 'standard') {
  const value = {
    depth,
    touchedSystems: ['validation'],
    applicationSystems: depth === 'full-regression' ? ['application'] : [],
    criteria: [
      {
        id: 'issue',
        system: 'validation',
        source: 'issue',
        scenario: 'Ticket acceptance',
        polarity: 'positive',
        steps: ['Run acceptance check'],
        expected: 'Issue acceptance holds',
      },
      {
        id: 'valid',
        system: 'validation',
        source: 'touched',
        scenario: 'Valid input',
        polarity: 'positive',
        steps: ['Submit valid input'],
        expected: 'Accepted',
      },
      {
        id: 'invalid',
        system: 'validation',
        source: 'touched',
        scenario: 'Invalid input',
        polarity: 'negative',
        steps: ['Submit invalid input'],
        expected: 'Refused',
      },
    ],
  };
  if (depth === 'full-regression')
    for (const polarity of ['positive', 'negative'])
      value.criteria.push({
        id: `app-${polarity}`,
        system: 'application',
        source: 'application',
        scenario: `Application ${polarity}`,
        polarity,
        steps: ['Run application check'],
        expected: 'All feature expectations hold',
      });
  return value;
}
function results(plan = criteria(), failed = false) {
  return {
    summary: 'Actual catalogued checks.',
    results: plan.criteria.map((criterion, index) => ({
      criterionId: criterion.id,
      status: failed && index === 0 ? 'failed' : 'passed',
      observed: 'Recorded check result.',
      evidence: [{ path: `evidence/${criterion.id}.txt`, description: 'Actual test output' }],
    })),
  };
}
const sound = { sound: true, summary: 'The assessment is useful and supported.', gaps: [] };
const unsound = {
  sound: false,
  summary: 'Coverage gap requires a bounded rerun.',
  gaps: [{ criterionId: 'invalid', message: 'Add stronger negative evidence.' }],
};
const forbidden = [
  'DIFF_CANARY',
  'PR_BODY_CANARY',
  'REPOSITORY_FILE_CANARY',
  'PARENT_THREAD_CANARY',
  '/repos/forbidden-repository',
];
const engines: TestEngine[] = [];
function jsonObject(value: JsonValue | undefined): Record<string, JsonValue> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value;
  throw new Error('Malformed object in the bounded support double');
}
afterEach(() => {
  for (const engine of engines.splice(0)) engine.manager.stop();
});
interface Options {
  fakeIsolationAvailable?: boolean;
  isolationLostAt?: number;
  unavailable?: boolean;
  settings?: Partial<QaTemplateSettings>;
  labelFull?: boolean;
  failed?: boolean;
  adversaries?: unknown[];
  criteriaOutputs?: unknown[];
  resultOutputs?: unknown[];
  missingFile?: boolean;
  missingCriterion?: boolean;
  duplicateResult?: boolean;
  emptyFile?: boolean;
  issueCount?: number;
  issueOpen?: boolean;
  priorRequests?: number;
  priorReopens?: number;
  proofConflicts?: number;
  foreignProof?: 'run' | 'sha' | 'missing';
  blockAction?: string;
  malformedAction?: string;
  responses?: Record<string, JsonValue>;
  payload?: JsonValue;
}
/** This double alone can report isolation available. It proves graph/packet routing, NEVER native enforcement. */
async function scenario(options: Options = {}) {
  const config = settings(options.settings);
  const prepared = prepareTemplateBundle(await bundle(), config, allocations);
  const engine = await createTestEngine();
  engines.push(engine);
  engine.ports.workspace.resolve = async (spec, view) =>
    spec.kind === 'template' ? renderTemplate(spec.template, view) : '/tmp/evidence';
  for (const loop of prepared.loops)
    engine.publish(loop.definition, { loopId: loop.loopId, version: loop.version });
  const depth =
    config.depth === 'full-regression' || options.labelFull === true
      ? 'full-regression'
      : 'standard';
  const plan = criteria(depth);
  const defaultResults = results(plan, options.failed);
  if (options.missingCriterion) defaultResults.results.pop();
  if (options.duplicateResult)
    defaultResults.results[defaultResults.results.length - 1] = defaultResults.results[0]!;
  const turns = [
    ...(options.criteriaOutputs ?? [plan, plan]).map((structured) => ({
      structured,
      match: (request: { prompt: string }) => request.prompt.startsWith('QA criteria planner'),
    })),
    ...(options.resultOutputs ?? [defaultResults, defaultResults]).map((structured) => ({
      structured,
      match: (request: { prompt: string }) => request.prompt.startsWith('QA executor'),
    })),
    ...(options.adversaries ?? [sound]).map((structured) => ({
      structured,
      match: (request: { prompt: string }) =>
        request.prompt.startsWith('Evidence-only QA adversary'),
    })),
  ];
  engine.ports.harness.script(turns);
  for (const criterion of plan.criteria)
    engine.ports.workspace.files.set(
      `/repos/forbidden-repository/evidence/${criterion.id}.txt`,
      'Actual check output',
    );
  engine.ports.workspace.files.set(
    '/repos/forbidden-repository/private.txt',
    'REPOSITORY_FILE_CANARY',
  );
  if (options.missingFile)
    engine.ports.workspace.files.delete('/repos/forbidden-repository/evidence/issue.txt');
  if (options.emptyFile)
    engine.ports.workspace.files.set('/repos/forbidden-repository/evidence/issue.txt', '');
  const journal = {
    guardVisits: 0,
    reruns: 0,
    requests: options.priorRequests ?? 0,
    reopens: options.priorReopens ?? 0,
    issueOpen: options.issueOpen ?? false,
    passed: false,
  };
  const actions: string[] = [];
  const effects: string[] = [];
  const sha = 'a'.repeat(40);
  const attempt = (options.priorRequests ?? 0) + 1;
  const fact = { repository: 'owner/example', issue: 7, attempt, pullRequest: 11, mergeSha: sha };
  let checkedCriteria: JsonValue = null,
    checkedResults: JsonValue = null;
  let artifacts: { id: string; relativePath: string; sha256: string; content: string }[] = [];
  let gaps: JsonValue = [];
  let diagnostic = 'QA_REFUSED';
  const blocked = (code = 'QA_REFUSED') => {
    diagnostic = code;
    return {
      type: 'SupportBlocked',
      code,
      message: 'QA stopped safely without downstream effects.',
    };
  };
  engine.ports.scripts.respondWith((request) => {
    const action = request.args[0]!;
    actions.push(action);
    expect(request.command).toBe('graphgoblin-template-support');
    expect(request.args).toEqual([action]);
    expect(request.env).toEqual({});
    const thread = ContextThreadSchema.parse(JSON.parse(request.stdin ?? 'null'));
    const output = (): JsonValue => {
      if (action === 'proof-check' && options.foreignProof)
        return options.foreignProof === 'missing'
          ? { type: 'QaProof', passed: true }
          : {
              type: 'QaProof',
              passed: true,
              runId: options.foreignProof === 'run' ? fakeUlid('foreign-run') : thread.run.id,
              mergeSha: options.foreignProof === 'sha' ? 'f'.repeat(40) : sha,
            };
      if (options.responses && Object.hasOwn(options.responses, action))
        return options.responses[action] ?? null;
      if (action === options.blockAction) return blocked();
      if (action === options.malformedAction) return { type: 'Unknown', route: 'passed' };
      switch (action) {
        case 'claim':
          return {
            type: 'ClaimRecord',
            repository: fact.repository,
            issue: fact.issue,
            attempt: fact.attempt,
          };
        case 'prerequisites': {
          journal.guardVisits++;
          const available =
            options.fakeIsolationAvailable === true &&
            !options.unavailable &&
            journal.guardVisits !== options.isolationLostAt;
          if (!available)
            diagnostic = options.unavailable
              ? 'TEMPLATE_HARNESS_UNAVAILABLE'
              : 'TEMPLATE_ISOLATION_UNAVAILABLE';
          return {
            type: 'QaPrerequisites',
            available,
            code: available ? 'READY' : diagnostic,
            remediation: available
              ? 'Injected fake only.'
              : 'A required capability is unavailable; run no further QA or effects.',
          };
        }
        case 'prepare':
          if ((options.issueCount ?? 1) !== 1) return blocked('ISSUE_LINK_AMBIGUOUS');
          effects.push('checkout:' + sha);
          return {
            type: 'QaWorkspace',
            ...fact,
            cwd: '/repos/forbidden-repository',
            originalIssue,
            depth,
            diff: 'DIFF_CANARY',
            prBody: 'PR_BODY_CANARY',
          };
        case 'criteria-check': {
          const candidate = thread.lastOutput?.value;
          if (!validateJson(JsonSchemaSchema.parse(schemas.criteria), candidate).ok)
            return blocked('CRITERIA_INVALID');
          if (
            typeof candidate !== 'object' ||
            candidate === null ||
            Array.isArray(candidate) ||
            candidate.depth !== depth
          )
            return blocked('DEPTH_MISMATCH');
          const typed = criteria(depth);
          if (JSON.stringify(candidate) !== JSON.stringify(typed))
            return blocked('CRITERIA_SCOPE_INCOMPLETE');
          checkedCriteria = candidate;
          return { type: 'QaCriteria', value: candidate };
        }
        case 'proof-check': {
          const candidate = thread.lastOutput?.value;
          if (!validateJson(JsonSchemaSchema.parse(schemas.results), candidate).ok)
            return blocked('EVIDENCE_MISSING');
          const expected = plan.criteria.map((item) => item.id);
          const actual = jsonObject(candidate);
          if (!Array.isArray(actual.results)) return blocked('EVIDENCE_MISSING');
          const rows = actual.results.map(jsonObject);
          const seen = rows.map((item) => item.criterionId);
          if (new Set(seen).size !== seen.length || expected.some((id) => !seen.includes(id)))
            return blocked('EVIDENCE_COVERAGE');
          artifacts = [];
          for (const row of rows) {
            if (typeof row.criterionId !== 'string' || !Array.isArray(row.evidence))
              return blocked('EVIDENCE_MISSING');
            for (const raw of row.evidence) {
              const file = jsonObject(raw);
              if (typeof file.path !== 'string') return blocked('EVIDENCE_MISSING');
              const content = engine.ports.workspace.files.get(
                `/repos/forbidden-repository/${file.path}`,
              );
              if (!content) return blocked('EVIDENCE_MISSING');
              artifacts.push({
                id: row.criterionId,
                relativePath: file.path,
                sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
                content,
              });
            }
          }
          if ((options.proofConflicts ?? 0) > config.limits.proofPushRetries)
            return blocked('PROOF_PUSH_EXHAUSTED');
          effects.push('proof:' + sha);
          checkedResults = candidate ?? null;
          journal.passed = rows.every((row) => row.status === 'passed');
          return {
            type: 'QaProof',
            passed: journal.passed,
            runId: thread.run.id,
            mergeSha: sha,
            proofCommit: 'b'.repeat(40),
            links: ['https://example.test/immutable/b/proof'],
          };
        }
        case 'evidence-prepare': {
          const packet = {
            originalIssue,
            criteria: checkedCriteria,
            results: checkedResults,
            artifacts,
          };
          const workspace = `/tmp/evidence-${thread.run.iteration}`;
          engine.ports.workspace.files.set(
            `${workspace}/issue.json`,
            JSON.stringify(originalIssue),
          );
          engine.ports.workspace.files.set(
            `${workspace}/qa.json`,
            JSON.stringify({ criteria: checkedCriteria, results: checkedResults }),
          );
          for (const artifact of artifacts)
            engine.ports.workspace.files.set(
              `${workspace}/${artifact.relativePath}`,
              artifact.content,
            );
          return { type: 'QaEvidence', evidence: { workspace, packet } };
        }
        case 'adversary-check': {
          const candidate = thread.vars.adversary;
          if (
            typeof candidate !== 'object' ||
            candidate === null ||
            Array.isArray(candidate) ||
            !validateJson(JsonSchemaSchema.parse(schemas.adversary), candidate).ok
          )
            return blocked('ADVERSARY_INVALID');
          if (candidate.sound === true) {
            if (!Array.isArray(candidate.gaps) || candidate.gaps.length !== 0)
              return blocked('ADVERSARY_CONTRADICTORY');
            return { type: 'QaNext', route: journal.passed ? 'passed' : 'rework' };
          }
          gaps = candidate.gaps ?? [];
          if (journal.reruns < config.limits.unsoundReruns) {
            journal.reruns++;
            return { type: 'QaNext', route: 'rerun' };
          }
          return { type: 'QaNext', route: 'human' };
        }
        case 'rerun-prepare':
          return { type: 'QaRerun', gaps };
        case 'rework-status':
          return {
            type: 'QaReworkEligibility',
            eligible:
              journal.requests < config.limits.reworkRequests &&
              (journal.issueOpen || journal.reopens < config.limits.reopenings),
            requiresReopen: !journal.issueOpen,
          };
        case 'qa-rework':
          journal.requests++;
          effects.push('request');
          return { type: 'ReworkRequest', ...fact, request: journal.requests };
        case 'issue-reopened':
          journal.reopens++;
          journal.issueOpen = true;
          effects.push('reopen');
          return { type: 'IssueReopened', ...fact, request: journal.requests };
        case 'relabel':
          effects.push('label:' + config.triggerLabel);
          return { type: 'QaRelabeled' };
        case 'qa-outcome':
          return { type: 'QaOutcome', ...fact, outcome: thread.vars.outcome ?? 'blocked' };
        case 'human':
          effects.push('human-comment');
          return {
            type: 'QaHumanRequired',
            code: 'QA_HUMAN_REQUIRED',
            message: 'Review the catalogued gaps and bounded remaining work.',
          };
        case 'block':
          effects.push('blocked-comment');
          return {
            type: 'QaBlocked',
            code: diagnostic,
            message: 'QA stopped; inspect the recorded completed effects and refusal.',
          };
        default:
          throw new Error(`unknown action ${action}`);
      }
    };
    return { exitCode: 0, stdout: JSON.stringify(output()), stderr: '', timedOut: false };
  });
  const started = await engine.start(
    prepared.parentLoopId,
    options.payload ?? { pullRequest: 11, mergeSha: sha, threadCanary: 'PARENT_THREAD_CANARY' },
  );
  const run = await engine.settle(started.id);
  return { engine, run, actions, effects, journal, prepared, depth };
}
const schemas = {
  criteria: await asset('criteria.schema.json'),
  results: await asset('results.schema.json'),
  adversary: await asset('adversary.schema.json'),
};

describe('QA authored bundle boundary', () => {
  it('validates format3 and publishes the evidence child before the unarmed draft parent with exact remapped pins', async () => {
    const authored = await bundle();
    const original = structuredClone(authored);
    const prepared = prepareTemplateBundle(authored, settings(), allocations);
    expect(prepared.loops.map((loop) => [loop.key, loop.status])).toEqual([
      ['adversary', 'published'],
      ['parent', 'draft'],
    ]);
    const child = prepared.loops[0]!.definition,
      parent = prepared.loops[1]!.definition;
    expect(parent.settings.maxIterations).toBe(2);
    expect(child.settings.maxIterations).toBe(1);
    const subloop = parent.nodes.find((node) => node.kind === 'subloop')!;
    expect(subloop.config.loopRef).toEqual({ loopId: allocations.adversary!.loopId, version: 3 });
    expect(subloop.config.input).toEqual({ mode: 'fresh', trigger: { payload: 'vars.evidence' } });
    expect(authored.manifest.loops.find((loop) => loop.key === 'adversary')?.settingsNodes).toEqual(
      [],
    );
    expect(child.nodes.map((node) => node.kind)).toEqual(['trigger', 'inference', 'exit']);
    expect(child.settings.workingDirectory).toEqual({
      kind: 'template',
      template: '{{ invocation.trigger.payload.workspace }}',
    });
    expect(
      authored.manifest.prerequisites.find((check) => check.kind === 'isolation'),
    ).toMatchObject({ blocking: 'runtime', role: 'adversary' });
    expect(authored.manifest.description).toContain('assess evidence');
    expect(authored.manifest.description).not.toContain('unavailable');
    expect(authored.manifest.tags).toEqual(['qa', 'evidence', 'adversarial']);
    expect(authored).toEqual(original);
  });
  it('keeps prompts/schemas mirrored, role model names selected only by typed settings, and private argv static', async () => {
    const authored = await bundle();
    for (const [key, id, file] of [
      ['parent', 'criteria', 'criteria'],
      ['parent', 'execute', 'executor'],
      ['adversary', 'adversary', 'adversary'],
    ] as const) {
      const node = authored.loops[key]!.nodes.find((node) => node.id === id)!;
      if (node.kind !== 'inference') throw new Error('role missing');
      expect(node.config.prompt.template).toBe(
        await readFile(new URL(`${file}.md`, directory), 'utf8'),
      );
      expect(node.config.output.schema?.jsonSchema).toEqual(
        schemas[id === 'execute' ? 'results' : id],
      );
      expect(node.config.session).toEqual({ policy: 'fresh' });
      expect(node.config.model).toBeUndefined();
      expect(node.config.output.schema?.repair).toEqual({
        enabled: true,
        maxAttempts: 1,
        onFailure: 'fail-run',
      });
    }
    for (const node of authored.loops.parent!.nodes.filter((node) => node.kind === 'script')) {
      expect(node.config.command).toBe('graphgoblin-template-support');
      expect(node.config.args).toHaveLength(1);
      expect(node.config.args[0]).toMatch(/^[a-z-]+$/);
      expect(node.config.env).toBeUndefined();
    }
    const trigger = authored.loops.parent!.nodes.find((node) => node.kind === 'trigger')!;
    expect(trigger.config).toMatchObject({
      subtype: 'poll',
      items: { dedupeKey: 'item.payload.mergeSha', maxRunsPerPoll: 1 },
    });
    expect(settings()).toMatchObject({
      depth: 'standard',
      proofBranch: 'graphgoblin-proof',
      limits: { unsoundReruns: 1, reworkRequests: 2, reopenings: 2, proofPushRetries: 3 },
    });
  });
  it.each([
    ['criteria', { ...criteria(), attempt: 2 }],
    ['criteria', { ...criteria(), criteria: [] }],
    [
      'results',
      {
        summary: 'Claims',
        results: [{ criterionId: 'issue', status: 'passed', observed: 'Claimed', evidence: [] }],
      },
    ],
    ['results', { ...results(), hash: 'invented' }],
    [
      'results',
      {
        summary: 'Unsafe',
        results: [
          {
            criterionId: 'issue',
            status: 'passed',
            observed: 'Claimed',
            evidence: [{ path: 'evidence/../secret.txt', description: 'outside' }],
          },
        ],
      },
    ],
    ['adversary', { ...sound, decision: 'reopen' }],
    ['adversary', { ...sound, repository: '/repos/host' }],
  ] as const)('strictly refuses malformed or authority-shaped %s output', (key, value) => {
    expect(validateJson(JsonSchemaSchema.parse(schemas[key]), value).ok).toBe(false);
  });
});

describe('QA fake graph routes; no native isolation is asserted', () => {
  it('defaults unavailable and stops before checkout, proof/reopen/label or every worker', async () => {
    const s = await scenario();
    expect(s.run.status).toBe('failed');
    expect(s.actions).toEqual(['claim', 'prerequisites', 'block']);
    expect(s.effects).toEqual(['blocked-comment']);
    expect(s.engine.ports.harness.started).toEqual([]);
    expect(s.engine.eventTypes(s.run.id)).not.toContain('child_run.started');
  });
  it.each([2, 3])(
    'halts on lost prerequisite before worker boundary %s',
    async (isolationLostAt) => {
      const s = await scenario({ fakeIsolationAvailable: true, isolationLostAt });
      expect(s.run.status).toBe('failed');
      expect(s.engine.ports.harness.started).toHaveLength(isolationLostAt === 2 ? 1 : 2);
      expect(s.engine.eventTypes(s.run.id)).not.toContain('child_run.started');
      expect(s.actions).not.toContain('qa-rework');
    },
  );
  it.each(['standard', 'full-regression', 'label'] as const)(
    'prepares and executes %s depth, then only a sound pass preserves closed issue',
    async (mode) => {
      const s = await scenario({
        fakeIsolationAvailable: true,
        settings:
          mode === 'full-regression'
            ? { depth: 'full-regression' }
            : mode === 'label'
              ? { fullRegressionLabel: 'full-regression' }
              : {},
        labelFull: mode === 'label',
      });
      expect(s.run.status).toBe('succeeded');
      expect(s.depth).toBe(mode === 'standard' ? 'standard' : 'full-regression');
      expect(s.effects).toEqual(['checkout:' + 'a'.repeat(40), 'proof:' + 'a'.repeat(40)]);
      expect(
        (await s.engine.ports.runs.getThread(s.run.id))?.outputs['qa-outcome']?.value,
      ).toMatchObject({ type: 'QaOutcome', outcome: 'passed' });
      expect(s.actions.filter((action) => action === 'prerequisites')).toHaveLength(3);
    },
  );
  it('gives the configured fresh adversary only original issue and QA artifacts, never parent canaries/settings', async () => {
    const s = await scenario({ fakeIsolationAvailable: true });
    const child = s.engine.events(s.run.id).find((event) => event.type === 'child_run.started');
    if (child?.type !== 'child_run.started') throw new Error('no evidence child');
    const initial = await s.engine.ports.runs.getInitialThread(child.childRunId);
    expect(initial?.vars).toEqual({});
    expect(initial?.messages).toEqual([]);
    expect(initial?.artifacts).toEqual([]);
    expect(initial?.outputs).toEqual({});
    expect(initial?.lastOutput).toBeUndefined();
    const prompt = s.engine.ports.harness.started.find((request) =>
      request.turn.prompt.startsWith('Evidence-only QA adversary'),
    )!;
    expect(prompt).toMatchObject({
      workingDirectory: '/tmp/evidence-1',
      model: 'gpt-6-astra',
      effort: 'xhigh',
      options: { sandbox: 'read-only', networkAccess: false, webSearch: false },
    });
    for (const marker of forbidden) {
      expect(JSON.stringify(initial)).not.toContain(marker);
      expect(prompt.turn.prompt).not.toContain(marker);
    }
    expect(prompt.turn.prompt).toContain(originalIssue.body);
    const sessions = [...s.engine.events(s.run.id), ...s.engine.events(child.childRunId)].filter(
      (event) => event.type === 'harness.session',
    );
    expect(sessions).toHaveLength(3);
    expect(new Set(sessions.map((event) => event.sessionId)).size).toBe(3);
    expect(sessions.every((event) => event.mode === 'fresh')).toBe(true);
    expect(s.engine.ports.harness.resumed).toEqual([]);
    expect(
      [...s.engine.ports.workspace.files.keys()]
        .filter((path) => path.startsWith('/tmp/evidence-1/'))
        .sort(),
    ).toEqual(
      ['evidence/invalid.txt', 'evidence/issue.txt', 'evidence/valid.txt', 'issue.json', 'qa.json']
        .map((path) => '/tmp/evidence-1/' + path)
        .sort(),
    );
  });
  it('checks eligibility before a durable rework fact and only then reopens/relabels', async () => {
    const s = await scenario({ fakeIsolationAvailable: true, failed: true });
    expect(s.run.status).toBe('succeeded');
    expect(s.actions.slice(-5)).toEqual([
      'rework-status',
      'qa-rework',
      'issue-reopened',
      'relabel',
      'qa-outcome',
    ]);
    expect(s.effects.slice(-3)).toEqual(['request', 'reopen', 'label:ready-for-implementation']);
    const events = s.engine.events(s.run.id).filter((event) => event.type === 'node.finished');
    const ids = events.map((event) => event.nodeId);
    expect(ids.indexOf('rework-status')).toBeLessThan(ids.indexOf('qa-rework'));
    expect(ids.indexOf('qa-rework')).toBeLessThan(ids.indexOf('issue-reopened'));
  });
  it('uses a rework request for an already-open issue without minting another reopen', async () => {
    const s = await scenario({
      fakeIsolationAvailable: true,
      failed: true,
      issueOpen: true,
      priorReopens: 2,
    });
    expect(s.run.status).toBe('succeeded');
    expect(s.actions).toContain('qa-rework');
    expect(s.actions).not.toContain('issue-reopened');
    expect(s.journal).toMatchObject({ requests: 1, reopens: 2 });
  });
  it.each(['requests', 'reopens'] as const)(
    'exhausted %s caps route human before any authority request or issue effects',
    async (cap) => {
      const s = await scenario({
        fakeIsolationAvailable: true,
        failed: true,
        priorRequests: cap === 'requests' ? 2 : 0,
        priorReopens: cap === 'reopens' ? 2 : 0,
      });
      expect(s.run.status).toBe('failed');
      expect(s.actions).not.toContain('qa-rework');
      expect(s.actions).not.toContain('issue-reopened');
      expect(s.actions).not.toContain('relabel');
      expect(s.effects.at(-1)).toBe('human-comment');
    },
  );
  it.each([0, 1])(
    'bounds unsound reruns to %s without reopening on unsound assessment',
    async (unsoundReruns) => {
      const s = await scenario({
        fakeIsolationAvailable: true,
        settings: { limits: { ...settings().limits, unsoundReruns } },
        adversaries: [unsound, unsound],
      });
      expect(s.run.status).toBe('failed');
      expect(s.journal.reruns).toBe(unsoundReruns);
      expect(s.run.iteration).toBe(unsoundReruns + 1);
      expect(s.actions.filter((action) => action === 'proof-check')).toHaveLength(
        unsoundReruns + 1,
      );
      expect(s.actions.filter((action) => action === 'claim')).toHaveLength(1);
      expect(s.actions).not.toContain('qa-rework');
      expect(s.effects.at(-1)).toBe('human-comment');
    },
  );
  it('accepts one sound rerun, with gaps and a new fresh evidence child', async () => {
    const s = await scenario({ fakeIsolationAvailable: true, adversaries: [unsound, sound] });
    expect(s.run.status).toBe('succeeded');
    expect(s.run.iteration).toBe(2);
    expect(
      s.engine.events(s.run.id).filter((event) => event.type === 'child_run.started'),
    ).toHaveLength(2);
    expect(
      s.engine.ports.harness.started.filter((request) =>
        request.turn.prompt.startsWith('QA criteria planner'),
      )[1]?.turn.prompt,
    ).toContain('Add stronger negative evidence.');
  });
  it.each(['missingFile', 'emptyFile', 'missingCriterion', 'duplicateResult'] as const)(
    'refuses %s before proof push, adversary or rework',
    async (negative) => {
      const s = await scenario({ fakeIsolationAvailable: true, [negative]: true });
      expect(s.run.status).toBe('failed');
      expect(s.actions).not.toContain('evidence-prepare');
      expect(s.actions).not.toContain('qa-rework');
      expect(s.effects).not.toContain('proof:' + 'a'.repeat(40));
      expect(s.engine.eventTypes(s.run.id)).not.toContain('child_run.started');
    },
  );
  it.each([0, 2])('refuses %s linked issues before checkout or turns', async (issueCount) => {
    const s = await scenario({ fakeIsolationAvailable: true, issueCount });
    expect(s.run.status).toBe('failed');
    expect(s.engine.ports.harness.started).toEqual([]);
    expect(s.effects).toEqual(['blocked-comment']);
  });
  it('ignores selector attempts/repository authority and retains exact trusted proof lineage', async () => {
    const s = await scenario({
      fakeIsolationAvailable: true,
      payload: {
        pullRequest: 11,
        mergeSha: 'f'.repeat(40),
        attempt: 3,
        repository: 'attacker/other',
      },
    });
    expect(s.run.status).toBe('succeeded');
    const thread = await s.engine.ports.runs.getThread(s.run.id);
    expect(thread?.outputs.claim?.value).toEqual({
      type: 'ClaimRecord',
      repository: 'owner/example',
      issue: 7,
      attempt: 1,
    });
    expect(thread?.outputs['proof-check']?.value).toMatchObject({
      runId: s.run.id,
      mergeSha: 'a'.repeat(40),
    });
  });
  it('refuses exhausted proof-push budget without running the adversary', async () => {
    const s = await scenario({ fakeIsolationAvailable: true, proofConflicts: 4 });
    expect(s.run.status).toBe('failed');
    expect(s.actions).not.toContain('evidence-prepare');
    expect(s.effects).not.toContain('proof:' + 'a'.repeat(40));
  });
  it.each([
    'claim',
    'prepare',
    'criteria-check',
    'proof-check',
    'evidence-prepare',
    'adversary-check',
    'qa-outcome',
  ])('blocks typed %s refusal without later authority effects', async (blockAction) => {
    const s = await scenario({ fakeIsolationAvailable: true, blockAction });
    expect(s.run.status).toBe('failed');
    expect(s.actions.at(-1)).toBe('block');
    expect(s.actions).not.toContain('qa-rework');
    expect(s.effects.some((effect) => effect === 'reopen' || effect.startsWith('label:'))).toBe(
      false,
    );
  });
  it.each([
    'prepare',
    'criteria-check',
    'proof-check',
    'evidence-prepare',
    'adversary-check',
    'qa-outcome',
  ])('routes unknown %s output to block', async (malformedAction) => {
    const s = await scenario({ fakeIsolationAvailable: true, malformedAction });
    expect(s.run.status).toBe('failed');
    expect(s.actions.at(-1)).toBe('block');
  });
  it('never runs any turn when role readiness fails at the prerequisite', async () => {
    const s = await scenario({ fakeIsolationAvailable: true, unavailable: true });
    expect(s.run.status).toBe('failed');
    expect(s.engine.ports.harness.started).toEqual([]);
    expect(s.effects).toEqual(['blocked-comment']);
  });
  it.each(['reworkRequests', 'reopenings'] as const)(
    'honors a configured zero %s budget before recording authority',
    async (cap) => {
      const s = await scenario({
        fakeIsolationAvailable: true,
        failed: true,
        settings: { limits: { ...settings().limits, [cap]: 0 } },
      });
      expect(s.run.status).toBe('failed');
      expect(s.actions).not.toContain('qa-rework');
      expect(s.effects.slice(-1)).toEqual(['human-comment']);
    },
  );
  it('preserves authenticated second-attempt facts rather than resetting the trusted snapshot', async () => {
    const s = await scenario({
      fakeIsolationAvailable: true,
      failed: true,
      priorRequests: 1,
      priorReopens: 1,
    });
    expect(s.run.status).toBe('succeeded');
    const thread = await s.engine.ports.runs.getThread(s.run.id);
    expect(thread?.outputs['qa-rework']?.value).toMatchObject({
      type: 'ReworkRequest',
      attempt: 2,
      request: 2,
    });
    expect(thread?.outputs['issue-reopened']?.value).toMatchObject({
      type: 'IssueReopened',
      attempt: 2,
      request: 2,
    });
  });
  it.each(['rework-status', 'qa-rework', 'issue-reopened', 'relabel'])(
    'halts a late %s refusal before downstream effects',
    async (blockAction) => {
      const s = await scenario({ fakeIsolationAvailable: true, failed: true, blockAction });
      expect(s.run.status).toBe('failed');
      expect(s.actions.at(-1)).toBe('block');
      if (blockAction === 'rework-status' || blockAction === 'qa-rework')
        expect(s.effects).not.toContain('reopen');
      if (blockAction !== 'relabel')
        expect(s.effects).not.toContain('label:ready-for-implementation');
      expect(s.actions).not.toContain('qa-outcome');
    },
  );
  it.each([
    ['prerequisites', { type: 'QaPrerequisites', available: 'true' }],
    ['adversary-check', { type: 'QaNext', route: 'invented' }],
    ['rework-status', { type: 'QaReworkEligibility', eligible: true }],
    ['rework-status', { type: 'QaReworkEligibility', eligible: true, requiresReopen: 'false' }],
  ] as const)('refuses incomplete or wrongly typed %s support claims', async (action, value) => {
    const s = await scenario({
      fakeIsolationAvailable: true,
      failed: true,
      responses: { [action]: value },
    });
    expect(s.run.status).toBe('failed');
    expect(s.actions.at(-1)).toBe('block');
    expect(s.actions).not.toContain('qa-rework');
    expect(s.effects).not.toContain('reopen');
  });
  it('rejects depth scope that silently omits a required touched-system negative case', async () => {
    const incomplete = criteria();
    incomplete.criteria.pop();
    const s = await scenario({ fakeIsolationAvailable: true, criteriaOutputs: [incomplete] });
    expect(s.run.status).toBe('failed');
    expect(s.actions).toContain('criteria-check');
    expect(s.actions).not.toContain('proof-check');
    expect(s.engine.ports.harness.started).toHaveLength(1);
  });
  it.each(['criteria', 'results', 'adversary'] as const)(
    'bounds malformed %s native output repair without authority effects',
    async (stage) => {
      const options: Options = { fakeIsolationAvailable: true };
      if (stage === 'criteria') options.criteriaOutputs = [{ ...criteria(), attempt: 2 }];
      if (stage === 'results')
        options.resultOutputs = [
          {
            summary: 'No evidence',
            results: [{ criterionId: 'issue', status: 'passed', observed: 'Claim', evidence: [] }],
          },
        ];
      if (stage === 'adversary') options.adversaries = [{ ...sound, decision: 'reopen' }];
      const s = await scenario(options);
      expect(s.run.status).toBe('failed');
      expect(s.engine.ports.harness.resumed).toHaveLength(1);
      expect(s.actions).not.toContain('qa-rework');
      expect(s.effects).not.toContain('reopen');
      expect(s.effects).not.toContain('label:ready-for-implementation');
      if (stage !== 'adversary')
        expect(s.engine.eventTypes(s.run.id)).not.toContain('child_run.started');
    },
  );
  it.each(['run', 'sha', 'missing'] as const)(
    'refuses %s proof lineage before evidence child or rework',
    async (foreignProof) => {
      const s = await scenario({ fakeIsolationAvailable: true, foreignProof });
      expect(s.run.status).toBe('failed');
      expect(s.actions.at(-1)).toBe('block');
      expect(s.actions).not.toContain('evidence-prepare');
      expect(s.actions).not.toContain('qa-rework');
      expect(s.engine.eventTypes(s.run.id)).not.toContain('child_run.started');
    },
  );
  it('refuses an evidence directory result that omits the explicit child packet', async () => {
    const s = await scenario({
      fakeIsolationAvailable: true,
      responses: {
        'evidence-prepare': { type: 'QaEvidence', evidence: { workspace: '/tmp/evidence-only' } },
      },
    });
    expect(s.run.status).toBe('failed');
    expect(s.engine.eventTypes(s.run.id)).not.toContain('child_run.started');
  });
});
