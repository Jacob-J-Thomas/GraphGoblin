import { EffortSchema } from '@graphgoblin/contracts';
import { createContext, use, useId } from 'react';
import { useWatch } from 'react-hook-form';
import { Link } from 'react-router';
import { useModelCatalog } from '../../api/queries.js';
import { Button, HelpText, Input, Select } from '../../components/ui/index.js';
import { isUnset } from '../unset.js';
import { fieldMeta, Row, useField, type FieldProps } from './shared.js';

/** Validation paths relative to the config/settings form, supplied by the editor. */
export const CatalogWarningsContext = createContext<
  readonly { path?: string | undefined; code: string; message: string }[]
>([]);

function sibling(name: string, key: string): string {
  const parent = name.slice(0, name.lastIndexOf('.') + 1);
  return `${parent}${key}`;
}

/** Watch siblings so changing a harness/model refreshes the choices without changing values. */
function useCatalogField(name: string) {
  const harness: unknown = useWatch({ name: sibling(name, 'harness') });
  const model: unknown = useWatch({ name: sibling(name, 'model') });
  const query = useModelCatalog();
  const harnessId = typeof harness === 'string' && !isUnset(harness) ? harness : 'codex';
  const entries = query.data?.filter((entry) => entry.harness === harnessId) ?? [];
  const current = typeof model === 'string' && !isUnset(model) ? model : undefined;
  return { query, entries, entry: entries.find((entry) => entry.model === current) };
}

function CatalogField({
  schema,
  name,
  label,
  kind,
  unsetLabel = '(loop default)',
}: FieldProps & { kind: 'model' | 'effort'; unsetLabel?: string }) {
  const field = useField(name);
  const { help, required } = fieldMeta(schema);
  const { query, entries, entry } = useCatalogField(name);
  const warnings = use(CatalogWarningsContext).filter(
    (warning) =>
      warning.path === name &&
      (warning.code === 'MODEL_DISABLED' || warning.code === 'MODEL_NOT_IN_CATALOG'),
  );
  const id = useId();
  const noticeId = `${id}-catalog`;
  const value = typeof field.value === 'string' ? field.value : '';
  const unavailable = query.isPending || query.isError;
  const efforts: readonly string[] = entry?.efforts ?? EffortSchema.options;
  const unsupported = kind === 'effort' && value !== '' && !efforts.includes(value);
  const missing = kind === 'model' && value !== '' && !entry;
  const disabled = kind === 'model' && entry?.enabled === false;
  const status = missing ? 'not in catalog' : disabled ? 'disabled in the catalog' : undefined;
  const messages = (
    unavailable
      ? [
          query.isError || query.fetchStatus === 'paused'
            ? 'Cannot load the model catalog. The current value is read-only until it recovers.'
            : 'Loading the model catalog. The current value is read-only.',
        ]
      : [
          ...(status ? [`This model is ${status}. Its saved value is kept.`] : []),
          ...(unsupported
            ? ['This effort is not supported by the selected model. Its saved value is kept.']
            : []),
          ...(kind === 'model' && entries.every((entry) => !entry.enabled)
            ? [
                'No enabled models for this harness. Enable a model in Settings or keep the inherited default.',
              ]
            : []),
        ]
  ).concat(warnings.map((warning) => `${warning.code}: ${warning.message}`));
  const options =
    kind === 'model'
      ? entries
          .filter((entry) => entry.enabled)
          .map((entry) => ({
            value: entry.model,
            label: `${entry.displayName} (${entry.model})`,
          }))
      : efforts.map((effort) => ({ value: effort, label: effort }));
  const placeholder =
    kind === 'model'
      ? unsetLabel
      : entry
        ? `(inherited effort; catalog default: ${entry.defaultEffort})`
        : '(inherited effort)';

  return (
    <Row
      name={name}
      label={label}
      htmlFor={id}
      help={help}
      required={required}
      aside={
        kind === 'model' ? (
          <Link className="text-xs text-link underline" to="/settings">
            Model catalog in Settings
          </Link>
        ) : undefined
      }
    >
      {(control) => {
        const describedBy =
          [control['aria-describedby'], messages.length ? noticeId : undefined]
            .filter(Boolean)
            .join(' ') || undefined;
        return (
          <>
            {unavailable ? (
              <Input
                {...control}
                aria-describedby={describedBy}
                readOnly
                value={value || placeholder}
              />
            ) : (
              <Select
                {...control}
                aria-describedby={describedBy}
                value={value}
                onBlur={field.onBlur}
                onChange={(event) => field.onChange(event.target.value || undefined)}
              >
                <option value="">{placeholder}</option>
                {status || unsupported ? (
                  <option value={value} disabled>
                    {kind === 'model' && entry ? `${entry.displayName} (${value})` : value}
                    {` (${status ?? 'not supported by this model'})`}
                  </option>
                ) : null}
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
            {messages.length ? (
              <HelpText id={noticeId} role="status">
                {messages.join(' ')}
              </HelpText>
            ) : null}
            {unavailable ? (
              <Button
                size="sm"
                variant="outline"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                Retry model catalog
              </Button>
            ) : null}
          </>
        );
      }}
    </Row>
  );
}

export function ModelField(props: FieldProps) {
  return <CatalogField {...props} kind="model" />;
}

export function LoopModelField(props: FieldProps) {
  return <CatalogField {...props} kind="model" unsetLabel="(owner default)" />;
}

export function EffortField(props: FieldProps) {
  return <CatalogField {...props} kind="effort" />;
}
