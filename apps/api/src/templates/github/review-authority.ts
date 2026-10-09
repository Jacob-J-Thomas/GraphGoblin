import { z } from 'zod';
import { ReviewTemplateSettingsSchema } from '@graphgoblin/contracts';
import type { TemplateBinding } from '../binding.js';
import { TemplateBindingSchema } from '../binding.js';
import { assertClaim, FixerHeadSchema, checkedEvents, readAuthority } from '../authority.js';
import { parseSubject, sameSubject, type ParentSubject } from '../subjects.js';
import type { TemplateInstances } from '../instances.js';
import { TemplateError } from '../errors.js';
import { unavailableTemplateAuthority, type TemplateAuthoritySource } from '../runtime.js';
import { trustedReviewPr } from './review-client.js';
import { ImplementationRepository } from './repository.js';
import { SignedReviewJournal, type ReviewJournal } from './review-storage.js';
import { nativeReviewDependencies, type ReviewDependenciesFactory } from './review.js';

const refuse = (): never => {
  throw new TemplateError(
    'TEMPLATE_AUTHORITY_REFUSED',
    'The current review subject or authenticated recovery intent is unavailable. Reconcile the PR manually.',
  );
};
export class ReviewAuthority implements TemplateAuthoritySource {
  constructor(
    private readonly instances: Pick<TemplateInstances, 'store'>,
    private readonly dependencies: ReviewDependenciesFactory = nativeReviewDependencies,
    private readonly credential: (binding: TemplateBinding) => Promise<string> = () =>
      Promise.reject(new Error('Private support credential unavailable.')),
  ) {}
  async resolve(binding: TemplateBinding, payload: unknown) {
    if (binding.manifest.id !== 'review' || binding.manifest.kind !== 'review')
      return unavailableTemplateAuthority.resolve(binding, payload);
    const settings = ReviewTemplateSettingsSchema.parse(binding.settings);
    const manual = z.strictObject({
      pullRequest: z.number().int().positive(),
      head: z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .optional(),
    });
    const candidate = z
      .strictObject({
        id: z.number().int().positive(),
        payload: z.strictObject({
          pullRequest: z.number().int().positive(),
          head: z.string().regex(/^[a-f0-9]{40}$/),
        }),
      })
      .refine((item) => item.id === item.payload.pullRequest);
    const selector = z.union([manual, candidate]).safeParse(payload);
    if (!selector.success) return refuse();
    const selected = 'payload' in selector.data ? selector.data.payload : selector.data;
    const deps = await this.dependencies(settings);
    await new ImplementationRepository(
      settings,
      deps.commands,
      deps.files,
      deps.git,
      'review',
    ).assert();
    const current = await trustedReviewPr(deps.github, settings, selected.pullRequest);
    if (selected.head && selected.head !== current.pr.head.sha) return refuse();
    const repository = (settings.repository.owner + '/' + settings.repository.name).toLowerCase();
    const candidates = await this.instances.store.prFactCandidates(
      binding.ownerId,
      repository,
      selected.pullRequest,
      65,
    );
    if (candidates.length > 64) return refuse();
    const facts = [];
    for (const row of candidates) {
      if (!row.subject) return refuse();
      const subject = parseSubject(row.subject);
      if (subject.role !== 'parent' || subject.kind !== 'implementation') return refuse();
      const stored = await this.instances.store.bindingForLoop(binding.ownerId, row.run.loopId);
      if (!stored) return refuse();
      const source = await readAuthority(
        this.instances.store,
        TemplateBindingSchema.parse(stored.binding),
        row.run.id,
      );
      for (const fact of source.facts)
        if (fact.type === 'PrCreated' && fact.pullRequest === selected.pullRequest)
          facts.push({ fact, runId: row.run.id });
    }
    if (facts.length > 1) return refuse();
    const original = facts[0];
    if (original && original.fact.issue !== current.issue) return refuse();
    return {
      kind: 'review' as const,
      repository,
      issue: current.issue,
      pullRequest: selected.pullRequest,
      head: current.pr.head.sha,
      attempt: original ? original.fact.attempt : current.issue === null ? null : 1,
      source: original
        ? { kind: 'implementation' as const, runId: original.runId }
        : { kind: 'external' as const },
    };
  }
  private journalHeads(
    binding: TemplateBinding,
    history: Awaited<ReturnType<typeof readAuthority>>,
    state: ReviewJournal,
  ): Set<string> {
    const subject = history.subject;
    if (
      history.run.ownerId !== binding.ownerId ||
      subject.role !== 'parent' ||
      subject.kind !== 'review' ||
      subject.instanceId !== binding.instanceId ||
      !subject.head ||
      !subject.pullRequest
    )
      return refuse();
    assertClaim(history.facts, subject);
    const mapped = binding.loops.find((loop) => loop.loopId === history.run.loopId)?.nodes[
      'fixer-head'
    ];
    const visit = (seq: number) =>
      history.events.some(
        (event) =>
          event.type === 'node.started' &&
          event.seq === seq &&
          event.nodeId === 'fixer-head' &&
          event.kind === 'script' &&
          mapped?.kind === 'script' &&
          event.configHash === mapped.configHash,
      );
    const heads = new Set([subject.head]);
    for (const [key, value] of Object.entries(state.results)) {
      if (!key.startsWith('fixer-head:')) continue;
      const seq = /^fixer-head:([1-9][0-9]*)$/.exec(key)?.[1],
        fact = FixerHeadSchema.safeParse(value);
      if (
        !seq ||
        !visit(Number(seq)) ||
        !fact.success ||
        fact.data.repository !== subject.repository ||
        fact.data.pullRequest !== subject.pullRequest ||
        fact.data.issue !== subject.issue ||
        fact.data.attempt !== subject.attempt
      )
        return refuse();
      heads.add(fact.data.head);
    }
    if (!heads.has(state.head)) return refuse();
    if (state.push) {
      if (
        !visit(state.push.visit) ||
        state.push.parent !== state.head ||
        state.push.ref !== state.ref ||
        state.push.head === state.push.parent
      )
        return refuse();
      heads.add(state.push.head);
    }
    return heads;
  }
  async consumesReviewHead(
    binding: TemplateBinding,
    history: Awaited<ReturnType<typeof readAuthority>>,
    head: string,
  ): Promise<boolean> {
    if (
      binding.manifest.id !== 'review' ||
      binding.manifest.kind !== 'review' ||
      history.subject.role !== 'parent' ||
      history.subject.kind !== 'review'
    )
      return refuse();
    if (
      !history.events.some(
        (event) => event.type === 'node.started' && event.nodeId === 'fixer-head',
      )
    )
      return false;
    const settings = ReviewTemplateSettingsSchema.parse(binding.settings),
      deps = await this.dependencies(settings),
      repo = new ImplementationRepository(settings, deps.commands, deps.files, deps.git, 'review'),
      subject = history.subject;
    try {
      const state = await new SignedReviewJournal(deps.files, await this.credential(binding), {
        ownerId: binding.ownerId,
        runId: history.run.id,
        repository: subject.repository,
        pullRequest: subject.pullRequest!,
        originalHead: subject.head!,
        issue: subject.issue,
        attempt: subject.attempt,
      }).load(repo.journal(history.run.id));
      if (
        !state ||
        state.cwd !== repo.workspace(history.run.id) ||
        state.branch !== 'graphgoblin/review-' + subject.pullRequest + '-' + history.run.id
      )
        return refuse();
      return this.journalHeads(binding, history, state).has(head);
    } catch {
      return refuse();
    }
  }
  async recheck(binding: TemplateBinding, subject: ParentSubject): Promise<void> {
    if (binding.manifest.id !== 'review' || binding.manifest.kind !== 'review')
      return unavailableTemplateAuthority.recheck(binding, subject);
    if (subject.kind !== 'review' || !subject.pullRequest || !subject.head) return refuse();
    const settings = ReviewTemplateSettingsSchema.parse(binding.settings),
      deps = await this.dependencies(settings);
    const repo = new ImplementationRepository(
      settings,
      deps.commands,
      deps.files,
      deps.git,
      'review',
    );
    await repo.assert();
    const current = await trustedReviewPr(deps.github, settings, subject.pullRequest, true);
    if (current.issue !== subject.issue) return refuse();
    const rows = await this.instances.store.subjectRuns({
      ownerId: binding.ownerId,
      repository: subject.repository,
      pullRequest: subject.pullRequest,
      limit: 65,
    });
    if (rows.length > 64) return refuse();
    const own = rows.filter(
      (row) =>
        row.subject &&
        parseSubject(row.subject).role === 'parent' &&
        parseSubject(row.subject).instanceId === binding.instanceId &&
        sameSubject(parseSubject(row.subject), subject),
    );
    if (own.length !== 1) return refuse();
    const row = own[0]!,
      events = checkedEvents(await this.instances.store.events(row.run.id));
    const identity = {
      ownerId: binding.ownerId,
      runId: row.run.id,
      repository: subject.repository,
      pullRequest: subject.pullRequest,
      originalHead: subject.head,
      issue: subject.issue,
      attempt: subject.attempt,
    };
    const content = await deps.files.read(repo.journal(row.run.id));
    if (content === undefined) {
      if (current.pr.state !== 'open' || current.pr.head.sha !== subject.head) return refuse();
      return;
    }
    const state = await new SignedReviewJournal(
      deps.files,
      await this.credential(binding),
      identity,
    ).load(repo.journal(row.run.id));
    if (
      !state ||
      state.cwd !== repo.workspace(row.run.id) ||
      state.ref !== current.pr.head.ref ||
      state.branch !== 'graphgoblin/review-' + subject.pullRequest + '-' + row.run.id
    )
      return refuse();
    const mapped = binding.loops.find((loop) => loop.loopId === row.run.loopId);
    const started = (nodeId: string) =>
      events.some(
        (event) =>
          event.type === 'node.started' &&
          event.nodeId === nodeId &&
          event.kind === 'script' &&
          event.configHash === mapped?.nodes[nodeId]?.configHash,
      );
    if (current.pr.state !== 'open') {
      if (
        current.pr.merged &&
        state.merge &&
        started('merge') &&
        state.merge.head === current.pr.head.sha &&
        current.pr.merge_commit_sha
      )
        return;
      if (
        !current.pr.merged &&
        state.close &&
        started('close') &&
        state.close.head === current.pr.head.sha
      )
        return;
      return refuse();
    }
    if (current.pr.head.sha === subject.head) return;
    const authority = await readAuthority(this.instances.store, binding, row.run.id);
    if (
      authority.facts.some(
        (fact) =>
          fact.type === 'FixerHead' &&
          fact.pullRequest === subject.pullRequest &&
          fact.head === current.pr.head.sha &&
          fact.issue === subject.issue &&
          fact.attempt === subject.attempt,
      )
    ) {
      if (state.head !== current.pr.head.sha) return refuse();
      return;
    }
    // A remote push may commit before its response or node.finished. Only the signed intent,
    // tied to the installed deterministic action, permits its same-run reconciliation.
    if (
      state.push &&
      events.some(
        (event) =>
          event.type === 'node.started' &&
          event.seq === state.push?.visit &&
          event.nodeId === 'fixer-head' &&
          event.kind === 'script' &&
          event.configHash === mapped?.nodes['fixer-head']?.configHash,
      ) &&
      current.pr.head.sha === state.push.head &&
      state.push.parent === state.head &&
      (await repo.head(state.cwd)) === state.push.head &&
      !(await repo.git(['status', '--porcelain', '--untracked-files=all'], state.cwd)) &&
      (await repo.remoteHead(state.push.ref)) === state.push.head
    )
      return;
    // An authenticated result saved before node.finished also closes the commit/link gap.
    if (
      state.head === current.pr.head.sha &&
      this.journalHeads(binding, authority, state).has(current.pr.head.sha)
    )
      return;
    return refuse();
  }
}
