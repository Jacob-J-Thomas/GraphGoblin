// Real engine, fake ports. These tests do not start Codex/Jev or contact GitHub.
// Build contracts/domain/engine first; run node --test this-file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const entry = (pkg, sub = '') => {
  const directory = path.join(root, `packages/${pkg}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
  return pathToFileURL(path.resolve(directory, manifest.exports[`.${sub}`].import)).href;
};
const { createTestEngine } = await import(entry('engine', '/testing'));
const { validateLoop, validateJson } = await import(entry('domain'));
const { LoopExportSchema } = await import(entry('contracts'));
const config = JSON.parse(fs.readFileSync(path.join(here, '../full-v1.settings.json'), 'utf8'));
const schemas = JSON.parse(
  fs.readFileSync(path.join(here, '../structured-output-schemas.json'), 'utf8'),
);
const names = ['planning', 'implementation', 'review', 'pr-ci', 'qa', 'closing', 'parent'];
const exported = Object.fromEntries(
  names.map((name) => [
    name,
    JSON.parse(fs.readFileSync(path.join(here, `../${name}.loop.json`), 'utf8')),
  ]),
);
const checklist = [
  {
    id: 'aidlc-required',
    system: 'clamp',
    scenario: 'Required acceptance',
    polarity: 'negative',
    steps: ['Verify required behavior'],
    expected: 'Pass',
  },
];
const task = {
  id: 'aidlc-task',
  description: 'Required behavior',
  userVisibleUI: false,
  acceptanceCriteria: ['aidlc-required'],
  dependsOn: [],
};
const plan = {
  schemaVersion: 1,
  status: 'ready',
  planningSlot: 'plannerA',
  summary: 'aidlc- simulated plan',
  tasks: [task],
  checklist,
  risks: [],
  questions: [],
};
const evidence = [{ kind: 'log', path: '.aidlc-proof/aidlc-fixture.txt', sha256: 'a'.repeat(64) }];
const implementation = (cycle = 1) => ({
  status: 'complete',
  taskId: task.id,
  baseSha: 'b'.repeat(40),
  headSha: String(cycle).repeat(40),
  branch: 'aidlc-fixture',
  summary: 'aidlc- simulated implementation',
  filesChanged: ['clamp.js'],
  remainingWork: [],
  evidence,
  implementer: {
    role: 'codeImplementer',
    harness: 'codex',
    model: config.roles.codeImplementer.model,
    family: 'openai',
  },
});
const review = (head, verdict = 'pass', findings = []) => ({
  verdict,
  reviewedHeadSha: head,
  implementerFamily: 'openai',
  reviewerFamily: 'openai',
  acceptanceCoverage: [{ criterion: 'aidlc-required', covered: verdict === 'pass', evidence }],
  findings,
  summary: 'aidlc- simulated review',
});
const finding = (disposition = 'fix-now') => ({
  id: 'aidlc-finding',
  severity: disposition === 'future-issue' ? 'nonblocking' : 'blocking',
  file: 'clamp.js',
  line: 1,
  problem: 'aidlc- simulated defect',
  requestedChange: 'Concrete acceptance: required behavior passes',
  disposition,
  rationale: 'Bounded scope and acceptance',
  issueUrl: null,
  state: 'open',
});
const qa = (verdict = 'pass') => ({
  verdict,
  repository: config.repository,
  issueNumber: 1,
  taskId: task.id,
  qaRunId: '00000000000000000000000001',
  executionSha: 'c'.repeat(40),
  checklistHash: 'd'.repeat(64),
  depth: 'standard',
  results: [
    {
      id: 'aidlc-required',
      status: verdict,
      actual: 'aidlc- simulated outcome',
      evidence: evidence.map((e) => ({
        ...e,
        executionSha: 'c'.repeat(40),
        qaRunId: '00000000000000000000000001',
        criterionId: 'aidlc-required',
      })),
    },
  ],
  proofComplete: true,
  summary: 'aidlc- simulated QA',
});
const input = {
  message: 'aidlc- simulated request',
  repository: config.repository,
  workspacePath: 'aidlc-simulated-workspace',
  issueNumber: 1,
  checklist,
  bounds: { maxTasks: 1, reviewCycles: 3, qaReworks: 1 },
  policy: { allowMerge: true, allowClose: true },
};

test('seven complete exports validate graph, syntax, roles and forced schemas', () => {
  for (const name of names) {
    const parsed = LoopExportSchema.parse(exported[name]);
    assert.deepEqual(validateLoop(parsed.loop), [], name);
    for (const node of parsed.loop.nodes.filter((n) => n.kind === 'inference')) {
      assert.equal(node.config.session.policy, 'fresh');
      assert.equal(node.config.output.schema.native, true);
      assert.equal(node.config.output.schema.repair.onFailure, 'fail-run');
    }
  }
});

function seedRoleCatalog(engine) {
  for (const role of Object.values(config.roles)) {
    if (
      engine.ports.modelCatalog.entries.some(
        (entry) => entry.harness === role.harness && entry.model === role.model,
      )
    )
      continue;
    engine.ports.modelCatalog.entries.push({
      harness: role.harness,
      model: role.model,
      source: 'harness',
      displayName: role.model,
      efforts: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: role.effort,
      enabled: true,
    });
  }
}

async function scenario(mode) {
  const engine = await createTestEngine({ maxConcurrentRuns: 1 });
  seedRoleCatalog(engine);
  if (mode === 'uncertain')
    engine.ports.classifiers.models.set(config.routing.classifierId, {
      choose: async (request) => ({
        type: 'choice',
        optionId: 'uncertain',
        confidence: 0.9,
        probabilities: Object.fromEntries(
          request.options.map((option) => [option.id, option.id === 'uncertain' ? 0.9 : 0.05]),
        ),
      }),
    });
  const loopIds = Object.fromEntries(
    names.map((name) => [name, engine.loopId(exported[name].loop.name)]),
  );
  for (const name of names) {
    const def = structuredClone(exported[name].loop);
    for (const node of def.nodes.filter((n) => n.kind === 'subloop'))
      node.config.loopRef.loopId = loopIds[node.id];
    engine.publish(def, { loopId: loopIds[name] });
  }
  let cycles = 0;
  let qaVisits = 0;
  const judgment = (route) => ({ route, confidence: 0.95, reason: 'Explicit simulated judgment' });
  const turn = (value) => ({ structured: value, finalText: JSON.stringify(value) });
  const turns = [...(mode === 'uncertain' ? [turn(judgment('plannerA'))] : []), turn(plan)];
  const expectedCycles = ['fix-now', 'qa-rework'].includes(mode) ? 2 : mode === 'cap' ? 3 : 1;
  for (let n = 1; n <= expectedCycles; n++) {
    const i = implementation(n);
    const r =
      mode === 'cap' || (mode === 'fix-now' && n === 1)
        ? review(i.headSha, 'changes-required', [finding()])
        : mode === 'future-issue'
          ? review(i.headSha, 'pass', [finding('future-issue')])
          : review(i.headSha);
    if (mode === 'uncertain') turns.push(turn(judgment('code')));
    turns.push(
      { structured: i, finalText: JSON.stringify(i) },
      { structured: r, finalText: JSON.stringify(r) },
    );
    if (mode === 'qa-rework' && n === 1)
      turns.push({ structured: qa('fail'), finalText: JSON.stringify(qa('fail')) });
  }
  if (mode !== 'cap') turns.push({ structured: qa(), finalText: JSON.stringify(qa()) });
  engine.ports.harness.script(turns);
  engine.ports.scripts.respondWith((request) => {
    const t = JSON.parse(request.stdin);
    const p = t.invocation.trigger.payload;
    const v = structuredClone(t.vars);
    const action = request.args[1];
    const patch = [];
    const put = (key, value) => {
      v[key] = value;
      patch.push({ op: 'add', path: `/vars/${key}`, value });
    };
    const last = t.lastOutput?.value;
    switch (action) {
      case 'init':
        put('config', config);
        put('request', p);
        break;
      case 'claim':
        put('completed', []);
        put('prs', []);
        put('qaRuns', []);
        put('index', 0);
        put('reviewCycle', 1);
        put('qaReworks', 0);
        put('feedback', null);
        break;
      case 'reserve':
        break;
      case 'plan':
        put('result', last);
        break;
      case 'select':
        put('task', v.plan.tasks[v.index]);
        put('reviewCycle', 1);
        put('qaReworks', 0);
        put('feedback', null);
        put('implementation', null);
        break;
      case 'prepare':
        put('branch', 'aidlc-fixture');
        put('baseSha', 'b'.repeat(40));
        put('headSha', implementation(cycles + 1).headSha);
        break;
      case 'snapshot':
        cycles++;
        put('result', last);
        break;
      case 'review-prepare':
        put('relaxation', 'same-family test');
        break;
      case 'review': {
        const result = structuredClone(last);
        for (const f of result.findings)
          if (f.disposition === 'future-issue') {
            f.state = 'deferred';
            f.issueUrl = 'https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/999';
          }
        put('result', result);
        break;
      }
      case 'fix-feedback':
        put('feedback', v.review);
        put('reviewCycle', v.reviewCycle + 1);
        break;
      case 'ci':
        put('result', {
          status: 'ready',
          repository: p.repository,
          prNumber: 2,
          prUrl: 'https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/pull/2',
          headSha: p.implementation.headSha,
          baseSha: 'b'.repeat(40),
          mergeSha: null,
          requiredChecks: [
            { name: 'aidlc-test', sha: p.implementation.headSha, state: 'pass', evidence },
          ],
          reviewerLogin: null,
          approvedHeadSha: null,
          blockingFindings: [],
          reason: 'Simulated CI',
        });
        break;
      case 'merge':
        put('result', { ...v.result, status: 'merged', mergeSha: 'c'.repeat(40) });
        break;
      case 'qa-prepare':
        put('auditBlocked', false);
        put('checkEvidence', evidence);
        put('checksPass', true);
        put('checklistHash', 'd'.repeat(64));
        break;
      case 'qa':
        qaVisits++;
        put('result', last);
        put('proofLinks', [
          'https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/blob/fixture/aidlc-proof',
        ]);
        break;
      case 'qa-rework':
        put('qaReworks', v.qaReworks + 1);
        put('feedback', { reviewedHeadSha: null, qa: v.qa });
        put('implementation', null);
        put('reviewCycle', 1);
        put('task', { ...v.task, id: 'aidlc-task-rework-1' });
        break;
      case 'complete-task':
        put('completed', [...v.completed, task.id]);
        put('prs', [...v.prs, v.prCi.prUrl]);
        put('qaRuns', [...v.qaRuns, t.outputs.qa.value.childRunId]);
        put('index', v.index + 1);
        break;
      case 'close':
        put('result', {
          status: 'closed',
          issueUrl: 'https://github.com/Jacob-J-Thomas/gg-aidlc-scratch/issues/1',
          executionSha: p.qa.executionSha,
          checklistHash: p.qa.checklistHash,
          qaRunId: p.qaRunId,
          proofLinks: p.proofLinks,
          remainingTaskIds: [],
          summary: 'Simulated closure',
        });
        break;
      case 'report':
        put('result', {
          status: request.args[2],
          completedTaskIds: v.completed,
          remainingTaskIds: v.plan.tasks.map((x) => x.id).filter((id) => !v.completed.includes(id)),
          prUrls: v.prs,
          qaRunIds: v.qaRuns,
          summary: 'Simulated parent report',
        });
        break;
      default:
        throw new Error(`No simulation for ${action}`);
    }
    return { exitCode: 0, stdout: JSON.stringify(patch), stderr: '', timedOut: false };
  });
  try {
    const run = await engine.runToIdle(loopIds.parent, input);
    assert.equal(
      run.status,
      'succeeded',
      JSON.stringify(
        [...engine.ports.runs.runs.values()].map((item) => ({
          id: item.id,
          failure: item.failure,
        })),
      ),
    );
    for (const item of engine.ports.runs.runs.values())
      for (const event of engine.events(item.id)) {
        if (event.type !== 'decision.made') continue;
        assert.equal(event.answer.type, 'choice');
        assert.equal(event.portId, event.answer.optionId);
        assert.deepEqual(event.diagnostics, []);
        assert.equal(Object.hasOwn(event, 'strategy'), false);
        if (event.provenance.kind === 'expression') assert.equal(event.answer.confidence, null);
        else assert.equal(event.provenance.classifierId, config.routing.classifierId);
      }
    assert.equal(run.result.status, mode === 'cap' ? 'needs-human' : 'complete');
    assert.equal(cycles, expectedCycles);
    assert.equal(qaVisits, mode === 'cap' ? 0 : mode === 'qa-rework' ? 2 : 1);
    assert.equal(engine.ports.harness.resumed.length, 0);
    assert.equal(validateJson(schemas.ParentReport, run.result).ok, true);
    const parentEvents = engine.events(run.id);
    const reviews = parentEvents.filter(
      (e) => e.type === 'child_run.finished' && e.nodeId === 'review',
    );
    assert.equal(reviews.length, expectedCycles);
    if (mode !== 'cap') {
      const ciCalls = engine.ports.scripts.calls.filter((request) => request.args[1] === 'ci');
      const ciPayload = JSON.parse(ciCalls.at(-1).stdin).invocation.trigger.payload;
      assert.equal(
        ciPayload.reviewRunId,
        reviews.at(-1).childRunId,
        'P1-4 parent hands off the authentic review run id',
      );
      const closeCall = engine.ports.scripts.calls.find((request) => request.args[1] === 'close');
      const closePayload = JSON.parse(closeCall.stdin).invocation.trigger.payload;
      const qaCalls = engine.ports.scripts.calls.filter(
        (request) => request.args[1] === 'qa-prepare',
      );
      const qaPayload = JSON.parse(qaCalls.at(-1).stdin).invocation.trigger.payload;
      assert.equal(
        closePayload.task.id,
        qaPayload.task.id,
        'P1-5 parent binds closing to the delivered QA task',
      );
    }
    if (mode === 'fix-now') {
      const implementCalls = engine.ports.scripts.calls.filter((r) => r.args[1] === 'prepare');
      assert.equal(
        JSON.parse(implementCalls[1].stdin).invocation.trigger.payload.feedback.reviewedHeadSha,
        implementation(1).headSha,
      );
    }
    if (mode === 'future-issue') {
      const ciCall = engine.ports.scripts.calls.find((r) => r.args[1] === 'ci');
      const f = JSON.parse(ciCall.stdin).invocation.trigger.payload.review.findings[0];
      assert.equal(f.state, 'deferred');
      assert.match(f.issueUrl, /gg-aidlc-scratch\/issues/);
    }
  } finally {
    engine.manager.stop();
  }
}
for (const mode of ['pass', 'fix-now', 'future-issue', 'cap', 'qa-rework', 'uncertain'])
  test(`real engine / fake ports: ${mode}`, () => scenario(mode));

test('classifier rejection stops the planning graph without entering its explicit judgment route', async () => {
  const engine = await createTestEngine();
  seedRoleCatalog(engine);
  engine.publish(exported.planning.loop);
  engine.ports.classifiers.models.set(config.routing.classifierId, {
    choose: async (request) => ({
      type: 'choice',
      optionId: 'plannerA',
      confidence: 0.4,
      probabilities: Object.fromEntries(
        request.options.map((option) => [option.id, option.id === 'plannerA' ? 0.4 : 0.3]),
      ),
    }),
  });
  engine.ports.scripts.respondWith((request) => ({
    exitCode: 0,
    stderr: '',
    timedOut: false,
    stdout: JSON.stringify(
      request.args[1] === 'init' ? [{ op: 'add', path: '/vars/config', value: config }] : [],
    ),
  }));
  try {
    const run = await engine.runToIdle(engine.loopId(exported.planning.loop.name), input);
    assert.equal(run.status, 'failed');
    assert.equal(run.failure.code, 'EVALUATION_RESULT_REJECTED');
    assert.equal(run.failure.resumable, false);
    assert.equal(engine.ports.classifiers.requests.length, 1);
    assert.equal(engine.ports.harness.started.length, 0);
    assert.equal(
      engine
        .events(run.id)
        .some((event) => event.type === 'node.started' && event.nodeId === 'judgment'),
      false,
    );
  } finally {
    engine.manager.stop();
  }
});
