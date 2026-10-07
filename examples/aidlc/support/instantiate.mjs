// Compile owner settings into literal model fields and local helper paths. No product changes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'full-v1.settings.json'), 'utf8'));
const schemas = JSON.parse(
  fs.readFileSync(path.join(dir, 'structured-output-schemas.json'), 'utf8'),
);
const idsFile = process.argv[2];
const ids = idsFile ? JSON.parse(fs.readFileSync(idsFile, 'utf8')) : {};
const placeholder = '00000000000000000000000000';
const runtime = path.join(here, 'runtime.mjs');
const supportHash = createHash('sha256')
  .update(
    ['runtime.mjs', 'core.mjs', 'attempts.mjs', 'proof.mjs']
      .map((name) => fs.readFileSync(path.join(here, name), 'utf8'))
      .join('\n'),
  )
  .digest('hex');
const settingsHash = createHash('sha256')
  .update(fs.readFileSync(path.join(dir, 'full-v1.settings.json')))
  .digest('hex');
const role = (name) => cfg.roles[name];
const str = { type: 'string' };
const obj = { type: 'object' };
const payloadSchema = {
  type: 'object',
  properties: {
    message: { type: 'string', minLength: 1 },
    repository: str,
    workspacePath: str,
    issueNumber: { type: 'integer', minimum: 1 },
    checklist: schemas.Plan.properties.checklist,
    bounds: {
      type: 'object',
      properties: {
        maxTasks: { type: 'integer', minimum: 1, maximum: cfg.bounds.maxTasks },
        reviewCycles: { type: 'integer', minimum: 1, maximum: cfg.bounds.reviewCycles },
        qaReworks: { type: 'integer', minimum: 0, maximum: cfg.bounds.qaReworks },
      },
      required: ['maxTasks', 'reviewCycles', 'qaReworks'],
      additionalProperties: false,
    },
    policy: {
      type: 'object',
      properties: { allowMerge: { type: 'boolean' }, allowClose: { type: 'boolean' } },
      required: ['allowMerge', 'allowClose'],
      additionalProperties: false,
    },
    task: obj,
    plan: schemas.Plan,
    implementation: { anyOf: [schemas.Implementation, { type: 'null' }] },
    review: { anyOf: [schemas.Review, { type: 'null' }] },
    reviewRunId: str,
    recoveryParentRunId: str,
    feedback: {},
    prCi: schemas.PrCi,
    qa: schemas.Qa,
    qaRunId: str,
    proofLinks: { type: 'array', items: str },
    remainingTaskIds: { type: 'array', items: str },
    startedAt: str,
    reviewHints: str,
    acceptance: {
      type: 'object',
      properties: {
        round: { type: 'string', pattern: '^[a-z0-9-]+$' },
        allowUnsandboxedChecks: { type: 'boolean' },
        waitForCodexReview: { type: 'boolean' },
      },
      required: ['round', 'allowUnsandboxedChecks', 'waitForCodexReview'],
      additionalProperties: false,
    },
  },
  required: [
    'message',
    'repository',
    'workspacePath',
    'issueNumber',
    'checklist',
    'bounds',
    'policy',
  ],
  additionalProperties: false,
};
const common =
  'Work alone, with a fresh session, only in the current scratch repository. No subagents, MCP, network, credential access, other repositories or private instance files. Never change AGENTS.md, aidlc-checklist.lock.json or .github/. Do not run Git mutations; the scripts own commits and pushes. Required checklist cannot be relaxed. Return only the forced JSON schema. ';
function graph(name, description) {
  const loop = {
    schemaVersion: 2,
    name: `aidlc-full-v1-${name}`,
    description,
    settings: {
      workingDirectory: { kind: 'template', template: '{{ trigger.payload.workspacePath }}' },
      defaults: {
        byHarness: {
          codex: { model: cfg.roles.plannerB.model, effort: cfg.roles.plannerB.effort },
        },
      },
      maxIterations: cfg.bounds.maxTasks * (cfg.bounds.reviewCycles + cfg.bounds.qaReworks + 1) + 4,
      subloopDepthLimit: 2,
    },
    variables: { config: { type: 'object' } },
    nodes: [],
    edges: [],
  };
  const add = (id, kind, config) => {
    loop.nodes.push({
      id,
      label: `aidlc-${id}`,
      kind,
      config,
      ui: { x: loop.nodes.length * 170, y: 0 },
    });
    return id;
  };
  const edge = (from, to, port = 'out') =>
    loop.edges.push({
      id: `e-${loop.edges.length + 1}`,
      from: { node: from, port },
      to: { node: to, port: 'in' },
    });
  const script = (id, action, args = [], timeoutSeconds = 60) =>
    add(id, 'script', {
      command: process.execPath,
      args: [runtime, action, ...args],
      env: {
        AIDLC_SETTINGS_HASH: settingsHash,
        AIDLC_SUPPORT_HASH: supportHash,
        AIDLC_REVIEW_LOOP_ID: ids.review ?? placeholder,
        AIDLC_QA_LOOP_ID: ids.qa ?? placeholder,
        AIDLC_PR_CI_LOOP_ID: ids['pr-ci'] ?? placeholder,
      },
      cwd: 'workspace',
      stdin: 'thread',
      stdout: 'patch',
      timeoutSeconds,
    });
  const start = () => {
    add('start', 'trigger', {
      subtype: 'manual',
      exposeTo: ['ui', 'api', 'mcp'],
      inputSchema: payloadSchema,
    });
    script('init', 'init');
    edge('start', 'init');
  };
  const decision = (id, labels, expression) =>
    add(id, 'decision', {
      answer: {
        type: 'choice',
        options: labels.map((id) => ({ id, label: id, criteria: `aidlc-${id}` })),
      },
      evaluation: { kind: 'expression', jsonata: expression },
    });
  const choice = (id, slots, descriptions, question) => {
    script(`${id}-budget`, 'reserve', ['jev', id]);
    add(id, 'decision', {
      answer: {
        type: 'choice',
        options: [...slots, 'uncertain'].map((id, i) => ({
          id,
          label: id,
          criteria: descriptions[i] ?? 'Unclear, ambiguous, or requires soft judgement.',
        })),
      },
      evaluation: {
        kind: 'classifier',
        model: cfg.routing.classifierId,
        question,
        minConfidence: cfg.routing.minConfidence,
        context: { messages: 'none', vars: ['config'], includeLastOutput: false },
      },
    });
    edge(`${id}-budget`, id);
  };
  const inference = (id, slot, schema, prompt, writable = false) => {
    const r = role(slot);
    script(`${id}-budget`, 'reserve', ['worker', id, slot]);
    add(id, 'inference', {
      harness: r.harness,
      model: r.model,
      effort: r.effort,
      session: { policy: 'fresh' },
      prompt: { template: common + prompt },
      harnessOptions: {
        sandbox: writable ? 'workspace-write' : 'read-only',
        approval: 'never',
        networkAccess: false,
        webSearch: false,
        configOverrides: { 'features.multi_agent': false, 'mcp_servers.node_repl.enabled': false },
      },
      timeoutSeconds: r.timeoutSeconds,
      output: {
        captureTranscript: 'artifact',
        toMessages: 'final',
        schema: {
          jsonSchema: schemas[schema],
          native: true,
          repair: {
            enabled: cfg.maxSchemaRepairAttempts > 0,
            maxAttempts: cfg.maxSchemaRepairAttempts,
            onFailure: 'fail-run',
          },
        },
      },
    });
    edge(`${id}-budget`, id);
  };
  const exit = (id, mapping = 'vars.result') =>
    add(id, 'exit', { default: 'success', return: { mapping, channels: [{ kind: 'caller' }] } });
  const child = (id, target, resultTo, extra = '{}') =>
    add(id, 'subloop', {
      loopRef: { loopId: ids[target] ?? placeholder, version: 'latest' },
      input: {
        mode: 'project',
        messages: 'none',
        artifacts: 'none',
        trigger: { payload: `$merge([vars.request, ${extra}])` },
      },
      output: {
        mode: 'result-only',
        resultTo: { lastOutput: true, var: resultTo },
        usage: 'roll-up',
      },
    });
  const set = (id, fields) =>
    add(id, 'mutate', {
      operations: Object.entries(fields).map(([name, jsonata]) => ({
        op: 'set',
        path: `/vars/${name}`,
        value: { kind: 'expression', jsonata },
      })),
    });
  return { loop, add, edge, script, start, decision, choice, inference, exit, child, set };
}
const outputs = [];
{
  const g = graph(
    'planning',
    'Two configurable planner slots selected by Jev Choice; uncertain selection gets forced-schema LLM judgement.',
  );
  g.start();
  g.choice(
    'route',
    ['plannerA', 'plannerB'],
    [cfg.routing.plannerA, cfg.routing.plannerB],
    'Select the planning slot for this request: {{ trigger.payload.message }}. Criteria A: {{ vars.config.routing.plannerA }}. Criteria B: {{ vars.config.routing.plannerB }}.',
  );
  g.edge('init', 'route-budget');
  for (const slot of ['plannerA', 'plannerB']) {
    g.inference(
      slot.toLowerCase(),
      slot,
      'Plan',
      `Read the local module and original issue request, then plan at most {{ trigger.payload.bounds.maxTasks }} sequential tasks. Request: {{ trigger.payload.message }}. Locked checklist: {{ trigger.payload.checklist | json }}. Return planningSlot ${slot}, preserve checklist exactly, use ready only for clear bounded scope. No file changes. Tasks have lowercase slug ids; dependencies must precede their dependent. Do not implement. Each delivered task must preserve the required checklist invariants; use one task for changes that jointly satisfy acceptance. Task ids and acceptance criteria are the parent's delivery contract.`,
    );
    g.edge('route', `${slot.toLowerCase()}-budget`, slot);
    g.edge(slot.toLowerCase(), 'verify');
  }
  g.inference(
    'judgment',
    'judgment',
    'RouteJudgment',
    'Choose plannerA or plannerB using the configured criteria; use human for missing intent. Request: {{ trigger.payload.message }}. Criteria: {{ vars.config.routing | json }}.',
  );
  g.edge('route', 'judgment-budget', 'uncertain');
  g.decision(
    'judgment-route',
    ['plannerA', 'plannerB', 'blocked'],
    'lastOutput.value.confidence >= vars.config.routing.minConfidence and lastOutput.value.confidence <= 1 ? (lastOutput.value.route = "plannerA" ? "plannerA" : lastOutput.value.route = "plannerB" ? "plannerB" : "blocked") : "blocked"',
  );
  g.edge('judgment', 'judgment-route');
  g.edge('judgment-route', 'plannera-budget', 'plannerA');
  g.edge('judgment-route', 'plannerb-budget', 'plannerB');
  g.exit(
    'blocked',
    '{"schemaVersion":1,"status":"needs-input","planningSlot":"plannerB","summary":"Routing needs clarification","tasks":[],"checklist":trigger.payload.checklist,"risks":[],"questions":["Clarify planning intent"]}',
  );
  g.edge('judgment-route', 'blocked', 'blocked');
  g.script('verify', 'plan');
  g.exit('done');
  g.edge('verify', 'done');
  outputs.push(['planning', g.loop]);
}
{
  const g = graph(
    'implementation',
    'Jev UI classification, forced-schema uncertain judgement, configurable code/visual implementer, authoritative Git snapshot and script checks.',
  );
  g.start();
  g.script('prepare', 'prepare');
  g.edge('init', 'prepare');
  g.choice(
    'route',
    ['code', 'visual'],
    [cfg.routing.code, cfg.routing.visual],
    'Classify the task, not the surrounding pipeline: {{ trigger.payload.task | json }}. Code criterion: {{ vars.config.routing.code }}. Visual criterion: {{ vars.config.routing.visual }}.',
  );
  g.edge('prepare', 'route-budget');
  for (const [id, slot] of [
    ['code', 'codeImplementer'],
    ['visual', 'visualImplementer'],
  ]) {
    const r = role(slot);
    g.inference(
      id,
      slot,
      'Implementation',
      `Implement the task: {{ trigger.payload.task | json }}. Original request: {{ trigger.payload.message }}. Prior head-bound review/QA feedback: {{ trigger.payload.feedback | json }}. Checklist: {{ trigger.payload.checklist | json }}. On a fix attempt address each fix-now finding at the specified prior head; report blocking uncertainty rather than waive it. Make code/test edits only. Return branch {{ vars.branch }}, baseSha {{ vars.baseSha }}, current headSha {{ vars.headSha }} (script commits after your return), taskId {{ trigger.payload.task.id }}, implementer {role:'${slot}',harness:'${r.harness}',model:'${r.model}',family:'${r.family}'}. You may use empty evidence (the check script supplies authoritative logs). Do not claim tests ran unless you ran them.`,
      true,
    );
    g.edge('route', `${id}-budget`, id);
    g.edge(id, 'snapshot');
  }
  g.inference(
    'judgment',
    'judgment',
    'RouteJudgment',
    'Classify code versus visual work using soft judgement; human if unresolved. Task: {{ trigger.payload.task | json }}. Criteria: {{ vars.config.routing | json }}.',
  );
  g.edge('route', 'judgment-budget', 'uncertain');
  g.decision(
    'judgment-route',
    ['code', 'visual', 'blocked'],
    'lastOutput.value.confidence >= vars.config.routing.minConfidence and lastOutput.value.confidence <= 1 ? (lastOutput.value.route = "code" ? "code" : lastOutput.value.route = "visual" ? "visual" : "blocked") : "blocked"',
  );
  g.edge('judgment', 'judgment-route');
  g.edge('judgment-route', 'code-budget', 'code');
  g.edge('judgment-route', 'visual-budget', 'visual');
  g.exit(
    'blocked',
    '{"status":"blocked","taskId":trigger.payload.task.id,"baseSha":vars.baseSha,"headSha":vars.headSha,"branch":vars.branch,"summary":"UI route requires human judgement","filesChanged":[],"remainingWork":["Classify task"],"evidence":[],"implementer":{"role":"unselected","harness":"codex","model":"unselected","family":"unselected"}}',
  );
  g.edge('judgment-route', 'blocked', 'blocked');
  g.script('snapshot', 'snapshot');
  g.exit('done');
  g.edge('snapshot', 'done');
  outputs.push(['implementation', g.loop]);
}
{
  const g = graph(
    'review',
    'Fresh reviewer derived from actual implementer family, exact-head findings, draft PR comments and idempotent future issues. Parent owns three-cycle fix cap.',
  );
  g.start();
  g.script('prepare', 'review-prepare');
  g.edge('init', 'prepare');
  g.inference(
    'reviewer',
    'reviewer',
    'Review',
    'Review actual diff from {{ trigger.payload.implementation.baseSha }} to {{ trigger.payload.implementation.headSha }} and test acceptance independently. Original request: {{ trigger.payload.message }}. Task: {{ trigger.payload.task | json }}. Locked checklist: {{ trigger.payload.checklist | json }}. Candidate: {{ trigger.payload.implementation | json }}. Review hints: {{ trigger.payload.reviewHints }}. Return reviewedHeadSha equal to candidate head, implementerFamily equal to candidate family and reviewerFamily {{ vars.config.roles.reviewer.family }}. Include every locked checklist item in acceptanceCoverage. The criterion field MUST be ONLY its exact id (for example "aidlc-in-range"), never a sentence, colon or appended description; put explanations in summary. Findings use fix-now for required defects, future-issue for optional nonblocking scope with concrete requestedChange acceptance criteria and rationale, wont-fix only for configured authorized ids {{ vars.config.policy.allowedWontFixIds | json }}, human for unaccepted exceptions. Use state open until helper records accepted/deferred. Required missing acceptance is blocking and changes-required. Never turn a blocking issue into future-issue. Separate fresh same-family review is explicitly relaxed: {{ vars.relaxation }}.',
  );
  g.edge('prepare', 'reviewer-budget');
  g.script('dispositions', 'review');
  g.edge('reviewer', 'dispositions');
  g.decision(
    'route',
    ['pass', 'fix-now', 'wont-fix', 'future-issue', 'blocked'],
    'vars.result.verdict = "blocked" ? "blocked" : $count(vars.result.findings[disposition = "fix-now" and state != "fixed"]) > 0 ? "fix-now" : vars.result.verdict != "pass" ? "blocked" : $count(vars.result.findings[disposition = "future-issue"]) > 0 ? "future-issue" : $count(vars.result.findings[disposition = "wont-fix"]) > 0 ? "wont-fix" : "pass"',
  );
  g.edge('dispositions', 'route');
  for (const id of ['pass', 'fix-now', 'wont-fix', 'future-issue', 'blocked']) {
    g.exit(id);
    g.edge('route', id, id);
  }
  outputs.push(['review', g.loop]);
}
{
  const g = graph(
    'pr-ci',
    'Reconcile PR, bounded exact-head CI poll, reviewer verdict comment and label, policy-authorized merge observation. Single-identity mode never claims API approval.',
  );
  g.start();
  g.script('ci', 'ci', [], 180);
  g.edge('init', 'ci');
  g.decision(
    'ci-route',
    ['ready', 'blocked'],
    'vars.result.status = "ready" ? "ready" : "blocked"',
  );
  g.edge('ci', 'ci-route');
  g.script('merge', 'merge', [], 180);
  g.edge('ci-route', 'merge', 'ready');
  g.exit('blocked');
  g.edge('ci-route', 'blocked', 'blocked');
  g.decision(
    'merge-route',
    ['merged', 'human', 'blocked'],
    'vars.result.status = "merged" ? "merged" : vars.result.status = "blocked" ? "blocked" : "human"',
  );
  g.edge('merge', 'merge-route');
  g.exit('done');
  g.edge('merge-route', 'done', 'merged');
  g.edge('merge-route', 'blocked', 'blocked');
  g.add('human', 'wait', {
    mode: 'input',
    prompt:
      'aidlc- CI passed on {{ vars.result.headSha }}. Merge is gated by policy; provide merge with expectedHeadSha or stop. No real GitHub approval exists.',
    inputSchema: schemas.HumanInput,
    exposeTo: ['ui', 'api', 'mcp'],
    timeoutSeconds: 600,
    onTimeout: 'continue',
  });
  g.edge('merge-route', 'human', 'human');
  g.decision(
    'human-route',
    ['merge', 'stop'],
    'lastOutput.value.decision = "merge" ? "merge" : "stop"',
  );
  g.edge('human', 'human-route');
  g.script('human-approval', 'human');
  g.edge('human-route', 'human-approval', 'merge');
  g.edge('human-approval', 'merge');
  g.edge('human-route', 'blocked', 'stop');
  outputs.push(['pr-ci', g.loop]);
}
{
  const g = graph(
    'qa',
    'Verify merge SHA, execute locked preconfigured checklist with QA role, hash-check evidence, persist proof branch and return pass/fail/blocked. Strict audit fails closed.',
  );
  g.start();
  g.script('prepare', 'qa-prepare');
  g.edge('init', 'prepare');
  g.decision('audit-route', ['run', 'blocked'], 'vars.auditBlocked ? "blocked" : "run"');
  g.edge('prepare', 'audit-route');
  g.inference(
    'qa',
    'qa',
    'Qa',
    'Execute every locked checklist item at current verified merge SHA {{ trigger.payload.prCi.mergeSha }}. Checklist: {{ trigger.payload.checklist | json }}. Original request: {{ trigger.payload.message }}. Use the actual checks already run by the script plus your independent local verification. Script evidence: {{ vars.checkEvidence | json }}; checksPass {{ vars.checksPass }}. Report concrete actual outcomes for each required id. Each criterion must cite only the supplied script evidence with its matching criterionId, executionSha and qaRunId; preserve the supplied hashes and all metadata. Do not create files or modify the merge. Return repository {{ trigger.payload.repository }}, issueNumber {{ trigger.payload.issueNumber }}, taskId {{ trigger.payload.task.id }}, qaRunId {{ vars.qaRunId }}, executionSha {{ trigger.payload.prCi.mergeSha }}, checklistHash {{ vars.checklistHash }}, depth {{ vars.config.policy.qaDepth }}, proofComplete true only when every required criterion has proof. Report fail/blocked honestly for missing acceptance. No adversarial evidence-only audit is claimed.',
  );
  g.edge('audit-route', 'qa-budget', 'run');
  g.script('verify-proof', 'qa');
  g.edge('qa', 'verify-proof');
  g.exit('done', '{"qa":vars.result,"proofLinks":vars.proofLinks}');
  g.edge('verify-proof', 'done');
  g.script('blocked', 'qa-blocked');
  g.edge('audit-route', 'blocked', 'blocked');
  g.exit('blocked-done', '{"qa":vars.result,"proofLinks":[]}');
  g.edge('blocked', 'blocked-done');
  outputs.push(['qa', g.loop]);
}
{
  const g = graph(
    'closing',
    'QA-before-closure policy, merge/checklist/proof provenance, no remaining tasks and authorized issue closure.',
  );
  g.start();
  g.script('close', 'close');
  g.edge('init', 'close');
  g.exit('done');
  g.edge('close', 'done');
  outputs.push(['closing', g.loop]);
}
{
  const g = graph(
    'parent',
    'Manual bounded sequential planning, implementation, review/fix, PR/CI, merged QA/rework, closing and ParentReport.',
  );
  g.start();
  g.script('claim', 'claim');
  g.decision(
    'entry',
    ['claim', 'recover'],
    '$exists(trigger.payload.recoveryParentRunId) ? "recover" : "claim"',
  );
  g.edge('init', 'entry');
  g.edge('entry', 'claim', 'claim');
  g.script('recover', 'recover');
  g.edge('entry', 'recover', 'recover');
  g.child('planning', 'planning', 'plan');
  g.edge('claim', 'planning');
  g.decision(
    'plan-route',
    ['ready', 'human', 'blocked'],
    'outputs.planning.value.status = "succeeded" and outputs.planning.value.outcome = "success" and vars.plan.status = "ready" ? "ready" : vars.plan.status = "needs-input" ? "human" : "blocked"',
  );
  g.edge('planning', 'plan-route');
  g.script('select', 'select');
  g.edge('plan-route', 'select', 'ready');
  const candidate =
    '{"task":vars.task,"plan":vars.plan,"implementation":vars.implementation,"feedback":vars.feedback}';
  g.child('implementation', 'implementation', 'implementation', candidate);
  g.edge('select', 'implementation');
  g.decision(
    'implementation-route',
    ['ready', 'blocked'],
    'outputs.implementation.value.status = "succeeded" and outputs.implementation.value.outcome = "success" and vars.implementation.status = "complete" ? "ready" : "blocked"',
  );
  g.edge('implementation', 'implementation-route');
  g.child('review', 'review', 'review', candidate);
  g.edge('implementation-route', 'review', 'ready');
  g.decision(
    'review-route',
    ['pass', 'fix', 'human', 'blocked'],
    'outputs.review.value.status != "succeeded" or outputs.review.value.outcome != "success" ? "blocked" : vars.review.verdict = "pass" ? "pass" : vars.review.verdict = "changes-required" and vars.reviewCycle < trigger.payload.bounds.reviewCycles ? "fix" : vars.review.verdict = "changes-required" ? "human" : "blocked"',
  );
  g.edge('review', 'review-route');
  g.script('fix-feedback', 'fix-feedback');
  g.edge('review-route', 'fix-feedback', 'fix');
  g.edge('fix-feedback', 'implementation');
  g.child(
    'pr-ci',
    'pr-ci',
    'prCi',
    '{"task":vars.task,"implementation":vars.implementation,"review":vars.review,"reviewRunId":outputs.review.value.childRunId}',
  );
  g.edge('review-route', 'pr-ci', 'pass');
  g.decision(
    'pr-route',
    ['merged', 'blocked'],
    'outputs.`pr-ci`.value.status = "succeeded" and outputs.`pr-ci`.value.outcome = "success" and vars.prCi.status = "merged" ? "merged" : "blocked"',
  );
  g.edge('pr-ci', 'pr-route');
  g.child('qa', 'qa', 'qaResult', '{"task":vars.task,"prCi":vars.prCi}');
  g.edge('pr-route', 'qa', 'merged');
  g.edge('recover', 'qa');
  g.set('qa-result', { qa: 'vars.qaResult.qa' });
  g.edge('qa', 'qa-result');
  g.decision(
    'qa-route',
    ['pass', 'rework', 'blocked'],
    'outputs.qa.value.status != "succeeded" or outputs.qa.value.outcome != "success" ? "blocked" : vars.qa.verdict = "pass" ? "pass" : vars.qa.verdict = "fail" and vars.qaReworks < trigger.payload.bounds.qaReworks ? "rework" : "blocked"',
  );
  g.edge('qa-result', 'qa-route');
  g.script('qa-rework', 'qa-rework');
  g.edge('qa-route', 'qa-rework', 'rework');
  g.edge('qa-rework', 'implementation');
  g.script('complete-task', 'complete-task');
  g.edge('qa-route', 'complete-task', 'pass');
  g.decision(
    'remaining',
    ['next', 'close'],
    'vars.index < $count(vars.plan.tasks) ? "next" : "close"',
  );
  g.edge('complete-task', 'remaining');
  g.edge('remaining', 'select', 'next');
  g.child(
    'closing',
    'closing',
    'closure',
    '{"task":vars.task,"prCi":vars.prCi,"qa":vars.qa,"qaRunId":outputs.qa.value.childRunId,"proofLinks":vars.qaResult.proofLinks,"remainingTaskIds":[]}',
  );
  g.edge('remaining', 'closing', 'close');
  g.decision(
    'closure-route',
    ['complete', 'blocked'],
    'outputs.closing.value.status = "succeeded" and outputs.closing.value.outcome = "success" and vars.closure.status = "closed" ? "complete" : "blocked"',
  );
  g.edge('closing', 'closure-route');
  for (const [id, status] of [
    ['complete', 'complete'],
    ['blocked', 'blocked'],
    ['human', 'needs-human'],
  ]) {
    g.script(`${id}-report`, 'report', [status]);
    g.exit(id);
    g.edge(`${id}-report`, id);
  }
  g.edge('closure-route', 'complete-report', 'complete');
  g.edge('review-route', 'human-report', 'human');
  g.edge('plan-route', 'human-report', 'human');
  for (const [id, port] of [
    ['plan-route', 'blocked'],
    ['implementation-route', 'blocked'],
    ['review-route', 'blocked'],
    ['pr-route', 'blocked'],
    ['qa-route', 'blocked'],
    ['closure-route', 'blocked'],
  ])
    g.edge(id, 'blocked-report', port);
  outputs.push(['parent', g.loop]);
}
for (const [name, loop] of outputs)
  fs.writeFileSync(
    path.join(dir, `${name}.loop.json`),
    JSON.stringify(
      {
        format: 'graphgoblin-loop',
        formatVersion: 2,
        exportedAt: '2026-10-07T00:00:00.000Z',
        loop,
      },
      null,
      2,
    ) + '\n',
  );
console.log(JSON.stringify({ generated: outputs.map(([name]) => name), bound: Boolean(idsFile) }));
