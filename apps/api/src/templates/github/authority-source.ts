import { z } from 'zod';
import {
  ImplementationTemplateSettingsSchema,
  type ImplementationTemplateSettings,
} from '@graphgoblin/contracts';
import type { TemplateBinding } from '../binding.js';
import type { TemplateInstances } from '../instances.js';
import { readAuthority } from '../authority.js';
import { unavailableTemplateAuthority, type TemplateAuthoritySource } from '../runtime.js';
import { TemplateError } from '../errors.js';
import { eligibleIssue } from './client.js';
import { ImplementationRepository } from './repository.js';
import { nativeSupportDependencies, type ImplementationSupportDeps } from './implementation.js';
import { SupportFailure } from './protocol.js';

export type SupportDependencies = (
  settings: ImplementationTemplateSettings,
) => Promise<ImplementationSupportDeps>;
export class ImplementationAuthority implements TemplateAuthoritySource {
  constructor(
    private readonly instances: Pick<TemplateInstances, 'store'>,
    readonly dependencies: SupportDependencies = nativeSupportDependencies,
  ) {}
  async resolve(binding: TemplateBinding, payload: unknown) {
    if (binding.manifest.id !== 'implementation' || binding.manifest.kind !== 'implementation')
      return unavailableTemplateAuthority.resolve(binding, payload);
    const settings = ImplementationTemplateSettingsSchema.parse(binding.settings);
    const manual = z.strictObject({ issue: z.number().int().positive() });
    const repository = (settings.repository.owner + '/' + settings.repository.name).toLowerCase();
    const candidate = z
      .strictObject({ id: z.string().min(1).max(180), payload: manual })
      .refine((item) =>
        [1, 2, 3].some(
          (attempt) => item.id === repository + '#' + item.payload.issue + '@' + attempt,
        ),
      );
    const selector = z.union([manual, candidate]).safeParse(payload);
    if (!selector.success)
      throw new TemplateError(
        'TEMPLATE_AUTHORITY_REFUSED',
        'Select one issue; repository, attempts and lineage come from trusted metadata.',
      );
    const issue = 'payload' in selector.data ? selector.data.payload.issue : selector.data.issue;
    try {
      const deps = await this.dependencies(settings);
      await new ImplementationRepository(settings, deps.commands, deps.storage, deps.git).assert();
      await eligibleIssue(deps.github, settings, issue);
      return {
        kind: 'implementation' as const,
        repository: (settings.repository.owner + '/' + settings.repository.name).toLowerCase(),
        issue,
      };
    } catch (error) {
      throw new TemplateError(
        'TEMPLATE_AUTHORITY_REFUSED',
        error instanceof SupportFailure
          ? 'Implementation issue eligibility refused: ' + error.code
          : 'Implementation repository discovery is unavailable.',
      );
    }
  }
  async recheck(
    binding: TemplateBinding,
    subject: Parameters<TemplateAuthoritySource['recheck']>[1],
  ): Promise<void> {
    if (binding.manifest.id !== 'implementation' || binding.manifest.kind !== 'implementation')
      return unavailableTemplateAuthority.recheck(binding, subject);
    const settings = ImplementationTemplateSettingsSchema.parse(binding.settings);
    if (
      subject.kind !== 'implementation' ||
      subject.source.kind !== 'implementation' ||
      subject.issue === null
    )
      throw new TemplateError(
        'TEMPLATE_AUTHORITY_REFUSED',
        'Implementation lineage is unavailable.',
      );
    const deps = await this.dependencies(settings);
    await new ImplementationRepository(settings, deps.commands, deps.storage, deps.git).assert();
    const current = await readAuthority(this.instances.store, binding, subject.source.runId);
    const claims = current.facts.filter((fact) => fact.type === 'ClaimRecord');
    if (claims.length > 1)
      throw new TemplateError('AUTHORITY_CONFLICT', 'Implementation claim history conflicts.');
    const issue = await deps.github.issue(subject.repository, subject.issue);
    if (
      current.facts.some((fact) => fact.type === 'PrCreated') &&
      issue.state === 'open' &&
      issue.labels.some((label) => label.name === settings.labels.prOpen)
    ) {
      await deps.github.authenticate();
      return; // The exact completion action still reconciles the frozen PR intent.
    }
    const inProgress =
      claims.length === 1 &&
      issue.labels.some((label) => label.name === settings.labels.inProgress);
    await eligibleIssue(deps.github, settings, subject.issue, inProgress);
  }
}
