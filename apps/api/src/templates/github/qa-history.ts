import { join } from 'node:path';
import { QaTemplateSettingsSchema } from '@graphgoblin/contracts';
import { TemplateBindingSchema, type TemplateBinding } from '../binding.js';
import { readAuthority, assertSubjectSource } from '../authority.js';
import { sameSubject, type ParentSubject } from '../subjects.js';
import type { TemplateInstances } from '../instances.js';
import { TemplateError } from '../errors.js';
import { QaIdentitySchema, type QaIdentity } from './qa-protocol.js';
import { QaHistorySnapshotSchema } from './qa-envelope.js';
import { SignedQaJournal } from './qa-journal.js';
import { nativeQaMetadata, type QaMetadataFactory } from './qa-native.js';
import { ImplementationRepository } from './repository.js';

function refused(): never {
  throw new TemplateError(
    'TEMPLATE_AUTHORITY_REFUSED',
    'Authenticated QA history is unavailable or uncertain. Manual reconciliation is required.',
  );
}
export function admittedQaIdentity(
  binding: TemplateBinding,
  runId: string,
  subject: ParentSubject,
): QaIdentity {
  if (binding.manifest.kind !== 'qa' || subject.kind !== 'qa' || subject.role !== 'parent')
    return refused();
  return QaIdentitySchema.parse({
    ownerId: binding.ownerId,
    runId,
    repository: subject.repository,
    issue: subject.issue,
    attempt: subject.attempt,
    pullRequest: subject.pullRequest,
    mergeSha: subject.mergeSha,
    source: subject.source,
  });
}
/** Read-only API composition: no mutable thread authority and no reservation/write endpoint. */
export class QaHistory {
  constructor(
    private readonly instances: Pick<TemplateInstances, 'store'>,
    private readonly credential: (binding: TemplateBinding) => Promise<string>,
    private readonly metadata: QaMetadataFactory = nativeQaMetadata,
  ) {}
  async snapshot(binding: TemplateBinding, runId: string) {
    const current = await readAuthority(this.instances.store, binding, runId);
    if (
      current.subject.role !== 'parent' ||
      !['running', 'waiting', 'paused'].includes(current.run.status)
    )
      return refused();
    const identity = admittedQaIdentity(binding, runId, current.subject);
    await assertSubjectSource(this.instances.store, binding, current.subject);
    const rows = await this.instances.store.subjectRuns({
      ownerId: binding.ownerId,
      repository: identity.repository,
      issue: identity.issue,
      parentRunId: null,
      limit: 65,
    });
    if (rows.length > 64) return refused();
    const requests = new Set<number>(),
      reopened = new Set<number>();
    let own = 0;
    for (const row of rows) {
      const stored = await this.instances.store.bindingForLoop(binding.ownerId, row.run.loopId);
      if (!stored) return refused();
      const priorBinding = TemplateBindingSchema.parse(stored.binding),
        authority = await readAuthority(this.instances.store, priorBinding, row.run.id);
      if (authority.subject.role !== 'parent') return refused();
      if (row.run.id === runId) {
        if (!sameSubject(authority.subject, current.subject)) return refused();
        own++;
        continue;
      }
      if (authority.subject.attempt !== null && authority.subject.attempt > identity.attempt)
        return refused();
      if (authority.subject.kind !== 'qa') continue;
      if (authority.subject.source.kind === 'implementation') {
        await assertSubjectSource(this.instances.store, priorBinding, authority.subject);
      } else {
        // An authentic external original can precede later implementation attempts on this
        // issue. Its original PR must still have no contradictory implementation lineage.
        const originals = await this.instances.store.prFactCandidates(
          binding.ownerId,
          identity.repository,
          authority.subject.pullRequest!,
          65,
        );
        if (originals.length > 64) return refused();
        for (const original of originals) {
          const sourceBinding = await this.instances.store.bindingForLoop(
            binding.ownerId,
            original.run.loopId,
          );
          if (!sourceBinding) return refused();
          const source = await readAuthority(
            this.instances.store,
            TemplateBindingSchema.parse(sourceBinding.binding),
            original.run.id,
          );
          if (
            source.facts.some(
              (fact) =>
                fact.type === 'PrCreated' && fact.pullRequest === authority.subject.pullRequest,
            )
          )
            return refused();
        }
      }
      for (const fact of authority.facts) {
        if (fact.type !== 'ReworkRequest' && fact.type !== 'IssueReopened') continue;
        if (
          fact.attempt !== authority.subject.attempt ||
          fact.request !== fact.attempt ||
          fact.attempt >= identity.attempt ||
          fact.pullRequest !== authority.subject.pullRequest ||
          fact.mergeSha !== authority.subject.mergeSha
        )
          return refused();
        const set = fact.type === 'ReworkRequest' ? requests : reopened;
        if (set.has(fact.request)) return refused();
        set.add(fact.request);
      }
      const settings = QaTemplateSettingsSchema.parse(priorBinding.settings),
        deps = await this.metadata(settings);
      await new ImplementationRepository(settings, deps.commands, deps.files, deps.git).assert();
      // Claim/prerequisite-only runs have no controller journal. Any prepared run must have one.
      const prepared = authority.events.some(
        (event) => event.type === 'node.started' && event.nodeId === 'prepare',
      );
      const root = join(settings.repository.path, '.git', 'graphgoblin', 'qa');
      if (!(await deps.files.exists(root))) {
        if (prepared) return refused();
        continue;
      }
      const state = await new SignedQaJournal(
        deps.files,
        root,
        await this.credential(priorBinding),
      ).load(admittedQaIdentity(priorBinding, row.run.id, authority.subject));
      if (!state) {
        if (prepared) return refused();
        continue;
      }
      if (
        state.reservation &&
        !authority.events.some(
          (event) =>
            event.type === 'node.started' &&
            event.kind === 'script' &&
            state.reservation!.key === 'qa-rework:' + event.seq &&
            priorBinding.loops.find((loop) => loop.loopId === row.run.loopId)?.nodes[event.nodeId]
              ?.configHash === event.configHash &&
            event.nodeId === 'qa-rework',
        )
      )
        return refused();
      if (state.reservation?.reopen === 'intent') return refused();
      // A saved result can precede node.finished. Preserve that consumption without inventing a fact.
      if (state.reservation?.request !== null && state.reservation?.request !== undefined) {
        const ordinal = state.reservation.request;
        if (ordinal !== authority.subject.attempt || ordinal >= identity.attempt) return refused();
        requests.add(ordinal);
        if (state.reservation.reopen === 'complete') reopened.add(ordinal);
      }
    }
    if (
      own !== 1 ||
      reopened.size > requests.size ||
      [...reopened].some((value) => !requests.has(value)) ||
      requests.size !== identity.attempt - 1 ||
      [...requests].some((value) => value < 1 || value >= identity.attempt)
    )
      return refused();
    return QaHistorySnapshotSchema.parse({
      identity,
      requests: requests.size,
      reopenings: reopened.size,
      attempts: identity.attempt,
    });
  }
}
