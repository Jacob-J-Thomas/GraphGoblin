import { z } from 'zod';
import { JsonValueSchema, QaTemplateSettingsSchema, type JsonValue } from '@graphgoblin/contracts';
import { TemplateBindingSchema, type TemplateBinding } from '../binding.js';
import { readAuthority } from '../authority.js';
import { sameSubject, parseSubject, type ParentSubject } from '../subjects.js';
import type { TemplateInstances } from '../instances.js';
import { TemplateError } from '../errors.js';
import { unavailableTemplateAuthority, type TemplateAuthoritySource } from '../runtime.js';
import { trustedQaPr } from './qa-client.js';
import { ImplementationRepository } from './repository.js';
import { nativeQaMetadata, type QaMetadataFactory } from './qa-native.js';
import { ShaSchema } from './protocol.js';

const Manual = z.strictObject({
  pullRequest: z.number().int().positive(),
  mergeSha: ShaSchema.optional(),
});
export const QaPollItemSchema = z
  .strictObject({
    id: ShaSchema,
    payload: z.strictObject({ pullRequest: z.number().int().positive(), mergeSha: ShaSchema }),
  })
  .refine((item) => item.id === item.payload.mergeSha);
function refused(): never {
  throw new TemplateError(
    'TEMPLATE_AUTHORITY_REFUSED',
    'The exact merged QA subject or authenticated source is unavailable. Reconcile it manually.',
  );
}
export class QaAuthority implements TemplateAuthoritySource {
  constructor(
    private readonly instances: Pick<TemplateInstances, 'store'>,
    private readonly metadata: QaMetadataFactory = nativeQaMetadata,
  ) {}
  async resolve(binding: TemplateBinding, payload: unknown) {
    if (binding.manifest.id !== 'qa' || binding.manifest.kind !== 'qa')
      return unavailableTemplateAuthority.resolve(binding, payload);
    try {
      return await this.selected(binding, payload);
    } catch {
      return refused();
    }
  }
  private async selected(binding: TemplateBinding, payload: unknown) {
    const parsed = z.union([Manual, QaPollItemSchema]).safeParse(payload);
    if (!parsed.success) return refused();
    const selector = 'payload' in parsed.data ? parsed.data.payload : parsed.data,
      settings = QaTemplateSettingsSchema.parse(binding.settings),
      deps = await this.metadata(settings);
    await new ImplementationRepository(settings, deps.commands, deps.files, deps.git).assert();
    const current = await trustedQaPr(deps.github, settings, selector.pullRequest),
      repository = (settings.repository.owner + '/' + settings.repository.name).toLowerCase();
    if (selector.mergeSha && selector.mergeSha !== current.mergeSha) return refused();
    const candidates = await this.instances.store.prFactCandidates(
      binding.ownerId,
      repository,
      selector.pullRequest,
      65,
    );
    if (candidates.length > 64) return refused();
    const sources = [];
    for (const row of candidates) {
      if (!row.subject) return refused();
      const subject = parseSubject(row.subject);
      if (subject.role !== 'parent' || subject.kind !== 'implementation') return refused();
      const stored = await this.instances.store.bindingForLoop(binding.ownerId, row.run.loopId);
      if (!stored) return refused();
      const authority = await readAuthority(
        this.instances.store,
        TemplateBindingSchema.parse(stored.binding),
        row.run.id,
      );
      for (const fact of authority.facts)
        if (fact.type === 'PrCreated' && fact.pullRequest === selector.pullRequest)
          sources.push({ fact, runId: row.run.id });
    }
    if (sources.length > 1 || (sources[0] && sources[0].fact.issue !== current.issue.number))
      return refused();
    const original = sources[0];
    // Missing an authenticated PrCreated never downgrades an existing implementation to external.
    if (!original) {
      const linked = await this.instances.store.subjectRuns({
        ownerId: binding.ownerId,
        repository,
        issue: current.issue.number,
        limit: 65,
      });
      if (
        linked.length > 64 ||
        linked.some(
          (row) =>
            row.subject &&
            parseSubject(row.subject).role === 'parent' &&
            parseSubject(row.subject).kind === 'implementation',
        )
      )
        return refused();
    }
    return {
      kind: 'qa' as const,
      repository,
      issue: current.issue.number,
      pullRequest: selector.pullRequest,
      mergeSha: current.mergeSha,
      attempt: original?.fact.attempt ?? 1,
      source: original
        ? { kind: 'implementation' as const, runId: original.runId }
        : { kind: 'external' as const },
    };
  }
  async recheck(binding: TemplateBinding, subject: ParentSubject): Promise<void> {
    if (subject.kind !== 'qa' || !subject.pullRequest || !subject.mergeSha) return refused();
    const selected = await this.resolve(binding, {
      pullRequest: subject.pullRequest,
      mergeSha: subject.mergeSha,
    });
    if (
      selected.kind !== 'qa' ||
      !sameSubject(subject, {
        ...subject,
        ...selected,
        source: selected.source,
        attempt: selected.attempt,
      })
    )
      return refused();
  }
}
/** Whole native output is reselected against trusted authority before generic poll dedupe. */
export async function qaPollKeys(
  binding: TemplateBinding,
  input: JsonValue,
  authority: TemplateAuthoritySource,
): Promise<JsonValue> {
  const data = z.strictObject({ items: z.array(QaPollItemSchema).max(100) }).parse(input);
  if (new Set(data.items.map((item) => item.id)).size !== data.items.length) return refused();
  const items = [];
  for (const item of data.items) {
    const selected = await authority.resolve(binding, item);
    if (
      selected.kind !== 'qa' ||
      selected.pullRequest !== item.payload.pullRequest ||
      selected.mergeSha !== item.id
    )
      return refused();
    items.push({
      id: selected.mergeSha,
      payload: { pullRequest: selected.pullRequest, mergeSha: selected.mergeSha },
    });
  }
  return JsonValueSchema.parse({ items });
}
