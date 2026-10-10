import {
  EffortSchema,
  HarnessIdSchema,
  InferenceConfigSchema,
  type ClaudeModelCapability,
  type ModelCatalogEntry,
} from '@graphgoblin/contracts';
import { createContext, use, useId } from 'react';
import { useWatch } from 'react-hook-form';
import { Link } from 'react-router';
import { useModelCatalog, usePreflight } from '../../api/queries.js';
import { Icon } from '../../components/icons/index.js';
import { Button, HelpText, Select } from '../../components/ui/index.js';
import { shapeOf, unwrap, type FieldShape, type Schema } from '../introspect.js';
import { isUnset } from '../unset.js';
import { fieldMeta, FormScopeContext, Row, useField, type FieldProps } from './shared.js';

/** Safe inherited choices shared by node/loop pickers and owner defaults; never selects a model. */
export function inheritedClaudeEfforts(
  entries: readonly ModelCatalogEntry[],
  capabilities: readonly ClaudeModelCapability[] | undefined,
): readonly string[] {
  return (
    entries[0]?.efforts.filter((effort) =>
      entries.every(
        (entry) =>
          entry.efforts.includes(effort) &&
          capabilities?.some(
            (capability) => capability.model === entry.model && capability.efforts.includes(effort),
          ),
      ),
    ) ?? []
  );
}

/** Catalog warnings from the editor validation list, already relative to this form's value. */
export const CatalogWarningsContext = createContext<
  readonly { path?: string | undefined; code: string; message: string }[]
>([]);

function sibling(name: string, key: string): string {
  const parent = name.slice(0, name.lastIndexOf('.') + 1);
  return `${parent}${key}`;
}

function child(name: string, key: string): string {
  return name ? `${name}.${key}` : key;
}

/** A model or effort under `defaults.byHarness.<harness>` in the active form schema. */
function defaultsHarnessField(
  schema: Schema,
  name: string,
): { harness: string; mapPath: string } | undefined {
  const segments = name.split('.');
  const field = segments.at(-1);
  if (field !== 'model' && field !== 'effort') return undefined;
  let parent: Schema | undefined = schema;
  const traversed: string[] = [];
  for (const key of segments.slice(0, -1)) {
    const shape: FieldShape | undefined = parent && shapeOf(parent);
    if (shape?.kind === 'object') parent = shape.shape[key];
    else if (shape?.kind === 'record') {
      if (traversed.at(-1) === 'byHarness' && traversed.at(-2) === 'defaults') {
        const harness = HarnessIdSchema.safeParse(key);
        const entry = shapeOf(shape.value);
        if (!harness.success || entry.kind !== 'object' || !Object.hasOwn(entry.shape, field))
          return undefined;
        return { harness: harness.data, mapPath: traversed.join('.') };
      }
      parent = shape.value;
    } else return undefined;
    traversed.push(key);
  }
  return undefined;
}

function useCatalogField(name: string, kind: 'model' | 'effort', value: unknown) {
  const scope = use(FormScopeContext)!;
  const segments = name.split('.');
  const defaultsField = defaultsHarnessField(scope.schema, name);
  const defaultsByHarness: unknown = useWatch({
    name: defaultsField?.mapPath ?? name,
  });
  const loopHarness =
    defaultsField &&
    typeof defaultsByHarness === 'object' &&
    defaultsByHarness !== null &&
    !Array.isArray(defaultsByHarness) &&
    Object.hasOwn(defaultsByHarness, defaultsField.harness)
      ? HarnessIdSchema.safeParse(defaultsField.harness).data
      : undefined;
  const selection =
    segments.at(-1) === 'value' && ['model', 'effort'].includes(segments.at(-2) ?? '');
  const selectionRoot = selection ? segments.slice(0, -2).join('.') : undefined;
  const harness: unknown = useWatch({
    name: selection ? child(selectionRoot ?? '', 'harness') : sibling(name, 'harness'),
  });
  const selectedModel: unknown = useWatch({
    name: selection ? child(selectionRoot ?? '', 'model') : sibling(name, 'model'),
  });
  const query = useModelCatalog();
  const preflightQuery = usePreflight();
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
      : (loopHarness ??
        (typeof defaultHarness === 'string'
          ? defaultHarness
          : InferenceConfigSchema.shape.harness.parse(undefined)));
  const entries = query.data?.filter((entry) => entry.harness === harnessId) ?? [];
  const harnessPreflight = preflightQuery.data?.find((item) => item.harness === harnessId);
  const modelCapabilities = harnessPreflight?.models;
  const hasClaudeAdmission =
    harnessId !== 'claude' ||
    (harnessPreflight?.ok === true &&
      harnessPreflight.authenticated &&
      modelCapabilities !== undefined);
  const availableEntries = entries.filter((entry) => {
    if (!entry.enabled) return false;
    if (harnessId !== 'claude') return true;
    if (!hasClaudeAdmission) return false;
    return modelCapabilities?.some((capability) => capability.model === entry.model);
  });
  const model = selection ? (kind === 'model' ? value : selectedModel) : selectedModel;
  const selected =
    selection && kind === 'effort' && typeof model === 'object' && model !== null
      ? (model as { mode?: unknown; value?: unknown }).mode === 'explicit'
        ? (model as { value?: unknown }).value
        : undefined
      : model;
  const current = typeof selected === 'string' && !isUnset(selected) ? selected : undefined;
  return {
    query,
    preflightQuery,
    harnessId,
    entries,
    availableEntries,
    harnessPreflight,
    modelCapabilities,
    hasClaudeAdmission,
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
  const field = useField(name, 'commit');
  const { help, required } = fieldMeta(schema);
  const {
    query,
    preflightQuery,
    harnessId,
    availableEntries,
    harnessPreflight,
    modelCapabilities,
    hasClaudeAdmission,
    entry,
    catalogNoticeId,
  } = useCatalogField(name, kind, field.value);
  const id = useId();
  const noticeId = kind === 'model' ? catalogNoticeId : `${id}-effort`;
  const value = typeof field.value === 'string' ? field.value : '';
  const unavailable =
    query.data === undefined || ((kind === 'model' || !entry) && !hasClaudeAdmission);
  // An inherited Claude model must support any offered effort, without choosing a model for it.
  const inheritedEfforts =
    harnessId === 'claude'
      ? inheritedClaudeEfforts(availableEntries, modelCapabilities)
      : EffortSchema.options;
  const efforts: readonly string[] = entry?.efforts ?? inheritedEfforts;
  const unsupported = kind === 'effort' && !unavailable && value !== '' && !efforts.includes(value);
  const capability =
    kind === 'model' ? modelCapabilities?.find((item) => item.model === value) : undefined;
  const savedHarness =
    kind === 'model' && value !== '' && !entry
      ? query.data?.find((candidate) => candidate.model === value)?.harness
      : undefined;
  const wrongHarness = savedHarness !== undefined && savedHarness !== harnessId;
  const missing = kind === 'model' && value !== '' && !entry && !wrongHarness;
  const savedHarnessLabel =
    savedHarness === 'codex' ? 'Codex' : savedHarness === 'claude' ? 'Claude' : savedHarness;
  const admissionUnknown =
    kind === 'model' && harnessId === 'claude' && value !== '' && !capability;
  const disabled = kind === 'model' && entry?.enabled === false;
  const status = wrongHarness
    ? `Saved model belongs to ${savedHarnessLabel}`
    : missing
      ? 'not in catalog'
      : admissionUnknown
        ? 'availability not verified'
        : disabled
          ? 'disabled in the catalog'
          : undefined;
  const localCode = missing ? 'MODEL_NOT_IN_CATALOG' : disabled ? 'MODEL_DISABLED' : undefined;
  const warnings = use(CatalogWarningsContext).filter(
    (warning) =>
      warning.path === name &&
      (warning.code === 'MODEL_DISABLED' || warning.code === 'MODEL_NOT_IN_CATALOG') &&
      (unavailable || warning.code !== localCode),
  );
  const noEnabled = kind === 'model' && availableEntries.length === 0 && hasClaudeAdmission;
  const messages = (
    unavailable
      ? kind === 'model'
        ? [
            query.data === undefined && (query.isError || query.fetchStatus === 'paused')
              ? 'Cannot load the model catalog. The current values are read-only until it recovers.'
              : query.data === undefined
                ? 'Loading the model catalog. The current values are read-only.'
                : preflightQuery.isError || preflightQuery.fetchStatus === 'paused'
                  ? 'Claude model availability could not be checked; model choices are read-only until preflight recovers.'
                  : preflightQuery.data === undefined
                    ? 'Checking Claude model availability. Model choices are read-only until preflight completes.'
                    : !harnessPreflight?.ok || !harnessPreflight.authenticated
                      ? 'Claude CLI preflight is not ready; model choices are read-only until it passes.'
                      : 'Claude model availability was not returned by preflight; model choices are read-only.',
          ]
        : []
      : [
          ...(kind === 'model' && query.isError
            ? [
                'The model catalog may be out of date. Cached choices are still available; retry to refresh them.',
              ]
            : []),
          ...(status && !wrongHarness
            ? [
                missing
                  ? 'This model is not in the catalog. Its saved value is kept.'
                  : admissionUnknown
                    ? 'Claude model availability could not be verified. Its saved value is kept.'
                    : `This model is ${missing ? 'not in the catalog' : status}. Its saved value is kept.`,
              ]
            : []),
          ...(unsupported
            ? ['This effort is not supported by the selected model. Its saved value is kept.']
            : []),
          ...(noEnabled
            ? [
                harnessId === 'claude'
                  ? 'No available Claude model is verified. Choose an inherited default or retry preflight.'
                  : 'No enabled models for this harness. Enable a model in Settings or keep the inherited default.',
              ]
            : []),
        ]
  )
    .concat(
      wrongHarness
        ? [
            `Saved model belongs to ${savedHarnessLabel}. Choose a ${harnessId === 'claude' ? 'Claude' : harnessId} model or an inherited default from this picker when the harness is ready.`,
          ]
        : [],
    )
    .concat(warnings.map((warning) => `${warning.code}: ${warning.message}`));
  const warn =
    wrongHarness ||
    warnings.length > 0 ||
    query.isError ||
    query.fetchStatus === 'paused' ||
    (!unavailable && (Boolean(status) || unsupported || noEnabled));
  const options =
    kind === 'model'
      ? availableEntries.map((entry) => ({
          value: entry.model,
          label: `${entry.displayName} (${entry.model})`,
        }))
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
      help={
        kind === 'effort' && harnessId === 'claude'
          ? `${help ? `${help} ` : ''}For Claude, this is the requested effort; the CLI does not report the effective effort.`
          : help
      }
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
                  <option value={value} disabled>
                    {value}
                    {status ? ` (${status})` : ' (saved; unavailable)'}
                  </option>
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
            {kind === 'model' && (query.data === undefined || query.isError) ? (
              <Button
                size="sm"
                variant="outline"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                Retry model catalog
              </Button>
            ) : null}
            {kind === 'model' && harnessId === 'claude' && !hasClaudeAdmission ? (
              <Button
                size="sm"
                variant="outline"
                disabled={preflightQuery.isFetching}
                onClick={() => void preflightQuery.refetch()}
              >
                Retry Claude preflight
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
