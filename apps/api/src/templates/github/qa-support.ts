import { qaDigest } from './qa-protocol.js';
import type { QaTemplateSettings } from '@graphgoblin/contracts';
import { z } from 'zod';
import {
  ClaimRecordSchema,
  IssueReopenedSchema,
  QaOutcomeSchema,
  QaReworkRequestSchema,
} from '../authority.js';
import { IssueSchema, PullRequestSchema, type GithubIssue } from './client.js';
import { ShaSchema } from './protocol.js';
import {
  QaActionSchema,
  QaEnvelopeSchema,
  QaAdversarySchema,
  QaOutputSchema,
  QaScopeSchema,
  QaOriginalIssueSchema,
  QaProofSnapshotSchema,
  validateQaCriteria,
  qaFail,
  qaBlocked,
  qaScan,
  QaFailure,
  type QaIdentity,
  type QaEnvelope,
  type QaAction,
  type QaOutput,
  type QaProofSnapshot,
} from './qa-protocol.js';
import { QaStateSchema, qaIdentityKey, type QaJournal, type QaState } from './qa-journal.js';
import type { QaProofFiles } from './qa-proof.js';

export const QaMergedPrSchema = PullRequestSchema.extend({
  draft: z.boolean(),
  merged: z.boolean(),
  merge_commit_sha: ShaSchema.nullable(),
});
export interface QaGithubPort {
  pullRequest(repository: string, number: number): Promise<unknown>;
  linkedIssues(
    repository: string,
    number: number,
  ): Promise<readonly { repository: string; number: number }[]>;
  issue(repository: string, issue: number): Promise<GithubIssue>;
  comments(repository: string, issue: number, limit: number): Promise<readonly { body: string }[]>;
  post(repository: string, issue: number, body: string): Promise<void>;
  label(
    repository: string,
    issue: number,
    add: readonly string[],
    remove: readonly string[],
  ): Promise<void>;
  reopen(repository: string, issue: number): Promise<void>;
  mergedCandidates(
    settings: QaTemplateSettings,
  ): Promise<readonly { pullRequest: number; mergeSha: string }[]>;
}
export interface QaRepositoryPort {
  prepare(
    identity: QaIdentity,
    round: number,
  ): Promise<{
    cwd: string;
    artifactRoot: string;
    diff: string;
    touchedSystems: string[];
    applicationSystems: string[];
  }>;
  /** Idempotent exact key+snapshot; must reconcile an existing commit before any native commit. */
  stageProof(
    identity: QaIdentity,
    snapshot: QaProofSnapshot,
    branch: string,
    parent: string | null,
    key: string,
  ): Promise<string>;
  remoteHead(branch: string): Promise<string | null>;
  containsProof(remoteHead: string, commit: string, digest: string): Promise<boolean>;
  /** Nonforce, exact expected parent. No retry or uncertain-tree cleanup inside this call. */
  pushProof(
    branch: string,
    commit: string,
    expectedParent: string | null,
  ): Promise<'pushed' | 'conflict'>;
}
export interface QaBudgetSnapshot {
  requests: number;
  reopenings: number;
  attempts: number;
}
export interface QaHistoryPort {
  verify(identity: QaIdentity): Promise<void>;
  budgets(identity: QaIdentity): Promise<QaBudgetSnapshot>;
}
export interface QaIsolationPort {
  available(identity: QaIdentity | null, phase: string): Promise<boolean>;
}
/** No platform implementation or settings/environment bypass exists. */
export const unavailableQaIsolation: QaIsolationPort = Object.freeze({
  available: () => Promise.resolve(false),
});
export interface QaSupportDeps {
  github: QaGithubPort;
  repository: QaRepositoryPort;
  journal: QaJournal;
  proofs: QaProofFiles;
  history: QaHistoryPort;
  secrets: readonly string[];
  isolation?: QaIsolationPort;
}
const budgetSchema = z.strictObject({
  requests: z.number().int().min(0).max(2),
  reopenings: z.number().int().min(0).max(2),
  attempts: z.number().int().min(1).max(3),
});
const authorityActions = new Set<QaAction>(['claim', 'qa-rework', 'issue-reopened', 'qa-outcome']);
const fixedHuman =
  'QA requires human reconciliation; do not repeat uncertain effects or replenish implementation attempts.';
export class QaSupport {
  private readonly isolation: QaIsolationPort;
  constructor(private readonly deps: QaSupportDeps) {
    this.isolation = deps.isolation ?? unavailableQaIsolation;
  }
  private async guard(identity: QaIdentity | null, phase: string): Promise<void> {
    if (!(await this.isolation.available(identity, phase)))
      qaFail('TEMPLATE_ISOLATION_UNAVAILABLE');
  }
  async poll(
    settings: QaTemplateSettings,
  ): Promise<{ items: { id: string; payload: { pullRequest: number; mergeSha: string } }[] }> {
    await this.guard(null, 'poll');
    const candidates = z
      .array(z.strictObject({ pullRequest: z.number().int().positive(), mergeSha: ShaSchema }))
      .max(100)
      .parse(await this.deps.github.mergedCandidates(settings));
    if (
      candidates.length === 100 ||
      new Set(candidates.map((item) => item.mergeSha)).size !== candidates.length
    )
      qaFail('QA_DISCOVERY_BOUND');
    return { items: candidates.map((item) => ({ id: item.mergeSha, payload: item })) };
  }
  async execute(actionInput: unknown, envelopeInput: unknown): Promise<QaOutput> {
    let action: QaAction | undefined;
    try {
      action = QaActionSchema.parse(actionInput);
      const envelope = QaEnvelopeSchema.parse(envelopeInput);
      if (action === 'prerequisites') {
        const available = await this.isolation.available(envelope.identity, envelope.nodeId);
        return {
          type: 'QaPrerequisites',
          available,
          code: available ? 'READY' : 'TEMPLATE_ISOLATION_UNAVAILABLE',
          remediation: available
            ? 'Injected capability supplied; native enforcement must be verified separately.'
            : 'Enforced evidence-only isolation is unavailable; run no QA or effects.',
        };
      }
      if (action === 'block')
        return {
          type: 'QaBlocked',
          code: 'QA_REFUSED',
          message: 'QA stopped safely; inspect the recorded support code.',
        };
      await this.guard(envelope.identity, action);
      qaScan({ settings: envelope.settings }, this.deps.secrets);
      const result = QaOutputSchema.parse(await this.perform(action, envelope));
      qaScan(result, this.deps.secrets);
      return result;
    } catch (error) {
      const code =
        error instanceof QaFailure &&
        /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) &&
        !this.deps.secrets.some((secret) => secret.length > 0 && error.code.includes(secret))
          ? error.code
          : 'QA_INVALID_INPUT';
      if (action && authorityActions.has(action)) throw new QaFailure(code);
      return qaBlocked(code);
    }
  }
  private async exact(identity: QaIdentity): Promise<GithubIssue> {
    await this.deps.history.verify(identity);
    const pr = QaMergedPrSchema.parse(
      await this.deps.github.pullRequest(identity.repository, identity.pullRequest),
    );
    const linked = await this.deps.github.linkedIssues(identity.repository, identity.pullRequest);
    if (
      pr.number !== identity.pullRequest ||
      !pr.merged ||
      pr.draft ||
      pr.state !== 'closed' ||
      pr.merge_commit_sha !== identity.mergeSha ||
      pr.head.repo.full_name.toLowerCase() !== identity.repository ||
      pr.base.repo.full_name.toLowerCase() !== identity.repository ||
      linked.length !== 1 ||
      linked[0]?.repository.toLowerCase() !== identity.repository ||
      linked[0].number !== identity.issue
    )
      qaFail('QA_LINEAGE_REFUSED');
    const issue = IssueSchema.parse(
      await this.deps.github.issue(identity.repository, identity.issue),
    );
    if (
      issue.number !== identity.issue ||
      issue.pull_request ||
      issue.html_url.toLowerCase() !==
        'https://github.com/' + identity.repository + '/issues/' + identity.issue
    )
      qaFail('QA_LINEAGE_REFUSED');
    return issue;
  }
  private async perform(action: QaAction, envelope: QaEnvelope): Promise<QaOutput> {
    const { identity, settings, claim, input } = envelope;
    if (action === 'poll') qaFail('QA_POLL_ENTRY');
    const key = qaDigest({ nodeId: envelope.nodeId, visit: envelope.visit });
    if (action === 'claim') {
      await this.exact(identity);
      return ClaimRecordSchema.parse({
        type: 'ClaimRecord',
        repository: identity.repository,
        issue: identity.issue,
        attempt: identity.attempt,
      });
    }
    if (!claim) qaFail('QA_CLAIM_REQUIRED');
    const state = (await this.deps.journal.load(identity)) ?? QaStateSchema.parse({ identity });
    if (qaIdentityKey(state.identity) !== qaIdentityKey(identity)) qaFail('QA_JOURNAL_IDENTITY');
    const cached = state.results[key];
    if (cached) return cached;
    const save = async () => {
      await this.deps.journal.save(identity, state);
    };
    const issue = await this.exact(identity);
    const currentPr = QaMergedPrSchema.parse(
      await this.deps.github.pullRequest(identity.repository, identity.pullRequest),
    );
    if (settings.proofBranch === currentPr.head.ref) qaFail('QA_PROOF_BRANCH_REFUSED');
    let result: QaOutput;
    if (action === 'prepare') {
      if (state.prepared && state.preparedVisit !== key) qaFail('QA_PREPARE_CONSUMED');
      if (!state.prepared) {
        await this.guard(identity, 'checkout');
        const prepared = await this.deps.repository.prepare(identity, state.reruns);
        const depth =
          settings.fullRegressionLabel &&
          issue.labels.some((label) => label.name === settings.fullRegressionLabel)
            ? 'full-regression'
            : settings.depth;
        // Structural repository extras never enter signed state or model output.
        const pr = QaMergedPrSchema.parse(
          await this.deps.github.pullRequest(identity.repository, identity.pullRequest),
        );
        state.prepared = {
          cwd: prepared.cwd,
          artifactRoot: prepared.artifactRoot,
          scope: QaScopeSchema.parse({
            depth,
            touchedSystems: prepared.touchedSystems,
            applicationSystems: prepared.applicationSystems,
          }),
          originalIssue: QaOriginalIssueSchema.parse({
            number: issue.number,
            title: issue.title,
            body: issue.body,
          }),
          diff: prepared.diff,
          prBody: pr.body ?? '',
        };
        state.preparedVisit = key;
        qaScan(state.prepared, this.deps.secrets);
        await save();
      }
      const prepared = state.prepared;
      result = {
        type: 'QaWorkspace',
        repository: identity.repository,
        issue: identity.issue,
        attempt: identity.attempt,
        pullRequest: identity.pullRequest,
        mergeSha: identity.mergeSha,
        cwd: prepared.cwd,
        originalIssue: prepared.originalIssue,
        depth: prepared.scope.depth,
        diff: prepared.diff,
        prBody: prepared.prBody,
      };
    } else if (action === 'criteria-check') {
      if (!state.prepared) qaFail('QA_PREPARE_REQUIRED');
      if (state.criteria && state.criteriaVisit !== key) qaFail('QA_CRITERIA_CONSUMED');
      state.criteria ??= validateQaCriteria(input.lastOutput?.value, state.prepared.scope);
      state.criteriaVisit = key;
      qaScan(state.criteria, this.deps.secrets);
      result = { type: 'QaCriteria', value: state.criteria };
    } else if (action === 'proof-check') {
      if (!state.prepared || !state.criteria) qaFail('QA_CRITERIA_REQUIRED');
      await this.guard(identity, 'proof');
      state.snapshot ??= await this.deps.proofs.collect({
        identity,
        round: state.reruns,
        artifactRoot: state.prepared.artifactRoot,
        scope: state.prepared.scope,
        originalIssue: state.prepared.originalIssue,
        criteria: state.criteria,
        results: input.lastOutput?.value,
        secrets: this.deps.secrets,
      });
      state.snapshot = QaProofSnapshotSchema.parse(state.snapshot);
      if (
        qaIdentityKey(state.snapshot.identity) !== qaIdentityKey(identity) ||
        state.snapshot.digest !== qaDigest({ identity, packet: state.snapshot.packet })
      )
        qaFail('QA_PROOF_IDENTITY');
      await save();
      const commit = await this.publish(identity, settings, state, save);
      result = {
        type: 'QaProof',
        passed: state.snapshot.packet.results.results.every((row) => row.status === 'passed'),
        runId: identity.runId,
        mergeSha: identity.mergeSha,
        proofCommit: commit,
        links: [
          'https://github.com/' +
            identity.repository +
            '/blob/' +
            commit +
            '/qa/' +
            identity.runId +
            '/manifest.json',
        ],
      };
    } else if (action === 'evidence-prepare') {
      if (!state.snapshot || !state.proof?.published) qaFail('QA_PROOF_REQUIRED');
      await this.guard(identity, 'adversary');
      const evidence = await this.deps.proofs.evidence(state.snapshot, state.reruns);
      qaScan(evidence.packet, this.deps.secrets);
      // Packet is stored once in the signed snapshot; avoid caching large copies per visit.
      return { type: 'QaEvidence', evidence };
    } else if (action === 'adversary-check') {
      if (!state.snapshot || !state.proof?.published) qaFail('QA_PROOF_REQUIRED');
      state.adversary = QaAdversarySchema.parse(input.vars.adversary);
      qaScan(state.adversary, this.deps.secrets);
      if (
        state.adversary.gaps.some(
          (gap) =>
            gap.criterionId !== null &&
            !state.criteria?.criteria.some((criterion) => criterion.id === gap.criterionId),
        )
      )
        qaFail('QA_ADVERSARY_IDENTITY');
      const route = state.adversary.sound
        ? state.snapshot.packet.results.results.every((row) => row.status === 'passed')
          ? 'passed'
          : 'rework'
        : state.reruns < settings.limits.unsoundReruns
          ? 'rerun'
          : 'human';
      if (route === 'passed') state.outcome = 'passed';
      if (route === 'human') state.outcome = 'blocked';
      result = { type: 'QaNext', route };
    } else if (action === 'rerun-prepare') {
      if (
        !state.adversary ||
        state.adversary.sound ||
        state.reruns >= settings.limits.unsoundReruns
      )
        qaFail('QA_RERUN_EXHAUSTED');
      const gaps = state.adversary.gaps;
      state.reruns++;
      delete state.prepared;
      delete state.preparedVisit;
      delete state.criteria;
      delete state.criteriaVisit;
      delete state.snapshot;
      delete state.proof;
      delete state.adversary;
      result = { type: 'QaRerun', gaps };
    } else if (action === 'rework-status') {
      if (
        !state.adversary?.sound ||
        !state.snapshot ||
        state.snapshot.packet.results.results.every((row) => row.status === 'passed')
      )
        qaFail('QA_REWORK_REQUIRED');
      const budgets = budgetSchema.parse(await this.deps.history.budgets(identity));
      const eligible =
        budgets.requests === identity.attempt - 1 &&
        budgets.attempts === identity.attempt &&
        budgets.requests < settings.limits.reworkRequests &&
        budgets.attempts < 3 &&
        identity.attempt < 3 &&
        (issue.state === 'open' || budgets.reopenings < settings.limits.reopenings);
      if (!eligible) state.outcome = 'blocked';
      result = { type: 'QaReworkEligibility', eligible, requiresReopen: issue.state === 'closed' };
    } else if (action === 'qa-rework') {
      if (
        !state.adversary?.sound ||
        !state.snapshot ||
        state.snapshot.packet.results.results.every((row) => row.status === 'passed')
      )
        qaFail('QA_REWORK_REQUIRED');
      await this.guard(identity, 'rework');
      state.reservation ??= {
        key,
        request: null,
        requiresReopen: null,
        reopen: 'none',
        relabel: 'none',
      };
      await save();
      if (state.reservation.key !== key) qaFail('QA_REWORK_CONSUMED');
      if (state.reservation.request === null) {
        // Admission uniquely owns owner/repository/issue/attempt across merge SHAs/instances.
        // This read-only callback must verify that exact admitted owner and prior signed facts.
        const budgets = budgetSchema.parse(await this.deps.history.budgets(identity));
        if (
          identity.attempt >= 3 ||
          budgets.attempts !== identity.attempt ||
          budgets.requests !== identity.attempt - 1 ||
          budgets.requests >= settings.limits.reworkRequests ||
          (issue.state === 'closed' && budgets.reopenings >= settings.limits.reopenings)
        )
          qaFail('QA_REWORK_EXHAUSTED');
        state.reservation.request = identity.attempt;
        state.reservation.requiresReopen = issue.state === 'closed';
        await save();
      }
      result = QaReworkRequestSchema.parse({
        type: 'ReworkRequest',
        repository: identity.repository,
        issue: identity.issue,
        attempt: identity.attempt,
        pullRequest: identity.pullRequest,
        mergeSha: identity.mergeSha,
        request: state.reservation.request,
      });
    } else if (action === 'issue-reopened') {
      const reservation = state.reservation;
      if (!reservation?.request || reservation.requiresReopen !== true)
        qaFail('QA_REOPEN_REQUIRED');
      if (reservation.reopen === 'intent') qaFail('QA_REOPEN_UNCERTAIN');
      if (reservation.reopen !== 'complete') {
        if (issue.state !== 'closed') qaFail('QA_REOPEN_TRANSITION');
        reservation.reopen = 'intent';
        await save();
        await this.guard(identity, 'reopen');
        await this.deps.github.reopen(identity.repository, identity.issue);
        if ((await this.deps.github.issue(identity.repository, identity.issue)).state !== 'open')
          qaFail('QA_REOPEN_UNCERTAIN');
        reservation.reopen = 'complete';
        await save();
      }
      result = IssueReopenedSchema.parse({
        type: 'IssueReopened',
        repository: identity.repository,
        issue: identity.issue,
        attempt: identity.attempt,
        pullRequest: identity.pullRequest,
        mergeSha: identity.mergeSha,
        request: reservation.request,
      });
    } else if (action === 'relabel') {
      const reservation = state.reservation;
      if (
        !reservation?.request ||
        (reservation.requiresReopen && reservation.reopen !== 'complete') ||
        issue.state !== 'open'
      )
        qaFail('QA_REWORK_REQUIRED');
      if (reservation.relabel !== 'complete') {
        if (
          reservation.relabel === 'intent' &&
          !issue.labels.some((label) => label.name === settings.triggerLabel)
        )
          qaFail('QA_LABEL_UNCERTAIN');
        if (reservation.relabel === 'none') {
          reservation.relabel = 'intent';
          await save();
          await this.guard(identity, 'relabel');
          await this.deps.github.label(
            identity.repository,
            identity.issue,
            [settings.triggerLabel],
            [],
          );
        }
        reservation.relabel = 'complete';
        state.outcome = 'rework';
        await save();
      }
      result = { type: 'QaRelabeled' };
    } else if (action === 'human') {
      state.outcome = 'blocked';
      await this.report(identity, state, key, save);
      result = { type: 'QaHumanRequired', code: 'QA_HUMAN_REQUIRED', message: fixedHuman };
    } else if (action === 'qa-outcome') {
      if (!state.outcome || input.vars.outcome !== state.outcome) qaFail('QA_OUTCOME_AUTHORITY');
      if (state.outcome === 'rework' && state.reservation?.relabel !== 'complete')
        qaFail('QA_OUTCOME_AUTHORITY');
      result = QaOutcomeSchema.parse({
        type: 'QaOutcome',
        repository: identity.repository,
        issue: identity.issue,
        attempt: identity.attempt,
        pullRequest: identity.pullRequest,
        mergeSha: identity.mergeSha,
        outcome: state.outcome,
      });
    } else qaFail('QA_ACTION_REFUSED');
    // Large criteria/workspace records are already stored as checked state.
    if (action !== 'prepare' && action !== 'criteria-check') state.results[key] = result;
    await save();
    return result;
  }
  private async publish(
    identity: QaIdentity,
    settings: QaTemplateSettings,
    state: QaState,
    save: () => Promise<void>,
  ): Promise<string> {
    const snapshot = state.snapshot!;
    state.proof ??= {
      key: qaDigest({ identity, round: state.reruns, digest: snapshot.digest }),
      parent: await this.deps.repository.remoteHead(settings.proofBranch),
      commit: null,
      pushes: 0,
      pushStarted: false,
      published: false,
      uncertain: false,
    };
    await save();
    const proof = state.proof;
    if (proof.published && proof.commit) return proof.commit;
    if (proof.pushStarted && proof.commit) {
      const remote = await this.deps.repository.remoteHead(settings.proofBranch);
      if (
        remote &&
        (await this.deps.repository.containsProof(remote, proof.commit, snapshot.digest))
      ) {
        proof.published = true;
        proof.uncertain = false;
        await save();
        return proof.commit;
      }
      if (proof.uncertain) qaFail('QA_PUSH_UNCERTAIN');
    }
    while (proof.pushes < settings.limits.proofPushRetries) {
      await this.guard(identity, 'proof-push');
      proof.commit ??= ShaSchema.parse(
        await this.deps.repository.stageProof(
          identity,
          snapshot,
          settings.proofBranch,
          proof.parent,
          proof.key + ':' + proof.pushes,
        ),
      );
      await save();
      proof.pushes++;
      proof.pushStarted = true;
      proof.uncertain = true;
      await save();
      const status = await this.deps.repository.pushProof(
        settings.proofBranch,
        proof.commit,
        proof.parent,
      );
      if (status === 'conflict') {
        proof.parent = await this.deps.repository.remoteHead(settings.proofBranch);
        proof.commit = null;
        proof.pushStarted = false;
        proof.uncertain = false;
        await save();
        continue;
      }
      const remote = await this.deps.repository.remoteHead(settings.proofBranch);
      if (
        !remote ||
        !(await this.deps.repository.containsProof(remote, proof.commit, snapshot.digest))
      )
        qaFail('QA_PUSH_UNCERTAIN');
      proof.published = true;
      proof.uncertain = false;
      await save();
      return proof.commit;
    }
    qaFail('QA_PUSH_EXHAUSTED');
  }
  private async report(
    identity: QaIdentity,
    state: QaState,
    key: string,
    save: () => Promise<void>,
  ): Promise<void> {
    const marker = '<!-- graphgoblin-qa:' + qaDigest({ identity, key, kind: 'human' }) + ' -->';
    state.report ??= { key, started: false, complete: false };
    if (state.report.key !== key) qaFail('QA_REPORT_IDENTITY');
    if (state.report.complete) return;
    const comments = await this.deps.github.comments(identity.repository, identity.issue, 100);
    if (
      comments.length >= 100 ||
      comments.filter((comment) => comment.body.includes(marker)).length > 1
    )
      qaFail('QA_COMMENT_BOUND');
    if (comments.some((comment) => comment.body.includes(marker))) {
      state.report.complete = true;
      await save();
      return;
    }
    if (state.report.started) qaFail('QA_COMMENT_UNCERTAIN');
    state.report.started = true;
    await save();
    await this.guard(identity, 'report');
    await this.deps.github.post(identity.repository, identity.issue, marker + '\n' + fixedHuman);
    state.report.complete = true;
    await save();
  }
}
