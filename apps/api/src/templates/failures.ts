import { stableHash } from '@graphgoblin/domain';
import type { RunRecord } from '@graphgoblin/contracts';
import type { TemplateInstances } from './instances.js';
import { TemplateBindingSchema, assertBoundVersion, type TemplateBinding } from './binding.js';
import { parseSubject, sameSubject, type ParentSubject } from './subjects.js';
import { TemplateError } from './errors.js';
import type { TemplateFailureReporter } from './runtime.js';
import { checkedEvents } from './authority.js';

export interface TemplateReportPort {
  comments(repository: string, issue: number, limit: number): Promise<readonly { body: string }[]>;
  post(repository: string, issue: number, body: string): Promise<void>;
}
const fixedCodes = new Set(['TEMPLATE_PREREQUISITE_UNAVAILABLE', 'TEMPLATE_ISOLATION_UNAVAILABLE']);
function refused(): never {
  throw new TemplateError(
    'TEMPLATE_REPORT_UNAVAILABLE',
    'The trusted pre-execution prerequisite report is unavailable.',
  );
}
/** Reconciliation precedes the sole explanatory effect. It never resets a consumed subject. */
export class ReconciledTemplateFailureReporter implements TemplateFailureReporter {
  constructor(
    private readonly instances: TemplateInstances,
    private readonly port: TemplateReportPort,
  ) {}
  async report(
    binding: TemplateBinding,
    run: RunRecord,
    subject: ParentSubject,
    code: string,
  ): Promise<void> {
    if (
      !fixedCodes.has(code) ||
      run.ownerId !== binding.ownerId ||
      run.loopId !== binding.loops.find((loop) => loop.key === binding.manifest.parentKey)?.loopId
    )
      refused();
    const stored = await this.instances.store.bindingForLoop(run.ownerId, run.loopId);
    const current = await this.instances.store.run(run.id);
    const version = await this.instances.store.version(run.versionId);
    if (
      !stored ||
      !current?.subject ||
      !version ||
      !['queued', 'running', 'waiting', 'paused'].includes(current.run.status) ||
      stableHash(TemplateBindingSchema.parse(stored.binding)) !== stableHash(binding)
    )
      refused();
    if (
      checkedEvents(await this.instances.store.events(run.id)).some(
        (event) => event.type === 'node.started',
      )
    )
      refused();
    assertBoundVersion(binding, run.loopId, run.versionId, version.definition);
    const actual = parseSubject(current.subject);
    if (
      actual.role !== 'parent' ||
      actual.instanceId !== binding.instanceId ||
      !sameSubject(actual, subject)
    )
      refused();
    const marker =
      '<!-- graphgoblin-template-failure:' +
      stableHash({
        runId: run.id,
        repository: actual.repository,
        issue: actual.issue,
        mergeSha: actual.mergeSha ?? null,
      }) +
      ' -->';
    const target = actual.issue ?? actual.pullRequest;
    if (!target) refused();
    const comments = await this.port.comments(actual.repository, target, 101);
    if (comments.length > 100) refused();
    const matches = comments.filter((comment) => comment.body.includes(marker));
    if (matches.length > 1) refused();
    if (matches.length === 1) return;
    const body =
      marker +
      '\n' +
      (code === 'TEMPLATE_ISOLATION_UNAVAILABLE'
        ? 'GraphGoblin QA did not run because production isolation is unavailable. The issue state is unchanged. This merge SHA is consumed and requires manual recovery; there is no isolation override.'
        : 'GraphGoblin did not run workflow effects because a prerequisite is unavailable. Repair the prerequisite and use the same run only if its trusted pre-execution failure permits resume. Otherwise use manual recovery.');
    await this.port.post(actual.repository, target, body);
  }
}
