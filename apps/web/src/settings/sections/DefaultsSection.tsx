import { settings } from '@graphgoblin/api-client';
import {
  EffortSchema,
  HarnessIdSchema,
  JsonValueSchema,
  type ModelCatalogEntry,
} from '@graphgoblin/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../api/context.js';
import { keys, useModelCatalog, usePreflight, useSettings } from '../../api/queries.js';
import { harnessReadiness, readinessLine, type HarnessReadiness } from '../../api/readiness.js';
import { Icon } from '../../components/icons/index.js';
import { QueryState } from '../../components/status.js';
import { Card, FieldGroup, FieldRow, HelpText, Label, Select } from '../../components/ui/index.js';
import { inheritedClaudeEfforts } from '../../forms/fields/model.js';
import { MutationError } from '../shared.js';

interface HarnessDefaults {
  model?: string;
  effort?: string;
}
interface DefaultsValue {
  byHarness?: Record<string, HarnessDefaults>;
}
interface SaveDefaults {
  harness: string;
  values: HarnessDefaults;
}

/**
 * One short line under a harness's defaults: the saved model's catalog problem first, then the
 * harness's readiness. The full readiness problem and its next step are in Harness preflight.
 */
function defaultsHelp({
  harness,
  saved,
  catalogLoading,
  catalogKnown,
  entry,
  readiness,
}: {
  harness: string;
  saved: string;
  catalogLoading: boolean;
  catalogKnown: boolean;
  entry: ModelCatalogEntry | undefined;
  readiness: HarnessReadiness;
}): { text: string; tone: 'muted' | 'warn' } | undefined {
  if (saved && catalogLoading) return { text: 'Checking…', tone: 'muted' };
  if (saved && !catalogKnown)
    return {
      text: 'Could not load the model catalog. The saved default stays until you change it.',
      tone: 'warn',
    };
  if (saved && !entry)
    return {
      text: 'Not in the model catalog. Choose another default before publishing or running.',
      tone: 'warn',
    };
  if (entry?.enabled === false)
    return {
      text: 'Disabled in the model catalog. Enable it or choose another default.',
      tone: 'warn',
    };
  // Without a saved model nothing waits on the first check.
  if (readiness.state === 'checking')
    return saved ? { text: readinessLine(harness, readiness), tone: 'muted' } : undefined;
  if (readiness.state !== 'ready')
    return {
      text: `${readinessLine(harness, readiness)} See Harness preflight below.`,
      tone: 'warn',
    };
  if (
    saved &&
    harness === 'claude' &&
    !readiness.item?.models?.some((model) => model.model === saved)
  )
    return { text: 'Not listed by the Claude adapter. Choose another default.', tone: 'warn' };
  return undefined;
}

/** Owner defaults are independent for each harness; changing one preserves every other entry. */
export function DefaultsSection() {
  const client = useApi();
  const queryClient = useQueryClient();
  const settingsQuery = useSettings();
  const catalogQuery = useModelCatalog();
  const preflightQuery = usePreflight();
  const save = useMutation({
    mutationFn: async ({ harness, values }: SaveDefaults) => {
      const saved =
        queryClient.getQueryData<Record<string, unknown>>(keys.settings) ?? settingsQuery.data;
      const defaults = saved?.['defaults'];
      const current =
        defaults !== null && typeof defaults === 'object' && !Array.isArray(defaults)
          ? ((defaults as DefaultsValue).byHarness ?? {})
          : {};
      const byHarness = { ...current };
      if (values.model || values.effort)
        byHarness[harness] = {
          ...(values.model ? { model: values.model } : {}),
          ...(values.effort ? { effort: values.effort } : {}),
        };
      else delete byHarness[harness];
      if (Object.keys(byHarness).length === 0) {
        await settings.remove(client, 'defaults');
        return settings.get(client);
      }
      return settings.update(client, { defaults: JsonValueSchema.parse({ byHarness }) });
    },
    onSuccess: async (authoritative) => {
      queryClient.setQueryData(keys.settings, authoritative);
      await queryClient.invalidateQueries({ queryKey: keys.settings, exact: true });
    },
  });
  return (
    <Card title="Defaults">
      <QueryState query={settingsQuery} what="Settings">
        {(values) => {
          const saved = values['defaults'];
          const valuesByHarness =
            saved !== null && typeof saved === 'object' && !Array.isArray(saved)
              ? ((saved as DefaultsValue).byHarness ?? {})
              : {};
          const known = new Set<string>(['codex', 'claude']);
          for (const entry of catalogQuery.data ?? []) known.add(entry.harness);
          for (const harness of Object.keys(valuesByHarness)) known.add(harness);
          const harnesses = [...known]
            .filter((harness) => HarnessIdSchema.safeParse(harness).success)
            .sort((left, right) =>
              left === 'codex' ? -1 : right === 'codex' ? 1 : left.localeCompare(right),
            );
          return (
            <div className="grid gap-5">
              {harnesses.map((harness) => {
                const current = valuesByHarness[harness] ?? {};
                const selectedModel = current.model ?? '';
                const selectedEffort = current.effort ?? '';
                const entries = (catalogQuery.data ?? []).filter(
                  (entry) => entry.harness === harness,
                );
                const selectedEntry = entries.find((entry) => entry.model === selectedModel);
                // A background recheck keeps the last result, so a ready harness keeps its choices.
                const readiness = harnessReadiness(preflightQuery, harness);
                const listed = readiness.item?.models;
                // Claude choices are the adapter's listed models, offered only while Claude is ready.
                const availableEntries = entries.filter(
                  (entry) =>
                    entry.enabled &&
                    (harness !== 'claude' ||
                      (readiness.state === 'ready' &&
                        listed?.some((model) => model.model === entry.model))),
                );
                const catalogKnown = catalogQuery.data !== undefined && !catalogQuery.isError;
                const savedOption = !selectedEntry
                  ? `${selectedModel} (${catalogKnown ? 'not in catalog' : 'saved'})`
                  : `${selectedEntry.displayName} (${selectedEntry.enabled ? 'saved' : 'disabled'})`;
                const help = defaultsHelp({
                  harness,
                  saved: selectedModel,
                  catalogLoading: catalogQuery.data === undefined && catalogQuery.isFetching,
                  catalogKnown,
                  entry: selectedEntry,
                  readiness,
                });
                const helpId = `default-model-${harness}-help`;
                const effortHelpId = `default-effort-${harness}-help`;
                const modelLabel =
                  harness === 'codex' ? 'Default model' : `Default model (${harness})`;
                const effortLabel =
                  harness === 'codex' ? 'Default effort' : `Default effort (${harness})`;
                const effortOptions =
                  selectedEntry?.efforts ??
                  (harness === 'claude'
                    ? inheritedClaudeEfforts(availableEntries, listed)
                    : EffortSchema.options);
                return (
                  <section key={harness} aria-label={`${harness} defaults`} className="grid gap-2">
                    <h3 className="text-sm font-semibold capitalize">{harness}</h3>
                    <FieldRow>
                      <FieldGroup className="w-[240px]">
                        <Label htmlFor={`default-model-${harness}`}>{modelLabel}</Label>
                        <Select
                          id={`default-model-${harness}`}
                          value={selectedModel}
                          disabled={save.isPending}
                          aria-describedby={help ? helpId : undefined}
                          onChange={(e) =>
                            save.mutate({
                              harness,
                              values: { model: e.target.value, effort: selectedEffort },
                            })
                          }
                        >
                          <option value="">(server default)</option>
                          {selectedModel &&
                          !availableEntries.some((entry) => entry.model === selectedModel) ? (
                            <option value={selectedModel}>{savedOption}</option>
                          ) : null}
                          {availableEntries.map((entry) => (
                            <option key={entry.model} value={entry.model}>
                              {entry.displayName}
                            </option>
                          ))}
                        </Select>
                      </FieldGroup>
                      <FieldGroup className="w-[200px]">
                        <Label htmlFor={`default-effort-${harness}`}>{effortLabel}</Label>
                        <Select
                          id={`default-effort-${harness}`}
                          value={selectedEffort}
                          disabled={save.isPending}
                          aria-describedby={harness === 'claude' ? effortHelpId : undefined}
                          onChange={(e) =>
                            save.mutate({
                              harness,
                              values: { model: selectedModel, effort: e.target.value },
                            })
                          }
                        >
                          <option value="">(server default)</option>
                          {selectedEffort &&
                          !effortOptions.some((effort) => effort === selectedEffort) ? (
                            <option value={selectedEffort} disabled>
                              {selectedEffort} (unavailable)
                            </option>
                          ) : null}
                          {effortOptions.map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </Select>
                        {harness === 'claude' ? (
                          <HelpText id={effortHelpId}>
                            This is the requested effort; Claude does not report the effective
                            effort.
                          </HelpText>
                        ) : null}
                      </FieldGroup>
                    </FieldRow>
                    {help ? (
                      <HelpText id={helpId} tone={help.tone}>
                        {help.tone === 'warn' ? (
                          <Icon name="alert" className="mr-1 inline size-3.5 align-text-bottom" />
                        ) : null}
                        {help.text}
                      </HelpText>
                    ) : null}
                  </section>
                );
              })}
            </div>
          );
        }}
      </QueryState>
      <MutationError error={save.error} />
    </Card>
  );
}
