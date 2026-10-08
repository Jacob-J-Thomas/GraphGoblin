import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewTemplateSettingsSchema } from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import type { CommandRequest, CommandResult, CommandRunner } from './process.js';
import { gateCommand } from './process.js';
import {
  CliReviewGithub,
  ReviewPullRequestSchema,
  type ReviewCandidate,
  type ReviewGithubPort,
  type ReviewPullRequest,
  trustedReviewPr,
} from './review-client.js';
import {
  HumanChoiceSchema,
  ReviewEnvelopeSchema,
  ReviewProposalSchema,
} from './review-protocol.js';
import {
  REVIEW_SUPPORT_ENTRY,
  REVIEW_SUPPORT_MODULES,
  reviewSupportClosure,
} from './review-closure.js';

/* eslint-disable @typescript-eslint/require-await */

const head = 'a'.repeat(40);
const settings = ReviewTemplateSettingsSchema.parse({
  kind: 'review',
  repository: {
    path: 'C:/fixture/repo',
    owner: 'Example',
    name: 'Repo',
    baseBranch: 'release/2026',
  },
  supportReadKey: 'supportReadKey',
  roles: {
    reviewer: { harness: 'codex', model: 'reviewer-model', effort: 'high' },
    fixer: { harness: 'codex', model: 'fixer-model', effort: 'low' },
  },
});

function commandResult(stdout = ''): CommandResult {
  return {
    exitCode: 0,
    stdout,
    stderr: '',
    timedOut: false,
    overflow: false,
    termination: 'confirmed',
  };
}

class InertRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];

  constructor(private readonly results: readonly CommandResult[]) {}

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(structuredClone(request));
    const result = this.results[this.calls.length - 1];
    if (!result) return Promise.reject(new Error('Unexpected fixture command.'));
    return Promise.resolve(result);
  }
}

function jsonResult(value: unknown): CommandResult {
  return commandResult(JSON.stringify(value));
}

function candidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    number: 42,
    title: 'Fixture review',
    body: 'Details',
    state: 'open',
    head: { sha: head, ref: 'feature/review', repo: { full_name: 'example/repo' } },
    base: { ref: settings.repository.baseBranch, repo: { full_name: 'example/repo' } },
    draft: false,
    user: { login: 'trusted-bot' },
    ...overrides,
  };
}

function pullRequest(overrides: Partial<ReviewPullRequest> = {}): ReviewPullRequest {
  return ReviewPullRequestSchema.parse({
    ...candidate(),
    merged: false,
    merge_commit_sha: null,
    ...overrides,
  });
}

class ReviewPortStub implements ReviewGithubPort {
  readonly calls: string[] = [];
  current = pullRequest();
  permissionValue = 'write';
  links: readonly { repository: string; number: number }[] = [];
  issueLabels: readonly { name: string }[] = [];

  async authenticate() {
    this.calls.push('authenticate');
  }

  async pullRequest(repository: string, number: number) {
    this.calls.push(`pullRequest:${repository}:${number}`);
    return structuredClone(this.current);
  }

  async reviewCandidates() {
    this.calls.push('reviewCandidates');
    return [candidate()];
  }

  async permission(repository: string, login: string) {
    this.calls.push(`permission:${repository}:${login}`);
    return this.permissionValue;
  }

  async linkedIssues(repository: string, number: number) {
    this.calls.push(`linkedIssues:${repository}:${number}`);
    return structuredClone(this.links);
  }

  async issue(repository: string, number: number) {
    this.calls.push(`issue:${repository}:${number}`);
    return {
      number,
      title: 'Fixture issue',
      body: 'Details',
      state: 'open' as const,
      labels: [...this.issueLabels],
      html_url: `https://github.com/${repository}/issues/${number}`,
    };
  }

  async requiredChecks() {
    this.calls.push('requiredChecks');
    return [];
  }

  async checks() {
    this.calls.push('checks');
    return [];
  }

  async readiness() {
    this.calls.push('readiness');
    return { head, mergeable: true, clean: true, reviewsSatisfied: true };
  }

  async comments() {
    this.calls.push('comments');
    return [];
  }

  async post() {
    throw new Error('Unexpected GitHub write.');
  }

  async label() {
    throw new Error('Unexpected GitHub write.');
  }

  async merge() {
    throw new Error('Unexpected GitHub write.');
  }

  async close() {
    throw new Error('Unexpected GitHub write.');
  }
}

const invalidPrMutations: readonly [string, (pr: ReviewPullRequest) => void][] = [
  [
    'different pull-request number',
    (pr) => {
      pr.number = 43;
    },
  ],
  [
    'foreign head repository',
    (pr) => {
      pr.head.repo.full_name = 'fork/repo';
    },
  ],
  [
    'foreign base repository',
    (pr) => {
      pr.base.repo.full_name = 'fork/repo';
    },
  ],
  [
    'wrong base branch',
    (pr) => {
      pr.base.ref = 'main';
    },
  ],
  [
    'draft pull request',
    (pr) => {
      pr.draft = true;
    },
  ],
  [
    'closed pull request',
    (pr) => {
      pr.state = 'closed';
    },
  ],
];

const temporaryRoots: string[] = [];
async function temporaryRoot() {
  const base = resolve(tmpdir());
  const root = await mkdtemp(join(base, 'graphgoblin-review-boundary-'));
  const rel = relative(base, root);
  if (!rel || isAbsolute(rel) || rel.startsWith('..'))
    throw new Error('Temporary fixture escaped the OS temp directory.');
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('review GitHub command boundary', () => {
  it('uses a bounded native candidate query and filters drafts without changing argv', async () => {
    const first = candidate();
    const draft = candidate({ number: 43, draft: true });
    const runner = new InertRunner([jsonResult([first, draft])]);
    const github = new CliReviewGithub(runner, 'fixture-gh.exe', settings.repository.path);

    expect(await github.reviewCandidates(settings)).toEqual([first]);
    expect(runner.calls).toEqual([
      {
        program: 'fixture-gh.exe',
        args: [
          'api',
          '--method',
          'GET',
          'repos/example/repo/pulls',
          '-f',
          'state=open',
          '-f',
          'base=release/2026',
          '-f',
          'per_page=100',
        ],
        cwd: settings.repository.path,
        timeoutMs: 20_000,
        maxBytes: 524_288,
      },
    ]);
  });

  it('refuses an incomplete candidate page and an unexpected pull-request identity', async () => {
    const fullPage = new InertRunner([
      jsonResult(Array.from({ length: 100 }, (_, index) => candidate({ number: index + 1 }))),
    ]);
    const fullClient = new CliReviewGithub(fullPage, 'fixture-gh.exe', settings.repository.path);
    await expect(fullClient.reviewCandidates(settings)).rejects.toMatchObject({
      code: 'PR_DISCOVERY_BOUND',
    });
    expect(fullPage.calls).toHaveLength(1);

    const wrongIdentity = new InertRunner([jsonResult(pullRequest({ number: 43 }))]);
    const wrongClient = new CliReviewGithub(
      wrongIdentity,
      'fixture-gh.exe',
      settings.repository.path,
    );
    await expect(wrongClient.pullRequest('example/repo', 42)).rejects.toMatchObject({
      code: 'PR_IDENTITY_REFUSED',
    });
    expect(wrongIdentity.calls[0]?.args).toEqual(['api', 'repos/example/repo/pulls/42']);
  });

  it('preserves app identity and exact head facts while refusing protection ambiguity', async () => {
    const runner = new InertRunner([
      jsonResult({
        required_status_checks: {
          contexts: ['Legacy context', 'CI'],
          checks: [
            { context: 'CI', app_id: 17 },
            { context: 'Verified job', app_id: null },
          ],
        },
      }),
      jsonResult({
        total_count: 1,
        check_runs: [
          {
            name: 'Verified job',
            head_sha: head,
            status: 'completed',
            conclusion: 'success',
            app: { id: 17 },
          },
        ],
      }),
      jsonResult({
        sha: head,
        total_count: 1,
        statuses: [{ context: 'Legacy context', state: 'success' }],
      }),
      jsonResult({
        data: {
          repository: {
            pullRequest: {
              headRefOid: head,
              mergeable: 'MERGEABLE',
              mergeStateStatus: 'CLEAN',
              reviewDecision: 'APPROVED',
            },
          },
        },
      }),
    ]);
    const github = new CliReviewGithub(runner, 'fixture-gh.exe', settings.repository.path);

    expect(await github.requiredChecks('example/repo', settings.repository.baseBranch)).toEqual([
      { name: 'CI', appId: 17 },
      { name: 'Verified job', appId: null },
      { name: 'Legacy context', appId: null },
    ]);
    expect(await github.checks('example/repo', head)).toEqual([
      {
        name: 'Verified job',
        head,
        appId: 17,
        passed: true,
        pending: false,
      },
      { name: 'Legacy context', head, appId: null, passed: true, pending: false },
    ]);
    expect(await github.readiness('example/repo', 42)).toEqual({
      head,
      mergeable: true,
      clean: true,
      reviewsSatisfied: true,
    });
    expect(runner.calls.map((call) => call.args)).toEqual([
      ['api', 'repos/example/repo/branches/release%2F2026/protection'],
      ['api', `repos/example/repo/commits/${head}/check-runs?per_page=100`],
      ['api', `repos/example/repo/commits/${head}/status?per_page=100`],
      [
        'api',
        'graphql',
        '-f',
        'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid mergeable mergeStateStatus reviewDecision}}}',
        '-f',
        'owner=example',
        '-f',
        'name=repo',
        '-F',
        'number=42',
      ],
    ]);

    for (const value of [
      { required_status_checks: null },
      { required_status_checks: { contexts: [], checks: [] } },
    ]) {
      const refused = new InertRunner([jsonResult(value)]);
      const client = new CliReviewGithub(refused, 'fixture-gh.exe', settings.repository.path);
      await expect(
        client.requiredChecks('example/repo', settings.repository.baseBranch),
      ).rejects.toMatchObject({
        code: 'REQUIRED_CHECK_SET_UNKNOWN',
      });
      expect(refused.calls).toHaveLength(1);
    }
  });

  it.each([
    ['status response SHA differs', head, 'b'.repeat(40), 1, 1],
    ['check run SHA differs', 'b'.repeat(40), head, 1, 1],
    ['check history is truncated', head, head, 2, 1],
  ])(
    'refuses %s before returning check facts',
    async (_reason, runHead, statusHead, runsTotal, statusesTotal) => {
      const runner = new InertRunner([
        jsonResult({
          total_count: runsTotal,
          check_runs: [
            {
              name: 'CI',
              head_sha: runHead,
              status: 'completed',
              conclusion: 'success',
              app: { id: 17 },
            },
          ],
        }),
        jsonResult({
          sha: statusHead,
          total_count: statusesTotal,
          statuses: [{ context: 'legacy', state: 'success' }],
        }),
      ]);
      const github = new CliReviewGithub(runner, 'fixture-gh.exe', settings.repository.path);
      await expect(github.checks('example/repo', head)).rejects.toMatchObject({
        code: 'CHECK_HISTORY_BOUND',
      });
      expect(runner.calls).toHaveLength(2);
    },
  );

  it('uses separate literal merge arguments and rejects unsafe native programs without spawning', async () => {
    const root = await temporaryRoot();
    const pnpm = join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
    await mkdir(dirname(pnpm), { recursive: true });
    await writeFile(pnpm, 'fixture only');
    const launched = await gateCommand('pnpm', ['check', 'test:coverage'], { PATH: root });
    expect(launched).toEqual({
      program: await realpath(process.execPath),
      args: [await realpath(pnpm), 'check', 'test:coverage'],
    });

    const runner = new InertRunner([commandResult()]);
    const github = new CliReviewGithub(runner, 'fixture-gh.exe', settings.repository.path);
    await github.merge('example/repo', 42, head, 'squash');
    expect(runner.calls[0]?.args).toEqual([
      'pr',
      'merge',
      '42',
      '--repo',
      'example/repo',
      '--squash',
      '--match-head-commit',
      head,
    ]);
    expect(runner.calls[0]?.args).not.toContain('--admin');
    await expect(gateCommand('fixture.cmd', ['check'], { PATH: root })).rejects.toMatchObject({
      code: 'NATIVE_PROGRAM_REQUIRED',
    });
  });

  it('reads only exact, same-repository linked issues and rejects login argument injection', async () => {
    const linked = {
      data: {
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              nodes: [{ number: 9, repository: { nameWithOwner: 'EXAMPLE/REPO' } }],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      },
    };
    const runner = new InertRunner([jsonResult(linked)]);
    const github = new CliReviewGithub(runner, 'fixture-gh.exe', settings.repository.path);
    expect(await github.linkedIssues('example/repo', 42)).toEqual([
      { repository: 'example/repo', number: 9 },
    ]);
    expect(runner.calls[0]?.args).toEqual([
      'api',
      'graphql',
      '-f',
      'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:100){nodes{number repository{nameWithOwner}} pageInfo{hasNextPage}}}}}',
      '-f',
      'owner=example',
      '-f',
      'name=repo',
      '-F',
      'number=42',
    ]);
    await expect(
      github.permission('example/repo', 'trusted-bot;gh issue close 1'),
    ).rejects.toThrow();
    expect(runner.calls).toHaveLength(1);
  });
});

describe('trusted pull-request identity boundary', () => {
  it('uses authenticated exact identity, current author permission, and issue labels', async () => {
    const github = new ReviewPortStub();
    github.links = [{ repository: 'example/repo', number: 9 }];
    github.issueLabels = [{ name: 'needs-human' }];

    const result = await trustedReviewPr(github, settings, 42);
    expect(result).toMatchObject({ issue: 9, humanRequired: false });
    expect(github.calls).toEqual([
      'authenticate',
      'pullRequest:example/repo:42',
      'permission:example/repo:trusted-bot',
      'linkedIssues:example/repo:42',
      'issue:example/repo:9',
    ]);

    const humanSettings = ReviewTemplateSettingsSchema.parse({
      ...settings,
      humanReviewLabels: ['needs-human'],
    });
    expect((await trustedReviewPr(github, humanSettings, 42)).humanRequired).toBe(true);
  });

  it('accepts configured authors case-insensitively and otherwise requires current write permission', async () => {
    const configured = ReviewTemplateSettingsSchema.parse({
      ...settings,
      trustedAuthors: ['TRUSTED-BOT'],
    });
    const github = new ReviewPortStub();
    expect((await trustedReviewPr(github, configured, 42)).issue).toBeNull();
    expect(github.calls).not.toContain('permission:example/repo:trusted-bot');
    expect(github.calls).not.toContain('issue:example/repo:42');

    for (const permission of ['write', 'maintain', 'admin']) {
      const permitted = new ReviewPortStub();
      permitted.permissionValue = permission;
      await expect(trustedReviewPr(permitted, settings, 42)).resolves.toMatchObject({
        issue: null,
        humanRequired: false,
      });
    }
    const readOnly = new ReviewPortStub();
    readOnly.permissionValue = 'read';
    await expect(trustedReviewPr(readOnly, settings, 42)).rejects.toMatchObject({
      code: 'PR_AUTHOR_UNTRUSTED',
    });
    expect(readOnly.calls).not.toContain('linkedIssues:example/repo:42');
  });

  it.each(invalidPrMutations)('rejects %s before issue lookup', async (_reason, mutate) => {
    const github = new ReviewPortStub();
    mutate(github.current);
    await expect(trustedReviewPr(github, settings, 42)).rejects.toMatchObject({
      code: 'PR_NOT_ELIGIBLE',
    });
    expect(github.calls.slice(0, 2)).toEqual(['authenticate', 'pullRequest:example/repo:42']);
    expect(github.calls.some((call) => call.startsWith('linkedIssues:'))).toBe(false);
  });

  it('rejects ambiguous or foreign issue links and allows terminal reads only when requested', async () => {
    const foreign = new ReviewPortStub();
    foreign.links = [{ repository: 'elsewhere/repo', number: 9 }];
    await expect(trustedReviewPr(foreign, settings, 42)).rejects.toMatchObject({
      code: 'ISSUE_LINK_AMBIGUOUS',
    });
    const multiple = new ReviewPortStub();
    multiple.links = [
      { repository: 'example/repo', number: 9 },
      { repository: 'example/repo', number: 10 },
    ];
    await expect(trustedReviewPr(multiple, settings, 42)).rejects.toMatchObject({
      code: 'ISSUE_LINK_AMBIGUOUS',
    });

    const terminal = new ReviewPortStub();
    terminal.current.state = 'closed';
    terminal.current.merged = true;
    terminal.current.merge_commit_sha = 'b'.repeat(40);
    await expect(trustedReviewPr(terminal, settings, 42, true)).resolves.toMatchObject({
      issue: null,
    });
    await expect(trustedReviewPr(new ReviewPortStub(), settings, 42)).resolves.toMatchObject({
      issue: null,
    });
  });
});

describe('review protocol and packaged support closure', () => {
  it('keeps proposal and human-input schemas strict and gives polls no run authority', () => {
    const validProposal = {
      verdict: 'approved' as const,
      summary: 'No blocking issues remain.',
      findings: [],
    };
    expect(ReviewProposalSchema.parse(validProposal)).toEqual(validProposal);
    expect(
      ReviewProposalSchema.safeParse({
        ...validProposal,
        findings: [
          {
            id: 'blocking',
            path: 'src/index.ts',
            line: 1,
            severity: 'blocking',
            message: 'A blocker cannot approve.',
          },
        ],
      }).success,
    ).toBe(false);
    expect(HumanChoiceSchema.safeParse({ decision: 'another-cycle', extra: true }).success).toBe(
      false,
    );

    const poll = {
      settings,
      credential: 'fixture-credential',
      identity: {
        kind: 'poll' as const,
        ownerId: 'local',
        loopId: fakeUlid('review-boundary-loop'),
        versionId: fakeUlid('review-boundary-version'),
        nodeId: 'poll',
      },
      input: null,
      visit: null,
      subject: null,
      claim: null,
      wake: null,
    };
    expect(ReviewEnvelopeSchema.parse(poll).identity.kind).toBe('poll');
    expect(ReviewEnvelopeSchema.safeParse({ ...poll, visit: 1 }).success).toBe(false);
  });

  it('hashes the complete stable review delegate closure and keeps source and dist selection separate', async () => {
    const expectedModules = [
      'authority',
      'binding',
      'errors',
      'github/client',
      'github/process',
      'github/protocol',
      'github/repository',
      'github/review',
      'github/review-client',
      'github/review-entry',
      'github/review-protocol',
      'github/review-storage',
      'github/storage',
      'github/support-input',
      'subjects',
    ];
    expect(REVIEW_SUPPORT_ENTRY).toBe('dist/templates/github/review-entry.js');
    expect([...REVIEW_SUPPORT_MODULES]).toEqual(expectedModules);

    const root = await temporaryRoot();
    for (const mode of [
      { folder: 'src/templates', extension: '.ts' },
      { folder: 'dist/templates', extension: '.js' },
    ]) {
      for (const module of expectedModules) {
        const path = join(root, mode.folder, module + mode.extension);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${mode.folder.startsWith('dist') ? 'dist' : 'source'}:${module}`);
      }
    }

    const source = await reviewSupportClosure(root, '1.0.0', true);
    const distribution = await reviewSupportClosure(root, '1.0.0', false);
    expect(source.path).toBe(join(root, 'src/templates/github/review-entry.ts'));
    expect(distribution.path).toBe(join(root, REVIEW_SUPPORT_ENTRY));
    expect(source.hash).not.toBe(distribution.hash);
    for (const module of expectedModules) {
      const path = join(root, 'src/templates', module + '.ts');
      await writeFile(path, `changed:${module}`);
      expect((await reviewSupportClosure(root, '1.0.0', true)).hash).not.toBe(source.hash);
      await writeFile(path, `source:${module}`);
    }
    await expect(reviewSupportClosure(root, '2.0.0', true)).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
    });
  });
});
