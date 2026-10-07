// Live acceptance fixtures and inventory. Execute only in an API-owner script node.
// No credentials are read, exported or printed. All GitHub endpoints are scratch-only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const worktree = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const control = path.join(worktree, '.tmp/aidlc-control');
const repository = 'Jacob-J-Thomas/gg-aidlc-scratch';
let text = '';
for await (const chunk of process.stdin) text += chunk;
const payload = JSON.parse(text).invocation.trigger.payload;
if (payload.repository !== repository) throw new Error('SCRATCH_ONLY');
function command(program, args, cwd, input) {
  const r = spawnSync(program, args, {
    cwd,
    input,
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error || r.status !== 0)
    throw new Error(`${program} ${args.slice(0, 3).join(' ')}: ${r.stderr ?? r.error?.message}`);
  return r.stdout.trim();
}
function gh(suffix, method = 'GET', body) {
  const args = ['api', `repos/${repository}${suffix ? `/${suffix}` : ''}`, '--method', method];
  if (body !== undefined) args.push('--input', '-');
  return JSON.parse(
    command(
      'gh',
      args,
      payload.workspacePath,
      body === undefined ? undefined : JSON.stringify(body),
    ),
  );
}
function pages(suffix) {
  return JSON.parse(
    command(
      'gh',
      ['api', `repos/${repository}/${suffix}`, '--paginate', '--slurp'],
      payload.workspacePath,
    ),
  ).flat();
}
let result;
if (payload.action === 'fixtures') {
  if (!gh('').private) throw new Error('PRIVATE_REPOSITORY_REQUIRED');
  const outputs = [];
  for (const scenario of ['fix-now', 'future-issue']) {
    const workspacePath = path.join(worktree, `.tmp/aidlc-${scenario}`);
    // Refuse rather than replace existing directories or change their ownership.
    if (fs.existsSync(workspacePath)) throw new Error(`FIXTURE_EXISTS ${scenario}`);
    command(
      'git',
      ['clone', '--no-hardlinks', `https://github.com/${repository}.git`, workspacePath],
      payload.workspacePath,
    );
    command('git', ['config', 'user.name', 'AIDLC scratch acceptance'], workspacePath);
    command('git', ['config', 'user.email', 'aidlc-scratch@example.invalid'], workspacePath);
    const baselineSha = command('git', ['rev-parse', 'HEAD'], workspacePath);
    command('attrib', ['+R', path.join(workspacePath, 'aidlc-checklist.lock.json')], workspacePath);
    const issue = gh('issues', 'POST', {
      title: `aidlc-${scenario} live negative acceptance`,
      body:
        scenario === 'fix-now'
          ? 'Controlled acceptance experiment: inject a reversed-interval regression in an isolated candidate, require a blocking fix-now review, then restore it with head-bound feedback. All three locked clamp criteria must pass before acceptance. This experiment is intentionally left unmerged.'
          : 'Add a concise README with the clamp export and finite-number examples. Preserve the three locked clamp criteria. Non-finite input policy is explicitly outside this task; a concrete optional follow-up may be deferred with acceptance criteria. This experiment is intentionally left unmerged.',
      labels: ['aidlc-ready'],
    });
    const p = {
      ...payload.positiveInput,
      repository,
      workspacePath,
      issueNumber: issue.number,
      policy: { allowMerge: false, allowClose: false },
    };
    p.message =
      scenario === 'fix-now'
        ? 'The final candidate must reject min > max with RangeError, preserve normal clamping and regression coverage. This controlled negative test first injects a fault; review must reject it and the next implementation must fix it using head-bound findings. Do not merge or close this experiment.'
        : 'Add concise README documentation of the clamp export with finite-number usage examples and reversed-interval RangeError. Preserve all three locked criteria. Non-finite input policy (NaN and infinities) is outside this task; defer any optional policy/documentation follow-up with concrete acceptance criteria.';
    p.task = {
      id: `aidlc-${scenario}-candidate`,
      description:
        scenario === 'fix-now'
          ? 'FIRST CONTROLLED NEGATIVE ATTEMPT ONLY: remove the min > max RangeError guard and its reversed-interval regression test, preserving the normal and equal-bounds tests. This deliberately bad candidate must be rejected by review, then restored on the feedback attempt. Do not change the locked checklist or protected instructions.'
          : 'Add README.md with the clamp import, in-range/below/above examples, equal bounds and reversed-interval RangeError. Explicitly say examples cover finite numbers and a non-finite policy is outside this change. Do not define a new NaN/infinity behavior or alter code/tests.',
      userVisibleUI: false,
      acceptanceCriteria:
        scenario === 'fix-now'
          ? [
              'Produce the intentional fault injection for this first experiment stage only; normal tests still pass. Final review acceptance remains the locked checklist, including reversed-interval RangeError.',
            ]
          : [
              'README documents actual finite-number clamp behavior.',
              'All three locked checklist criteria continue passing.',
            ],
      dependsOn: [],
    };
    p.reviewHints =
      scenario === 'fix-now'
        ? 'Fault injection is over. Enforce the ORIGINAL FINAL REQUEST and all locked checklist criteria, regardless of the temporary injection-stage task text. Reproduce the reversed interval. Missing RangeError and missing regression are blocking fix-now findings; never defer them.'
        : 'Inspect the candidate honestly. Non-finite input policy is intentionally outside this issue. If no deliberate policy/tests exist for NaN/infinities, record one optional nonblocking future-issue finding to specify the policy and regression tests, with concrete acceptance criteria and rationale for deferral. Do not treat unsupported non-finite inputs as a blocking violation of this finite-input task.';
    const file = path.join(control, `aidlc-${scenario}-input.json`);
    fs.writeFileSync(file, JSON.stringify(p, null, 2));
    outputs.push({
      scenario,
      workspacePath,
      baselineSha,
      issueUrl: issue.html_url,
      issueNumber: issue.number,
      inputFile: file,
    });
  }
  result = { fixtures: outputs };
} else if (payload.action === 'inventory') {
  const issues = pages('issues?state=all&per_page=100');
  const pulls = [];
  for (const item of issues.filter((x) => x.pull_request)) {
    const pr = gh(`pulls/${item.number}`);
    pulls.push({
      number: pr.number,
      url: pr.html_url,
      title: pr.title,
      state: pr.state,
      draft: pr.draft,
      headSha: pr.head.sha,
      branch: pr.head.ref,
      baseSha: pr.base.sha,
      merged: pr.merged,
      mergeSha: pr.merge_commit_sha,
      labels: pr.labels.map((x) => x.name),
      checks: gh(`commits/${pr.head.sha}/check-runs`).check_runs.map((x) => ({
        id: x.id,
        url: x.html_url,
        name: x.name,
        headSha: x.head_sha,
        status: x.status,
        conclusion: x.conclusion,
      })),
      reviews: pages(`pulls/${pr.number}/reviews?per_page=100`).map((x) => ({
        id: x.id,
        url: x.html_url,
        state: x.state,
        headSha: x.commit_id,
      })),
    });
  }
  result = {
    at: new Date().toISOString(),
    repository,
    labels: pages('labels?per_page=100').map((x) => ({ name: x.name, url: x.url })),
    issues: issues
      .filter((x) => !x.pull_request)
      .map((x) => ({
        number: x.number,
        url: x.html_url,
        title: x.title,
        body: x.body,
        state: x.state,
        labels: x.labels.map((y) => y.name),
      })),
    pulls,
    comments: pages('issues/comments?per_page=100').map((x) => ({
      id: x.id,
      url: x.html_url,
      issueUrl: x.issue_url,
      body: x.body,
      createdAt: x.created_at,
    })),
    refs: pages('git/matching-refs/heads/').map((x) => ({ ref: x.ref, sha: x.object.sha })),
    workspaces: ['positive', 'fix-now', 'future-issue'].map((scenario) => {
      const p = JSON.parse(fs.readFileSync(path.join(control, `aidlc-${scenario}-input.json`)));
      const checklist = path.join(p.workspacePath, 'aidlc-checklist.lock.json');
      return {
        scenario,
        workspacePath: p.workspacePath,
        headSha: command('git', ['rev-parse', 'HEAD'], p.workspacePath),
        trackedStatus: command(
          'git',
          ['status', '--porcelain', '--untracked-files=no'],
          p.workspacePath,
        ),
        branch: command('git', ['rev-parse', '--abbrev-ref', 'HEAD'], p.workspacePath),
        origin: command('git', ['remote', 'get-url', 'origin'], p.workspacePath),
        checklistMatchesInput:
          JSON.stringify(JSON.parse(fs.readFileSync(checklist))) === JSON.stringify(p.checklist),
        checklistSha256: createHash('sha256').update(fs.readFileSync(checklist)).digest('hex'),
        checklistAttributes: command('attrib', [checklist], p.workspacePath),
      };
    }),
  };
  fs.writeFileSync(
    path.join(control, 'aidlc-github-inventory.json'),
    JSON.stringify(result, null, 2),
  );
} else throw new Error('ACTION_NOT_AUTHORIZED');
console.log(JSON.stringify(result));
