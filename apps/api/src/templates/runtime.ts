import {
  EngineRequestError,
  RunFailureError,
  type EngineSettings,
  type RunAdmission,
  type RunRecordChanges,
  type TriggerAdmissionPort,
} from '@graphgoblin/engine';
import { type RunRecord } from '@graphgoblin/contracts';
import { stableHash } from '@graphgoblin/domain';
import type {
  AdmissionPolicyResult,
  TemplateTransaction,
} from '@graphgoblin/infrastructure/sqlite';
import { TemplateBindingSchema, assertBoundVersion, type TemplateBinding } from './binding.js';
import {
  assertClaim,
  assertSubjectSource,
  assertPinnedBundle,
  checkedEvents,
  nextAttempt,
  readAuthority,
} from './authority.js';
import {
  ParentSubjectSchema,
  parseSubject,
  sameSubject,
  subjectJson,
  type ParentSubject,
} from './subjects.js';
import { TemplateError } from './errors.js';
import type { TemplateInstances } from './instances.js';

export type TemplateAuthoritySelection = Omit<
  ParentSubject,
  'role' | 'instanceId' | 'templateVersion' | 'source' | 'attempt'
> &
  (
    | { kind: 'implementation'; issue: number; source?: never; attempt?: never }
    | { kind: 'review' | 'qa'; source: ParentSubject['source']; attempt: number | null }
  );
export interface TemplateAuthoritySource {
  /** Trusted repository eligibility; authored payload is only a selector, never authority. */
  resolve(binding: TemplateBinding, payload: unknown): Promise<TemplateAuthoritySelection>;
  recheck(binding: TemplateBinding, subject: ParentSubject): Promise<void>;
}
export interface TemplateFailureReporter {
  report(
    binding: TemplateBinding,
    run: RunRecord,
    subject: ParentSubject,
    code: string,
  ): Promise<void>;
}
/** Production repository authority stays closed until verified packaged support is registered. */
export const unavailableTemplateAuthority: TemplateAuthoritySource = {
  resolve: () =>
    Promise.reject(
      new TemplateError(
        'TEMPLATE_AUTHORITY_UNAVAILABLE',
        'Repository template authority support is not installed.',
      ),
    ),
  recheck: () =>
    Promise.reject(
      new TemplateError(
        'TEMPLATE_AUTHORITY_UNAVAILABLE',
        'Repository template authority support is not installed.',
      ),
    ),
};
const repairable = new Set(['role', 'secret', 'repository', 'github', 'support']);
const active = new Set(['queued', 'running', 'waiting', 'paused']);
export class TemplateRuntime {
  private readonly prepared = new Map<string, ParentSubject>();
  constructor(
    readonly instances: TemplateInstances,
    private readonly authority: TemplateAuthoritySource = unavailableTemplateAuthority,
    private readonly reporter?: TemplateFailureReporter,
  ) {}
  private async bound(
    ownerId: string,
    loopId: string,
    versionId: string,
    store: TemplateTransaction = this.instances.store,
  ) {
    const stored = await store.bindingForLoop(ownerId, loopId);
    if (!stored) return undefined;
    const binding = TemplateBindingSchema.parse(stored.binding);
    const version = await store.version(versionId);
    if (!version)
      throw new TemplateError(
        'TEMPLATE_BINDING_CHANGED',
        'The immutable template version is missing.',
      );
    if (version.loopId !== loopId)
      throw new TemplateError(
        'TEMPLATE_BINDING_CHANGED',
        'The selected version belongs to another loop.',
      );
    if (binding.manifest.kind !== 'starter')
      assertBoundVersion(binding, loopId, versionId, version.definition);
    return { binding, version, instance: stored.instance };
  }
  async prepare(input: RunAdmission): Promise<void> {
    const bound = await this.bound(input.run.ownerId, input.run.loopId, input.run.versionId);
    if (!bound || bound.binding.manifest.kind === 'starter') return;
    if (input.initialThread.invocation.replayOf)
      throw new TemplateError(
        'TEMPLATE_AUTHORITY_REFUSED',
        'Replay cannot grant template authority.',
      );
    if (input.run.loopId !== bound.instance.parentLoopId) return;
    if (input.run.parentRunId || input.initialThread.invocation.source === 'subloop')
      throw new TemplateError(
        'TEMPLATE_AUTHORITY_REFUSED',
        'A template parent cannot inherit worker authority.',
      );
    const prior = await this.instances.store.run(input.run.id);
    if (prior?.subject) {
      const subject = parseSubject(prior.subject);
      if (subject.role !== 'parent')
        throw new TemplateError('AUTHORITY_CONFLICT', 'The saved parent authority is invalid.');
      this.prepared.set(input.run.id, subject);
      return;
    }
    const selected = await this.authority.resolve(
      bound.binding,
      input.initialThread.invocation.trigger.payload,
    );
    const parsed = ParentSubjectSchema.safeParse({
      ...selected,
      role: 'parent',
      instanceId: bound.instance.id,
      templateVersion: bound.binding.manifest.version,
      ...(selected.kind === 'implementation'
        ? { attempt: 1, source: { kind: 'implementation', runId: input.run.id } }
        : {}),
    });
    if (!parsed.success)
      throw new TemplateError(
        'AUTHORITY_CONFLICT',
        'Trusted repository discovery did not identify one valid original subject. QA requires exactly one same-repository linked issue.',
      );
    const subject = parsed.data;
    if (
      subject.kind !== bound.binding.manifest.kind ||
      !('repository' in bound.binding.settings) ||
      subject.repository !==
        (
          bound.binding.settings.repository.owner +
          '/' +
          bound.binding.settings.repository.name
        ).toLowerCase()
    )
      throw new TemplateError(
        'AUTHORITY_CONFLICT',
        'The selected repository subject does not match the immutable binding.',
      );
    this.prepared.set(input.run.id, subject);
  }
  release(runId: string) {
    this.prepared.delete(runId);
  }
  async afterRunStaged(
    store: TemplateTransaction,
    input: RunAdmission,
    pollItem: boolean,
  ): Promise<AdmissionPolicyResult> {
    const bound = await this.bound(input.run.ownerId, input.run.loopId, input.run.versionId, store);
    if (!bound || bound.binding.manifest.kind === 'starter') return { action: 'keep' };
    const { binding, instance } = bound;
    if (input.run.loopId !== instance.parentLoopId) {
      const invocation = input.initialThread.invocation;
      if (
        invocation.source !== 'subloop' ||
        invocation.caller?.kind !== 'run' ||
        !input.run.parentRunId ||
        invocation.caller.id !== input.run.parentRunId ||
        invocation.replayOf
      )
        throw new TemplateError(
          'TEMPLATE_AUTHORITY_REFUSED',
          'A worker requires its trusted active parent visit.',
        );
      const parent = await readAuthority(store, binding, input.run.parentRunId);
      if (
        parent.subject.role !== 'parent' ||
        !active.has(parent.run.status) ||
        parent.run.loopId !== instance.parentLoopId
      )
        throw new TemplateError('TEMPLATE_AUTHORITY_REFUSED', 'The worker parent is not active.');
      assertClaim(parent.facts, parent.subject);
      const parentVersion = await store.version(parent.run.versionId);
      const node = parentVersion?.definition.nodes.find(
        (item) => item.id === parent.run.currentNodeId,
      );
      if (!node || node.kind !== 'subloop')
        throw new TemplateError(
          'TEMPLATE_AUTHORITY_REFUSED',
          'The current parent node is not the mapped subloop.',
        );
      const mapped = binding.manifest.loops
        .find((loop) => loop.key === binding.manifest.parentKey)
        ?.subloops.find((item) => item.nodeId === node.id);
      const child = instance.loops.find((loop) => loop.key === mapped?.loopKey);
      if (
        !child ||
        child.loopId !== input.run.loopId ||
        child.versionId !== input.run.versionId ||
        node.config.loopRef.loopId !== child.loopId ||
        node.config.loopRef.version !== child.version
      )
        throw new TemplateError(
          'TEMPLATE_AUTHORITY_REFUSED',
          'The worker target does not match the frozen numeric pin.',
        );
      let visit: number | undefined;
      for (const event of parent.events) {
        if (!('nodeId' in event) || event.nodeId !== node.id) continue;
        if (event.type === 'node.finished') visit = undefined;
        if (event.type === 'node.started') {
          if (event.kind !== 'subloop' || event.configHash !== stableHash(node.config))
            throw new TemplateError(
              'AUTHORITY_CONFLICT',
              'The parent visit configuration has changed.',
            );
          visit ??= event.seq;
        }
      }
      if (visit === undefined)
        throw new TemplateError(
          'TEMPLATE_AUTHORITY_REFUSED',
          'The parent has no unfinished mapped visit.',
        );
      const original = await store.originalChild(parent.run.id, node.id, visit);
      if (original) return { action: 'replace', run: original };
      await store.setSubject(
        input.run.id,
        subjectJson({
          ...parent.subject,
          role: 'worker',
          parentRunId: parent.run.id,
          nodeId: node.id,
          visit,
        }),
      );
      return { action: 'keep' };
    }
    let subject = this.prepared.get(input.run.id);
    if (!subject)
      throw new TemplateError(
        'TEMPLATE_AUTHORITY_REFUSED',
        'The parent subject has not passed trusted admission.',
      );
    const current = await store.run(input.run.id);
    if (current?.subject) {
      if (!sameSubject(subject, parseSubject(current.subject)))
        throw new TemplateError('AUTHORITY_CONFLICT', 'The saved subject has changed.');
      return { action: 'keep' };
    }
    if (subject.kind === 'implementation') {
      subject = { ...subject, attempt: await nextAttempt(store, binding, subject) };
      if (pollItem) {
        const expected = subject.repository + '#' + subject.issue + '@' + subject.attempt;
        const payload = input.initialThread.invocation.trigger.payload;
        if (
          !payload ||
          typeof payload !== 'object' ||
          Array.isArray(payload) ||
          payload['id'] !== expected ||
          input.initialThread.invocation.trigger.dedupeKey !== expected
        )
          throw new TemplateError(
            'TEMPLATE_AUTHORITY_REFUSED',
            'The selected poll candidate no longer matches the authenticated implementation attempt.',
          );
      }
    } else {
      await assertSubjectSource(store, binding, subject);
      if (pollItem && subject.kind === 'review') {
        const payload = input.initialThread.invocation.trigger.payload;
        const expected = String(subject.pullRequest) + ':' + subject.head;
        if (
          !payload ||
          typeof payload !== 'object' ||
          Array.isArray(payload) ||
          payload['id'] !== subject.pullRequest ||
          input.initialThread.invocation.trigger.dedupeKey !== expected
        )
          throw new TemplateError(
            'TEMPLATE_AUTHORITY_REFUSED',
            'The selected review poll candidate no longer matches the authenticated PR head.',
          );
      }
    }
    const rows = await store.subjectRuns({
      ownerId: input.run.ownerId,
      repository: subject.repository,
      ...(subject.kind === 'implementation'
        ? { issue: subject.issue! }
        : subject.kind === 'review'
          ? { pullRequest: subject.pullRequest! }
          : { mergeSha: subject.mergeSha! }),
      limit: 65,
    });
    // The admitted QA parent owns this attempt even if another merge or instance arrives.
    // This is permanent ownership, not a renewable lock or a new rework write API.
    const issueRows =
      subject.kind === 'qa'
        ? await store.subjectRuns({
            ownerId: input.run.ownerId,
            repository: subject.repository,
            issue: subject.issue!,
            limit: 65,
          })
        : [];
    if (rows.length > 64 || issueRows.length > 64)
      throw new TemplateError(
        'AUTHORITY_CONFLICT',
        'The selected subject history exceeds its bound.',
      );
    const history = new Map([...rows, ...issueRows].map((row) => [row.run.id, row]));
    let consumed = false;
    for (const row of history.values()) {
      if (!row.subject || row.run.id === input.run.id) continue;
      const old = parseSubject(row.subject);
      if (old.role !== 'parent') continue;
      if (subject.kind === 'implementation')
        consumed ||= old.kind === 'implementation' && old.attempt === subject.attempt;
      else if (subject.kind === 'qa')
        consumed ||=
          old.kind === 'qa' &&
          (old.mergeSha === subject.mergeSha ||
            (old.issue === subject.issue && old.attempt === subject.attempt));
      else if (old.kind === 'review') {
        consumed ||= old.head === subject.head || active.has(row.run.status);
        const stored = await store.bindingForLoop(binding.ownerId, row.run.loopId);
        if (!stored)
          throw new TemplateError(
            'AUTHORITY_CONFLICT',
            'The selected review has no immutable binding.',
          );
        const source = await readAuthority(
          store,
          TemplateBindingSchema.parse(stored.binding),
          row.run.id,
        );
        for (const fact of source.facts) {
          if (fact.type !== 'FixerHead') continue;
          if (fact.pullRequest !== old.pullRequest)
            throw new TemplateError(
              'AUTHORITY_CONFLICT',
              'The fixer head does not belong to the selected review PR.',
            );
          consumed ||= fact.head === subject.head;
        }
      }
    }
    if (consumed) {
      if (pollItem) return { action: 'skip' };
      throw new TemplateError(
        'TEMPLATE_SUBJECT_CONSUMED',
        'This template subject is permanently consumed or held by an active run.',
      );
    }
    await store.setSubject(input.run.id, subjectJson(subject));
    return { action: 'keep' };
  }
  async beforeTransition(
    store: TemplateTransaction,
    run: RunRecord,
    changes: RunRecordChanges,
  ): Promise<void> {
    if (run.status !== 'failed' || !changes.status || !active.has(changes.status)) return;
    await this.assertResume(run, store);
  }
  private async assertResume(
    run: RunRecord,
    store: TemplateTransaction = this.instances.store,
  ): Promise<void> {
    const bound = await this.bound(run.ownerId, run.loopId, run.versionId, store);
    if (!bound || bound.binding.manifest.kind === 'starter') return;
    const events = checkedEvents(await store.events(run.id));
    await assertPinnedBundle(store, bound.binding, run.loopId, events);
    const failureEvent = events.filter((event) => event.type === 'run.failed').at(-1);
    const details = run.failure?.details;
    const declaration =
      details && typeof details === 'object' && !Array.isArray(details)
        ? bound.binding.manifest.prerequisites.find(
            (item) => item.id === details['prerequisite'] && item.kind === details['kind'],
          )
        : undefined;
    if (
      !run.failure ||
      !run.failure.resumable ||
      run.failure.code !== 'TEMPLATE_PREREQUISITE_UNAVAILABLE' ||
      !declaration ||
      !repairable.has(declaration.kind) ||
      !failureEvent ||
      stableHash(failureEvent.failure) !== stableHash(run.failure) ||
      events.some((event) => event.type === 'node.started')
    )
      throw new EngineRequestError(
        'INVALID_STATE',
        'This template failure requires manual recovery; resume cannot grant another attempt.',
      );
    const row = await store.run(run.id);
    if (!row?.subject || parseSubject(row.subject).role !== 'parent')
      throw new EngineRequestError('INVALID_STATE', 'The immutable parent subject is missing.');
  }
  readonly hooks: Pick<EngineSettings, 'beforeExecute' | 'beforeResume'> = {
    beforeResume: async ({ run }) => this.assertResume(run),
    beforeExecute: async ({ run, events }) => {
      let bound;
      try {
        bound = await this.bound(run.ownerId, run.loopId, run.versionId);
      } catch {
        throw new RunFailureError(
          'TEMPLATE_BINDING_CHANGED',
          'The immutable template binding has changed; instantiate a new template.',
          { resumable: false },
        );
      }
      if (!bound) return;
      const progressed = events.some((event) => event.type === 'node.started');
      const report =
        bound.binding.manifest.kind === 'starter'
          ? await this.instances.prerequisites.checkCurrentRoles(
              run.ownerId,
              bound.version.definition,
              bound.binding.manifest.prerequisites.find((item) => item.kind === 'role')?.id ??
                'roles',
            )
          : await this.instances.prerequisites.check(
              run.ownerId,
              bound.binding.manifest,
              bound.binding.settings,
            );
      if (!report.canRun) {
        const missing = report.checks.find((check) => check.status !== 'ok')!;
        const declaration = bound.binding.manifest.prerequisites.find(
          (item) => item.id === missing.id,
        );
        const kind = declaration?.kind ?? 'role';
        const code =
          kind === 'isolation'
            ? 'TEMPLATE_ISOLATION_UNAVAILABLE'
            : 'TEMPLATE_PREREQUISITE_UNAVAILABLE';
        if (progressed && bound.binding.manifest.kind !== 'starter')
          throw new RunFailureError(
            code,
            'A prerequisite is unavailable after workflow execution began. Earlier effects may have occurred; manual recovery is required.',
            { resumable: false, details: { prerequisite: missing.id, kind } },
          );
        const row = await this.instances.store.run(run.id);
        if (bound.binding.manifest.kind !== 'starter') {
          const subject = row?.subject ? parseSubject(row.subject) : undefined;
          if (!subject || subject.role !== 'parent' || !this.reporter)
            throw new RunFailureError(
              'TEMPLATE_REPORT_UNAVAILABLE',
              'Trusted failure reporting is unavailable; no workflow effects ran.',
              { resumable: false },
            );
          try {
            await this.reporter.report(bound.binding, run, subject, code);
          } catch {
            throw new RunFailureError(
              'TEMPLATE_REPORT_UNAVAILABLE',
              'The trusted prerequisite failure report could not be reconciled; no workflow effects ran.',
              { resumable: false },
            );
          }
        }
        throw new RunFailureError(code, missing.message, {
          resumable: repairable.has(kind),
          details: { prerequisite: missing.id, kind },
        });
      }
      if (bound.binding.manifest.kind !== 'starter') {
        await assertPinnedBundle(
          this.instances.store,
          bound.binding,
          run.loopId,
          checkedEvents(await this.instances.store.events(run.id)),
        );
        const row = await this.instances.store.run(run.id);
        const subject = row?.subject ? parseSubject(row.subject) : undefined;
        if (!subject)
          throw new RunFailureError(
            'TEMPLATE_AUTHORITY_REFUSED',
            'The run has no trusted template subject.',
            { resumable: false },
          );
        let parent: ParentSubject;
        if (subject.role === 'parent') parent = subject;
        else {
          const source = await readAuthority(
            this.instances.store,
            bound.binding,
            subject.parentRunId,
          );
          if (
            source.subject.role !== 'parent' ||
            !active.has(source.run.status) ||
            !sameSubject(source.subject, subject)
          )
            throw new RunFailureError(
              'TEMPLATE_AUTHORITY_REFUSED',
              'The trusted worker parent is no longer active.',
              { resumable: false },
            );
          assertClaim(source.facts, source.subject);
          parent = source.subject;
        }
        try {
          await this.authority.recheck(bound.binding, parent);
        } catch {
          throw new RunFailureError(
            'TEMPLATE_AUTHORITY_REFUSED',
            progressed
              ? 'The repository subject is no longer eligible after workflow execution began. Earlier effects may have occurred; manual recovery is required.'
              : 'The repository subject is no longer eligible; no workflow effects ran.',
            { resumable: false },
          );
        }
      }
    },
  };
}
export function templateAdmission(
  base: TriggerAdmissionPort,
  runtime: TemplateRuntime,
): TriggerAdmissionPort {
  return {
    async create(input, receiptId) {
      try {
        await runtime.prepare(input);
        return await base.create(input, receiptId);
      } finally {
        runtime.release(input.run.id);
      }
    },
    async createPollItem(input) {
      try {
        await runtime.prepare(input);
        return await base.createPollItem(input);
      } finally {
        runtime.release(input.run.id);
      }
    },
    claim: (input, intent) => base.claim(input, intent),
    get: (id) => base.get(id),
    due: (now, limit) => base.due(now, limit),
    failed: (id, code, at) => base.failed(id, code, at),
    hasPendingPin: (loopId) => base.hasPendingPin(loopId),
  };
}
