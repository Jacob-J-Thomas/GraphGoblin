import {
  JsonValueSchema,
  type JsonValue,
  type ReviewTemplateSettings,
} from '@graphgoblin/contracts';
import { stableHash } from '@graphgoblin/domain';
import { ImplementationRepository } from './repository.js';
import { DiskSupportStorage } from './storage.js';
import { NativeCommands, gateCommand, nativeExecutable, type CommandRunner } from './process.js';
import { CliReviewGithub, trustedReviewPr, type ReviewGithubPort } from './review-client.js';
import {
  ReviewEnvelopeSchema,
  ReviewActionSchema,
  ReviewProposalSchema,
  ReviewFixResultSchema,
  HumanChoiceSchema,
  reviewBlocked,
  type ReviewEnvelope,
  type ReviewIdentity,
} from './review-protocol.js';
import {
  SignedReviewJournal,
  ReviewJournalSchema,
  type ArtifactFiles,
  type ReviewJournal,
} from './review-storage.js';
import { SupportFailure, fail } from './protocol.js';

export interface ReviewDependencies {
  github: ReviewGithubPort;
  commands: CommandRunner;
  files: ArtifactFiles;
  git: string;
  gate(program: string, args: readonly string[]): Promise<{ program: string; args: string[] }>;
  now(): number;
  sleep(ms: number): Promise<void>;
}
export type ReviewDependenciesFactory = (
  settings: ReviewTemplateSettings,
) => Promise<ReviewDependencies>;
export async function nativeReviewDependencies(
  settings: ReviewTemplateSettings,
): Promise<ReviewDependencies> {
  const commands = new NativeCommands(),
    files = new DiskSupportStorage();
  return {
    commands,
    files,
    git: await nativeExecutable('git'),
    github: new CliReviewGithub(commands, await nativeExecutable('gh'), settings.repository.path),
    gate: gateCommand,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
export class ReviewSupport {
  constructor(readonly deps: ReviewDependencies) {}
  async execute(actionInput: string, envelopeInput: unknown): Promise<unknown> {
    try {
      return await this.act(
        ReviewActionSchema.parse(actionInput),
        ReviewEnvelopeSchema.parse(envelopeInput),
      );
    } catch (error) {
      return reviewBlocked(error instanceof SupportFailure ? error.code : 'REVIEW_INVALID_INPUT');
    }
  }
  private async act(
    action: ReturnType<typeof ReviewActionSchema.parse>,
    envelope: ReviewEnvelope,
  ): Promise<JsonValue> {
    const { settings } = envelope,
      repository = (settings.repository.owner + '/' + settings.repository.name).toLowerCase();
    const repo = new ImplementationRepository(
      settings,
      this.deps.commands,
      this.deps.files,
      this.deps.git,
      'review',
    );
    await repo.assert();
    if (action === 'poll') {
      if (envelope.identity.kind !== 'poll') fail('POLL_IDENTITY_REQUIRED');
      const items = [];
      for (const candidate of await this.deps.github.reviewCandidates(settings)) {
        if (
          candidate.head.repo.full_name.toLowerCase() !== repository ||
          candidate.base.repo.full_name.toLowerCase() !== repository ||
          candidate.base.ref !== settings.repository.baseBranch ||
          candidate.draft ||
          candidate.state !== 'open'
        )
          continue;
        try {
          const current = await trustedReviewPr(this.deps.github, settings, candidate.number);
          items.push({
            id: current.pr.number,
            payload: { pullRequest: current.pr.number, head: current.pr.head.sha },
          });
        } catch (error) {
          if (
            !(error instanceof SupportFailure) ||
            !['PR_AUTHOR_UNTRUSTED', 'PR_NOT_ELIGIBLE', 'ISSUE_LINK_AMBIGUOUS'].includes(error.code)
          )
            throw error;
        }
      }
      return JsonValueSchema.parse({ items });
    }
    if (
      envelope.identity.kind !== 'node' ||
      !envelope.subject ||
      envelope.subject.role !== 'parent' ||
      !envelope.subject.pullRequest ||
      !envelope.subject.head ||
      !envelope.visit
    )
      fail('REVIEW_PARENT_REQUIRED');
    const subject = envelope.subject,
      pullRequest = subject.pullRequest!,
      runId = envelope.identity.runId;
    const current = await trustedReviewPr(
      this.deps.github,
      settings,
      pullRequest,
      ['merge', 'close', 'block', 'timeout'].includes(action),
    );
    if (current.issue !== subject.issue) fail('ISSUE_LINK_CHANGED');
    if (action === 'claim') {
      if (current.pr.head.sha !== subject.head) fail('PR_HEAD_CHANGED');
      return { type: 'ClaimRecord', repository, issue: subject.issue, attempt: subject.attempt };
    }
    if (!envelope.claim) fail('CLAIM_REQUIRED');
    const identity: ReviewIdentity = {
      ownerId: envelope.identity.ownerId,
      runId,
      repository,
      pullRequest,
      originalHead: subject.head!,
      issue: subject.issue,
      attempt: subject.attempt,
    };
    const journal = new SignedReviewJournal(this.deps.files, envelope.credential, identity),
      path = repo.journal(runId);
    const key = action + ':' + envelope.visit;
    let state = await journal.load(path);
    if (!state) {
      if (action !== 'prepare' || current.pr.head.sha !== subject.head)
        fail('REVIEW_PREPARE_REQUIRED');
      state = ReviewJournalSchema.parse({
        version: 1,
        head: subject.head,
        cwd: repo.workspace(runId),
        branch: 'graphgoblin/review-' + pullRequest + '-' + runId,
        ref: current.pr.head.ref,
        humanRequired: current.humanRequired,
      });
      await repo.initialize();
      await journal.save(path, state);
    }
    if (
      state.cwd !== repo.workspace(runId) ||
      state.branch !== 'graphgoblin/review-' + pullRequest + '-' + runId ||
      state.ref !== current.pr.head.ref
    )
      fail('WORKSPACE_INTENT_CONFLICT');
    const save = () => journal.save(path, state);
    const flush = () => this.flushNotices(state, envelope, save);
    if (state.results[key] !== undefined) {
      await flush();
      return state.results[key];
    }
    if (state.quarantined || state.pendingGate) fail('WORKSPACE_QUARANTINED');
    if (
      current.pr.head.sha !== state.head &&
      !(state.push && current.pr.head.sha === state.push.head)
    )
      fail('PR_HEAD_CHANGED');
    state.humanRequired = current.humanRequired;
    const next = (route: string, summary: string) => ({
      type: 'ReviewNext',
      route,
      head: state.head,
      automaticCycles: state.automaticCycles,
      extraCycles: state.extraCycles,
      reminders: state.reminders,
      canExtra: state.extraCycles < settings.limits.extraCycles,
      mergeAllowed: !!state.gate?.passed && !!state.gate.checks && state.gate.head === state.head,
      summary,
    });
    const result = async (
      value: unknown,
      notice?: { body: string; issue: boolean },
    ): Promise<JsonValue> => {
      const parsed = JsonValueSchema.parse(value);
      state.results[key] = parsed;
      if (notice) state.notices[key] = { ...notice, prDone: false, issueDone: false };
      await save();
      await flush();
      return parsed;
    };
    if (action === 'prepare') {
      await repo.git(['fetch', '--no-tags', 'origin', state.ref]);
      if ((await repo.git(['rev-parse', 'FETCH_HEAD'])) !== state.head) fail('PR_HEAD_CHANGED');
      await repo.ensureWorkspace(state.branch, state.cwd, state.head);
      if ((await repo.head(state.cwd)) !== state.head) fail('WORKSPACE_HEAD_CHANGED');
      return result({
        type: 'ReviewWorkspace',
        repository,
        pullRequest,
        issue: subject.issue,
        attempt: subject.attempt,
        head: state.head,
        cwd: state.cwd,
        title: current.pr.title,
        body: current.pr.body ?? '',
        humanRequired: state.humanRequired,
      });
    }
    if (action === 'gate') {
      if (state.gateCalls >= settings.limits.automaticCycles + settings.limits.extraCycles)
        fail('GATE_VISIT_LIMIT');
      if (
        (await repo.head(state.cwd)) !== state.head ||
        (await repo.git(['status', '--porcelain', '--untracked-files=all'], state.cwd))
      )
        fail('GATE_WORKSPACE_CHANGED');
      state.gateCalls++;
      state.pendingGate = { head: state.head, visit: envelope.visit };
      state.gate = undefined;
      await save();
      const command = await this.deps.gate(settings.gate.program, settings.gate.args);
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
      if ((await repo.head(state.cwd)) !== state.head) {
        state.quarantined = true;
        await save();
        fail('GATE_HEAD_CHANGED');
      }
      const clean = !(await repo.git(
        ['status', '--porcelain', '--untracked-files=all'],
        state.cwd,
      ));
      const local = gate.exitCode === 0 && !gate.timedOut && !gate.overflow && clean;
      let checks = false;
      if (local) checks = await this.waitChecks(envelope, state);
      delete state.pendingGate;
      state.gate = {
        head: state.head,
        passed: local,
        checks,
        summary: !local
          ? 'Local gates failed; merge is unavailable.'
          : checks
            ? 'Local gates and required CI checks passed on the exact head.'
            : 'Required CI/protection did not become ready within the deadline; merge is unavailable.',
      };
      return result({
        type: 'ReviewGate',
        head: state.head,
        passed: local && checks,
        summary: state.gate.summary,
      });
    }
    if (action === 'verdict') {
      if (!state.gate?.passed || !state.gate.checks || state.gate.head !== state.head)
        fail('GATES_REQUIRED');
      const proposal = ReviewProposalSchema.parse(envelope.input?.lastOutput?.value);
      if (
        (await repo.head(state.cwd)) !== state.head ||
        (await repo.git(['status', '--porcelain', '--untracked-files=all'], state.cwd))
      )
        fail('VERDICT_HEAD_CHANGED');
      state.verdict = { head: state.head, proposal };
      delete state.authorization;
      let route = 'wait';
      if (state.extraPending) {
        state.extraPending = false;
        state.fixPending = false;
      } else {
        if (state.automaticCycles >= settings.limits.automaticCycles) fail('REVIEW_CYCLE_LIMIT');
        state.automaticCycles++;
        if (proposal.verdict === 'approved' && !state.humanRequired) {
          route = 'merge';
          state.authorization = { kind: 'automatic', head: state.head };
        } else if (
          proposal.verdict === 'changes' &&
          state.automaticCycles < settings.limits.automaticCycles
        ) {
          route = 'fix';
          state.fixPending = true;
        }
      }
      return result(next(route, proposal.summary), { body: this.verdictText(state), issue: false });
    }
    if (action === 'fix-prepare') {
      if (!state.fixPending || (state.verdict && state.verdict.head !== state.head))
        fail('FIX_NOT_AUTHORIZED');
      const instructions =
        (state.verdict
          ? this.verdictText(state)
          : (state.gate?.summary ?? 'Repair the configured gates.')) +
        '\nApply only the required corrections. Do not commit, push, merge or change GitHub state.';
      return result({ type: 'ReviewFix', head: state.head, cwd: state.cwd, instructions });
    }
    if (action === 'fixer-head') {
      if (!state.fixPending || (state.verdict && state.verdict.head !== state.head))
        fail('FIX_NOT_AUTHORIZED');
      ReviewFixResultSchema.parse(envelope.input?.lastOutput?.value);
      if ((await repo.git(['rev-parse', '--abbrev-ref', 'HEAD'], state.cwd)) !== state.branch)
        fail('WORKSPACE_BRANCH_CHANGED');
      if (!state.push) {
        const head = await repo.commit(
          state,
          state.cwd,
          'Address review findings for PR #' + pullRequest,
          save,
        );
        if (head === state.head) fail('FIX_NO_CHANGE');
        state.push = { parent: state.head, head, ref: state.ref };
        await save();
      }
      const intent = state.push;
      if (
        (await repo.head(state.cwd)) !== intent.head ||
        (await repo.git(['status', '--porcelain', '--untracked-files=all'], state.cwd))
      )
        fail('PUSH_INTENT_CHANGED');
      const remote = await repo.remoteHead(intent.ref);
      if (remote !== intent.parent && remote !== intent.head) fail('REMOTE_REF_CHANGED');
      if (remote === intent.parent)
        await repo.git(['push', 'origin', intent.head + ':refs/heads/' + intent.ref], state.cwd);
      if ((await repo.remoteHead(intent.ref)) !== intent.head) fail('PUSH_RECONCILIATION_REFUSED');
      state.head = intent.head;
      delete state.push;
      delete state.verdict;
      delete state.gate;
      delete state.authorization;
      state.fixPending = false;
      return result({
        type: 'FixerHead',
        repository,
        issue: subject.issue,
        attempt: subject.attempt,
        pullRequest,
        head: state.head,
      });
    }
    if (action === 'summary') {
      delete state.authorization;
      const summary =
        'Automatic cycles: ' +
        state.automaticCycles +
        '; extra cycles: ' +
        state.extraCycles +
        '; reminders: ' +
        state.reminders +
        '. ' +
        (subject.issue === null ? 'No linked issue; issue-only actions are unavailable. ' : '') +
        'Answer from the run inspector, POST /runs/' +
        runId +
        '/input, or MCP provide_input. Merge requires unchanged passing gates and native protection.';
      return result(
        {
          type: 'ReviewWait',
          head: state.head,
          canExtra: state.extraCycles < settings.limits.extraCycles,
          mergeAllowed:
            !!state.gate?.passed && !!state.gate.checks && state.gate.head === state.head,
          summary,
        },
        {
          body:
            summary +
            '\n' +
            (state.verdict ? this.verdictText(state) : 'No valid approval is recorded.'),
          issue: true,
        },
      );
    }
    if (action === 'human') {
      const wake = envelope.wake;
      if (
        wake?.reason !== 'input' ||
        wake.inputSeq <= state.inputSeq ||
        wake.seq <= state.timeoutSeq
      )
        fail('HUMAN_INPUT_REQUIRED');
      const choice = HumanChoiceSchema.parse(wake.payload);
      if (choice.decision === 'another-cycle') {
        if (wake.nodeId !== 'human-wait' || state.extraCycles >= settings.limits.extraCycles)
          fail('EXTRA_CYCLE_LIMIT');
        state.extraCycles++;
        state.extraPending = true;
        state.fixPending = true;
      }
      state.inputSeq = wake.inputSeq;
      delete state.authorization;
      if (choice.decision === 'merge' || choice.decision === 'close')
        state.authorization = {
          kind: choice.decision === 'merge' ? 'human' : 'close',
          head: state.head,
          inputSeq: wake.inputSeq,
        };
      return result(
        next(
          choice.decision === 'another-cycle' ? 'fix' : choice.decision,
          'Authenticated human choice recorded.',
        ),
      );
    }
    if (action === 'reminder') {
      const wake = envelope.wake;
      if (wake?.reason !== 'timeout' || wake.seq <= state.timeoutSeq || wake.seq <= state.inputSeq)
        fail('HUMAN_TIMEOUT_REQUIRED');
      state.timeoutSeq = wake.seq;
      if (state.reminders < settings.limits.reminders) state.reminders++;
      const route = state.reminders < settings.limits.reminders ? 'wait' : 'timeout';
      return result(
        {
          type: 'ReviewReminder',
          route,
          reminders: state.reminders,
          summary:
            'Human review is still required. Reply through inspector, REST or MCP; timeout cannot merge.',
        },
        {
          body:
            'Human review reminder ' +
            state.reminders +
            ' of ' +
            settings.limits.reminders +
            '. Timeout never authorizes merge.',
          issue: true,
        },
      );
    }
    if (action === 'merge') {
      const intent = state.merge;
      if (intent && current.pr.merged) {
        if (current.pr.head.sha !== intent.head || !current.pr.merge_commit_sha)
          fail('MERGE_RECONCILIATION_REFUSED');
        return result({ type: 'ReviewMerged', pullRequest, head: intent.head });
      }
      if (
        !state.authorization ||
        state.authorization.kind === 'close' ||
        state.authorization.head !== state.head ||
        (state.authorization.kind === 'automatic' &&
          (state.humanRequired || state.verdict?.proposal.verdict !== 'approved')) ||
        !state.gate?.passed ||
        !state.gate.checks ||
        state.gate.head !== state.head ||
        (await repo.head(state.cwd)) !== state.head ||
        (await repo.git(['status', '--porcelain', '--untracked-files=all'], state.cwd))
      )
        fail('MERGE_NOT_AUTHORIZED');
      if (!(await this.ready(envelope, state))) fail('MERGE_PROTECTION_UNAVAILABLE');
      state.merge = { head: state.head, method: settings.mergeMethod };
      await save();
      await this.deps.github.merge(repository, pullRequest, state.head, settings.mergeMethod);
      const completed = await this.deps.github.pullRequest(repository, pullRequest);
      if (!completed.merged || completed.head.sha !== state.head || !completed.merge_commit_sha)
        fail('MERGE_RECONCILIATION_REFUSED');
      return result({ type: 'ReviewMerged', pullRequest, head: state.head });
    }
    if (action === 'close') {
      if (
        state.authorization?.kind !== 'close' ||
        state.authorization.head !== state.head ||
        state.authorization.inputSeq !== state.inputSeq ||
        state.inputSeq === 0
      )
        fail('CLOSE_NOT_AUTHORIZED');
      state.close ??= { head: state.head };
      await save();
      if (current.pr.merged || current.pr.head.sha !== state.close.head)
        fail('CLOSE_RECONCILIATION_REFUSED');
      if (current.pr.state === 'open') await this.deps.github.close(repository, pullRequest);
      const closed = await this.deps.github.pullRequest(repository, pullRequest);
      if (closed.state !== 'closed' || closed.merged || closed.head.sha !== state.close.head)
        fail('CLOSE_RECONCILIATION_REFUSED');
      if (subject.issue !== null)
        await this.deps.github.label(repository, subject.issue, [settings.needsHumanLabel], []);
      return result(
        { type: 'ReviewClosed', pullRequest, issue: subject.issue },
        { body: 'The human closed this PR without merging it.', issue: true },
      );
    }
    if (action === 'timeout') {
      if (state.reminders < settings.limits.reminders || !state.timeoutSeq)
        fail('HUMAN_TIMEOUT_REQUIRED');
      if (current.pr.merged) fail('PR_ALREADY_MERGED');
      if (subject.issue !== null)
        await this.deps.github.label(repository, subject.issue, [settings.needsHumanLabel], []);
      return result(
        {
          type: 'ReviewTimedOut',
          reason: 'HUMAN_REVIEW_TIMEOUT',
          pullRequest,
          issue: subject.issue,
        },
        {
          body: 'HUMAN_REVIEW_TIMEOUT: the bounded reminders ended. The PR remains unmerged; manual review is required.',
          issue: true,
        },
      );
    }
    return result(
      {
        type: 'ReviewBlocked',
        code: 'REVIEW_REFUSED',
        message: 'Review stopped safely; this head remains permanently consumed.',
      },
      {
        body: 'GraphGoblin stopped this review. The head reservation remains consumed. Manual recovery is required; no approval was fabricated.',
        issue: true,
      },
    );
  }
  private verdictText(state: ReviewJournal) {
    const verdict = state.verdict;
    if (!verdict) fail('VERDICT_REQUIRED');
    return (
      'GraphGoblin review on ' +
      verdict.head +
      ': ' +
      verdict.proposal.verdict +
      '\n' +
      verdict.proposal.summary +
      verdict.proposal.findings
        .map(
          (finding) =>
            '\n- ' +
            finding.id +
            ' (' +
            finding.severity +
            ', ' +
            finding.path +
            (finding.line === null ? '' : ':' + finding.line) +
            '): ' +
            finding.message,
        )
        .join('')
    );
  }
  private async ready(envelope: ReviewEnvelope, state: ReviewJournal): Promise<boolean> {
    const { settings } = envelope,
      repository = envelope.subject!.repository,
      number = envelope.subject!.pullRequest!;
    const current = await trustedReviewPr(this.deps.github, settings, number);
    if (current.pr.head.sha !== state.head) fail('PR_HEAD_CHANGED');
    const required =
      settings.requiredChecks.source === 'explicit'
        ? settings.requiredChecks.names.map((name) => ({ name, appId: null }))
        : await this.deps.github.requiredChecks(repository, settings.repository.baseBranch);
    const checks = await this.deps.github.checks(repository, state.head);
    const complete = required.every((required) => {
      const candidates = checks.filter(
        (check) =>
          check.name === required.name &&
          (required.appId === null || check.appId === required.appId),
      );
      return (
        candidates.length > 0 &&
        candidates.every((check) => check.head === state.head && check.passed && !check.pending)
      );
    });
    const native = await this.deps.github.readiness(repository, number);
    if (native.head !== state.head) fail('PR_HEAD_CHANGED');
    return complete && native.mergeable && native.clean && native.reviewsSatisfied;
  }
  private async waitChecks(envelope: ReviewEnvelope, state: ReviewJournal) {
    const deadline = this.deps.now() + envelope.settings.limits.ciWaitMinutes * 60000;
    const maxReads = Math.ceil((envelope.settings.limits.ciWaitMinutes * 60000) / 5000) + 1;
    for (let read = 0; read < maxReads; read++) {
      if (await this.ready(envelope, state)) return true;
      if (this.deps.now() >= deadline) return false;
      await this.deps.sleep(Math.min(5000, deadline - this.deps.now()));
    }
    return false;
  }
  private async flushNotices(
    state: ReviewJournal,
    envelope: ReviewEnvelope,
    save: () => Promise<void>,
  ) {
    const subject = envelope.subject!,
      runId = envelope.identity.kind === 'node' ? envelope.identity.runId : '';
    for (const [key, notice] of Object.entries(state.notices)) {
      const body =
        notice.body + '\n\n<!-- graphgoblin-review:' + stableHash({ runId, key }) + ' -->';
      const post = async (number: number) => {
        const comments = await this.deps.github.comments(subject.repository, number, 100);
        if (comments.length >= 100) fail('COMMENT_DISCOVERY_BOUND');
        const marker = body.slice(body.lastIndexOf('<!--'));
        const matched = comments.filter((comment) => comment.body.includes(marker));
        if (matched.length > 1 || matched.some((comment) => comment.body !== body))
          fail('COMMENT_RECONCILIATION_REFUSED');
        if (!matched.length) await this.deps.github.post(subject.repository, number, body);
      };
      if (!notice.prDone) {
        await post(subject.pullRequest!);
        notice.prDone = true;
        await save();
      }
      if (notice.issue && subject.issue !== null && !notice.issueDone) {
        await post(subject.issue);
        notice.issueDone = true;
        await save();
      }
    }
  }
}
export async function nativeReviewSupport(settings: ReviewTemplateSettings) {
  return new ReviewSupport(await nativeReviewDependencies(settings));
}
