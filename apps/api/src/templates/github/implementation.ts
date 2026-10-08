import { join, resolve } from 'node:path';
import { stableHash } from '@graphgoblin/domain';
import { ClaimRecordSchema, PrCreatedSchema } from '../authority.js';
import { CliGithub, eligibleIssue, type GithubPort, type GithubPullRequest } from './client.js';
import { ImplementationRepository } from './repository.js';
import { DiskSupportStorage, JournalSchema, type SupportStorage } from './storage.js';
import { NativeCommands, nativeExecutable, gateCommand, type CommandRunner } from './process.js';
import {
  ImplementationPlanSchema,
  PrProposalSchema,
  WorkerResultSchema,
  SupportEnvelopeSchema,
  SupportActionSchema,
  SupportFailure,
  fail,
  blocked,
  type SupportEnvelope,
} from './protocol.js';

export interface ImplementationSupportDeps {
  commands: CommandRunner;
  github: GithubPort;
  storage: SupportStorage;
  git: string;
  gate: (program: string, args: readonly string[]) => Promise<{ program: string; args: string[] }>;
}
export async function nativeSupportDependencies(
  settings: SupportEnvelope['settings'],
): Promise<ImplementationSupportDeps> {
  const commands = new NativeCommands();
  return {
    commands,
    storage: new DiskSupportStorage(),
    github: new CliGithub(commands, await nativeExecutable('gh'), settings.repository.path),
    git: await nativeExecutable('git'),
    gate: gateCommand,
  };
}
export async function nativeSupport(
  settings: SupportEnvelope['settings'],
): Promise<ImplementationSupport> {
  return new ImplementationSupport(await nativeSupportDependencies(settings));
}
export function closingIssue(body: string, repository: string, issue: number): boolean {
  const matches = [
    ...body.matchAll(
      /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:(https:\/\/github\.com\/[^\s]+\/issues\/)|([a-z0-9_.-]+\/[a-z0-9_.-]+))?#?(\d+)/gi,
    ),
  ];
  return (
    matches.length === 1 &&
    Number(matches[0]?.[3]) === issue &&
    (!matches[0]?.[2] || matches[0][2].toLowerCase() === repository) &&
    (!matches[0]?.[1] ||
      matches[0][1].toLowerCase() === 'https://github.com/' + repository + '/issues/')
  );
}
export class ImplementationSupport {
  constructor(private readonly deps: ImplementationSupportDeps) {}
  async execute(actionInput: unknown, envelopeInput: unknown): Promise<unknown> {
    let envelope: SupportEnvelope | undefined;
    try {
      envelope = SupportEnvelopeSchema.parse(envelopeInput);
      const action = SupportActionSchema.parse(actionInput);
      return await this.perform(action, envelope);
    } catch (error) {
      const code = error instanceof SupportFailure ? error.code : 'SUPPORT_INVALID_INPUT';
      // Never report caller input or subprocess errors. Graph routing decides the blocked exit.
      return blocked(code);
    }
  }
  private async perform(action: string, envelope: SupportEnvelope): Promise<unknown> {
    const { settings, identity, subject } = envelope;
    if (action === 'poll') {
      if (identity.kind !== 'poll') fail('POLL_IDENTITY_REFUSED');
      await this.deps.github.authenticate();
      const labels = await this.deps.github.labels(
        (settings.repository.owner + '/' + settings.repository.name).toLowerCase(),
      );
      if (!Object.values(settings.labels).every((label) => labels.includes(label)))
        fail('REQUIRED_LABEL_MISSING');
      const items = await this.deps.github.candidates(settings);
      return {
        items: items
          .filter(
            (item) =>
              item.state === 'open' &&
              item.title.trim() &&
              item.body?.trim() &&
              item.labels.some((label) => label.name === settings.labels.trigger),
          )
          .map((item) => ({ id: item.number, payload: { issue: item.number } })),
      };
    }
    if (
      identity.kind !== 'node' ||
      !subject ||
      subject.kind !== 'implementation' ||
      subject.issue === null ||
      subject.attempt === null ||
      envelope.visit === null
    )
      fail('RUN_IDENTITY_REFUSED');
    const repository = subject.repository,
      issue = subject.issue,
      attempt = subject.attempt;
    const parentRunId = subject.role === 'worker' ? subject.parentRunId : identity.runId;
    if (action === 'claim') {
      if (
        subject.role !== 'parent' ||
        subject.source.kind !== 'implementation' ||
        subject.source.runId !== identity.runId
      )
        fail('CLAIM_IDENTITY_REFUSED');
      await eligibleIssue(this.deps.github, settings, issue);
      return ClaimRecordSchema.parse({ type: 'ClaimRecord', repository, issue, attempt });
    }
    if (!envelope.claim) fail('CLAIM_REQUIRED');
    const storage =
      this.deps.storage instanceof DiskSupportStorage
        ? new DiskSupportStorage(envelope.credential, {
            ownerId: identity.ownerId,
            runId: parentRunId,
            repository,
            issue,
            attempt,
          })
        : this.deps.storage;
    const repo = new ImplementationRepository(settings, this.deps.commands, storage, this.deps.git);
    await repo.initialize();
    const path = repo.journal(parentRunId);
    let state = await storage.load(path);
    if (
      state &&
      (state.runId !== parentRunId ||
        state.repository !== repository ||
        state.issue !== issue ||
        state.attempt !== attempt ||
        state.branch !== 'graphgoblin/issue-' + issue + '-attempt-' + attempt ||
        resolve(state.cwd) !== resolve(repo.workspace(parentRunId)))
    )
      fail('JOURNAL_IDENTITY_CONFLICT');
    if (state?.task) {
      const task = state.task;
      const expectedCwd =
        state.mode === 'direct' ? state.cwd : repo.workspace(parentRunId, task.index);
      const expectedBranch =
        state.mode === 'direct' ? state.branch : state.branch + '-task-' + (task.index + 1);
      if (
        task.index !== state.taskIndex ||
        task.id !== state.tasks[task.index]?.id ||
        resolve(task.cwd) !== resolve(expectedCwd) ||
        task.branch !== expectedBranch
      )
        fail('TASK_INTENT_CONFLICT');
    }
    const key = identity.nodeId + ':' + envelope.visit;
    if (state?.results[key] !== undefined) return state.results[key];
    if (state?.quarantined) fail('WORKSPACE_QUARANTINED');
    if (state?.blocked && action !== 'block') fail('ATTEMPT_BLOCKED');
    const save = async () => {
      if (!state) fail('JOURNAL_REQUIRED');
      await storage.save(path, state);
    };
    if (action === 'prepare') {
      if (subject.role !== 'parent') fail('PARENT_ACTION_REQUIRED');
      const current = await this.deps.github.issue(repository, issue);
      await this.deps.github.authenticate();
      const declared = await this.deps.github.labels(repository);
      if (!Object.values(settings.labels).every((label) => declared.includes(label)))
        fail('REQUIRED_LABEL_MISSING');
      const actual = current.labels.map((label) => label.name);
      if (
        current.state !== 'open' ||
        !current.title.trim() ||
        !current.body?.trim() ||
        ![settings.labels.trigger, settings.labels.inProgress].some((label) =>
          actual.includes(label),
        )
      )
        fail('ISSUE_NOT_ELIGIBLE');
      if (!state) {
        const base = await repo.remoteHead(settings.repository.baseBranch);
        if (!base) fail('BASE_BRANCH_MISSING');
        state = JournalSchema.parse({
          version: 1,
          runId: parentRunId,
          repository,
          issue,
          attempt,
          branch: 'graphgoblin/issue-' + issue + '-attempt-' + attempt,
          cwd: repo.workspace(parentRunId),
          base,
          title: current.title,
          body: current.body,
          taskIndex: 0,
        });
        await save(); // Local workspace intent precedes fetch/branch/worktree effects.
      }
      await repo.git(['fetch', '--no-tags', 'origin', state.base]);
      await repo.ensureWorkspace(state.branch, state.cwd, state.base);
      await this.deps.github.label(
        repository,
        issue,
        [settings.labels.inProgress],
        [settings.labels.trigger],
      );
      await this.comment(
        repo,
        parentRunId,
        repository,
        issue,
        'claimed',
        'GraphGoblin admitted implementation attempt ' +
          attempt +
          ' and prepared its contained support workspace.',
      );
      const result = {
        type: 'ImplementationWorkspace',
        repository,
        issue,
        attempt,
        branch: state.branch,
        cwd: state.cwd,
        title: state.title,
        body: state.body,
      };
      state.results[key] = result;
      await save();
      return result;
    }
    if (!state) fail('WORKSPACE_REQUIRED');
    if (action === 'block') {
      if (state.intent) {
        const prs = await this.deps.github.pullRequests(repository, state.intent.branch);
        if (prs.length > 1) fail('PR_RECONCILIATION_CONFLICT');
        const pr = prs[0];
        if (pr) {
          if (
            pr.head.sha !== state.intent.head ||
            pr.head.ref !== state.intent.branch ||
            pr.head.repo.full_name.toLowerCase() !== repository ||
            pr.base.repo.full_name.toLowerCase() !== repository ||
            pr.base.ref !== settings.repository.baseBranch ||
            pr.title !== state.intent.title ||
            pr.body !== state.intent.body ||
            !closingIssue(pr.body, repository, issue)
          )
            fail('PR_RECONCILIATION_CONFLICT');
          state.intent.pullRequest = pr.number;
          await save();
          await this.comment(
            repo,
            parentRunId,
            repository,
            issue,
            'blocked-after-pr',
            'GraphGoblin stopped after pull request #' +
              pr.number +
              ' was created. Inspect this consumed run and reconcile completion manually; no second pull request will be created.',
          );
          return {
            type: 'ImplementationBlocked',
            code: 'PR_COMPLETION_UNCERTAIN',
            message: 'The existing pull request requires manual completion reconciliation.',
          };
        }
        if (state.intent.pullRequest) fail('PR_RECONCILIATION_CONFLICT');
      }
      state.blocked = true;
      await save();
      await this.deps.github.authenticate();
      await this.comment(
        repo,
        parentRunId,
        repository,
        issue,
        'blocked',
        'GraphGoblin stopped this implementation attempt. No pull request was created. The permanent attempt remains consumed; inspect its fixed support or run failure code and recover manually.',
      );
      await this.deps.github.label(
        repository,
        issue,
        [settings.labels.blocked],
        [settings.labels.inProgress],
      );
      const result = {
        type: 'ImplementationBlocked',
        code: 'IMPLEMENTATION_BLOCKED',
        message: 'The consumed implementation attempt is blocked.',
      };
      state.results[key] = result;
      await save();
      return result;
    }
    if (subject.role !== 'parent') fail('PARENT_ACTION_REQUIRED');
    if (action === 'complete') {
      const current = await this.deps.github.issue(repository, issue);
      if (
        current.state !== 'open' ||
        !current.labels.some((label) =>
          [settings.labels.inProgress, settings.labels.prOpen].includes(label.name),
        )
      )
        fail('ISSUE_NOT_ELIGIBLE');
      await this.deps.github.authenticate();
    } else await eligibleIssue(this.deps.github, settings, issue, true);
    await repo.assert(state.cwd);
    if ((await repo.git(['rev-parse', '--abbrev-ref', 'HEAD'], state.cwd)) !== state.branch)
      fail('ISSUE_BRANCH_CHANGED');
    let result: unknown;
    if (action === 'plan') {
      const plan = ImplementationPlanSchema.parse(envelope.input?.lastOutput?.value);
      const tasks =
        plan.mode === 'direct'
          ? [{ id: 'direct', title: 'Implement issue ' + issue, instructions: plan.instructions }]
          : plan.tasks;
      if (tasks.length > settings.limits.maxTasks || state.mode) fail('PLAN_LIMIT_OR_CONFLICT');
      state.mode = plan.mode;
      state.tasks = tasks;
      result = { type: 'ImplementationPlan', mode: plan.mode, tasks, taskIndex: 0 };
    } else if (action === 'task-prepare') {
      const task = state.tasks[state.taskIndex];
      if (!task) fail('TASK_PLAN_EXHAUSTED');
      const cwd =
        state.mode === 'direct' ? state.cwd : repo.workspace(parentRunId, state.taskIndex);
      const branch =
        state.mode === 'direct' ? state.branch : state.branch + '-task-' + (state.taskIndex + 1);
      state.task ??= {
        index: state.taskIndex,
        id: task.id,
        branch,
        cwd,
        start: await repo.head(state.cwd),
      };
      if (state.task.index !== state.taskIndex || state.task.id !== task.id)
        fail('TASK_INTENT_CONFLICT');
      await save();
      await repo.ensureWorkspace(branch, cwd, state.task.start);
      result = { type: 'ImplementationTask', ...task, cwd, index: state.taskIndex };
    } else if (action === 'task-complete') {
      const task = state.task;
      if (!task || task.index !== state.taskIndex) fail('TASK_VISIT_CONFLICT');
      WorkerResultSchema.parse(envelope.input?.vars['workerResult']);
      if ((await repo.git(['rev-parse', '--abbrev-ref', 'HEAD'], task.cwd)) !== task.branch)
        fail('TASK_BRANCH_CHANGED');
      const head = await repo.commit(
        state,
        task.cwd,
        'Implement #' + issue + ': ' + state.tasks[task.index]!.title,
        save,
      );
      const merged = state.mode === 'split' ? await repo.merge(state, head, save) : head;
      state.taskIndex++;
      delete state.task;
      result = {
        type: 'TaskComplete',
        taskIndex: state.taskIndex,
        remaining: state.taskIndex < state.tasks.length,
        head: merged,
      };
    } else if (action === 'gate') {
      if (state.taskIndex !== state.tasks.length || !state.mode) fail('TASKS_NOT_COMPLETE');
      const calls = (state.gate?.calls ?? 0) + 1;
      if (calls > settings.limits.gateFixes + 1) fail('GATE_FIX_LIMIT');
      if (calls > 1) await repo.commit(state, state.cwd, 'Fix gates for #' + issue, save);
      const command = await this.deps.gate(settings.gate.program, settings.gate.args);
      state.quarantined = true;
      state.gate = {
        calls,
        passed: false,
        head: await repo.head(state.cwd),
        summary: 'Gate launch completion is not yet confirmed.',
      };
      await save(); // Count and uncertain launch precede the process; restart cannot rerun it.
      const gate = await this.deps.commands.run({
        ...command,
        cwd: state.cwd,
        timeoutMs: Math.min(settings.gate.timeoutSeconds * 1000, 86395000),
        maxBytes: 65536,
      });
      if (gate.termination !== 'confirmed') {
        state.quarantined = true;
        await save();
        fail('PROCESS_TERMINATION_UNCONFIRMED');
      }
      const launchedHead = state.gate.head;
      if ((await repo.head(state.cwd)) !== launchedHead) {
        state.quarantined = true;
        await save();
        fail('GATE_HEAD_CHANGED');
      }
      state.quarantined = false;
      const clean = !(await repo.git(
        ['status', '--porcelain', '--untracked-files=all'],
        state.cwd,
      ));
      const passed = gate.exitCode === 0 && !gate.timedOut && !gate.overflow && clean;
      const summary = passed
        ? 'Configured gates passed.'
        : gate.timedOut
          ? 'Configured gates reached their deadline.'
          : gate.overflow
            ? 'Configured gates exceeded the output bound.'
            : 'Configured gates failed.';
      state.gate = { calls, passed, summary, head: launchedHead };
      result = {
        type: 'GateResult',
        passed,
        fixes: calls - 1,
        canFix: !passed && calls <= settings.limits.gateFixes,
        summary,
      };
    } else if (action === 'pr-intent') {
      const proposal = PrProposalSchema.parse(envelope.input?.lastOutput?.value);
      const head = await repo.head(state.cwd);
      if (
        !state.gate?.passed ||
        state.gate.head !== head ||
        (await repo.git(['status', '--porcelain', '--untracked-files=all'], state.cwd))
      )
        fail('GATES_OR_HEAD_CHANGED');
      const body =
        '## Summary\n\n' +
        proposal.summary +
        '\n\nCloses #' +
        issue +
        '\n\n## Changes\n\n' +
        proposal.changes.map((item) => '- ' + item).join('\n') +
        '\n\n## Tests and gates\n\n' +
        proposal.tests.map((item) => '- ' + item).join('\n') +
        '\n- Configured gates passed on ' +
        head +
        '\n\n## Risks\n\n' +
        proposal.risks.map((item) => '- ' + item).join('\n') +
        '\n';
      if (!closingIssue(body, repository, issue)) fail('PR_CLOSING_LINK_REFUSED');
      state.intent = { head, branch: state.branch, title: proposal.title, body, pushed: false };
      result = { type: 'PrIntent', head, branch: state.branch, title: proposal.title, body };
    } else if (action === 'pr-created') {
      const intent = state.intent;
      if (
        !intent ||
        !state.gate?.passed ||
        state.gate.head !== intent.head ||
        (await repo.head(state.cwd)) !== intent.head
      )
        fail('PR_INTENT_REQUIRED');
      const exact = (prs: readonly GithubPullRequest[]) => {
        if (prs.length > 1) fail('PR_RECONCILIATION_CONFLICT');
        const pr = prs[0];
        if (
          pr &&
          (pr.state !== 'open' ||
            pr.title !== intent.title ||
            pr.head.sha !== intent.head ||
            pr.head.ref !== intent.branch ||
            pr.head.repo.full_name.toLowerCase() !== repository ||
            pr.base.repo.full_name.toLowerCase() !== repository ||
            pr.base.ref !== settings.repository.baseBranch ||
            pr.body !== intent.body ||
            !closingIssue(pr.body, repository, issue))
        )
          fail('PR_RECONCILIATION_CONFLICT');
        return pr;
      };
      let pr = exact(await this.deps.github.pullRequests(repository, intent.branch));
      const remote = await repo.remoteHead(intent.branch);
      if (remote && remote !== intent.head) fail('REMOTE_HEAD_CHANGED');
      if (!remote)
        await repo.git(['push', 'origin', intent.head + ':refs/heads/' + intent.branch], state.cwd);
      if ((await repo.remoteHead(intent.branch)) !== intent.head)
        fail('PUSH_RECONCILIATION_REFUSED');
      intent.pushed = true;
      await save();
      const bodyFile = join(repo.metadata, parentRunId + '-pr.md');
      await this.deps.storage.text(repo.metadata, bodyFile, intent.body);
      if (!pr) {
        await this.deps.github.create(
          repository,
          intent.branch,
          settings.repository.baseBranch,
          intent.title,
          bodyFile,
        );
        pr = exact(await this.deps.github.pullRequests(repository, intent.branch));
      }
      if (!pr || (intent.pullRequest !== undefined && intent.pullRequest !== pr.number))
        fail('PR_RECONCILIATION_CONFLICT');
      intent.pullRequest = pr.number;
      await save();
      result = PrCreatedSchema.parse({
        type: 'PrCreated',
        repository,
        issue,
        attempt,
        pullRequest: pr.number,
        head: intent.head,
      });
    } else if (action === 'complete') {
      if (!state.intent?.pullRequest) fail('PR_FACT_REQUIRED');
      const intent = state.intent;
      const prs = await this.deps.github.pullRequests(repository, intent.branch);
      const pr = prs[0];
      if (
        prs.length !== 1 ||
        !pr ||
        pr.state !== 'open' ||
        pr.number !== intent.pullRequest ||
        pr.head.sha !== intent.head ||
        pr.head.ref !== intent.branch ||
        pr.head.repo.full_name.toLowerCase() !== repository ||
        pr.base.repo.full_name.toLowerCase() !== repository ||
        pr.base.ref !== settings.repository.baseBranch ||
        pr.title !== intent.title ||
        pr.body !== intent.body
      )
        fail('PR_RECONCILIATION_CONFLICT');
      await this.deps.github.label(
        repository,
        issue,
        [settings.labels.prOpen],
        [settings.labels.inProgress, settings.labels.trigger],
      );
      await this.comment(
        repo,
        parentRunId,
        repository,
        issue,
        'complete',
        'GraphGoblin created pull request #' +
          state.intent.pullRequest +
          ' for implementation attempt ' +
          attempt +
          '.',
      );
      result = {
        type: 'ImplementationComplete',
        pullRequest: state.intent.pullRequest,
        head: state.intent.head,
      };
    } else fail('ACTION_REFUSED');
    if (Object.keys(state.results).length >= 1000) fail('VISIT_BOUND');
    state.results[key] = result;
    await save();
    return result;
  }
  private async comment(
    repo: ImplementationRepository,
    runId: string,
    repository: string,
    issue: number,
    kind: string,
    text: string,
  ) {
    const marker =
      '<!-- graphgoblin-implementation:' + stableHash({ runId, repository, issue, kind }) + ' -->';
    const comments = await this.deps.github.comments(repository, issue, 101);
    if (comments.length >= 100) fail('COMMENT_DISCOVERY_BOUND');
    const found = comments.filter((item) => item.body.includes(marker));
    if (found.length > 1) fail('COMMENT_RECONCILIATION_CONFLICT');
    if (found.length) return;
    const path = join(repo.metadata, runId + '-' + kind + '.md');
    await this.deps.storage.text(repo.metadata, path, marker + '\n' + text);
    await this.deps.github.comment(repository, issue, path);
  }
}
