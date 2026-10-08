import { stableHash } from '@graphgoblin/domain';
import { QaTemplateSettingsSchema, type RunRecord } from '@graphgoblin/contracts';
import { TemplateBindingSchema, type TemplateBinding } from '../binding.js';
import { readAuthority } from '../authority.js';
import { sameSubject, type ParentSubject } from '../subjects.js';
import type { TemplateInstances } from '../instances.js';
import type { TemplateFailureReporter } from '../runtime.js';
import { TemplateError } from '../errors.js';
import type { QaAuthority } from './qa-authority.js';
import { nativeQaMetadata, type QaMetadataFactory } from './qa-native.js';

function refused(): never {
  throw new TemplateError(
    'TEMPLATE_REPORT_UNAVAILABLE',
    'The trusted QA prerequisite explanation could not be reconciled.',
  );
}
export class QaReporter implements TemplateFailureReporter {
  constructor(
    private readonly instances: Pick<TemplateInstances, 'store'>,
    private readonly authority: Pick<QaAuthority, 'recheck'>,
    private readonly metadata: QaMetadataFactory = nativeQaMetadata,
  ) {}
  async report(
    binding: TemplateBinding,
    run: RunRecord,
    subject: ParentSubject,
    code: string,
  ): Promise<void> {
    try {
      if (
        !['TEMPLATE_PREREQUISITE_UNAVAILABLE', 'TEMPLATE_ISOLATION_UNAVAILABLE'].includes(code) ||
        binding.manifest.id !== 'qa' ||
        binding.manifest.kind !== 'qa' ||
        subject.kind !== 'qa' ||
        !subject.issue
      )
        return refused();
      const actual = await readAuthority(this.instances.store, binding, run.id);
      if (
        actual.subject.role !== 'parent' ||
        !sameSubject(actual.subject, subject) ||
        actual.run.loopId !== run.loopId ||
        actual.events.some((event) => event.type === 'node.started')
      )
        return refused();
      await this.authority.recheck(binding, actual.subject);
      const deps = await this.metadata(QaTemplateSettingsSchema.parse(binding.settings)),
        marker =
          '<!-- graphgoblin-qa-unavailable:' +
          stableHash({
            ownerId: binding.ownerId,
            runId: run.id,
            repository: subject.repository,
            issue: subject.issue,
            mergeSha: subject.mergeSha,
          }) +
          ' -->';
      const body =
        marker +
        '\nGraphGoblin QA did not run because production isolation is unavailable. No QA or adversary turn, checkout, proof push, reopen, or label change occurred. This merge SHA and issue attempt remain consumed; manual recovery is required. There is no isolation override.';
      const comments = await deps.github.comments(subject.repository, subject.issue, 100);
      if (comments.length >= 100) return refused();
      const found = comments.filter((comment) => comment.body.includes(marker));
      if (found.length > 1 || found.some((comment) => comment.body !== body)) return refused();
      if (!found.length) await deps.github.post(subject.repository, subject.issue, body);
    } catch {
      return refused();
    }
  }
  async terminal(run: RunRecord): Promise<void> {
    if (run.status !== 'failed') return;
    const stored = await this.instances.store.bindingForLoop(run.ownerId, run.loopId);
    if (
      !stored ||
      stored.instance.templateId !== 'qa' ||
      stored.instance.parentLoopId !== run.loopId
    )
      return;
    const binding = TemplateBindingSchema.parse(stored.binding),
      actual = await readAuthority(this.instances.store, binding, run.id);
    if (
      actual.subject.role !== 'parent' ||
      actual.events.some((event) => event.type === 'node.started')
    )
      return;
    const failure = actual.events.findLast((event) => event.type === 'run.failed');
    if (
      failure?.type === 'run.failed' &&
      [
        'TEMPLATE_PREREQUISITE_UNAVAILABLE',
        'TEMPLATE_ISOLATION_UNAVAILABLE',
        'TEMPLATE_REPORT_UNAVAILABLE',
      ].includes(failure.failure.code)
    )
      await this.report(binding, run, actual.subject, 'TEMPLATE_ISOLATION_UNAVAILABLE');
  }
}
