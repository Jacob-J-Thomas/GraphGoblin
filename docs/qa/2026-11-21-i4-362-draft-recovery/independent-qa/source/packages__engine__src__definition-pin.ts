import type {
  ClassifierBinding,
  LoopDefinition,
  LoopVersionRecord,
  RunPin,
  RunRecord,
} from '@graphgoblin/contracts';
import { nodesOfKind } from '@graphgoblin/domain';
import type { ClassifierRegistryPort } from './ports.js';

/**
 * Run definition pins (ADR-0041). Every run executes one immutable definition record for its whole
 * life, through waits, wakes, resume, replay forks and process restart: a published version, or a
 * snapshot of the draft frozen when the run was created. The engine reads the definition only
 * through the run's `versionId`, and the inherited model defaults and classifier bindings only from
 * `run.pinned`.
 */

/** What a start pins besides the definition record: inherited defaults and classifier bindings. */
export type PinnedSelections = Pick<RunPin, 'defaults' | 'classifiers'>;

/** `<name> v<n>` for a published version, `<name> draft v<n>` for a draft snapshot. */
export function pinLabel(source: RunPin['source'], name: string, version: number): string {
  return `${name} ${source === 'draft' ? 'draft ' : ''}v${version}`;
}

/** The pin of a run that executes `record` (a published version or a draft snapshot). */
export function pinOf(record: LoopVersionRecord, selections: PinnedSelections): RunPin {
  const source = record.status === 'published' ? 'published' : 'draft';
  const { name } = record.definition;
  return {
    source,
    version: record.version,
    name,
    label: pinLabel(source, name, record.version),
    defaults: selections.defaults,
    limits: {
      structuredTimeoutMs: record.definition.settings.structuredTimeoutMs,
      maxNodeVisits: record.definition.settings.maxNodeVisits,
      runDeadlineSeconds: record.definition.settings.runDeadlineSeconds,
    },
    classifiers: selections.classifiers,
  };
}

/**
 * The binding a pin holds for classifier `id`. Catalog ids such as `constructor` are valid, and the
 * map is plain JSON, so only the map's own entries count, never what an object inherits.
 */
export function pinnedBinding(
  classifiers: RunPin['classifiers'],
  id: string,
): ClassifierBinding | undefined {
  return Object.hasOwn(classifiers, id) ? classifiers[id] : undefined;
}

/**
 * The classifier bindings a run of `def` pins: one per catalog id its decisions reference. An id the
 * parent already pinned keeps the parent's binding, so one run tree calls one classifier
 * configuration; any other id is bound to the catalog entry as it is now, and an id with no entry
 * stays unbound (its decision then fails explicitly).
 */
export async function bindClassifiers(
  def: LoopDefinition,
  ownerId: string,
  registry: Pick<ClassifierRegistryPort, 'bind'>,
  inherited: RunPin['classifiers'] = {},
): Promise<RunPin['classifiers']> {
  const ids = new Set(
    nodesOfKind(def, 'decision').flatMap((node) =>
      node.config.kind === 'classifier' ? [node.config.model] : [],
    ),
  );
  const bindings: RunPin['classifiers'] = {};
  for (const id of [...ids].sort()) {
    const binding = pinnedBinding(inherited, id) ?? (await registry.bind(ownerId, id));
    if (binding) bindings[id] = binding;
  }
  return bindings;
}

/**
 * The immutable copy of a draft that a draft run pins: the definition exactly as the start read and
 * validated it, under a new id, with the draft's number. Storage commits it with the run.
 */
export function freezeDraft(draft: LoopVersionRecord, id: string, at: string): LoopVersionRecord {
  return {
    id,
    loopId: draft.loopId,
    version: draft.version,
    status: 'snapshot',
    definition: structuredClone(draft.definition),
    createdAt: at,
  };
}

/** The run fields a definition pin sets: what the run executes and how it is described. */
export function pinnedFields(
  record: LoopVersionRecord,
  selections: PinnedSelections,
): Pick<RunRecord, 'versionId' | 'pinned'> {
  return { versionId: record.id, pinned: pinOf(record, selections) };
}
