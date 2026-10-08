import { stableHash } from '@graphgoblin/domain';
import { ReviewTemplateSettingsSchema, type RunRecord } from '@graphgoblin/contracts';
import { TemplateBindingSchema, type TemplateBinding } from '../binding.js';
import { checkedEvents, readAuthority } from '../authority.js';
import { sameSubject, type ParentSubject } from '../subjects.js';
import type { TemplateFailureReporter } from '../runtime.js';
import type { TemplateInstances } from '../instances.js';
import { TemplateError } from '../errors.js';
import { nativeReviewDependencies, type ReviewDependenciesFactory } from './review.js';

export class ReviewReporter implements TemplateFailureReporter {
  constructor(
    private readonly instances: Pick<TemplateInstances, 'store'>,
    private readonly dependencies: ReviewDependenciesFactory = nativeReviewDependencies,
  ) {}
  async report(binding: TemplateBinding, run: RunRecord, subject: ParentSubject, code: string) {
    if (!['TEMPLATE_PREREQUISITE_UNAVAILABLE', 'TEMPLATE_ISOLATION_UNAVAILABLE'].includes(code))
      throw new TemplateError(
        'TEMPLATE_REPORT_UNAVAILABLE',
        'This fixed prerequisite report is unavailable.',
      );
    const progressed = checkedEvents(await this.instances.store.events(run.id)).some(
      (event) => event.type === 'node.started',
    );
    await this.explain(
      binding,
      run,
      subject,
      'prerequisite',
      progressed
        ? 'GraphGoblin stopped after workflow progress because a prerequisite is unavailable. Earlier effects may have occurred; this consumed head requires manual recovery.'
        : 'GraphGoblin did not begin workflow execution because a prerequisite is unavailable. Repair it and use this run only if its trusted failure explicitly permits same-run resume.',
      false,
    );
  }
  async terminal(run: RunRecord) {
    if (run.status !== 'failed' && run.status !== 'cancelled' && run.outcome !== 'failure') return;
    const stored = await this.instances.store.bindingForLoop(run.ownerId, run.loopId);
    if (!stored) return;
    const binding = TemplateBindingSchema.parse(stored.binding);
    if (
      binding.manifest.id !== 'review' ||
      binding.manifest.kind !== 'review' ||
      run.loopId !== stored.instance.parentLoopId
    )
      return;
    const authority = await readAuthority(this.instances.store, binding, run.id);
    if (
      authority.subject.role !== 'parent' ||
      !authority.events.some((event) => event.type === 'node.started')
    )
      return;
    await this.explain(
      binding,
      run,
      authority.subject,
      'blocked',
      'GraphGoblin stopped this review after workflow progress. Earlier effects may have occurred. This head remains permanently consumed; inspect the fixed failure code and reconcile the current PR state manually. No approval was fabricated.',
      true,
    );
  }
  private async explain(
    binding: TemplateBinding,
    run: RunRecord,
    subject: ParentSubject,
    kind: string,
    text: string,
    label: boolean,
  ) {
    if (binding.manifest.id !== 'review' || subject.kind !== 'review' || !subject.pullRequest)
      throw new TemplateError(
        'TEMPLATE_REPORT_UNAVAILABLE',
        'The trusted review report identity is unavailable.',
      );
    const authority = await readAuthority(this.instances.store, binding, run.id);
    if (
      authority.subject.role !== 'parent' ||
      !sameSubject(authority.subject, subject) ||
      authority.run.ownerId !== binding.ownerId ||
      authority.run.loopId !== run.loopId
    )
      throw new TemplateError(
        'TEMPLATE_REPORT_UNAVAILABLE',
        'The trusted review report identity conflicts.',
      );
    const settings = ReviewTemplateSettingsSchema.parse(binding.settings),
      deps = await this.dependencies(settings);
    await deps.github.authenticate();
    const marker =
      '<!-- graphgoblin-review-failure:' +
      stableHash({
        ownerId: binding.ownerId,
        runId: run.id,
        repository: subject.repository,
        pullRequest: subject.pullRequest,
        kind,
      }) +
      ' -->';
    const body =
      marker +
      '\n' +
      text +
      (subject.issue === null ? '\nNo linked issue; issue labels and rework are skipped.' : '');
    for (const number of [
      subject.pullRequest,
      ...(subject.issue === null ? [] : [subject.issue]),
    ]) {
      const comments = await deps.github.comments(subject.repository, number, 100);
      if (comments.length >= 100)
        throw new TemplateError(
          'TEMPLATE_REPORT_UNAVAILABLE',
          'The report history exceeds its reconciliation bound.',
        );
      const found = comments.filter((comment) => comment.body.includes(marker));
      if (found.length > 1 || found.some((comment) => comment.body !== body))
        throw new TemplateError('TEMPLATE_REPORT_UNAVAILABLE', 'The report marker conflicts.');
      if (!found.length) await deps.github.post(subject.repository, number, body);
    }
    if (label && subject.issue !== null)
      await deps.github.label(subject.repository, subject.issue, [settings.needsHumanLabel], []);
  }
}
