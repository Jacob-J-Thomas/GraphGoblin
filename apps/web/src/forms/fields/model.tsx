import { EffortSchema, InferenceConfigSchema } from '@graphgoblin/contracts';
import { createContext, use, useId } from 'react';
import { useWatch } from 'react-hook-form';
import { Link } from 'react-router';
import { useModelCatalog } from '../../api/queries.js';
import { Icon } from '../../components/icons/index.js';
import { Button, HelpText, Select } from '../../components/ui/index.js';
import { shapeOf, unwrap, type FieldShape, type Schema } from '../introspect.js';
import { isUnset } from '../unset.js';
import { fieldMeta, FormScopeContext, Row, useField, type FieldProps } from './shared.js';

/** Catalog warnings from the editor validation list, already relative to this form's value. */
export const CatalogWarningsContext = createContext<
  readonly { path?: string | undefined; code: string; message: string }[]
>([]);

function sibling(name: string, key: string): string {
  const parent = name.slice(0, name.lastIndexOf('.') + 1);
  return `${parent}${key}`;
}

function useCatalogField(name: string) {
  const scope = use(FormScopeContext)!;
  const harness: unknown = useWatch({ name: sibling(name, 'harness') });
  const model: unknown = useWatch({ name: sibling(name, 'model') });
  const query = useModelCatalog();
  // Read the sibling schema's default even before RHF materializes a defaulted value.
  // Groups without a harness use the inference contract's Codex default.
  let parent: Schema | undefined = scope.schema;
  for (const key of name.split('.').slice(0, -1)) {
    const shape: FieldShape | undefined = parent && shapeOf(parent);
    parent = shape?.kind === 'object' ? shape.shape[key] : undefined;
  }
  const shape = parent && shapeOf(parent);
  const harnessSchema = shape?.kind === 'object' ? shape.shape.harness : undefined;
  const defaultHarness = unwrap(harnessSchema ?? InferenceConfigSchema.shape.harness).defaultValue;
  const harnessId =
    typeof harness === 'string' && !isUnset(harness)
      ? harness
      : typeof defaultHarness === 'string'
        ? defaultHarness
        : InferenceConfigSchema.shape.harness.parse(undefined);
  const entries = query.data?.filter((entry) => entry.harness === harnessId) ?? [];
  const current = typeof model === 'string' && !isUnset(model) ? model : undefined;
  return {
    query,
    entries,
    entry: entries.find((entry) => entry.model === current),
    catalogNoticeId: `${scope.id}-${sibling(name, 'model')}-catalog`,
  };
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
  const { query, entries, entry, catalogNoticeId } = useCatalogField(name);
  const id = useId();
  const noticeId = kind === 'model' ? catalogNoticeId : `${id}-effort`;
  const value = typeof field.value === 'string' ? field.value : '';
  const unavailable = query.data === undefined;
  const efforts: readonly string[] = entry?.efforts ?? EffortSchema.options;
  const unsupported = kind === 'effort' && value !== '' && !efforts.includes(value);
  const missing = kind === 'model' && value !== '' && !entry;
  const disabled = kind === 'model' && entry?.enabled === false;
  const status = missing ? 'not in catalog' : disabled ? 'disabled in the catalog' : undefined;
  const localCode = missing ? 'MODEL_NOT_IN_CATALOG' : disabled ? 'MODEL_DISABLED' : undefined;
  const warnings = use(CatalogWarningsContext).filter(
    (warning) =>
      warning.path === name &&
      (warning.code === 'MODEL_DISABLED' || warning.code === 'MODEL_NOT_IN_CATALOG') &&
      (unavailable || warning.code !== localCode),
  );
  const noEnabled = kind === 'model' && entries.every((entry) => !entry.enabled);
  const messages = (
    unavailable
      ? kind === 'model'
        ? [
            query.isError || query.fetchStatus === 'paused'
              ? 'Cannot load the model catalog. The current values are read-only until it recovers.'
              : 'Loading the model catalog. The current values are read-only.',
          ]
        : []
      : [
          ...(kind === 'model' && query.isError
            ? [
                'The model catalog may be out of date. Cached choices are still available; retry to refresh them.',
              ]
            : []),
          ...(status
            ? [`This model is ${missing ? 'not in the catalog' : status}. Its saved value is kept.`]
            : []),
          ...(unsupported
            ? ['This effort is not supported by the selected model. Its saved value is kept.']
            : []),
          ...(noEnabled
            ? [
                'No enabled models for this harness. Enable a model in Settings or keep the inherited default.',
              ]
            : []),
        ]
  ).concat(warnings.map((warning) => `${warning.code}: ${warning.message}`));
  const warn =
    warnings.length > 0 ||
    query.isError ||
    query.fetchStatus === 'paused' ||
    (!unavailable && (Boolean(status) || unsupported || noEnabled));
  const options =
    kind === 'model'
      ? entries
          .filter((entry) => entry.enabled)
          .map((entry) => ({ value: entry.model, label: `${entry.displayName} (${entry.model})` }))
      : efforts.map((effort) => ({ value: effort, label: effort }));
  const placeholder =
    kind === 'model'
      ? unsetLabel
      : entry
        ? `(inherited; the catalog suggests ${entry.defaultEffort})`
        : '(inherited effort)';
  return (
    <Row
      name={name}
      label={label}
      htmlFor={id}
      help={help}
      required={required}
      after={
        kind === 'model' ? (
          <Link className="touch-target text-xs text-link underline" to="/settings">
            Model catalog in Settings
          </Link>
        ) : undefined
      }
    >
      {(control) => {
        const describedBy =
          [
            control['aria-describedby'],
            messages.length ? noticeId : undefined,
            kind === 'effort' && (unavailable || query.isError) ? catalogNoticeId : undefined,
          ]
            .filter(Boolean)
            .join(' ') || undefined;
        return (
          <>
            <Select
              {...control}
              aria-describedby={describedBy}
              value={value}
              aria-readonly={unavailable || undefined}
              onBlur={field.onBlur}
              onChange={(event) => {
                if (unavailable) event.currentTarget.value = value;
                else field.onChange(event.target.value || undefined);
              }}
            >
              <option value="">{placeholder}</option>
              {unavailable ? (
                value !== '' ? (
                  <option value={value}>{value}</option>
                ) : null
              ) : status || unsupported ? (
                <option value={value} disabled>
                  {kind === 'model' && entry ? `${entry.displayName} (${value})` : value}
                  {` (${status ?? 'not supported by this model'})`}
                </option>
              ) : null}
              {!unavailable &&
                options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </Select>
            {messages.length ? (
              <HelpText id={noticeId} role="status" tone={warn ? 'warn' : 'muted'}>
                {warn ? (
                  <Icon name="alert" className="mr-1 inline size-3.5 align-text-bottom" />
                ) : null}
                {messages.join(' ')}
              </HelpText>
            ) : null}
            {kind === 'model' && (unavailable || query.isError) ? (
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
