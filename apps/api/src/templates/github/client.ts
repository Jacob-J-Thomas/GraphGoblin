import { z } from 'zod';
import type { ImplementationTemplateSettings } from '@graphgoblin/contracts';
import type { CommandRunner } from './process.js';
import { fail, ShaSchema } from './protocol.js';
import { assertIssueOutput } from './support-output.js';

export const IssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().max(4000),
  body: z.string().nullable(),
  state: z.enum(['open', 'closed']),
  labels: z.array(z.object({ name: z.string() })).max(100),
  html_url: z.string(),
  pull_request: z.unknown().optional(),
});
export type GithubIssue = z.infer<typeof IssueSchema>;
export const PullRequestSchema = z.object({
  number: z.number().int().positive(),
  state: z.enum(['open', 'closed']),
  title: z.string(),
  head: z.object({ sha: ShaSchema, ref: z.string(), repo: z.object({ full_name: z.string() }) }),
  base: z.object({ ref: z.string(), repo: z.object({ full_name: z.string() }) }),
  body: z.string().nullable(),
});
export type GithubPullRequest = z.infer<typeof PullRequestSchema>;
export interface GithubPort {
  authenticate(): Promise<void>;
  issue(repository: string, issue: number): Promise<GithubIssue>;
  candidates(settings: ImplementationTemplateSettings): Promise<readonly GithubIssue[]>;
  labels(repository: string): Promise<readonly string[]>;
  comments(repository: string, issue: number, limit: number): Promise<readonly { body: string }[]>;
  comment(repository: string, issue: number, path: string): Promise<void>;
  post(repository: string, issue: number, body: string): Promise<void>;
  label(
    repository: string,
    issue: number,
    add: readonly string[],
    remove: readonly string[],
  ): Promise<void>;
  pullRequests(repository: string, branch: string): Promise<readonly GithubPullRequest[]>;
  create(
    repository: string,
    branch: string,
    base: string,
    title: string,
    bodyFile: string,
  ): Promise<void>;
}
export class CliGithub implements GithubPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly program: string,
    private readonly cwd: string,
  ) {}
  private async run(args: string[], stdin?: string): Promise<string> {
    const result = await this.runner.run({
      program: this.program,
      credentialContext: true,
      args,
      cwd: this.cwd,
      ...(stdin === undefined ? {} : { stdin }),
      timeoutMs: 20000,
      maxBytes: 524288,
    });
    if (
      result.exitCode !== 0 ||
      result.timedOut ||
      result.overflow ||
      result.termination !== 'confirmed'
    )
      fail('GITHUB_UNAVAILABLE');
    return result.stdout;
  }
  async authenticate() {
    await this.run(['auth', 'status']);
  }
  async issue(repository: string, issue: number) {
    const result = IssueSchema.parse(
      JSON.parse(await this.run(['api', 'repos/' + repository + '/issues/' + issue])),
    );
    if (
      result.number !== issue ||
      result.pull_request ||
      result.html_url.toLowerCase() !==
        'https://github.com/' + repository.toLowerCase() + '/issues/' + issue
    )
      fail('ISSUE_IDENTITY_REFUSED');
    return result;
  }
  async candidates(settings: ImplementationTemplateSettings) {
    const repository = (settings.repository.owner + '/' + settings.repository.name).toLowerCase();
    const result = z
      .array(IssueSchema)
      .max(100)
      .parse(
        JSON.parse(
          await this.run([
            'api',
            '--method',
            'GET',
            'repos/' + repository + '/issues',
            '-f',
            'state=open',
            '-f',
            'labels=' + settings.labels.trigger,
            '-f',
            'per_page=100',
          ]),
        ),
      );
    if (result.length === 100) fail('ISSUE_DISCOVERY_BOUND');
    return result.filter((issue) => !issue.pull_request);
  }
  async labels(repository: string) {
    const result = z
      .array(z.object({ name: z.string() }))
      .max(100)
      .parse(JSON.parse(await this.run(['api', 'repos/' + repository + '/labels?per_page=100'])));
    if (result.length === 100) fail('LABEL_DISCOVERY_BOUND');
    return result.map((label) => label.name);
  }
  async comments(repository: string, issue: number, limit: number) {
    const result = z
      .array(z.object({ body: z.string() }))
      .max(limit)
      .parse(
        JSON.parse(
          await this.run([
            'api',
            'repos/' +
              repository +
              '/issues/' +
              issue +
              '/comments?per_page=' +
              Math.min(limit, 100),
          ]),
        ),
      );
    if (result.length >= 100) fail('COMMENT_DISCOVERY_BOUND');
    return result;
  }
  async comment(repository: string, issue: number, path: string) {
    await this.run(['issue', 'comment', String(issue), '--repo', repository, '--body-file', path]);
  }
  async post(repository: string, issue: number, body: string) {
    await this.run(
      [
        'api',
        '--method',
        'POST',
        'repos/' + repository + '/issues/' + issue + '/comments',
        '--input',
        '-',
      ],
      JSON.stringify({ body }),
    );
  }
  async label(
    repository: string,
    issue: number,
    add: readonly string[],
    remove: readonly string[],
  ) {
    const args = ['issue', 'edit', String(issue), '--repo', repository];
    for (const label of add) args.push('--add-label', label);
    for (const label of remove) args.push('--remove-label', label);
    await this.run(args);
  }
  async pullRequests(repository: string, branch: string) {
    const result = z
      .array(PullRequestSchema)
      .max(100)
      .parse(
        JSON.parse(
          await this.run([
            'api',
            '--method',
            'GET',
            'repos/' + repository + '/pulls',
            '-f',
            'state=all',
            '-f',
            'head=' + repository.split('/')[0] + ':' + branch,
            '-f',
            'per_page=100',
          ]),
        ),
      );
    if (result.length === 100) fail('PR_DISCOVERY_BOUND');
    return result;
  }
  async create(repository: string, branch: string, base: string, title: string, bodyFile: string) {
    await this.run([
      'pr',
      'create',
      '--repo',
      repository,
      '--head',
      branch,
      '--base',
      base,
      '--title',
      title,
      '--body-file',
      bodyFile,
    ]);
  }
}
export async function eligibleIssue(
  github: GithubPort,
  settings: ImplementationTemplateSettings,
  issue: number,
  claimed = false,
) {
  await github.authenticate();
  const repository = (settings.repository.owner + '/' + settings.repository.name).toLowerCase();
  const current = await github.issue(repository, issue);
  const labels = await github.labels(repository);
  if (!Object.values(settings.labels).every((label) => labels.includes(label)))
    fail('REQUIRED_LABEL_MISSING');
  if (current.state !== 'open' || !current.title.trim() || !current.body?.trim())
    fail('ISSUE_NOT_ELIGIBLE');
  assertIssueOutput(settings, current);
  const actual = current.labels.map((label) => label.name);
  if (!actual.includes(claimed ? settings.labels.inProgress : settings.labels.trigger))
    fail('TRIGGER_LABEL_REMOVED');
  return current;
}
