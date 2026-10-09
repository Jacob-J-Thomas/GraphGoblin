import { z } from 'zod';
import type { QaTemplateSettings } from '@graphgoblin/contracts';
import { CliReviewGithub, ReviewPullRequestSchema } from './review-client.js';
import { PullRequestSchema, type GithubIssue } from './client.js';
import { fail, ShaSchema } from './protocol.js';

/** Metadata discovery and the sole trusted explanatory comment, without QA effect methods. */
export interface QaMetadataPort {
  authenticate(): Promise<void>;
  pullRequest(repository: string, number: number): Promise<z.infer<typeof ReviewPullRequestSchema>>;
  linkedIssues(
    repository: string,
    number: number,
  ): Promise<readonly { repository: string; number: number }[]>;
  issue(repository: string, number: number): Promise<GithubIssue>;
  comments(repository: string, number: number, limit: number): Promise<readonly { body: string }[]>;
  post(repository: string, number: number, body: string): Promise<void>;
  mergedCandidates(
    settings: QaTemplateSettings,
  ): Promise<readonly { pullRequest: number; mergeSha: string }[]>;
}
const Candidate = PullRequestSchema.extend({
  draft: z.boolean(),
  merged_at: z.string().nullable(),
  merge_commit_sha: ShaSchema.nullable(),
});
export class CliQaGithub extends CliReviewGithub implements QaMetadataPort {
  async mergedCandidates(settings: QaTemplateSettings) {
    const repository = (settings.repository.owner + '/' + settings.repository.name).toLowerCase();
    const rows = z
      .array(Candidate)
      .max(100)
      .parse(
        JSON.parse(
          await this.run([
            'api',
            '--method',
            'GET',
            'repos/' + repository + '/pulls',
            '-f',
            'state=closed',
            '-f',
            'base=' + settings.repository.baseBranch,
            '-f',
            'per_page=100',
          ]),
        ),
      );
    if (rows.length === 100) fail('QA_DISCOVERY_BOUND');
    return rows
      .filter(
        (row) =>
          row.state === 'closed' &&
          !row.draft &&
          row.merged_at !== null &&
          row.merge_commit_sha !== null &&
          row.base.ref === settings.repository.baseBranch &&
          row.base.repo.full_name.toLowerCase() === repository &&
          row.head.repo.full_name.toLowerCase() === repository,
      )
      .map((row) => ({ pullRequest: row.number, mergeSha: row.merge_commit_sha! }));
  }
}
export async function trustedQaPr(
  github: QaMetadataPort,
  settings: QaTemplateSettings,
  number: number,
) {
  const repository = (settings.repository.owner + '/' + settings.repository.name).toLowerCase();
  await github.authenticate();
  const pr = ReviewPullRequestSchema.parse(await github.pullRequest(repository, number));
  if (
    pr.number !== number ||
    pr.state !== 'closed' ||
    !pr.merged ||
    pr.draft ||
    !pr.merge_commit_sha ||
    pr.base.ref !== settings.repository.baseBranch ||
    pr.base.repo.full_name.toLowerCase() !== repository ||
    pr.head.repo.full_name.toLowerCase() !== repository
  )
    fail('QA_MERGE_REFUSED');
  const links = await github.linkedIssues(repository, number);
  if (links.length !== 1 || links[0]!.repository.toLowerCase() !== repository)
    fail('QA_ISSUE_LINK_REFUSED');
  const issue = await github.issue(repository, links[0]!.number);
  if (
    issue.number !== links[0]!.number ||
    issue.pull_request ||
    issue.html_url.toLowerCase() !== 'https://github.com/' + repository + '/issues/' + issue.number
  )
    fail('QA_ISSUE_IDENTITY_REFUSED');
  return { pr, issue, mergeSha: pr.merge_commit_sha };
}
