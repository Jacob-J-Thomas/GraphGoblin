import { z } from 'zod';
import type { ReviewTemplateSettings } from '@graphgoblin/contracts';
import { TemplateBranchSchema } from '@graphgoblin/contracts';
import { CliGithub, PullRequestSchema, type GithubIssue } from './client.js';
import { fail, ShaSchema } from './protocol.js';

export const ReviewPullRequestSchema = PullRequestSchema.extend({
  draft: z.boolean(),
  merged: z.boolean(),
  merge_commit_sha: ShaSchema.nullable(),
  user: z.object({ login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/) }),
});
export type ReviewPullRequest = z.infer<typeof ReviewPullRequestSchema>;
export const ReviewCandidateSchema = PullRequestSchema.extend({
  draft: z.boolean(),
  user: ReviewPullRequestSchema.shape.user,
});
export type ReviewCandidate = z.infer<typeof ReviewCandidateSchema>;
export interface RequiredCheck {
  name: string;
  appId: number | null;
}
export interface CheckFact {
  name: string;
  head: string;
  appId: number | null;
  passed: boolean;
  pending: boolean;
}
export interface MergeReadiness {
  head: string;
  mergeable: boolean;
  clean: boolean;
  reviewsSatisfied: boolean;
}
export interface ReviewGithubPort {
  authenticate(): Promise<void>;
  pullRequest(repository: string, number: number): Promise<ReviewPullRequest>;
  reviewCandidates(settings: ReviewTemplateSettings): Promise<readonly ReviewCandidate[]>;
  permission(repository: string, login: string): Promise<string>;
  linkedIssues(
    repository: string,
    number: number,
  ): Promise<readonly { repository: string; number: number }[]>;
  issue(repository: string, number: number): Promise<GithubIssue>;
  requiredChecks(repository: string, branch: string): Promise<readonly RequiredCheck[]>;
  checks(repository: string, head: string): Promise<readonly CheckFact[]>;
  readiness(repository: string, number: number): Promise<MergeReadiness>;
  comments(repository: string, number: number, limit: number): Promise<readonly { body: string }[]>;
  post(repository: string, number: number, body: string): Promise<void>;
  label(
    repository: string,
    number: number,
    add: readonly string[],
    remove: readonly string[],
  ): Promise<void>;
  merge(
    repository: string,
    number: number,
    head: string,
    method: ReviewTemplateSettings['mergeMethod'],
  ): Promise<void>;
  close(repository: string, number: number): Promise<void>;
}
const Login = z.string().regex(/^[A-Za-z0-9-]{1,39}$/);
const CheckRun = z.object({
  name: z.string(),
  head_sha: ShaSchema,
  status: z.string(),
  conclusion: z.string().nullable(),
  app: z.object({ id: z.number().int().positive() }),
});
const Status = z.object({ context: z.string(), state: z.string() });
export class CliReviewGithub extends CliGithub implements ReviewGithubPort {
  async pullRequest(repository: string, number: number) {
    const result = ReviewPullRequestSchema.parse(
      JSON.parse(await this.run(['api', 'repos/' + repository + '/pulls/' + number])),
    );
    if (result.number !== number) fail('PR_IDENTITY_REFUSED');
    return result;
  }
  async reviewCandidates(settings: ReviewTemplateSettings) {
    const repository = (settings.repository.owner + '/' + settings.repository.name).toLowerCase();
    const result = z
      .array(ReviewCandidateSchema)
      .max(100)
      .parse(
        JSON.parse(
          await this.run([
            'api',
            '--method',
            'GET',
            'repos/' + repository + '/pulls',
            '-f',
            'state=open',
            '-f',
            'base=' + settings.repository.baseBranch,
            '-f',
            'per_page=100',
          ]),
        ),
      );
    if (result.length === 100) fail('PR_DISCOVERY_BOUND');
    return result.filter((pr) => !pr.draft);
  }
  async permission(repository: string, login: string) {
    return z
      .object({ permission: z.string() })
      .parse(
        JSON.parse(
          await this.run([
            'api',
            'repos/' + repository + '/collaborators/' + Login.parse(login) + '/permission',
          ]),
        ),
      ).permission;
  }
  async linkedIssues(repository: string, number: number) {
    const [owner, name] = repository.split('/');
    const data = z
      .object({
        data: z.object({
          repository: z.object({
            pullRequest: z.object({
              closingIssuesReferences: z.object({
                nodes: z
                  .array(
                    z.object({
                      number: z.number().int().positive(),
                      repository: z.object({ nameWithOwner: z.string() }),
                    }),
                  )
                  .max(100),
                pageInfo: z.object({ hasNextPage: z.boolean() }),
              }),
            }),
          }),
        }),
      })
      .parse(
        JSON.parse(
          await this.run([
            'api',
            'graphql',
            '-f',
            'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:100){nodes{number repository{nameWithOwner}} pageInfo{hasNextPage}}}}}',
            '-f',
            'owner=' + owner,
            '-f',
            'name=' + name,
            '-F',
            'number=' + number,
          ]),
        ),
      );
    const connection = data.data.repository.pullRequest.closingIssuesReferences;
    if (connection.pageInfo.hasNextPage || connection.nodes.length === 100)
      fail('ISSUE_LINK_BOUND');
    return connection.nodes.map((issue) => ({
      repository: issue.repository.nameWithOwner.toLowerCase(),
      number: issue.number,
    }));
  }
  async requiredChecks(repository: string, branch: string) {
    const value = z
      .object({
        required_status_checks: z
          .object({
            contexts: z.array(z.string()).max(100),
            checks: z
              .array(
                z.object({ context: z.string(), app_id: z.number().int().positive().nullable() }),
              )
              .max(100),
          })
          .nullable(),
      })
      .parse(
        JSON.parse(
          await this.run([
            'api',
            'repos/' + repository + '/branches/' + encodeURIComponent(branch) + '/protection',
          ]),
        ),
      );
    if (!value.required_status_checks) fail('REQUIRED_CHECK_SET_UNKNOWN');
    const explicit = value.required_status_checks.checks.map((check) => ({
      name: check.context,
      appId: check.app_id,
    }));
    const all = [
      ...explicit,
      ...value.required_status_checks.contexts
        .filter((name) => !explicit.some((check) => check.name === name))
        .map((name) => ({ name, appId: null })),
    ];
    if (!all.length || all.length > 100) fail('REQUIRED_CHECK_SET_UNKNOWN');
    return all;
  }
  async checks(repository: string, head: string) {
    ShaSchema.parse(head);
    const checks = z
      .object({ total_count: z.number().int().min(0), check_runs: z.array(CheckRun).max(100) })
      .parse(
        JSON.parse(
          await this.run([
            'api',
            'repos/' + repository + '/commits/' + head + '/check-runs?per_page=100',
          ]),
        ),
      );
    const statuses = z
      .object({
        sha: ShaSchema,
        total_count: z.number().int().min(0),
        statuses: z.array(Status).max(100),
      })
      .parse(
        JSON.parse(
          await this.run([
            'api',
            'repos/' + repository + '/commits/' + head + '/status?per_page=100',
          ]),
        ),
      );
    if (
      checks.total_count > checks.check_runs.length ||
      statuses.total_count > statuses.statuses.length ||
      statuses.sha !== head ||
      checks.check_runs.some((check) => check.head_sha !== head)
    )
      fail('CHECK_HISTORY_BOUND');
    return [
      ...checks.check_runs.map((check) => ({
        name: check.name,
        head: check.head_sha,
        appId: check.app.id,
        passed: check.status === 'completed' && check.conclusion === 'success',
        pending: check.status !== 'completed',
      })),
      ...statuses.statuses.map((status) => ({
        name: status.context,
        head,
        appId: null,
        passed: status.state === 'success',
        pending: status.state === 'pending',
      })),
    ];
  }
  async readiness(repository: string, number: number) {
    const [owner, name] = repository.split('/');
    const value = z
      .object({
        data: z.object({
          repository: z.object({
            pullRequest: z.object({
              headRefOid: ShaSchema,
              mergeable: z.string(),
              mergeStateStatus: z.string(),
              reviewDecision: z.string().nullable(),
            }),
          }),
        }),
      })
      .parse(
        JSON.parse(
          await this.run([
            'api',
            'graphql',
            '-f',
            'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid mergeable mergeStateStatus reviewDecision}}}',
            '-f',
            'owner=' + owner,
            '-f',
            'name=' + name,
            '-F',
            'number=' + number,
          ]),
        ),
      );
    const pr = value.data.repository.pullRequest;
    return {
      head: pr.headRefOid,
      mergeable: pr.mergeable === 'MERGEABLE',
      clean: pr.mergeStateStatus === 'CLEAN',
      reviewsSatisfied: pr.reviewDecision === null || pr.reviewDecision === 'APPROVED',
    };
  }
  async merge(
    repository: string,
    number: number,
    head: string,
    method: ReviewTemplateSettings['mergeMethod'],
  ) {
    await this.run([
      'pr',
      'merge',
      String(number),
      '--repo',
      repository,
      '--' + method,
      '--match-head-commit',
      ShaSchema.parse(head),
    ]);
  }
  async close(repository: string, number: number) {
    await this.run(['pr', 'close', String(number), '--repo', repository]);
  }
}
export async function trustedReviewPr(
  github: ReviewGithubPort,
  settings: ReviewTemplateSettings,
  number: number,
  allowTerminal = false,
) {
  const repository = (settings.repository.owner + '/' + settings.repository.name).toLowerCase();
  await github.authenticate();
  const pr = await github.pullRequest(repository, number);
  if (
    pr.number !== number ||
    pr.head.repo.full_name.toLowerCase() !== repository ||
    pr.base.repo.full_name.toLowerCase() !== repository ||
    pr.base.ref !== settings.repository.baseBranch ||
    pr.draft ||
    (!allowTerminal && (pr.state !== 'open' || pr.merged))
  )
    fail('PR_NOT_ELIGIBLE');
  TemplateBranchSchema.parse(pr.head.ref);
  if (
    !settings.trustedAuthors.some((login) => login.toLowerCase() === pr.user.login.toLowerCase()) &&
    !['write', 'maintain', 'admin'].includes(await github.permission(repository, pr.user.login))
  )
    fail('PR_AUTHOR_UNTRUSTED');
  const links = await github.linkedIssues(repository, number);
  if (links.length > 1 || links.some((link) => link.repository !== repository))
    fail('ISSUE_LINK_AMBIGUOUS');
  const issue = links[0]?.number ?? null;
  const linked = issue === null ? undefined : await github.issue(repository, issue);
  return {
    pr,
    issue,
    humanRequired:
      settings.requireHumanBeforeMerge ||
      !!linked?.labels.some((label) => settings.humanReviewLabels.includes(label.name)),
  };
}
