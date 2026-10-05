import type { ClassifierModelSummary } from '@graphgoblin/contracts';
import { useId } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useClassifierModels } from '../api/queries.js';
import { Icon } from '../components/icons/index.js';
import { HelpText, Select } from '../components/ui/index.js';
import { fieldMeta, joinPath, Row } from '../forms/fields/shared.js';
import type { FieldProps } from '../forms/fields.js';
import { isUnset, UNSET } from '../forms/unset.js';
import { errorMessage } from '../lib/utils.js';
import { useEditorStore } from './store.js';

/** The built-in classifier's id: what a decision uses when `jev.model` is absent. */
export const BUILTIN_CLASSIFIER = 'jev';

/** `Kev 4B (kev)`: a classifier by display name, with its id. */
function named(entry: ClassifierModelSummary): string {
  return `${entry.displayName} (${entry.id})`;
}

/** Whether a decision can select the entry: enabled and able to answer Choice. */
export function selectable(entry: ClassifierModelSummary): boolean {
  return entry.enabled && entry.primitives.includes('choice');
}

/** The path one level up (`jev` for `jev.model`, `` for `jev`). */
function parentOf(path: string): string {
  const at = path.lastIndexOf('.');
  return at === -1 ? '' : path.slice(0, at);
}

/**
 * Why a decision's Jev strategy cannot use `entry` (or a missing id), else undefined. `usesJev`
 * says whether the decision's strategy includes Jev: only then do the API's checks (and so
 * publishing) look at the selection; otherwise the problem is one to fix before adding Jev.
 */
function unavailable(
  id: string,
  entry: ClassifierModelSummary | undefined,
  usesJev: boolean,
): { tag: string; why: string } | undefined {
  const beforeJev = 'before adding Jev to the strategy.';
  if (!entry)
    return {
      tag: 'not in catalog',
      why: usesJev
        ? `${id} is not in the classifier catalog. The draft cannot be published until you choose an available model, or register ${id} again in Settings, Classifier models.`
        : `${id} is not in the classifier catalog. Choose an available model, or register ${id} again in Settings, Classifier models, ${beforeJev}`,
    };
  if (!entry.primitives.includes('choice'))
    return {
      tag: 'no Choice',
      why: usesJev
        ? `${named(entry)} cannot answer Choice decisions. The draft cannot be published until you choose a model with Choice / classification.`
        : `${named(entry)} cannot answer Choice decisions. Choose a model with Choice / classification ${beforeJev}`,
    };
  if (!entry.enabled)
    return {
      tag: 'disabled',
      why: usesJev
        ? `${named(entry)} is disabled, so this decision skips its Jev strategy. Enable it in Settings, Classifier models, or choose another model.`
        : `${named(entry)} is disabled. Enable it in Settings, Classifier models, or choose another model, ${beforeJev}`,
    };
  if (!entry.configured)
    return {
      tag: 'needs a key',
      why: `${named(entry)} needs a key, ${usesJev ? 'so this decision skips its Jev strategy until it is set' : 'which the Jev strategy will need'}. ${entry.configurationReason ?? 'Set it in Settings, Secrets.'}`,
    };
  return undefined;
}

/**
 * The decision's classifier (`jev.model`, registered as the `classifier` control): a select of the
 * enabled classifiers that answer Choice, labelled by display name and id. The first option is the
 * built-in default, which leaves `jev.model` out of the config (choosing it removes the field;
 * the rest of the `jev` block stays). An enabled classifier that needs a key is listed with that
 * warning. A selected id that is disabled, deleted, or without Choice stays selected as an
 * unavailable value, with the reason under the field, and is never cleared or replaced unasked.
 *
 * It is drawn even while the decision has no `jev` block (`drawsWithoutParent`), showing the
 * built-in default; choosing another classifier then adds the block with its defaults and the
 * model. The value is read with `useWatch` and written with `setValue`, so drawing it registers
 * nothing that could add an empty `jev` block. Each pick is an undo step of its own.
 */
export function ClassifierField({ schema, name, label, absentParent }: FieldProps) {
  const { setValue } = useFormContext();
  const watched: unknown = useWatch({ name });
  const blockName = absentParent?.name ?? parentOf(name);
  const strategy: unknown = useWatch({ name: joinPath(parentOf(blockName), 'strategy') });
  const query = useClassifierModels();
  const statusId = `${useId()}-status`;
  const { required, help } = fieldMeta(schema);
  const value =
    absentParent || isUnset(watched) || typeof watched !== 'string' ? undefined : watched;
  const usesJev = Array.isArray(strategy) && strategy.includes(BUILTIN_CLASSIFIER);
  const entries = query.data ?? [];
  const builtin = entries.find((entry) => entry.id === BUILTIN_CLASSIFIER);
  // An explicit `jev` is the built-in: it shows as the default option and is left as it is.
  const chosen = value === undefined || value === BUILTIN_CLASSIFIER ? undefined : value;
  const options = entries.filter((entry) => entry.id !== BUILTIN_CLASSIFIER && selectable(entry));
  const current = chosen === undefined ? builtin : entries.find((entry) => entry.id === chosen);
  const problem = query.isSuccess
    ? unavailable(chosen ?? BUILTIN_CLASSIFIER, current, usesJev)
    : undefined;
  const stale = chosen !== undefined && !options.some((entry) => entry.id === chosen);

  const defaultLabel = (() => {
    const base = `${builtin?.displayName ?? 'Jev'} (${BUILTIN_CLASSIFIER}), the default`;
    const tag = builtin && unavailable(BUILTIN_CLASSIFIER, builtin, usesJev)?.tag;
    return tag ? `${base} (${tag})` : base;
  })();

  const status = query.isPending
    ? 'Loading classifier models…'
    : query.isError
      ? `Classifier models could not be loaded: ${errorMessage(query.error)}. The current choice is kept.`
      : problem?.why;

  const choose = (next: string | undefined) => {
    const how = { shouldDirty: true, shouldTouch: true, shouldValidate: true };
    const { closeStep } = useEditorStore.getState();
    // Each pick is an undo step of its own, however soon it follows the last change.
    closeStep();
    if (absentParent) {
      // Choosing the default leaves the decision without a `jev` block, as it was.
      if (next !== undefined)
        setValue(absentParent.name, { ...absentParent.initial, [lastKey(name)]: next }, how);
    } else {
      setValue(name, next ?? UNSET, how);
    }
    closeStep();
  };

  return (
    <Row label={label} name={name} required={required} help={help}>
      {(control) => (
        <>
          <Select
            {...control}
            aria-describedby={
              [control['aria-describedby'], status ? statusId : ''].filter(Boolean).join(' ') ||
              undefined
            }
            value={chosen ?? ''}
            onChange={(event) => choose(event.target.value === '' ? undefined : event.target.value)}
          >
            <option value="">{defaultLabel}</option>
            {stale ? (
              <option value={chosen}>
                {current ? named(current) : chosen}
                {problem ? ` (${problem.tag})` : ''}
              </option>
            ) : null}
            {options.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {named(entry)}
                {entry.configured ? '' : ' (needs a key)'}
              </option>
            ))}
          </Select>
          {status ? (
            <HelpText id={statusId} className="flex items-start gap-1.5">
              {problem ? (
                <Icon name="alert" className="mt-px shrink-0 text-status-warn-fg" />
              ) : null}
              <span>{status}</span>
            </HelpText>
          ) : null}
        </>
      )}
    </Row>
  );
}
ClassifierField.drawsWithoutParent = true;

/** The last segment of a path (`model` for `jev.model`). */
function lastKey(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1);
}
