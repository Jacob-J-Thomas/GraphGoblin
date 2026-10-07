import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  assert,
  hash,
  sha,
  repositoryGuard,
  verifyProof,
  validatePlan,
  exactChecks,
  validateReview,
  validateQa,
  branchGuard,
  remoteGuard,
  rejectClosingKeywords,
  implementationGuard,
  checkPermission,
  boundReview,
  boundQa,
} from './core.mjs';
import { readAttempts } from './attempts.mjs';
import { hashObjectArgs, proofParent } from './proof.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(here, '../../..');
const config = JSON.parse(fs.readFileSync(path.join(here, '../full-v1.settings.json'), 'utf8'));
const action = process.argv[2];
let input = '';
for await (const chunk of process.stdin) input += chunk;
const t = JSON.parse(input);
const p = t.invocation.trigger.payload;
const v = t.vars;
const root = fs.realpathSync(process.cwd());
const patch = [];
const put = (name, value) => {
  v[name] = value;
  patch.push({ op: 'add', path: `/vars/${name}`, value });
};
const record = (nodeId, value) =>
  patch.push({
    op: 'add',
    path: `/outputs/${nodeId}`,
    value: { nodeId, value, at: new Date().toISOString() },
  });
const last = () => t.lastOutput?.value;
const proofDir = path.join(root, '.aidlc-proof');
const controlDir = path.join(templateRoot, '.tmp/aidlc-control');
function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  assert(
    !result.error && result.status === 0,
    `COMMAND_FAILED ${program} ${args.slice(0, 3).join(' ')}: ${(result.stderr ?? result.error?.message ?? '').slice(-1500)}`,
  );
  return result.stdout.trim();
}
const git = (...args) => command('git', args);
function gh(endpoint, method = 'GET', body) {
  repositoryGuard(p.repository, config.repository);
  assert(
    endpoint === `repos/${config.repository}` ||
      endpoint.startsWith(`repos/${config.repository}/`) ||
      endpoint === 'user',
    'GITHUB_ENDPOINT_FORBIDDEN',
  );
  const args = ['api', endpoint, '--method', method];
  if (body !== undefined) args.push('--input', '-');
  const text = command('gh', args, body === undefined ? {} : { input: JSON.stringify(body) });
  return text ? JSON.parse(text) : null;
}
const endpoint = (suffix) => `repos/${config.repository}/${suffix}`;
function writeProof(name, contents, kind = 'log') {
  const rel = `.aidlc-proof/aidlc-${p.issueNumber}-${name}`;
  fs.writeFileSync(path.join(root, rel), contents);
  return { kind, path: rel, sha256: hash(contents) };
}
function checklist() {
  const original = JSON.parse(
    fs.readFileSync(path.join(root, 'aidlc-checklist.lock.json'), 'utf8'),
  );
  assert(JSON.stringify(original) === JSON.stringify(p.checklist), 'LOCKED_CHECKLIST_CHANGED');
  assert(
    original.length > 0 && new Set(original.map((x) => x.id)).size === original.length,
    'CHECKLIST_INVALID',
  );
  return original;
}
function pushDestination() {
  remoteGuard(
    git('remote', 'get-url', '--all', 'origin').split('\n'),
    git('remote', 'get-url', '--push', '--all', 'origin').split('\n'),
    config.repository,
  );
}
function push(branch, head) {
  branchGuard(branch, config);
  assert(sha(head), 'PUSH_SHA_INVALID');
  pushDestination();
  git('push', '--', 'origin', `${head}:refs/heads/${branch}`);
}
async function instanceRun(id) {
  assert(/^[A-Z0-9]{26}$/.test(id), 'RUN_ID_INVALID');
  const get = async (suffix) => {
    const response = await fetch(`http://127.0.0.1:4747/runs/${id}${suffix}`);
    assert(response.ok, 'PROVENANCE_FETCH_FAILED');
    return response.json();
  };
  return { run: await get(''), thread: await get('/thread') };
}
const context = (runId) => ({
  runId,
  repository: p.repository,
  issueNumber: p.issueNumber,
  taskId: p.task?.id,
  checklist: p.checklist,
});
async function authenticatedReview() {
  const source = await instanceRun(p.reviewRunId);
  return boundReview(
    source.run,
    source.thread,
    context(p.reviewRunId),
    process.env.AIDLC_REVIEW_LOOP_ID,
    p.implementation,
    config,
  );
}
const qaContext = (qaRunId, checkEvidence) => ({
  ...context(qaRunId),
  qaRunId,
  checkEvidence,
  allowUnsandboxedChecks: config.allowUnsandboxedChecks,
});
function admission() {
  repositoryGuard(p.repository, config.repository);
  assert(
    root === fs.realpathSync(p.workspacePath) &&
      root.startsWith(path.join(templateRoot, '.tmp') + path.sep) &&
      path.basename(root).startsWith('aidlc-'),
    'WORKSPACE_NOT_AUTHORIZED',
  );
  assert(fs.lstatSync(path.join(root, '.git')).isDirectory(), 'INDEPENDENT_GIT_REQUIRED');
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      assert(!fs.lstatSync(file).isSymbolicLink(), 'LINK_FORBIDDEN');
      if (entry.isDirectory() && entry.name !== '.git') walk(file);
    }
  };
  walk(root);
  pushDestination();
  if (p.implementation) implementationGuard(p.implementation, config);
  if (p.prCi)
    assert(sha(p.prCi.headSha) && sha(p.prCi.mergeSha ?? p.prCi.headSha), 'PR_SHA_INVALID');
  assert(
    Number.isInteger(p.issueNumber) &&
      p.issueNumber > 0 &&
      typeof p.message === 'string' &&
      p.message.trim(),
    'INPUT_INVALID',
  );
  checklist();
  assert(
    p.bounds.maxTasks > 0 &&
      p.bounds.maxTasks <= config.bounds.maxTasks &&
      p.bounds.reviewCycles > 0 &&
      p.bounds.reviewCycles <= config.bounds.reviewCycles &&
      p.bounds.qaReworks >= 0 &&
      p.bounds.qaReworks <= config.bounds.qaReworks,
    'BOUNDS_NOT_AUTHORIZED',
  );
  assert(p.policy.allowMerge === false || config.policy.allowMerge, 'MERGE_NOT_AUTHORIZED');
  assert(p.policy.allowClose === false || config.policy.allowClose, 'CLOSE_NOT_AUTHORIZED');
}
function checkDeadline() {
  const startedAt = p.startedAt ?? v.request?.startedAt;
  if (startedAt)
    assert(
      Date.now() - Date.parse(startedAt) < config.bounds.deadlineSeconds * 1000,
      'PARENT_DEADLINE',
    );
}
function runChecks(head) {
  checkPermission(config);
  assert(git('rev-parse', 'HEAD') === head, 'CHECK_HEAD_CHANGED');
  let pass = true;
  const reports = config.checks.map((check, index) => {
    const result = spawnSync(check.program, check.args, {
      cwd: root,
      encoding: 'utf8',
      timeout: check.timeoutMs,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) pass = false;
    return writeProof(
      `${head}-check-${index}.txt`,
      JSON.stringify(
        {
          program: check.program,
          args: check.args,
          sha: head,
          sandbox: 'unsandboxed-explicit',
          exitCode: result.status,
          error: result.error?.message ?? null,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
        },
        null,
        2,
      ),
    );
  });
  checklist();
  assert(
    git('rev-parse', 'HEAD') === head && !git('status', '--porcelain', '--untracked-files=no'),
    'CHECK_MUTATED_CANDIDATE',
  );
  return { pass, reports };
}
function labels(number, add = [], remove = []) {
  for (const name of [...add, ...remove]) assert(name.startsWith('aidlc-'), 'LABEL_NOT_AUTHORIZED');
  const current = gh(endpoint(`issues/${number}/labels`)).map((x) => x.name);
  gh(endpoint(`issues/${number}/labels`), 'PUT', {
    labels: [...new Set([...current.filter((x) => !remove.includes(x)), ...add])],
  });
}
function comment(number, key, body) {
  const marker = `<!-- aidlc-${key} -->`;
  const comments = command('gh', [
    'api',
    endpoint(`issues/${number}/comments`),
    '--paginate',
    '--slurp',
  ]);
  const existing = JSON.parse(comments)
    .flat()
    .filter((x) => x.body.includes(marker));
  assert(existing.length <= 1, 'AMBIGUOUS_COMMENT');
  const payload = { body: `${marker}\n${body}` };
  return existing.length
    ? gh(endpoint(`issues/comments/${existing[0].id}`), 'PATCH', payload)
    : gh(endpoint(`issues/${number}/comments`), 'POST', payload);
}
function ensurePr(implementation, draft = true) {
  implementationGuard(implementation, config);
  assert(git('rev-parse', 'HEAD') === implementation.headSha, 'PR_LOCAL_HEAD_CHANGED');
  const title = `${config.policy.prTitlePrefix} issue ${p.issueNumber}: ${p.task?.id ?? 'task'}`;
  const prs = gh(
    endpoint(
      `pulls?${new URLSearchParams({ state: 'all', head: `${config.repository.split('/')[0]}:${implementation.branch}`, base: config.baseBranch })}`,
    ),
  );
  assert(prs.length <= 1, 'AMBIGUOUS_PR');
  const body = `${config.policy.linkage} #${p.issueNumber}\n\n## Summary\n${implementation.summary}\n\n## Changes\n${implementation.filesChanged.map((x) => `- ${x}`).join('\n')}\n\n## Tests and gates\n${implementation.evidence.map((x) => `${x.path} SHA-256 ${x.sha256}`).join('\n')}\n\n## Risks\nCodex-only independent fresh sessions; same-family relaxation. QA must pass before closure.\n\n<!-- aidlc-head:${implementation.headSha} -->`;
  rejectClosingKeywords(title, body);
  if (prs.length) assert(prs[0].state === 'open' && !prs[0].merged_at, 'PR_ALREADY_CLOSED');
  push(implementation.branch, implementation.headSha);
  let pr;
  if (prs.length) {
    assert(prs[0].state === 'open' && !prs[0].merged_at, 'PR_ALREADY_CLOSED');
    pr = gh(endpoint(`pulls/${prs[0].number}`), 'PATCH', { title, body });
  } else
    pr = gh(endpoint('pulls'), 'POST', {
      title,
      head: implementation.branch,
      base: config.baseBranch,
      body,
      draft,
    });
  assert(pr.head.sha === implementation.headSha, 'PR_REMOTE_HEAD_CHANGED');
  labels(pr.number, [], [config.labels.verdict]);
  labels(p.issueNumber, [config.labels.prOpen], [config.labels.inProgress]);
  return pr;
}
function remoteChecks(head) {
  assert(sha(head), 'CHECK_SHA_INVALID');
  const pages = JSON.parse(
    command('gh', [
      'api',
      endpoint(`commits/${head}/check-runs?filter=all&per_page=100`),
      '--paginate',
      '--slurp',
    ]),
  );
  const statuses = gh(endpoint(`commits/${head}/status`));
  return exactChecks(
    head,
    config.requiredChecks,
    pages.flatMap((page) => page.check_runs),
    statuses.statuses,
  );
}
function publishProof(qa) {
  const oldCommit = proofParent(config.policy.proofBranch, config, git, (args) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }),
  );
  const evidence = [
    ...new Map(qa.results.flatMap((r) => r.evidence).map((e) => [e.path, e])).values(),
  ];
  const report = writeProof(`${qa.executionSha}-qa.json`, JSON.stringify(qa, null, 2), 'report');
  evidence.push(report);
  verifyProof(root, evidence);
  const index = path.join(proofDir, `aidlc-index-${t.run.id}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  command('git', oldCommit ? ['read-tree', oldCommit] : ['read-tree', '--empty'], { env });
  for (const e of evidence) {
    const object = git(...hashObjectArgs(e.path));
    command('git', ['update-index', '--add', '--cacheinfo', '100644', object, e.path], { env });
  }
  const tree = command('git', ['write-tree'], { env });
  const ref = `refs/heads/${config.policy.proofBranch}`;
  const args = [
    'commit-tree',
    tree,
    '-m',
    `aidlc- QA proof issue ${p.issueNumber} at ${qa.executionSha}`,
  ];
  if (oldCommit) args.push('-p', oldCommit);
  const commit =
    oldCommit && git('rev-parse', '--verify', '--end-of-options', `${oldCommit}^{tree}`) === tree
      ? oldCommit
      : command('git', args);
  git('update-ref', ref, commit);
  push(config.policy.proofBranch, commit);
  return evidence.map((e) => `https://github.com/${config.repository}/blob/${commit}/${e.path}`);
}

try {
  assert(
    process.env.AIDLC_SETTINGS_HASH ===
      hash(fs.readFileSync(path.join(here, '../full-v1.settings.json'))),
    'SETTINGS_CHANGED_REINSTANTIATE',
  );
  assert(
    process.env.AIDLC_SUPPORT_HASH ===
      hash(
        ['runtime.mjs', 'core.mjs', 'attempts.mjs', 'proof.mjs']
          .map((name) => fs.readFileSync(path.join(here, name), 'utf8'))
          .join('\n'),
      ),
    'SUPPORT_CHANGED_REINSTANTIATE',
  );
  admission();
  checkDeadline();
  fs.mkdirSync(proofDir, { recursive: true });
  fs.mkdirSync(controlDir, { recursive: true });
  if (action === 'init') {
    put('config', config);
    put('request', p);
  } else if (action === 'reserve') {
    const kind = process.argv[3];
    if (kind === 'worker') {
      const selected = config.roles[process.argv[5]];
      assert(selected, 'ROLE_BINDING_MISSING');
      const catalog = await fetch('http://127.0.0.1:4747/model-catalog').then((r) => {
        assert(r.ok, 'MODEL_PREFLIGHT_FAILED');
        return r.json();
      });
      const preflight = await fetch('http://127.0.0.1:4747/harness/preflight').then((r) => {
        assert(r.ok, 'HARNESS_PREFLIGHT_FAILED');
        return r.json();
      });
      const available =
        catalog.items.some(
          (x) => x.harness === selected.harness && x.model === selected.model && x.enabled,
        ) && preflight.items.some((x) => x.harness === selected.harness && x.ok && x.authenticated);
      if (!available) {
        comment(
          p.issueNumber,
          `role-unavailable-${process.argv[5]}`,
          `aidlc- ROLE_UNAVAILABLE: ${process.argv[5]} ${selected.harness}/${selected.model}. No worker turn started.`,
        );
        throw new Error('ROLE_UNAVAILABLE');
      }
    }
    const file = path.join(controlDir, config.budgetFile);
    const budget = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : { workerReservations: 0, jevReservations: 0, entries: [] };
    const key = `${t.run.id}:${t.lastOutput?.nodeId ?? 'start'}:${process.argv[4]}:${t.counters.nodeVisits[process.argv[4]] ?? 0}`;
    if (!budget.entries.some((x) => x.key === key)) {
      if (kind === 'worker') {
        const turns = 1 + config.maxSchemaRepairAttempts;
        assert(budget.workerReservations + turns <= config.bounds.workerStarts, 'WORKER_BUDGET');
        budget.workerReservations += turns;
      } else {
        assert(budget.jevReservations + 1 <= config.bounds.jevEvaluations, 'JEV_BUDGET');
        budget.jevReservations += 1;
      }
      budget.entries.push({ key, runId: t.run.id, kind, at: new Date().toISOString() });
      fs.writeFileSync(file, JSON.stringify(budget, null, 2));
    }
    put('budget', budget);
  } else if (action === 'claim') {
    assert(gh(`repos/${config.repository}`).private, 'SCRATCH_MUST_BE_PRIVATE');
    const issue = gh(endpoint(`issues/${p.issueNumber}`));
    assert(
      !issue.pull_request &&
        issue.state === 'open' &&
        issue.labels.some((x) => x.name === config.labels.trigger),
      'ISSUE_NOT_ADMITTED',
    );
    const records = await readAttempts(
      'http://127.0.0.1:4747',
      t.run.loopId,
      p.repository,
      p.issueNumber,
    );
    assert(!records.some((x) => x.runId !== t.run.id), 'ISSUE_ALREADY_CLAIMED_IN_RUN_STORE');
    const claimFile = path.join(controlDir, `aidlc-claim-${p.issueNumber}.json`);
    const claim = {
      repository: p.repository,
      issueNumber: p.issueNumber,
      attempt: 1,
      runId: t.run.id,
      key: `${p.repository}#${p.issueNumber}@1`,
    };
    if (fs.existsSync(claimFile))
      assert(JSON.parse(fs.readFileSync(claimFile)).runId === t.run.id, 'ISSUE_ALREADY_CLAIMED');
    else fs.writeFileSync(claimFile, JSON.stringify(claim), { flag: 'wx' });
    put('claim', claim);
    record('claim', claim);
    put('request', { ...p, startedAt: new Date().toISOString() });
    put('completed', []);
    put('prs', []);
    put('qaRuns', []);
    put('index', 0);
    put('reviewCycle', 1);
    put('qaReworks', 0);
    put('feedback', null);
    labels(p.issueNumber, [config.labels.inProgress], [config.labels.trigger]);
    comment(
      p.issueNumber,
      'claim',
      `aidlc- claimed attempt 1 by run ${t.run.id}. Attempt authority is the run's claim output; this comment is display only.`,
    );
  } else if (action === 'plan') {
    const plan = last();
    if (plan.status === 'ready') validatePlan(plan, p.checklist, p.bounds.maxTasks);
    else assert(['needs-input', 'blocked'].includes(plan.status), 'PLAN_STATUS_INVALID');
    put('result', plan);
  } else if (action === 'select') {
    put('task', v.plan.tasks[v.index]);
    put('reviewCycle', 1);
    put('feedback', null);
    put('implementation', null);
    put('review', null);
    put('qaReworks', 0);
  } else if (action === 'prepare') {
    checkPermission(config);
    const branch = p.implementation?.branch ?? `aidlc-issue-${p.issueNumber}-${p.task.id}`;
    branchGuard(branch, config);
    assert(!git('status', '--porcelain', '--untracked-files=no'), 'WORKSPACE_DIRTY');
    const exists = spawnSync('git', ['show-ref', '--verify', '--', `refs/heads/${branch}`], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (exists.status === 0) git('checkout', '--no-guess', branch, '--');
    else {
      git('fetch', '--', 'origin', config.baseBranch);
      git('checkout', '-b', branch, `origin/${config.baseBranch}`, '--');
    }
    if (p.feedback?.reviewedHeadSha)
      assert(git('rev-parse', 'HEAD') === p.feedback.reviewedHeadSha, 'FEEDBACK_STALE_HEAD');
    put('branch', branch);
    put('baseSha', git('merge-base', 'HEAD', `origin/${config.baseBranch}`));
    put('headSha', git('rev-parse', 'HEAD'));
  } else if (action === 'snapshot') {
    const out = last();
    const roleName = t.lastOutput.nodeId === 'visual' ? 'visualImplementer' : 'codeImplementer';
    const role = config.roles[roleName];
    checklist();
    assert(out.status === 'complete', 'IMPLEMENTER_BLOCKED');
    const receiptFile = path.join(proofDir, `aidlc-snapshot-${t.run.id}.json`);
    const receipt = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile)) : null;
    assert(
      git('rev-parse', 'HEAD') === (receipt?.headSha ?? v.headSha),
      'WORKER_GIT_MUTATION_FORBIDDEN',
    );
    const files = [
      ...new Set(
        [
          ...git('diff', '--name-only').split('\n'),
          ...git('ls-files', '--others', '--exclude-standard').split('\n'),
        ].filter(Boolean),
      ),
    ];
    assert(!git('diff', '--cached', '--name-only'), 'WORKER_INDEX_MUTATION_FORBIDDEN');
    assert(
      !files.includes('aidlc-checklist.lock.json') &&
        !files.includes('AGENTS.md') &&
        !files.includes('.gitignore') &&
        files.every((x) => !x.startsWith('.github/')),
      'PROTECTED_FILE_CHANGED',
    );
    if (files.length) {
      git('add', '--', ...files);
      git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', `aidlc- implement ${p.task.id}`);
    }
    const headSha = git('rev-parse', 'HEAD');
    fs.writeFileSync(receiptFile, JSON.stringify({ headSha }));
    const changed = git('diff', '--name-only', `${v.baseSha}..${headSha}`)
      .split('\n')
      .filter(Boolean);
    const checks = runChecks(headSha);
    const diff = writeProof(
      `${headSha}-diff.txt`,
      git('diff', `${v.baseSha}..${headSha}`) || 'aidlc- no changes',
      'diff',
    );
    const actualUi = changed.some((file) => new RegExp(config.routing.uiFilePattern).test(file));
    put('result', {
      ...out,
      status:
        checks.pass && (!actualUi || roleName === 'visualImplementer') ? 'complete' : 'blocked',
      taskId: p.task.id,
      baseSha: v.baseSha,
      headSha,
      branch: v.branch,
      filesChanged: changed,
      remainingWork: checks.pass ? [] : ['Configured checks failed'],
      evidence: [...checks.reports, diff],
      implementer: {
        role: roleName,
        harness: role.harness,
        model: role.model,
        family: role.family,
      },
    });
  } else if (action === 'review-prepare') {
    const i = p.implementation;
    assert(
      git('rev-parse', 'HEAD') === i.headSha &&
        !git('status', '--porcelain', '--untracked-files=no'),
      'REVIEW_CANDIDATE_CHANGED',
    );
    const reviewerRole = config.familyMap[i.implementer.family];
    assert(reviewerRole === 'reviewer', 'REVIEWER_BINDING_NOT_COMPILED');
    const reviewer = config.roles[reviewerRole];
    assert(
      config.mode === 'codex-only' || reviewer.family !== i.implementer.family,
      'SAME_FAMILY_FORBIDDEN',
    );
    verifyProof(root, i.evidence);
    put('reviewerRole', reviewerRole);
    put(
      'relaxation',
      config.mode === 'codex-only'
        ? 'Independent fresh session, same OpenAI family; cross-family rule relaxed.'
        : null,
    );
  } else if (action === 'review') {
    const review = last();
    validateReview(review, p.implementation, config, p.checklist);
    assert(git('rev-parse', 'HEAD') === review.reviewedHeadSha, 'REVIEW_LOCAL_HEAD_CHANGED');
    const coverageIds = review.acceptanceCoverage.map((x) => x.criterion);
    assert(
      p.checklist.every((x) => coverageIds.includes(x.id)),
      'REVIEW_CHECKLIST_INCOMPLETE',
    );
    const pr = ensurePr(p.implementation, true);
    for (const finding of review.findings) {
      if (finding.disposition === 'future-issue') {
        assert(finding.requestedChange.trim(), 'FUTURE_ACCEPTANCE_REQUIRED');
        const key = `aidlc-future-${pr.number}-${review.reviewedHeadSha}-${finding.id}`;
        const all = JSON.parse(
          command('gh', [
            'api',
            endpoint('issues?state=all&per_page=100'),
            '--paginate',
            '--slurp',
          ]),
        ).flat();
        const old = all.filter((x) => x.body?.includes(`<!-- ${key} -->`));
        assert(old.length <= 1, 'AMBIGUOUS_FUTURE_ISSUE');
        const future =
          old[0] ??
          gh(endpoint('issues'), 'POST', {
            title: `aidlc-future: ${finding.id}`,
            body: `<!-- ${key} -->\nPart of #${p.issueNumber}; from PR #${pr.number} at ${review.reviewedHeadSha}.\n\n${finding.problem}\n\nRationale: ${finding.rationale}\n\nAcceptance criteria:\n- [ ] ${finding.requestedChange}`,
            labels: [config.labels.future],
          });
        finding.issueUrl = future.html_url;
        finding.state = 'deferred';
      } else if (finding.disposition === 'wont-fix') finding.state = 'accepted';
    }
    comment(
      pr.number,
      `review-${review.reviewedHeadSha}`,
      `aidlc- structured review; same-family relaxation: ${v.relaxation ?? 'none'}.\n\n${JSON.stringify(review, null, 2)}\n\nThese are findings, not a GitHub approval.`,
    );
    put('result', review);
    put('pr', { number: pr.number, url: pr.html_url });
  } else if (action === 'fix-feedback') {
    put('feedback', v.review);
    put('reviewCycle', v.reviewCycle + 1);
  } else if (action === 'ci') {
    const i = p.implementation;
    const review = await authenticatedReview();
    assert(review.verdict === 'pass', 'REVIEW_NOT_PASSED');
    const local = runChecks(i.headSha);
    assert(local.pass, 'LOCAL_GATE_FAILED');
    let pr = ensurePr(i, true);
    let checks = [];
    for (let n = 0; n < config.bounds.ciPolls; n++) {
      pr = gh(endpoint(`pulls/${pr.number}`));
      assert(pr.head.sha === i.headSha, 'CI_STALE_HEAD');
      checks = remoteChecks(i.headSha);
      if (
        checks.every((c) => c.state === 'pass') ||
        checks.some((c) => ['fail', 'cancelled'].includes(c.state))
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, config.bounds.ciIntervalMs));
    }
    const ready = checks.length > 0 && checks.every((c) => c.state === 'pass');
    const ciEvidence = writeProof(
      `${i.headSha}-remote-ci.json`,
      JSON.stringify({ headSha: i.headSha, requiredChecks: checks }, null, 2),
      'report',
    );
    checks = checks.map((c) => ({ ...c, evidence: [ciEvidence] }));
    put('result', {
      status: ready ? 'ready' : 'blocked',
      repository: p.repository,
      prNumber: pr.number,
      prUrl: pr.html_url,
      headSha: i.headSha,
      baseSha: pr.base.sha,
      mergeSha: null,
      requiredChecks: checks,
      reviewerLogin: null,
      approvedHeadSha: null,
      blockingFindings: [],
      reason: ready
        ? 'Exact-head required checks passed'
        : 'Required checks failed, missing or timed out',
    });
  } else if (action === 'merge') {
    const review = await authenticatedReview();
    const result = v.result;
    assert(result.status === 'ready', 'CI_NOT_READY');
    assert(
      config.policy.approvalMode === 'verdict-comment-label',
      'REAL_APPROVAL_REQUIRES_SECOND_IDENTITY',
    );
    const pr = gh(endpoint(`pulls/${result.prNumber}`));
    if (pr.merged) {
      assert(pr.head.sha === result.headSha && sha(pr.merge_commit_sha), 'RECOVERY_MERGE_MISMATCH');
      put('result', {
        ...result,
        status: 'merged',
        mergeSha: pr.merge_commit_sha,
        reason: 'Reconciled already-completed merge at exact head',
      });
      process.stdout.write(JSON.stringify(patch));
      process.exit(0);
    }
    assert(
      pr.head.sha === result.headSha &&
        remoteChecks(result.headSha).every((x) => x.state === 'pass'),
      'MERGE_STALE_HEAD_OR_CI',
    );
    const identity = gh('user').login;
    const verdict = {
      verdict: 'pass',
      reviewedHeadSha: result.headSha,
      reviewRunId: p.reviewRunId,
      reviewLoopId: process.env.AIDLC_REVIEW_LOOP_ID,
      acceptanceCoverage: review.acceptanceCoverage,
      reviewerModel: config.roles.reviewer.model,
      reviewerFamily: config.roles.reviewer.family,
      approvalKind: 'comment-and-label',
      realGithubApproval: false,
      singleIdentity: identity === pr.user.login,
    };
    comment(
      pr.number,
      `verdict-${result.headSha}`,
      `aidlc- reviewer verdict\n\n${JSON.stringify(verdict, null, 2)}\n\nA second eligible GitHub identity is required for an actual approval.`,
    );
    labels(pr.number, [config.labels.verdict]);
    const canMerge =
      p.policy.allowMerge &&
      config.policy.allowMerge &&
      (!config.policy.requireHumanBeforeMerge || v.humanApproved === result.headSha);
    if (!p.policy.allowMerge || !config.policy.allowMerge) {
      result.status = 'blocked';
      result.reason = 'Merge disabled by policy; human input cannot override it';
    } else if (!canMerge) result.reason = 'Merge policy requires human authorization';
    else {
      // Draft promotion needs GraphQL, but remains an explicit scratch-only gh operation.
      if (pr.draft) command('gh', ['pr', 'ready', String(pr.number), '--repo', config.repository]);
      const fresh = gh(endpoint(`pulls/${pr.number}`));
      assert(
        fresh.head.sha === result.headSha &&
          remoteChecks(result.headSha).every((x) => x.state === 'pass'),
        'MERGE_RECHECK_FAILED',
      );
      const merged = gh(endpoint(`pulls/${pr.number}/merge`), 'PUT', {
        sha: result.headSha,
        merge_method: 'merge',
        commit_title: `aidlc- merge PR #${pr.number}`,
      });
      assert(merged.merged, 'MERGE_REFUSED');
      const observed = gh(endpoint(`pulls/${pr.number}`));
      assert(observed.merged && sha(observed.merge_commit_sha), 'MERGE_NOT_OBSERVED');
      result.status = 'merged';
      result.mergeSha = observed.merge_commit_sha;
      result.reason = 'Merged after exact-head verdict comment and required CI';
    }
    // Deliberately keep approvedHeadSha null: this mode did not make an API approval.
    result.reviewerLogin = identity;
    put('result', result);
  } else if (action === 'human') {
    const input = last();
    assert(
      input.expectedHeadSha === v.result.headSha &&
        input.decision === 'merge' &&
        p.policy.allowMerge &&
        config.policy.allowMerge,
      'HUMAN_MERGE_REFUSED',
    );
    put('humanApproved', input.expectedHeadSha);
  } else if (action === 'qa-prepare') {
    checkPermission(config);
    assert(p.prCi.status === 'merged' && sha(p.prCi.mergeSha), 'QA_REQUIRES_MERGE');
    const remote = gh(endpoint(`pulls/${p.prCi.prNumber}`));
    assert(remote.merged && remote.merge_commit_sha === p.prCi.mergeSha, 'QA_MERGE_MISMATCH');
    assert(!git('status', '--porcelain', '--untracked-files=no'), 'QA_DIRTY_WORKSPACE');
    git('fetch', '--', 'origin', config.baseBranch);
    git('checkout', '--detach', p.prCi.mergeSha, '--');
    if (config.policy.requireStrictQaAudit) {
      comment(
        p.issueNumber,
        `audit-blocked-${p.prCi.mergeSha}`,
        'aidlc- strict evidence-only audit blocked: enforced canary-tested read isolation is unavailable. No weaker audit ran.',
      );
      put('auditBlocked', true);
    } else put('auditBlocked', false);
    const checks = runChecks(p.prCi.mergeSha);
    const boundEvidence = p.checklist.flatMap((criterion) =>
      checks.reports.map((report, index) => {
        const log = JSON.parse(fs.readFileSync(path.join(root, report.path), 'utf8'));
        const envelope = {
          ...log,
          repository: p.repository,
          issueNumber: p.issueNumber,
          taskId: p.task.id,
          executionSha: p.prCi.mergeSha,
          qaRunId: t.run.id,
          criterionId: criterion.id,
        };
        return {
          ...writeProof(
            `${p.prCi.mergeSha}-${t.run.id}-${hash(criterion.id)}-${index}.json`,
            JSON.stringify(envelope, null, 2),
          ),
          executionSha: p.prCi.mergeSha,
          qaRunId: t.run.id,
          criterionId: criterion.id,
        };
      }),
    );
    put('checkEvidence', boundEvidence);
    put('qaRunId', t.run.id);
    put('checksPass', checks.pass);
    put('checklistHash', hash(JSON.stringify(p.checklist)));
  } else if (action === 'qa') {
    const qa = last();
    validateQa(qa, p.prCi.mergeSha, p.checklist, root, qaContext(t.run.id, v.checkEvidence));
    assert(
      git('rev-parse', 'HEAD') === qa.executionSha &&
        !git('status', '--porcelain', '--untracked-files=no'),
      'QA_MUTATED_MERGE',
    );
    if (!v.checksPass && qa.verdict === 'pass') qa.verdict = 'fail';
    const links = publishProof(qa);
    comment(
      p.issueNumber,
      `qa-${qa.executionSha}`,
      `aidlc- QA ${qa.verdict} at ${qa.executionSha}; checklist ${qa.checklistHash}.\n\n| Criterion | Result | Actual |\n| --- | --- | --- |\n${qa.results.map((r) => `| ${r.id} | ${r.status} | ${r.actual.replaceAll('|', '/').replaceAll('\n', ' ')} |`).join('\n')}\n\nProof:\n${links.join('\n')}`,
    );
    if (qa.verdict !== 'pass') {
      gh(endpoint(`issues/${p.issueNumber}`), 'PATCH', { state: 'open' });
      labels(p.issueNumber, [config.labels.trigger]);
    }
    put('result', qa);
    put('proofLinks', links);
  } else if (action === 'qa-blocked') {
    put('result', {
      verdict: 'blocked',
      repository: p.repository,
      issueNumber: p.issueNumber,
      taskId: p.task.id,
      qaRunId: t.run.id,
      executionSha: p.prCi.mergeSha,
      checklistHash: hash(JSON.stringify(p.checklist)),
      depth: config.policy.qaDepth,
      results: [],
      proofComplete: false,
      summary: 'Strict audit boundary unavailable; no QA audit worker ran',
    });
  } else if (action === 'qa-rework') {
    put('qaReworks', v.qaReworks + 1);
    put('feedback', {
      reviewedHeadSha: null,
      qa: v.qa,
      reason: 'Post-merge QA failed; implement a new branch from the merge commit',
    });
    put('implementation', null);
    put('reviewCycle', 1);
    const attemptRecord = {
      repository: p.repository,
      issueNumber: p.issueNumber,
      attempt: v.qaReworks + 1,
      runId: t.run.id,
      reason: 'qa-rework',
      state: 'claimed-by-parent',
    };
    put('attemptRecord', attemptRecord);
    record('attempt-record', attemptRecord);
    put('task', { ...v.task, id: `${v.plan.tasks[v.index].id}-rework-${v.qaReworks}` });
  } else if (action === 'complete-task') {
    put('completed', [...v.completed, v.plan.tasks[v.index].id]);
    put('prs', [...v.prs, v.prCi.prUrl]);
    put('qaRuns', [...v.qaRuns, t.outputs.qa.value.childRunId]);
    put('index', v.index + 1);
  } else if (action === 'close') {
    const source = await instanceRun(p.qaRunId);
    const qa = boundQa(
      source.run,
      source.thread,
      context(p.qaRunId),
      process.env.AIDLC_QA_LOOP_ID,
      p.prCi.mergeSha,
    );
    assert(
      JSON.stringify(qa) === JSON.stringify(p.qa) &&
        JSON.stringify(source.run.result.proofLinks) === JSON.stringify(p.proofLinks),
      'CLOSURE_QA_PROVENANCE_FAILED',
    );
    validateQa(
      qa,
      p.prCi.mergeSha,
      p.checklist,
      root,
      qaContext(p.qaRunId, source.thread.vars.checkEvidence),
    );
    assert(
      qa.verdict === 'pass' && p.remainingTaskIds.length === 0 && p.proofLinks.length > 0,
      'CLOSURE_POLICY_FAILED',
    );
    assert(
      p.qaRunId &&
        p.policy.allowClose &&
        config.policy.allowClose &&
        !config.policy.requireStrictQaAudit,
      'CLOSURE_SIGNOFF_BLOCKED',
    );
    if (t.run.parentRunId)
      assert(source.run.parentRunId === t.run.parentRunId, 'CLOSURE_WRONG_PARENT');
    const remote = gh(endpoint(`pulls/${p.prCi.prNumber}`));
    assert(remote.merged && remote.merge_commit_sha === qa.executionSha, 'CLOSURE_MERGE_CHANGED');
    comment(
      p.issueNumber,
      `close-${qa.executionSha}`,
      `aidlc- closure policy verified: all required criteria passed at ${qa.executionSha}, checklist ${qa.checklistHash}, QA run ${p.qaRunId}.\n${p.proofLinks.join('\n')}`,
    );
    gh(endpoint(`issues/${p.issueNumber}`), 'PATCH', {
      state: 'closed',
      state_reason: 'completed',
    });
    labels(
      p.issueNumber,
      [],
      [
        config.labels.trigger,
        config.labels.inProgress,
        config.labels.prOpen,
        config.labels.blocked,
      ],
    );
    put('result', {
      status: 'closed',
      issueUrl: `https://github.com/${p.repository}/issues/${p.issueNumber}`,
      executionSha: qa.executionSha,
      checklistHash: qa.checklistHash,
      qaRunId: p.qaRunId,
      proofLinks: p.proofLinks,
      remainingTaskIds: [],
      summary: 'Issue closed after verified post-merge QA and durable proof',
    });
  } else if (action === 'report') {
    const status = process.argv[3];
    const remaining = v.plan?.tasks
      .map((x) => x.id)
      .filter((id) => !(v.completed ?? []).includes(id)) ?? ['unplanned'];
    put('result', {
      status: status === 'complete' && remaining.length ? 'blocked' : status,
      completedTaskIds: v.completed ?? [],
      remainingTaskIds: remaining,
      prUrls: v.prs ?? [],
      qaRunIds: v.qaRuns ?? [],
      summary: `aidlc- ${status}; same-family fresh-session review and single-identity verdict-comment/label mode; no real GitHub approval claimed`,
    });
    if (status !== 'complete') {
      labels(p.issueNumber, [
        status === 'needs-human' ? config.labels.needsHuman : config.labels.blocked,
      ]);
      comment(
        p.issueNumber,
        `parent-${t.run.id}`,
        `aidlc- parent report\n\n${JSON.stringify(v.result, null, 2)}\n\nNo further automatic workers will run. Inspect the parent and child run events for the stopped stage.`,
      );
    }
  } else throw new Error(`UNKNOWN_ACTION ${action}`);
  process.stdout.write(JSON.stringify(patch));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
