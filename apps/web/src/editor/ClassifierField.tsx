import type { ClassifierModelSummary } from '@graphgoblin/contracts';
import { useId } from 'react';
import { useWatch } from 'react-hook-form';
import { useClassifierModels } from '../api/queries.js';
import { Icon } from '../components/icons/index.js';
import { HelpText, Select } from '../components/ui/index.js';
import { fieldMeta, Row, useField, type FieldProps } from '../forms/fields/shared.js';
import { errorMessage } from '../lib/utils.js';

function named(entry: ClassifierModelSummary): string {
  return `${entry.displayName} (${entry.id})`;
}

function canChoose(entry: ClassifierModelSummary, primitive: 'choice' | 'noul' | 'score'): boolean {
  return entry.enabled && entry.primitives.includes(primitive);
}

function answerTypePath(name: string): string {
  const segments = name.split('.');
  const evaluation = segments.lastIndexOf('evaluation');
  if (evaluation >= 0) return [...segments.slice(0, evaluation), 'answer', 'type'].join('.');
  return 'answer.type';
}

/** Required explicit primitive-capable classifier selection for a decision. */
export function ClassifierField({ schema, name, label }: FieldProps) {
  const field = useField(name, 'commit');
  const query = useClassifierModels();
  const answerType = useWatch({ name: answerTypePath(name) }) as unknown;
  const id = useId();
  const { required, help } = fieldMeta(schema);
  const value = typeof field.value === 'string' ? field.value : '';
  const primitive = answerType === 'noul' || answerType === 'score' ? answerType : 'choice';
  const primitiveName = primitive === 'noul' ? 'Noul' : primitive === 'score' ? 'Score' : 'Choice';
  const entries = query.data ?? [];
  const options = entries.filter((entry) => canChoose(entry, primitive));
  const current = entries.find((entry) => entry.id === value);
  const stale = value !== '' && !options.some((entry) => entry.id === value);
  const status = query.isPending
    ? 'Loading classifier models…'
    : query.isError
      ? `Classifier models could not be loaded: ${errorMessage(query.error)}. The saved choice is kept.`
      : value === ''
        ? `Choose an enabled classifier that supports ${primitiveName}.`
        : !current
          ? `${value} is no longer in the classifier catalog. Choose an available classifier.`
          : !current.primitives.includes(primitive)
            ? `${named(current)} cannot answer ${primitiveName} decisions. Choose a ${primitiveName}-capable classifier.`
            : !current.enabled
              ? `${named(current)} is disabled. Enable it in Settings or choose another classifier.`
              : !current.configured
                ? `${named(current)} needs a key. Configure it in Settings, Secrets.`
                : undefined;
  const statusId = `${id}-status`;
  return (
    <Row name={name} label={label} htmlFor={id} help={help} required={required}>
      {(control) => (
        <>
          <Select
            {...control}
            id={id}
            value={value}
            aria-describedby={
              [control['aria-describedby'], status ? statusId : ''].filter(Boolean).join(' ') ||
              undefined
            }
            onChange={(event) => field.onChange(event.target.value || undefined)}
            onBlur={field.onBlur}
          >
            <option value="">(choose a classifier)</option>
            {stale ? (
              <option value={value}>
                {current ? named(current) : value}
                {!current
                  ? ' (not in catalog)'
                  : !current.enabled
                    ? ' (disabled)'
                    : ` (not ${primitiveName}-capable)`}
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
            <HelpText id={statusId} role={query.isPending ? 'status' : undefined}>
              {query.isSuccess && (value === '' || stale || current?.configured === false) ? (
                <Icon
                  name="alert"
                  className="mr-1 inline size-3.5 align-text-bottom text-status-warn-fg"
                />
              ) : null}
              {status}
            </HelpText>
          ) : null}
        </>
      )}
    </Row>
  );
}
