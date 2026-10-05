import type { ClassifierModelSummary } from '@graphgoblin/contracts';
import { useId } from 'react';
import { useClassifierModels } from '../api/queries.js';
import { Icon } from '../components/icons/index.js';
import { HelpText, Select } from '../components/ui/index.js';
import { fieldMeta, Row, useField } from '../forms/fields/shared.js';
import type { FieldProps } from '../forms/fields.js';
import { errorMessage } from '../lib/utils.js';

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

/** Why a decision's Jev strategy cannot use `entry` (or a missing id), else undefined. */
function unavailable(
  id: string,
  entry: ClassifierModelSummary | undefined,
): { tag: string; why: string } | undefined {
  if (!entry)
    return {
      tag: 'not in catalog',
      why: `${id} is not in the classifier catalog. The draft cannot be published until you choose an available model, or register ${id} again in Settings, Classifier models.`,
    };
  if (!entry.primitives.includes('choice'))
    return {
      tag: 'no Choice',
      why: `${named(entry)} cannot answer Choice decisions. The draft cannot be published until you choose a model with Choice / classification.`,
    };
  if (!entry.enabled)
    return {
      tag: 'disabled',
      why: `${named(entry)} is disabled, so this decision skips its Jev strategy. Enable it in Settings, Classifier models, or choose another model.`,
    };
  if (!entry.configured)
    return {
      tag: 'needs a key',
      why: `${named(entry)} needs a key, so this decision skips its Jev strategy until it is set. ${entry.configurationReason ?? 'Set it in Settings, Secrets.'}`,
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
 */
export function ClassifierField({ schema, name, label }: FieldProps) {
  const field = useField(name);
  const query = useClassifierModels();
  const statusId = `${useId()}-status`;
  const { required, help } = fieldMeta(schema);
  const value = typeof field.value === 'string' ? field.value : undefined;
  const entries = query.data ?? [];
  const builtin = entries.find((entry) => entry.id === BUILTIN_CLASSIFIER);
  // An explicit `jev` is the built-in: it shows as the default option and is left as it is.
  const chosen = value === undefined || value === BUILTIN_CLASSIFIER ? undefined : value;
  const options = entries.filter((entry) => entry.id !== BUILTIN_CLASSIFIER && selectable(entry));
  const current = chosen === undefined ? builtin : entries.find((entry) => entry.id === chosen);
  const problem = query.isSuccess ? unavailable(chosen ?? BUILTIN_CLASSIFIER, current) : undefined;
  const stale = chosen !== undefined && !options.some((entry) => entry.id === chosen);

  const defaultLabel = (() => {
    const base = `${builtin?.displayName ?? 'Jev'} (${BUILTIN_CLASSIFIER}), the default`;
    const tag = builtin && unavailable(BUILTIN_CLASSIFIER, builtin)?.tag;
    return tag ? `${base} (${tag})` : base;
  })();

  const status = query.isPending
    ? 'Loading classifier models…'
    : query.isError
      ? `Classifier models could not be loaded: ${errorMessage(query.error)}. The current choice is kept.`
      : problem?.why;

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
            onChange={(event) => {
              field.onChange(event.target.value === '' ? undefined : event.target.value);
              field.onBlur();
            }}
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
