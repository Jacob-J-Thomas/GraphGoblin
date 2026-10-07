import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  checkPermission,
  implementationGuard,
  branchGuard,
  remoteGuard,
  rejectClosingKeywords,
  boundReview,
  boundQa,
  externalReviewComplete,
  runProvenance,
  exactChecks,
  hash,
  validateQa,
  postMergeRecovery,
} from './core.mjs';
import { proofParent, hashObjectArgs } from './proof.mjs';

const repository = 'Jacob-J-Thomas/gg-aidlc-scratch';
const config = {
  branchPattern: '^aidlc-[a-z0-9-]+$',
  baseBranch: 'aidlc-base',
  mode: 'codex-only',
  familyMap: { openai: 'reviewer' },
  roles: { reviewer: { family: 'openai' } },
  policy: { allowedWontFixIds: [], allowNonblockingFutureIssues: true },
};
const head = 'a'.repeat(40);
const implementation = {
  headSha: head,
  baseSha: 'b'.repeat(40),
  branch: 'aidlc-task',
  implementer: { family: 'openai' },
};
const checklist = [{ id: 'required' }];
const payload = {
  repository,
  issueNumber: 1,
  task: { id: 'aidlc-task' },
  checklist,
  implementation,
};
const expected = {
  runId: 'aidlc-run',
  repository,
  issueNumber: 1,
  taskId: 'aidlc-task',
  checklist,
};
const review = {
  verdict: 'pass',
  reviewedHeadSha: head,
  implementerFamily: 'openai',
  reviewerFamily: 'openai',
  findings: [],
  acceptanceCoverage: [{ criterion: 'required', covered: true, evidence: [{ path: 'proof' }] }],
};
const source = {
  id: expected.runId,
  loopId: 'aidlc-review-loop',
  status: 'succeeded',
  outcome: 'success',
  result: review,
};
const thread = { invocation: { trigger: { payload } } };

test('P1-1: absent/false unsandboxed opt-in refuses checks before command execution', () => {
  assert.throws(() => checkPermission({}), /SANDBOXED_CHECKS_UNAVAILABLE/);
  assert.throws(
    () => checkPermission({ allowUnsandboxedChecks: false }),
    /SANDBOXED_CHECKS_UNAVAILABLE/,
  );
  checkPermission({ allowUnsandboxedChecks: true });
  const settings = JSON.parse(
    fs.readFileSync(new URL('../full-v1.settings.json', import.meta.url)),
  );
  assert.equal(settings.allowUnsandboxedChecks, false);
});
test('P1-2: standalone implementation/review/CI reject base and option branches', () => {
  for (const branch of ['main', 'master', 'aidlc-base', 'unapproved', '--upload-pack=evil'])
    assert.throws(
      () => implementationGuard({ ...implementation, branch }, config),
      /BRANCH_NOT_AUTHORIZED/,
    );
  implementationGuard(implementation, config);
  assert.throws(
    () => branchGuard('main', { ...config, branchPattern: '.*', baseBranch: 'other' }),
    /BRANCH_NOT_AUTHORIZED/,
  );
});
test('P1-2: the retired bootstrap cannot publish a base branch', () => {
  const script = fileURLToPath(new URL('./scratch.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--remote'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BASE_PUBLICATION_FORBIDDEN/);
});
test('P1-3: every documented closing keyword and local/qualified/URL reference is refused in title or body', () => {
  for (const keyword of [
    'close',
    'closes',
    'closed',
    'fix',
    'fixes',
    'fixed',
    'resolve',
    'resolves',
    'resolved',
  ])
    for (const ref of ['#1', 'owner/repo#1', 'https://github.com/owner/repo/issues/1']) {
      assert.throws(
        () => rejectClosingKeywords(`${keyword} ${ref}`, 'safe body'),
        /AUTO_CLOSE_FORBIDDEN/,
      );
      assert.throws(
        () => rejectClosingKeywords('safe title', `${keyword.toUpperCase()}: ${ref}`),
        /AUTO_CLOSE_FORBIDDEN/,
      );
    }
  assert.throws(
    () =>
      rejectClosingKeywords(
        'Fixes #1, closes owner/repo#2, resolves https://github.com/owner/repo/issues/3',
      ),
    /AUTO_CLOSE_FORBIDDEN/,
  );
  rejectClosingKeywords('aidlc- task', 'Part of #1');
});
test('P1-4: review authority requires instance run/loop/head/task and complete locked coverage', () => {
  assert.equal(
    boundReview(source, thread, expected, source.loopId, implementation, config),
    review,
  );
  for (const override of [
    { id: 'caller' },
    { loopId: 'caller' },
    { status: 'running' },
    { outcome: 'failure' },
  ])
    assert.throws(
      () =>
        boundReview(
          { ...source, ...override },
          thread,
          expected,
          source.loopId,
          implementation,
          config,
        ),
      /RUN_PROVENANCE_MISMATCH/,
    );
  assert.throws(
    () =>
      boundReview(
        {
          ...source,
          result: {
            ...review,
            acceptanceCoverage: [{ criterion: 'unlocked', covered: true, evidence: [{}] }],
          },
        },
        thread,
        expected,
        source.loopId,
        implementation,
        config,
      ),
    /REVIEW_CHECKLIST_INCOMPLETE/,
  );
  assert.throws(
    () =>
      boundReview(
        source,
        thread,
        expected,
        source.loopId,
        { ...implementation, headSha: 'c'.repeat(40) },
        config,
      ),
    /IMPLEMENTATION_MISMATCH/,
  );
});
test('P1-5: another repository, issue, task or QA run cannot authorize closing', () => {
  for (const override of [
    { repository: 'other/repo' },
    { issueNumber: 2 },
    { taskId: 'other' },
    { runId: 'other' },
  ])
    assert.throws(
      () => runProvenance(source, thread, { ...expected, ...override }, source.loopId),
      /RUN_PROVENANCE_MISMATCH/,
    );
  const qaRun = { ...source, result: { qa: { executionSha: head, qaRunId: expected.runId } } };
  const qaThread = {
    invocation: { trigger: { payload: { ...payload, prCi: { mergeSha: head } } } },
  };
  assert.equal(boundQa(qaRun, qaThread, expected, source.loopId, head), qaRun.result.qa);
  assert.throws(
    () => boundQa(qaRun, qaThread, expected, source.loopId, 'b'.repeat(40)),
    /MERGE_OR_RUN_MISMATCH/,
  );
  assert.throws(
    () =>
      boundQa(
        { ...qaRun, result: { qa: { ...qaRun.result.qa, qaRunId: 'other' } } },
        qaThread,
        expected,
        source.loopId,
        head,
      ),
    /MERGE_OR_RUN_MISMATCH/,
  );
});
test('P1-6: distinct pushurl, multiple destinations and rewritten push destinations are rejected', () => {
  const origin = `https://github.com/${repository}.git`;
  remoteGuard([origin], [origin], repository);
  for (const pushes of [['https://github.com/other/repo.git'], [origin, 'file:///elsewhere'], []])
    assert.throws(() => remoteGuard([origin], pushes, repository), /REMOTE_NOT_AUTHORIZED/);
});
test('P2-10: correctly hashed unrelated/rebound evidence cannot establish QA provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-qa-binding-'));
  const context = { ...expected, qaRunId: expected.runId, allowUnsandboxedChecks: true };
  const log = {
    repository,
    issueNumber: 1,
    taskId: expected.taskId,
    executionSha: head,
    qaRunId: expected.runId,
    criterionId: 'required',
    sandbox: 'unsandboxed-explicit',
    exitCode: 0,
  };
  fs.writeFileSync(path.join(root, 'aidlc-check.json'), JSON.stringify(log));
  const evidence = {
    kind: 'log',
    path: 'aidlc-check.json',
    sha256: hash(JSON.stringify(log)),
    executionSha: head,
    qaRunId: expected.runId,
    criterionId: 'required',
  };
  context.checkEvidence = [evidence];
  const qa = {
    ...log,
    verdict: 'pass',
    checklistHash: hash(JSON.stringify(checklist)),
    proofComplete: true,
    results: [{ id: 'required', status: 'pass', evidence: [evidence] }],
  };
  validateQa(qa, head, checklist, root, context);
  // JSON object member order is not provenance. Native schema output often
  // orders metadata differently from the script's insertion order.
  const reordered = Object.fromEntries(Object.entries(evidence).reverse());
  validateQa(
    { ...qa, results: [{ ...qa.results[0], evidence: [reordered] }] },
    head,
    checklist,
    root,
    context,
  );
  for (const changed of [
    { executionSha: 'b'.repeat(40) },
    { qaRunId: 'other' },
    { criterionId: 'other' },
  ]) {
    const bad = { ...qa, results: [{ ...qa.results[0], evidence: [{ ...evidence, ...changed }] }] };
    assert.throws(
      () => validateQa(bad, head, checklist, root, context),
      /EVIDENCE_BINDING_MISMATCH/,
    );
  }
  fs.writeFileSync(path.join(root, 'README.md'), 'unrelated but correctly hashed');
  const unrelated = {
    ...evidence,
    path: 'README.md',
    sha256: hash('unrelated but correctly hashed'),
  };
  assert.throws(
    () =>
      validateQa(
        { ...qa, results: [{ ...qa.results[0], evidence: [unrelated] }] },
        head,
        checklist,
        root,
        context,
      ),
    /NOT_FROM_CHECK_EXECUTION/,
  );
  assert.throws(
    () => validateQa({ ...qa, issueNumber: 2 }, head, checklist, root, context),
    /CONTEXT_MISMATCH/,
  );
});
test('external review barrier requires a completed summary at the exact candidate head', () => {
  const marker = '<!-- codex-pull-request-review-summary -->';
  const done = {
    body: `${marker}\n| 📝 **Code Review** | ✅ **Completed** | \`${head.slice(0, 7)}\` | Draft marked ready |`,
  };
  assert.equal(externalReviewComplete([done], head), true);
  for (const comments of [
    [],
    [done, done],
    [{ body: done.body.replace('✅ **Completed**', 'In progress') }],
    [{ body: done.body.replace(head.slice(0, 7), 'bbbbbbb') }],
    [{ body: `${done.body}\n| Code Review | In progress | \`${head.slice(0, 7)}\` | Ready |` }],
  ])
    assert.equal(externalReviewComplete(comments, head), false);
});
test('P2-12: a newer success cannot hide failures/pending or ambiguous duplicate successes', () => {
  const check = { name: 'aidlc-test', head_sha: head, status: 'completed', conclusion: 'success' };
  for (const [first, state] of [
    [{ conclusion: 'failure' }, 'fail'],
    [{ status: 'in_progress' }, 'pending'],
    [{}, 'fail'],
  ]) {
    const checks = [
      { ...check, id: 1, ...first },
      { ...check, id: 2 },
    ];
    assert.equal(exactChecks(head, ['aidlc-test'], checks)[0].state, state);
  }
  assert.equal(
    exactChecks(
      head,
      ['aidlc-test'],
      [check],
      [{ context: 'aidlc-test', sha: head, state: 'failure' }],
    )[0].state,
    'fail',
  );
});
function runner(cwd) {
  return (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
}
test('P2-7/P2-11: fresh clone extends remote proof history; --stdin is a filename', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-proof-remote-'));
  const git = runner(root);
  git('init', '--bare', '--', path.join(root, 'aidlc-remote.git'));
  git('clone', '--', path.join(root, 'aidlc-remote.git'), path.join(root, 'aidlc-first'));
  const first = runner(path.join(root, 'aidlc-first'));
  first('config', 'user.name', 'aidlc-test');
  first('config', 'user.email', 'aidlc-test@example.invalid');
  first('checkout', '-b', 'aidlc-proof');
  fs.writeFileSync(path.join(root, 'aidlc-first', '--stdin'), 'aidlc-file-bytes');
  const object = first(...hashObjectArgs('--stdin'));
  assert.equal(object, first('hash-object', '--', '--stdin'));
  first('add', '--', '--stdin');
  first('commit', '-m', 'aidlc-proof');
  first('push', '--', 'origin', 'aidlc-proof');
  const parent = first('rev-parse', 'HEAD');
  git('clone', '--', path.join(root, 'aidlc-remote.git'), path.join(root, 'aidlc-fresh'));
  const directory = path.join(root, 'aidlc-fresh');
  const fresh = runner(directory);
  const absent = spawnSync('git', ['show-ref', '--verify', 'refs/heads/aidlc-proof'], {
    cwd: directory,
    encoding: 'utf8',
  });
  assert.notEqual(absent.status, 0);
  assert.equal(
    proofParent('aidlc-proof', config, fresh, (args) =>
      spawnSync('git', args, { cwd: directory, encoding: 'utf8' }),
    ),
    parent,
  );
  fresh('config', 'user.name', 'aidlc-test');
  fresh('config', 'user.email', 'aidlc-test@example.invalid');
  const next = fresh(
    'commit-tree',
    fresh('rev-parse', `${parent}^{tree}`),
    '-p',
    parent,
    '-m',
    'aidlc-next-proof',
  );
  fresh('push', '--', 'origin', `${next}:refs/heads/aidlc-proof`);
  fresh('merge-base', '--is-ancestor', parent, next);
});
test('Windows proof publication hashes long paths without changing repository config', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-long-proof-'));
  const git = runner(root);
  git('init');
  git('config', 'core.longpaths', 'false');
  const relative = `${'aidlc-proof-directory/'.repeat(8)}aidlc-${'a'.repeat(145)}.json`;
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), 'aidlc- long proof');
  assert.ok(path.join(root, relative).length > 260);
  const object = git(...hashObjectArgs(relative));
  assert.equal(git('cat-file', '-p', object), 'aidlc- long proof');
  assert.equal(git('config', '--get', 'core.longpaths'), 'false');
});
test('post-merge parent recovery authenticates the prior parent, payload and canonical CI child', () => {
  const request = {
    ...payload,
    workspacePath: 'aidlc-workspace',
    message: 'aidlc-request',
    bounds: { maxTasks: 1 },
    policy: { allowMerge: true, allowClose: true },
    recoveryParentRunId: source.id,
  };
  const prior = { ...request };
  delete prior.recoveryParentRunId;
  const prCi = { status: 'merged', mergeSha: head };
  const ci = {
    ...source,
    id: 'aidlc-ci-run',
    loopId: 'aidlc-ci-loop',
    parentRunId: source.id,
    result: prCi,
  };
  const parent = { ...source, result: { status: 'blocked' } };
  const priorThread = {
    invocation: { trigger: { payload: prior } },
    vars: {
      plan: { status: 'ready', tasks: [{ id: 'aidlc-task' }] },
      task: { id: 'aidlc-task' },
      index: 0,
      completed: [],
      prCi,
    },
    outputs: { 'pr-ci': { value: { childRunId: ci.id } } },
  };
  assert.equal(
    postMergeRecovery(parent, priorThread, request, parent.loopId, ci, ci.loopId),
    priorThread.vars,
  );
  for (const changed of [
    { issueNumber: 2 },
    { workspacePath: 'another' },
    { checklist: [] },
    { policy: { allowMerge: false, allowClose: true } },
    { acceptance: { allowUnsandboxedChecks: true } },
  ])
    assert.throws(
      () =>
        postMergeRecovery(
          parent,
          priorThread,
          { ...request, ...changed },
          parent.loopId,
          ci,
          ci.loopId,
        ),
      /PARENT_MISMATCH/,
    );
  for (const changed of [
    { loopId: 'untrusted' },
    { parentRunId: 'another' },
    { status: 'failed' },
    { result: { ...prCi, mergeSha: 'b'.repeat(40) } },
  ])
    assert.throws(
      () =>
        postMergeRecovery(
          parent,
          priorThread,
          request,
          parent.loopId,
          { ...ci, ...changed },
          ci.loopId,
        ),
      /NOT_VERIFIED_POST_MERGE/,
    );
  assert.throws(
    () =>
      postMergeRecovery(
        parent,
        {
          ...priorThread,
          invocation: { trigger: { payload: { ...prior, recoveryParentRunId: 'earlier' } } },
        },
        request,
        parent.loopId,
        ci,
        ci.loopId,
      ),
    /PARENT_MISMATCH/,
  );
});

// Import the actual exported package entry point, without resolver flags or new links.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/domain/package.json')));
const { validateJson, evaluateExpression, renderTemplate } = await import(
  new URL(`../../../packages/domain/${manifest.exports['.'].import}`, import.meta.url)
);
test('P2-13: configured planner criteria and PR owner replace the old hard-coded meanings', async () => {
  const definition = JSON.parse(
    fs.readFileSync(new URL('../planning.loop.json', import.meta.url)),
  ).loop;
  const template = definition.nodes.find((node) => node.id === 'judgment').config.prompt.template;
  const prompt = await renderTemplate(template, {
    trigger: { payload: { message: 'aidlc-task' } },
    vars: { config: { routing: { plannerA: 'Routine work', plannerB: 'Architectural work' } } },
  });
  assert.ok(prompt.includes('Routine work') && prompt.includes('Architectural work'));
  assert.ok(!prompt.includes('Choose plannerA for deep architecture'));
  const runtime = fs.readFileSync(new URL('./runtime.mjs', import.meta.url), 'utf8');
  const functionText = runtime.slice(
    runtime.indexOf('function ensurePr('),
    runtime.indexOf('function remoteChecks('),
  );
  const queries = [];
  vm.runInNewContext(`${functionText}\nensurePr(candidate);`, {
    candidate: {
      ...implementation,
      summary: 'aidlc- change',
      filesChanged: ['clamp.js'],
      evidence: [],
    },
    config: {
      ...config,
      repository: 'configured-owner/gg-aidlc-scratch',
      policy: { linkage: 'Part of', prTitlePrefix: 'aidlc-' },
      labels: {},
    },
    p: { issueNumber: 1, task: { id: 'aidlc-task' } },
    git: () => head,
    push: () => {},
    implementationGuard,
    assert: (ok, message) => assert.ok(ok, message),
    rejectClosingKeywords,
    endpoint: (suffix) => suffix,
    URLSearchParams,
    labels: () => {},
    gh: (endpoint, method) => {
      if (endpoint.startsWith('pulls?')) {
        queries.push(endpoint);
        return [];
      }
      assert.equal(method, 'POST');
      return { number: 2, head: { sha: head }, html_url: 'aidlc-test-url' };
    },
  });
  const query = new URLSearchParams(queries[0].split('?')[1]);
  assert.equal(query.get('head'), 'configured-owner:aidlc-task');
});
const schemas = JSON.parse(
  fs.readFileSync(new URL('../structured-output-schemas.json', import.meta.url)),
);
test('review native schema refuses descriptive coverage keys from the failed live handoff', () => {
  const schema = schemas.Review.properties.acceptanceCoverage.items.properties.criterion;
  for (const criterion of [
    'aidlc-in-range: clamp(5, 0, 10) === 5.',
    'Reject all nine combinations of non-finite inputs',
    'aidlc-reversed: preserve RangeError',
  ])
    assert.equal(validateJson(schema, criterion).ok, false);
  for (const criterion of ['aidlc-in-range', 'aidlc-bounds', 'aidlc-reversed'])
    assert.equal(validateJson(schema, criterion).ok, true);
});
test('P1-2/P1-3: the actual PR reconciler refuses hostile handoffs before any push', () => {
  const runtime = fs.readFileSync(new URL('./runtime.mjs', import.meta.url), 'utf8');
  const functionText = runtime.slice(
    runtime.indexOf('function ensurePr('),
    runtime.indexOf('function remoteChecks('),
  );
  for (const candidate of [
    { ...implementation, branch: 'main', summary: 'aidlc- change' },
    { ...implementation, summary: 'Fixes owner/repo#1' },
    { ...implementation, summary: 'Resolves https://github.com/owner/repo/issues/1' },
  ]) {
    const pushes = [];
    const environment = {
      candidate: { ...candidate, filesChanged: ['clamp.js'], evidence: [] },
      config: {
        ...config,
        repository,
        policy: { ...config.policy, linkage: 'Part of', prTitlePrefix: 'aidlc-' },
        labels: {},
      },
      p: { issueNumber: 1, task: { id: 'aidlc-task' }, policy: { allowMerge: false } },
      git: (...args) => {
        if (args[0] === 'push') pushes.push(args);
        return head;
      },
      push: (...args) => pushes.push(args),
      implementationGuard,
      assert: (ok, message) => assert.ok(ok, message),
      rejectClosingKeywords,
      endpoint: (suffix) => suffix,
      URLSearchParams,
      labels: () => {},
      gh: () => [],
    };
    assert.throws(
      () => vm.runInNewContext(`${functionText}\nensurePr(candidate);`, environment),
      /BRANCH_NOT_AUTHORIZED|AUTO_CLOSE_FORBIDDEN/,
    );
    assert.equal(pushes.length, 0);
  }
});
test('P1-6: the actual push wrapper rechecks resolved destinations immediately before each push', () => {
  const runtime = fs.readFileSync(new URL('./runtime.mjs', import.meta.url), 'utf8');
  const functionText = runtime.slice(
    runtime.indexOf('function pushDestination('),
    runtime.indexOf('async function instanceRun('),
  );
  let destination = `https://github.com/${repository}.git`;
  const calls = [];
  const environment = {
    config: { ...config, repository },
    branchGuard,
    remoteGuard,
    sha: (value) => /^[a-f0-9]{40}$/.test(value),
    assert: (ok, message) => assert.ok(ok, message),
    git: (...args) => {
      calls.push(args);
      return args[0] === 'remote'
        ? args.includes('--push')
          ? destination
          : `https://github.com/${repository}.git`
        : '';
    },
  };
  vm.runInNewContext(`${functionText}\npush('aidlc-task','${head}');`, environment);
  assert.equal(calls.filter((args) => args[0] === 'push').length, 1);
  destination = 'https://github.com/unapproved/repo.git';
  assert.throws(
    () => vm.runInNewContext(`push('aidlc-task','${head}');`, environment),
    /REMOTE_NOT_AUTHORIZED/,
  );
  assert.equal(calls.filter((args) => args[0] === 'push').length, 1);
});
test('PR reconciliation waits for GitHub head propagation and still refuses a persistent stale head', () => {
  const source = fs.readFileSync(new URL('./runtime.mjs', import.meta.url), 'utf8');
  const fn = source.slice(
    source.indexOf('function ensurePr('),
    source.indexOf('function remoteChecks('),
  );
  for (const succeeds of [true, false]) {
    let polls = 0,
      pushes = 0;
    const pr = { number: 1, state: 'open', merged: false, head: { sha: 'b'.repeat(40) } };
    const environment = {
      candidate: {
        ...implementation,
        summary: 'aidlc-change',
        filesChanged: ['clamp.js'],
        evidence: [],
      },
      config: {
        ...config,
        repository,
        policy: { linkage: 'Part of', prTitlePrefix: 'aidlc-' },
        labels: {},
        bounds: { prHeadPolls: 2, prHeadIntervalMs: 1 },
      },
      p: { issueNumber: 1, task: { id: 'aidlc-task' } },
      git: () => head,
      push: () => pushes++,
      implementationGuard,
      assert: (ok, message) => assert.ok(ok, message),
      rejectClosingKeywords,
      endpoint: (x) => x,
      URLSearchParams,
      labels: () => {},
      Atomics: { wait: () => {} },
      gh: (route, method) => {
        if (route.startsWith('pulls?')) return [pr];
        if (method === 'PATCH') return pr;
        polls++;
        return { ...pr, head: { sha: succeeds && polls === 2 ? head : pr.head.sha } };
      },
    };
    if (succeeds) vm.runInNewContext(`${fn}\nensurePr(candidate);`, environment);
    else
      assert.throws(
        () => vm.runInNewContext(`${fn}\nensurePr(candidate);`, environment),
        /PR_REMOTE_HEAD_CHANGED/,
      );
    assert.equal(polls, 2);
    assert.equal(pushes, 1);
  }
});
test('P2-14: uncertain confidence is bounded and the actual expression applies the configured threshold', async () => {
  for (const confidence of [-1, 1.1])
    assert.equal(
      validateJson(schemas.RouteJudgment, { route: 'code', confidence, reason: 'aidlc-test' }).ok,
      false,
    );
  for (const [name, route] of [
    ['planning', 'plannerA'],
    ['implementation', 'code'],
  ]) {
    const definition = JSON.parse(
      fs.readFileSync(new URL(`../${name}.loop.json`, import.meta.url)),
    ).loop;
    const expression = definition.nodes.find((node) => node.id === 'judgment-route').config
      .evaluation.jsonata;
    for (const [confidence, expectedRoute] of [
      [0.79, 'blocked'],
      [0.8, route],
      [1, route],
    ]) {
      const result = await evaluateExpression(expression, {
        lastOutput: { value: { route, confidence } },
        vars: { config: { routing: { minConfidence: 0.8 } } },
      });
      assert.equal(result, expectedRoute);
    }
  }
});
test('P3-15: only implemented human choices; policy refusal exits rather than retries an impossible merge', async () => {
  assert.deepEqual(schemas.HumanInput.properties.decision.enum, ['merge', 'stop']);
  const definition = JSON.parse(
    fs.readFileSync(new URL('../pr-ci.loop.json', import.meta.url)),
  ).loop;
  const expression = definition.nodes.find((node) => node.id === 'merge-route').config.evaluation
    .jsonata;
  assert.equal(
    await evaluateExpression(expression, { vars: { result: { status: 'blocked' } } }),
    'blocked',
  );
  assert.ok(
    definition.edges.some(
      (edge) =>
        edge.from.node === 'merge-route' &&
        edge.from.port === 'blocked' &&
        edge.to.node === 'blocked',
    ),
  );
});
