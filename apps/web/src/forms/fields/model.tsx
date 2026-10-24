import {
  EffortSchema,
  HarnessDefaultsSchema,
  HarnessIdSchema,
  InferenceConfigSchema,
  type ClaudeModelCapability,
  type ModelCatalogEntry,
  type HarnessId,
} from '@graphgoblin/contracts';
import { createContext, use, useId } from 'react';
import { QueryObserver, useQueryClient } from '@tanstack/react-query';
import { useWatch } from 'react-hook-form';
import { Link } from 'react-router';
import { harnessDisplayName } from '@graphgoblin/domain';
import {
  keys,
  useModelCatalog,
  usePreflight,
  useSettings,
  useProcessModelDefaults,
  type HarnessPreflightItem,
} from '../../api/queries.js';
import { harnessReadiness, readinessLine } from '../../api/readiness.js';
import { Icon } from '../../components/icons/index.js';
import { Button, HelpText, Select } from '../../components/ui/index.js';
import { shapeOf, unwrap, type FieldShape, type Schema } from '../introspect.js';
import { isUnset } from '../unset.js';
import { NodeOutputsContext } from '../EarlierNodeOutputs.js';
import { fieldMeta, FormScopeContext, Row, useField, type FieldProps } from './shared.js';
import { DefaultField } from './structure.js';

/** Read the shared queries at action time; this hook never starts or refetches a lookup. */
export function useHarnessSwitch() {
  const queryClient = useQueryClient();
  return async (
    harness: HarnessId,
    model: unknown,
    effort: unknown,
    loopDefaults: unknown,
    waiting: () => void,
  ) => {
    // An unset model already inherits within the selected harness. An entirely inheriting
    // node needs no catalog, Settings or readiness lookup, even when those are unavailable.
    if (model === undefined && effort === undefined) return { message: undefined };
    const unchanged = (message: string) => ({ message });
    let firstLookupFailed = false;
    const queries = [keys.catalog, keys.settings, keys.preflight].map((queryKey) =>
      queryClient.getQueryCache().find({ queryKey }),
    );
    // A known failure must be reported in this action, never queued behind another lookup.
    const failed = queries.some(
      (query) => query?.state.status === 'error' || query?.state.fetchStatus === 'paused',
    );
    const firstLoads = failed
      ? []
      : queries.flatMap((query) => {
          return query?.state.status === 'pending' &&
            query.state.fetchStatus === 'fetching' &&
            query.state.errorUpdatedAt === 0 &&
            query.promise !== undefined
            ? [query.promise]
            : [];
        });
    if (firstLoads.length) {
      waiting();
      try {
        await Promise.all(firstLoads);
      } catch {
        firstLookupFailed = true;
      }
    }
    const catalog = queryClient.getQueryState<
      (ModelCatalogEntry & { ecosystemDefault: boolean })[]
    >(keys.catalog);
    const settings = queryClient.getQueryState<Record<string, unknown>>(keys.settings);
    const observer = new QueryObserver<HarnessPreflightItem[]>(queryClient, {
      queryKey: keys.preflight,
      enabled: false,
    });
    const readiness = harnessReadiness(observer.getCurrentResult(), harness);
    observer.destroy();
    // Failed checks preserve an authored effort even when the model itself is inherited.
    if (catalog?.status === 'error' || catalog?.fetchStatus === 'paused')
      return unchanged(
        'The harness changed, but model and effort are unchanged. Retry model catalog, then choose a model or switch harness again. Validation is unavailable while the catalog cannot be loaded. An incompatible draft cannot be saved.',
      );
    if (settings?.status === 'error' || settings?.fetchStatus === 'paused')
      return unchanged(
        'The harness changed, but model and effort are unchanged until Settings defaults can be checked. Reload the editor, then choose a model or switch harness again.',
      );
    if (readiness.state !== 'ready' && readiness.state !== 'checking')
      return unchanged(
        `${readinessLine(harness, readiness)} Model and effort are unchanged. Retry ${harnessDisplayName(harness)} preflight, then choose a model or switch harness again.`,
      );
    if (firstLookupFailed)
      return unchanged(
        'A first lookup failed during this harness change. Model and effort are unchanged; review the catalog and readiness results, then choose a model or switch harness again.',
      );
    if (!catalog?.data || !settings?.data || readiness.state === 'checking')
      return unchanged(
        'A catalog, Settings or readiness check is still loading. Model and effort are unchanged; wait for the checks to finish, then choose a model or switch harness again.',
      );
    const owner = HarnessDefaultsSchema.safeParse(settings.data['defaults'] ?? {});
    const loop = HarnessDefaultsSchema.safeParse(loopDefaults ?? {});
    if (!owner.success || !loop.success)
      return unchanged(
        'The harness changed, but model and effort are unchanged because the configured defaults are invalid. Correct the defaults, then choose a model or switch harness again.',
      );
    const defaults = [loop.data.byHarness[harness], owner.data.byHarness[harness]];
    const entries = catalog.data.filter((entry) => entry.harness === harness && entry.enabled);
    const supportedEfforts = (entry: ModelCatalogEntry) =>
      entry.efforts.filter(
        (value) =>
          harness !== 'claude' ||
          readiness.item?.models?.some(
            (capability) => capability.model === entry.model && capability.efforts.includes(value),
          ),
      );
    const candidates = [
      ...defaults.map((value) => value?.model),
      entries.find((entry) => entry.ecosystemDefault)?.model,
    ];
    const entry = candidates.flatMap((candidate) =>
      entries.filter((item) => item.model === candidate && supportedEfforts(item).length > 0),
    )[0];
    if (!entry)
      return unchanged(
        'No enabled compatible configured or ecosystem default is available for the new harness. Model and effort are unchanged; choose an enabled model explicitly or correct the default.',
      );
    const efforts = supportedEfforts(entry);
    const current = EffortSchema.safeParse(effort);
    const nextEffort =
      effort === undefined
        ? undefined
        : current.success && efforts.includes(current.data)
          ? current.data
          : [...defaults.map((value) => value?.effort), entry.defaultEffort].find(
              (value) => value !== undefined && efforts.includes(value),
            );
    if (effort !== undefined && !nextEffort && model !== undefined)
      return unchanged(
        'No compatible default effort is available for the new model. Model and effort are unchanged; choose them explicitly.',
      );
    return {
      ...(model === undefined ? {} : { model: entry.model }),
      effort: nextEffort,
      message: undefined,
    };
  };
}

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
  const node = use(NodeOutputsContext);
  const settings = useSettings();
  const processDefaults = useProcessModelDefaults();
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
  // A background recheck keeps the last result: a ready Claude field stays editable meanwhile.
  const readiness = harnessReadiness(preflightQuery, harnessId);
  const harnessPreflight = readiness.item;
  const modelCapabilities = harnessPreflight?.models;
  const hasClaudeAdmission =
    harnessId !== 'claude' || (readiness.state === 'ready' && modelCapabilities !== undefined);
  const availableEntries = entries.filter((entry) => {
    if (!entry.enabled) return false;
    if (harnessId !== 'claude') return true;
    if (!hasClaudeAdmission) return false;
    return modelCapabilities?.some((capability) => capability.model === entry.model);
  });
  const model = selection ? (kind === 'model' ? value : selectedModel) : selectedModel;
  const selected =
    kind === 'effort' && typeof model === 'object' && model !== null
      ? (model as { mode?: unknown; value?: unknown }).mode === 'explicit'
        ? (model as { value?: unknown }).value
        : undefined
      : model;
  const current = typeof selected === 'string' && !isUnset(selected) ? selected : undefined;
  const owner = HarnessDefaultsSchema.safeParse(settings.data?.['defaults'] ?? {});
  const loop = HarnessDefaultsSchema.safeParse(node?.definition.settings?.defaults ?? {});
  const levels = [
    ...(!defaultsField && loop.success ? [loop.data] : []),
    ...(owner.success ? [owner.data] : []),
    ...(processDefaults.data ? [processDefaults.data] : []),
  ].map((defaults) => defaults.byHarness[HarnessIdSchema.parse(harnessId)]);
  // Missing/failed Settings cannot certify that a lower-level fallback is effective.
  const defaultsKnown = settings.data !== undefined && owner.success && loop.success;
  const inherited = {
    model: defaultsKnown ? levels.find((level) => level?.model !== undefined)?.model : undefined,
    effort: defaultsKnown ? levels.find((level) => level?.effort !== undefined)?.effort : undefined,
  };
  const effectiveModel = current ?? inherited.model;
  return {
    query,
    preflightQuery,
    harnessId,
    entries,
    availableEntries,
    readiness,
    harnessPreflight,
    modelCapabilities,
    hasClaudeAdmission,
    entry: entries.find((entry) => entry.model === (kind === 'model' ? current : effectiveModel)),
    inherited,
    defaultsPending: settings.isPending || processDefaults.isPending,
    catalogNoticeId: `${scope.id}-${sibling(name, 'model')}-catalog`,
  };
}

function CatalogField({
  schema,
  name,
  label,
  kind,
  unsetLabel = '(loop default)',
  selection = false,
}: FieldProps & { kind: 'model' | 'effort'; unsetLabel?: string; selection?: boolean }) {
  const field = useField(name, 'commit');
  const { help, required } = fieldMeta(schema);
  const {
    query,
    preflightQuery,
    harnessId,
    availableEntries,
    readiness,
    harnessPreflight,
    modelCapabilities,
    hasClaudeAdmission,
    entry,
    inherited,
    defaultsPending,
    catalogNoticeId,
  } = useCatalogField(name, kind, field.value);
  const harnessName = harnessDisplayName(harnessId);
  const id = useId();
  const noticeId = kind === 'model' ? catalogNoticeId : `${id}-effort`;
  const raw =
    selection && typeof field.value === 'object' && field.value !== null
      ? (field.value as { mode?: unknown; value?: unknown }).mode === 'explicit'
        ? (field.value as { value?: unknown }).value
        : undefined
      : field.value;
  const value = typeof raw === 'string' ? raw : '';
  const unavailable =
    query.data === undefined || ((kind === 'model' || !entry) && !hasClaudeAdmission);
  // An inherited Claude model must support any offered effort, without choosing a model for it.
  const inheritedEfforts =
    harnessId === 'claude'
      ? inheritedClaudeEfforts(availableEntries, modelCapabilities)
      : EffortSchema.options;
  const efforts: readonly string[] = entry
    ? entry.efforts.filter(
        (effort) =>
          harnessId !== 'claude' ||
          !hasClaudeAdmission ||
          modelCapabilities?.some(
            (capability) => capability.model === entry.model && capability.efforts.includes(effort),
          ),
      )
    : inheritedEfforts;
  const unsupported = kind === 'effort' && !unavailable && value !== '' && !efforts.includes(value);
  const capability =
    kind === 'model' ? modelCapabilities?.find((item) => item.model === value) : undefined;
  const savedHarness =
    kind === 'model' && value !== '' && !entry
      ? query.data?.find((candidate) => candidate.model === value)?.harness
      : undefined;
  const wrongHarness = savedHarness !== undefined && savedHarness !== harnessId;
  const missing =
    kind === 'model' &&
    value !== '' &&
    query.data !== undefined &&
    !query.isError &&
    !query.isFetching &&
    query.fetchStatus !== 'paused' &&
    !entry &&
    !wrongHarness;
  const savedHarnessLabel = savedHarness && harnessDisplayName(savedHarness);
  // Claude is ready but its adapter does not list this catalog entry.
  const notListed =
    kind === 'model' &&
    harnessId === 'claude' &&
    hasClaudeAdmission &&
    entry !== undefined &&
    !capability;
  const disabled = kind === 'model' && entry?.enabled === false;
  const status = wrongHarness
    ? `Saved model belongs to ${savedHarnessLabel}`
    : missing
      ? 'not in catalog'
      : disabled
        ? 'disabled in the catalog'
        : notListed
          ? 'not listed by adapter'
          : undefined;
  const modelLookupUnknown =
    kind === 'model' && value !== '' && !entry && !wrongHarness && !missing;
  const localCode = missing ? 'MODEL_NOT_IN_CATALOG' : disabled ? 'MODEL_DISABLED' : undefined;
  const warnings = use(CatalogWarningsContext).filter(
    (warning) =>
      warning.path === name &&
      (warning.code === 'MODEL_DISABLED' || warning.code === 'MODEL_NOT_IN_CATALOG') &&
      (unavailable || warning.code !== localCode),
  );
  const noEnabled = kind === 'model' && availableEntries.length === 0 && hasClaudeAdmission;
  // Codex choices stay editable whatever its readiness; a known failure is noted, never the
  // first check or a background recheck.
  const harnessNote =
    kind === 'model' &&
    harnessId !== 'claude' &&
    readiness.state !== 'ready' &&
    readiness.state !== 'checking'
      ? readiness.lookupFailed
        ? readinessLine(harnessId, readiness)
        : (harnessPreflight?.problems[0] ?? readinessLine(harnessId, readiness))
      : undefined;
  const kept = 'The saved choice stays until you change it.';
  const messages = (
    unavailable
      ? kind === 'model'
        ? [
            query.data === undefined && (query.isError || query.fetchStatus === 'paused')
              ? 'Cannot load the model catalog. The current values are read-only until it recovers.'
              : query.data === undefined
                ? 'Loading the model catalog. The current values are read-only.'
                : readiness.lookupFailed
                  ? 'Could not check Claude readiness. Model choices are read-only until a retry succeeds.'
                  : readiness.state === 'checking'
                    ? 'Checking Claude readiness. Model choices are read-only until the check finishes.'
                    : readiness.state !== 'ready'
                      ? `${harnessPreflight?.problems[0] ?? readinessLine('claude', readiness)} Model choices are read-only until Claude is ready.`
                      : 'Claude preflight listed no models. Model choices are read-only.',
          ]
        : []
      : [
          ...(modelLookupUnknown
            ? [
                query.isFetching
                  ? `Checking the model catalog. ${kept}`
                  : `Model support is unknown because the catalog lookup could not complete. ${kept}`,
              ]
            : []),
          ...(harnessNote ? [harnessNote] : []),
          ...(kind === 'model' && query.isError
            ? [
                'The model catalog may be out of date. Cached choices are still available; retry to refresh them.',
              ]
            : []),
          ...(status && !wrongHarness
            ? [
                notListed
                  ? `The Claude adapter does not list this model. ${kept}`
                  : `This model is ${status === 'not in catalog' ? 'not in the catalog' : status}. ${kept}`,
              ]
            : []),
          ...(unsupported ? [`This effort is not supported by the selected model. ${kept}`] : []),
          ...(noEnabled
            ? [
                harnessId === 'claude'
                  ? 'No enabled Claude model is listed by the adapter. Enable one in Settings or keep the inherited default.'
                  : 'No enabled models for this harness. Enable a model in Settings or keep the inherited default.',
              ]
            : []),
        ]
  )
    .concat(
      wrongHarness
        ? [
            `Saved model belongs to ${savedHarnessLabel}. Choose a ${harnessName} model or an inherited default from this picker when the harness is ready.`,
          ]
        : [],
    )
    .concat(warnings.map((warning) => `${warning.code}: ${warning.message}`));
  const warn =
    wrongHarness ||
    warnings.length > 0 ||
    query.isError ||
    query.fetchStatus === 'paused' ||
    harnessNote !== undefined ||
    // A known Claude failure is a warning like the policy field's; the first check is not.
    (kind === 'model' &&
      unavailable &&
      query.data !== undefined &&
      !hasClaudeAdmission &&
      readiness.state !== 'checking') ||
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
      ? `${unsetLabel}${unsetLabel === '(loop default)' && inherited.model ? ` (${inherited.model})` : ''}`
      : `Default (${inherited.effort ?? (defaultsPending ? 'checking…' : 'unavailable')})`;
  const inheritedUnsupported =
    kind === 'effort' &&
    value === '' &&
    inherited.effort !== undefined &&
    !unavailable &&
    !efforts.includes(inherited.effort);
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
                else
                  field.onChange(
                    selection
                      ? event.target.value
                        ? { mode: 'explicit', value: event.target.value }
                        : { mode: 'inherit' }
                      : event.target.value || undefined,
                  );
              }}
            >
              <option value="">
                {placeholder}
                {inheritedUnsupported ? ' (not supported by this model)' : ''}
              </option>
              {unavailable ? (
                value !== '' ? (
                  <option value={value} disabled>
                    {value}
                    {` (${status ?? 'saved'})`}
                  </option>
                ) : null
              ) : status || unsupported || modelLookupUnknown ? (
                <option value={value} disabled>
                  {kind === 'model' && entry ? `${entry.displayName} (${value})` : value}
                  {` (${status ?? (modelLookupUnknown ? (query.isFetching ? 'checking model catalog' : 'model support unknown') : 'not supported by this model')})`}
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
                className="justify-self-start"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                Retry model catalog
              </Button>
            ) : null}
            {kind === 'model' &&
            ((harnessId === 'claude' && !hasClaudeAdmission) || harnessNote !== undefined) ? (
              <Button
                size="sm"
                variant="outline"
                className="justify-self-start"
                disabled={preflightQuery.isFetching}
                onClick={() => void preflightQuery.refetch()}
              >
                {`Retry ${harnessName} preflight`}
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
export function EffortSelectionField(props: FieldProps) {
  return <CatalogField {...props} kind="effort" selection />;
}

/** Keep the model's existing explicit/inherit editor, with the inherited identity in sight. */
export function ModelSelectionField(props: FieldProps) {
  const value: unknown = useWatch({ name: props.name });
  const { inherited, defaultsPending } = useCatalogField(`${props.name}.value`, 'model', undefined);
  return (
    <>
      <DefaultField {...props} />
      {typeof value === 'object' &&
      value !== null &&
      'mode' in value &&
      value.mode === 'inherit' ? (
        <HelpText>
          Default model: {inherited.model ?? (defaultsPending ? 'checking…' : 'unavailable')}
        </HelpText>
      ) : null}
    </>
  );
}
