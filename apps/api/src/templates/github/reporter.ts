import { stableHash } from '@graphgoblin/domain';
import type { RunRecord } from '@graphgoblin/contracts';
import type { TemplateInstances } from '../instances.js';
import { TemplateBindingSchema, type TemplateBinding } from '../binding.js';
import { readAuthority, checkedEvents } from '../authority.js';
import { sameSubject, type ParentSubject } from '../subjects.js';
import type { TemplateFailureReporter } from '../runtime.js';
import { TemplateError } from '../errors.js';
import { readImplementationIntent } from './intent.js';
import { closingIssue, nativeSupportDependencies } from './implementation.js';
import { ImplementationTemplateSettingsSchema } from '@graphgoblin/contracts';
import type { SupportDependencies } from './authority-source.js';
import type { SqliteRunRepository } from '@graphgoblin/infrastructure/sqlite';

export function installImplementationFinalization(
  runs: Pick<SqliteRunRepository, 'get' | 'markFinalized'>,
  reporter: Pick<ImplementationReporter, 'terminal'>,
): void {
  const markFinalized = runs.markFinalized.bind(runs);
  runs.markFinalized = async (runId) => {
    const run = await runs.get(runId);
    if (run) await reporter.terminal(run);
    await markFinalized(runId);
  };
}

export class ImplementationReporter implements TemplateFailureReporter {
  constructor(
    private readonly instances: Pick<TemplateInstances, 'store'>,
    private readonly dependencies: SupportDependencies = nativeSupportDependencies,
  ) {}
  async report(
    binding: TemplateBinding,
    run: RunRecord,
    subject: ParentSubject,
    code: string,
  ): Promise<void> {
    try {
      await this.prerequisiteReport(binding, run, subject, code);
    } catch (error) {
      if (error instanceof TemplateError) throw error;
      throw new TemplateError(
        'TEMPLATE_REPORT_UNAVAILABLE',
        'The trusted prerequisite report could not be reconciled.',
      );
    }
  }
  private async prerequisiteReport(
    binding: TemplateBinding,
    run: RunRecord,
    subject: ParentSubject,
    code: string,
  ): Promise<void> {
    if (!['TEMPLATE_PREREQUISITE_UNAVAILABLE', 'TEMPLATE_ISOLATION_UNAVAILABLE'].includes(code))
      throw new TemplateError(
        'TEMPLATE_REPORT_UNAVAILABLE',
        'The fixed prerequisite report code is unavailable.',
      );
    await this.verify(binding, run, subject);
    const events = checkedEvents(await this.instances.store.events(run.id));
    const progressed = events.some((event) => event.type === 'node.started');
    await this.explain(
      binding,
      run,
      subject,
      'prerequisite',
      progressed
        ? 'GraphGoblin stopped after workflow progress because a prerequisite is unavailable. This consumed attempt requires manual recovery; it is not eligible for a fresh attempt or same-run retry.'
        : 'GraphGoblin did not begin workflow execution because a prerequisite is unavailable. Repair the prerequisite and use this run only if its trusted failure explicitly permits same-run resume.',
      false,
    );
  }
  async terminal(run: RunRecord): Promise<void> {
    try {
      await this.terminalReport(run);
    } catch (error) {
      if (error instanceof TemplateError) throw error;
      throw new TemplateError(
        'TEMPLATE_REPORT_UNAVAILABLE',
        'The trusted terminal report could not be reconciled.',
      );
    }
  }
  private async terminalReport(run: RunRecord): Promise<void> {
    if (run.status !== 'failed' && run.status !== 'cancelled' && run.outcome !== 'failure') return;
    const stored = await this.instances.store.bindingForLoop(run.ownerId, run.loopId);
    if (!stored) return;
    const binding = TemplateBindingSchema.parse(stored.binding);
    if (
      binding.manifest.id !== 'implementation' ||
      binding.manifest.kind !== 'implementation' ||
      run.loopId !== stored.instance.parentLoopId
    )
      return;
    const authority = await readAuthority(this.instances.store, binding, run.id);
    if (authority.subject.role !== 'parent') return;
    if (!authority.events.some((event) => event.type === 'node.started')) return; // Prerequisites already report without labels.
    const deps = await this.dependencies(
      ImplementationTemplateSettingsSchema.parse(binding.settings),
    );
    const version = await this.instances.store.version(run.versionId);
    if (!version)
      throw new TemplateError(
        'TEMPLATE_REPORT_UNAVAILABLE',
        'The immutable PR intent version is unavailable.',
      );
    const intent = readImplementationIntent(
      binding,
      run.loopId,
      version.definition,
      authority.events,
    );
    let pullRequest = authority.facts.find((fact) => fact.type === 'PrCreated')?.pullRequest;
    let openPr = false;
    if (intent) {
      const prs = await deps.github.pullRequests(authority.subject.repository, intent.branch);
      if (prs.length > 1)
        throw new TemplateError(
          'TEMPLATE_REPORT_UNAVAILABLE',
          'PR completion requires manual reconciliation.',
        );
      const pr = prs[0];
      if (pr) {
        if (
          pr.head.sha !== intent.head ||
          pr.head.ref !== intent.branch ||
          pr.head.repo.full_name.toLowerCase() !== authority.subject.repository ||
          pr.base.repo.full_name.toLowerCase() !== authority.subject.repository ||
          pr.base.ref !==
            ImplementationTemplateSettingsSchema.parse(binding.settings).repository.baseBranch ||
          pr.title !== intent.title ||
          pr.body !== intent.body ||
          !closingIssue(pr.body, authority.subject.repository, authority.subject.issue!)
        )
          throw new TemplateError(
            'TEMPLATE_REPORT_UNAVAILABLE',
            'PR completion requires manual reconciliation.',
          );
        if (pullRequest && pullRequest !== pr.number)
          throw new TemplateError('AUTHORITY_CONFLICT', 'PR history conflicts.');
        pullRequest = pr.number;
        openPr = pr.state === 'open';
      } else if (pullRequest)
        throw new TemplateError(
          'TEMPLATE_REPORT_UNAVAILABLE',
          'The recorded PR could not be reconciled.',
        );
    } else if (pullRequest)
      throw new TemplateError('AUTHORITY_CONFLICT', 'The recorded PR has no authenticated intent.');
    const creationNode = version.definition.nodes.find(
      (node) =>
        node.kind === 'script' &&
        node.config.command === 'graphgoblin-template-support' &&
        node.config.args.length === 1 &&
        node.config.args[0] === 'pr-created',
    );
    const creationStarted =
      !!intent &&
      !!creationNode &&
      authority.events.some(
        (event) =>
          event.type === 'node.started' &&
          event.nodeId === creationNode.id &&
          event.kind === 'script' &&
          event.configHash ===
            binding.loops.find((loop) => loop.loopId === run.loopId)?.nodes[creationNode.id]
              ?.configHash,
      );
    await this.explain(
      binding,
      run,
      authority.subject,
      'blocked',
      pullRequest
        ? 'GraphGoblin stopped after pull request #' +
            pullRequest +
            ' was created. This consumed run requires manual completion reconciliation; no second PR will be created.'
        : creationStarted
          ? 'GraphGoblin stopped during pull request creation. The bounded lookup has not established completion. This consumed run requires manual PR reconciliation; no second PR will be created.'
          : 'GraphGoblin stopped this implementation attempt. No pull request was created. The permanent attempt remains consumed; inspect the recorded fixed failure code and recover manually.',
      !pullRequest,
    );
    if (pullRequest && openPr) {
      const settings = ImplementationTemplateSettingsSchema.parse(binding.settings);
      await deps.github.label(
        authority.subject.repository,
        authority.subject.issue!,
        [settings.labels.prOpen],
        [settings.labels.inProgress, settings.labels.trigger],
      );
    }
  }
  private async verify(binding: TemplateBinding, run: RunRecord, subject: ParentSubject) {
    if (binding.manifest.id !== 'implementation' || binding.manifest.kind !== 'implementation')
      throw new TemplateError(
        'TEMPLATE_REPORT_UNAVAILABLE',
        'This reporter only supports implementation.',
      );
    const actual = await readAuthority(this.instances.store, binding, run.id);
    if (
      actual.subject.role !== 'parent' ||
      !sameSubject(actual.subject, subject) ||
      actual.run.ownerId !== binding.ownerId ||
      actual.run.loopId !== run.loopId
    )
      throw new TemplateError(
        'TEMPLATE_REPORT_UNAVAILABLE',
        'Trusted report identity was refused.',
      );
  }
  private async explain(
    binding: TemplateBinding,
    run: RunRecord,
    subject: ParentSubject,
    kind: string,
    text: string,
    block: boolean,
  ) {
    await this.verify(binding, run, subject);
    if (subject.issue === null)
      throw new TemplateError('TEMPLATE_REPORT_UNAVAILABLE', 'The original issue is unavailable.');
    const settings = ImplementationTemplateSettingsSchema.parse(binding.settings);
    const deps = await this.dependencies(settings);
    await deps.github.authenticate();
    const marker =
      '<!-- graphgoblin-implementation:' +
      stableHash({ runId: run.id, repository: subject.repository, issue: subject.issue, kind }) +
      ' -->';
    const comments = await deps.github.comments(subject.repository, subject.issue, 101);
    if (comments.length >= 100)
      throw new TemplateError(
        'TEMPLATE_REPORT_UNAVAILABLE',
        'The comment history exceeds its bound.',
      );
    const matches = comments.filter((comment) => comment.body.includes(marker));
    if (matches.length > 1)
      throw new TemplateError('TEMPLATE_REPORT_UNAVAILABLE', 'The report marker conflicts.');
    if (!matches.length)
      await deps.github.post(subject.repository, subject.issue, marker + '\n' + text);
    if (block)
      await deps.github.label(
        subject.repository,
        subject.issue,
        [settings.labels.blocked],
        [settings.labels.inProgress],
      );
  }
}
