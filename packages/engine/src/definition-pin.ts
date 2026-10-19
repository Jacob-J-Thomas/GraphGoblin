import type { LoopVersionRecord, PinnedDefaults, RunPin, RunRecord } from '@graphgoblin/contracts';

/**
 * Run definition pins (ADR-0041). Every run executes one immutable definition record for its whole
 * life, through waits, wakes, resume, replay forks and process restart: a published version, or a
 * snapshot of the draft frozen when the run was created. The engine reads the definition only
 * through the run's `versionId`, and the inherited model defaults only from `run.pinned`.
 */

/** `<name> v<n>` for a published version, `<name> draft v<n>` for a draft snapshot. */
export function pinLabel(source: RunPin['source'], name: string, version: number): string {
  return `${name} ${source === 'draft' ? 'draft ' : ''}v${version}`;
}

/** The pin of a run that executes `record` (a published version or a draft snapshot). */
export function pinOf(record: LoopVersionRecord, defaults: PinnedDefaults): RunPin {
  const source = record.status === 'published' ? 'published' : 'draft';
  const { name } = record.definition;
  return {
    source,
    version: record.version,
    name,
    label: pinLabel(source, name, record.version),
    defaults,
  };
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
  defaults: PinnedDefaults,
): Pick<RunRecord, 'versionId' | 'pinned'> {
  return { versionId: record.id, pinned: pinOf(record, defaults) };
}
