import { describe, expect, it } from 'vitest';
import { ImplementationTemplateSettingsSchema } from '@graphgoblin/contracts';
import { CliGithub, eligibleIssue } from './client.js';
import type { CommandRequest, CommandResult, CommandRunner } from './process.js';

const repository = 'fixture/repo';
const sha = 'a'.repeat(40);
const settings = ImplementationTemplateSettingsSchema.parse({
  kind: 'implementation',
  repository: { path: 'C:/fixture/repo', owner: 'Fixture', name: 'repo', baseBranch: 'main' },
  supportReadKey: 'reader',
  roles: { implementer: { harness: 'codex', model: 'fixture-model', effort: 'high' } },
});
const issue = {
  number: 42,
  title: 'Fixture issue',
  body: 'Acceptance criteria.',
  state: 'open',
  labels: [{ name: settings.labels.trigger }],
  html_url: 'https://github.com/fixture/repo/issues/42',
};
const pr = {
  number: 7,
  title: 'Fixture change',
  body: 'Closes #42',
  state: 'open',
  head: { sha, ref: 'graphgoblin/issue-42-attempt-1', repo: { full_name: repository } },
  base: { ref: 'main', repo: { full_name: repository } },
};
const labels = Object.values(settings.labels).map((name) => ({ name }));
function success(stdout = ''): CommandResult {
  return {
    exitCode: 0,
    stdout,
    stderr: '',
    timedOut: false,
    overflow: false,
    termination: 'confirmed',
  };
}
class Runner implements CommandRunner {
  readonly calls: CommandRequest[] = [];
  constructor(private readonly results: CommandResult[]) {}
  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    const result = this.results.shift();
    if (!result) return Promise.reject(new Error('Unexpected fixture command.'));
    return Promise.resolve(result);
  }
}
function fixture(...responses: unknown[]) {
  const runner = new Runner(responses.map((value) => success(JSON.stringify(value))));
  return { runner, github: new CliGithub(runner, 'fixture-gh.exe', 'C:/fixture/repo') };
}

describe('bounded GitHub command client', () => {
  it('reads only the exact issue identity and accepts case-insensitive canonical GitHub URLs', async () => {
    const f = fixture({ ...issue, html_url: 'https://github.com/Fixture/Repo/issues/42' });
    expect(await f.github.issue(repository, 42)).toMatchObject({ number: 42 });
    expect(f.runner.calls).toEqual([
      {
        program: 'fixture-gh.exe',
        args: ['api', 'repos/fixture/repo/issues/42'],
        cwd: 'C:/fixture/repo',
        timeoutMs: 20000,
        maxBytes: 524288,
      },
    ]);
  });
  it.each([
    { ...issue, number: 43 },
    { ...issue, html_url: 'https://github.com/other/repo/issues/42' },
    { ...issue, html_url: 'https://github.com/fixture/repo/issues/42?forged=true' },
    { ...issue, html_url: 'https://github.com.evil.test/fixture/repo/issues/42' },
    { ...issue, pull_request: { url: 'fixture-pr' } },
  ])('rejects mismatched or PR-backed issue responses (%j)', async (response) => {
    const f = fixture(response);
    await expect(f.github.issue(repository, 42)).rejects.toMatchObject({
      code: 'ISSUE_IDENTITY_REFUSED',
    });
    expect(f.runner.calls).toHaveLength(1);
  });
  it.each(['malformed-json', '{"number":42}', '{"number":"42"}'])(
    'rejects malformed issue data without retry (%s)',
    async (stdout) => {
      const runner = new Runner([success(stdout)]);
      const github = new CliGithub(runner, 'fixture-gh.exe', 'C:/fixture/repo');
      await expect(github.issue(repository, 42)).rejects.toThrow();
      expect(runner.calls).toHaveLength(1);
    },
  );
  it.each([
    { exitCode: 1 },
    { timedOut: true },
    { overflow: true },
    { termination: 'unconfirmed' as const },
  ])(
    'refuses unsuccessful/unconfirmed CLI results without a mutation retry (%j)',
    async (override) => {
      const runner = new Runner([
        { ...success('private stdout'), stderr: 'private marker', ...override },
      ]);
      const github = new CliGithub(runner, 'fixture-gh.exe', 'C:/fixture/repo');
      await expect(github.authenticate()).rejects.toMatchObject({ code: 'GITHUB_UNAVAILABLE' });
      expect(runner.calls).toHaveLength(1);
    },
  );

  it('requests bounded open labelled candidates and removes PR-backed entries', async () => {
    const f = fixture([issue, { ...issue, number: 43, pull_request: { url: 'fixture-pr' } }]);
    expect(await f.github.candidates(settings)).toEqual([issue]);
    expect(f.runner.calls[0]?.args).toEqual([
      'api',
      '--method',
      'GET',
      'repos/fixture/repo/issues',
      '-f',
      'state=open',
      '-f',
      'labels=ready-for-implementation',
      '-f',
      'per_page=100',
    ]);
  });
  it('refuses a full issue page because discovery may be incomplete', async () => {
    const f = fixture(Array.from({ length: 100 }, (_, index) => ({ ...issue, number: index + 1 })));
    await expect(f.github.candidates(settings)).rejects.toMatchObject({
      code: 'ISSUE_DISCOVERY_BOUND',
    });
    expect(f.runner.calls).toHaveLength(1);
  });
  it('refuses a full labels page instead of declaring prerequisites complete', async () => {
    const f = fixture(Array.from({ length: 100 }, (_, index) => ({ name: `label-${index}` })));
    await expect(f.github.labels(repository)).rejects.toMatchObject({
      code: 'LABEL_DISCOVERY_BOUND',
    });
  });
  it('reads a finite comments page and rejects full or over-limit pages before reconciliation', async () => {
    const f = fixture([{ body: 'Existing fixed marker' }]);
    expect(await f.github.comments(repository, 42, 101)).toEqual([
      { body: 'Existing fixed marker' },
    ]);
    expect(f.runner.calls[0]?.args).toEqual([
      'api',
      'repos/fixture/repo/issues/42/comments?per_page=100',
    ]);
    const full = fixture(Array.from({ length: 100 }, () => ({ body: 'Unrelated comment' })));
    await expect(full.github.comments(repository, 42, 101)).rejects.toMatchObject({
      code: 'COMMENT_DISCOVERY_BOUND',
    });
    const excessive = fixture([{ body: 'First' }, { body: 'Second' }]);
    await expect(excessive.github.comments(repository, 42, 1)).rejects.toThrow();
  });
  it('reads open and closed PRs for the exact branch and refuses an incomplete full page', async () => {
    const f = fixture([pr, { ...pr, number: 8, state: 'closed' }]);
    expect(await f.github.pullRequests(repository, pr.head.ref)).toHaveLength(2);
    expect(f.runner.calls[0]?.args).toEqual([
      'api',
      '--method',
      'GET',
      'repos/fixture/repo/pulls',
      '-f',
      'state=all',
      '-f',
      'head=fixture:graphgoblin/issue-42-attempt-1',
      '-f',
      'per_page=100',
    ]);
    const full = fixture(Array.from({ length: 100 }, (_, index) => ({ ...pr, number: index + 1 })));
    await expect(full.github.pullRequests(repository, pr.head.ref)).rejects.toMatchObject({
      code: 'PR_DISCOVERY_BOUND',
    });
  });
  it('rejects a malformed returned PR SHA rather than allowing later reconciliation', async () => {
    const f = fixture([{ ...pr, head: { ...pr.head, sha: 'unverified' } }]);
    await expect(f.github.pullRequests(repository, pr.head.ref)).rejects.toThrow();
  });
  it('passes PR/model free text through body files and labels through distinct argv entries', async () => {
    const runner = new Runner([success(), success(), success()]);
    const github = new CliGithub(runner, 'fixture-gh.exe', 'C:/fixture/repo');
    await github.comment(repository, 42, 'C:/fixture/body with spaces.md');
    await github.label(repository, 42, ['fixture label'], ['ready-for-implementation']);
    await github.create(
      repository,
      pr.head.ref,
      'main',
      'Literal $(never-run) title',
      'C:/fixture/pr body.md',
    );
    expect(runner.calls.map((call) => call.args)).toEqual([
      [
        'issue',
        'comment',
        '42',
        '--repo',
        repository,
        '--body-file',
        'C:/fixture/body with spaces.md',
      ],
      [
        'issue',
        'edit',
        '42',
        '--repo',
        repository,
        '--add-label',
        'fixture label',
        '--remove-label',
        'ready-for-implementation',
      ],
      [
        'pr',
        'create',
        '--repo',
        repository,
        '--head',
        pr.head.ref,
        '--base',
        'main',
        '--title',
        'Literal $(never-run) title',
        '--body-file',
        'C:/fixture/pr body.md',
      ],
    ]);
  });
  it('passes only fixed reporter text through JSON stdin, preserving quotes/newlines without argv interpolation', async () => {
    const runner = new Runner([success()]);
    const github = new CliGithub(runner, 'fixture-gh.exe', 'C:/fixture/repo');
    const body = 'Fixed explanation with "quotes"\n<!-- fixed-marker -->';
    await github.post(repository, 42, body);
    expect(runner.calls[0]?.args).toEqual([
      'api',
      '--method',
      'POST',
      'repos/fixture/repo/issues/42/comments',
      '--input',
      '-',
    ]);
    expect(JSON.parse(runner.calls[0]?.stdin ?? 'null')).toEqual({ body });
    expect(runner.calls[0]?.args).not.toContain(body);
  });
});

describe('fresh eligible issue checks', () => {
  it.each([false, true])(
    'authenticates and rereads the current label state (claimed=%s)',
    async (claimed) => {
      const f = fixture(
        null,
        {
          ...issue,
          labels: [{ name: claimed ? settings.labels.inProgress : settings.labels.trigger }],
        },
        labels,
      );
      expect(await eligibleIssue(f.github, settings, 42, claimed)).toMatchObject({ number: 42 });
      expect(f.runner.calls.map((call) => call.args[0])).toEqual(['auth', 'api', 'api']);
    },
  );
  it.each([
    [{ ...issue, state: 'closed' }, labels, 'ISSUE_NOT_ELIGIBLE'],
    [{ ...issue, title: ' ' }, labels, 'ISSUE_NOT_ELIGIBLE'],
    [{ ...issue, body: null }, labels, 'ISSUE_NOT_ELIGIBLE'],
    [{ ...issue, body: '\n' }, labels, 'ISSUE_NOT_ELIGIBLE'],
    [{ ...issue, labels: [] }, labels, 'TRIGGER_LABEL_REMOVED'],
    [issue, labels.slice(0, 1), 'REQUIRED_LABEL_MISSING'],
  ] as const)(
    'refuses ineligible current issue without any effect command (%j)',
    async (current, declared, code) => {
      const f = fixture(null, current, declared);
      await expect(eligibleIssue(f.github, settings, 42)).rejects.toMatchObject({ code });
      expect(
        f.runner.calls.every((call) => call.args[0] === 'auth' || call.args[0] === 'api'),
      ).toBe(true);
      expect(f.runner.calls).toHaveLength(3);
    },
  );
});
