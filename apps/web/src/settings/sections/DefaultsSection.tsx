import { settings } from '@graphgoblin/api-client';
import { EffortSchema, HarnessIdSchema, JsonValueSchema } from '@graphgoblin/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../api/context.js';
import { keys, useModelCatalog, usePreflight, useSettings } from '../../api/queries.js';
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
                const preflight = preflightQuery.data?.find((item) => item.harness === harness);
                const capability = preflight?.models?.find((item) => item.model === selectedModel);
                const claudeUnknown =
                  harness === 'claude' &&
                  (!preflightQuery.data ||
                    !preflight?.ok ||
                    !preflight.authenticated ||
                    !preflight.models ||
                    !capability);
                const stale = Boolean(
                  selectedModel && catalogQuery.data && (!selectedEntry?.enabled || claudeUnknown),
                );
                const helpId = `default-model-${harness}-help`;
                const effortHelpId = `default-effort-${harness}-help`;
                const modelLabel =
                  harness === 'codex' ? 'Default model' : `Default model (${harness})`;
                const effortLabel =
                  harness === 'codex' ? 'Default effort' : `Default effort (${harness})`;
                const staleMessage =
                  harness === 'claude' && claudeUnknown
                    ? 'Claude CLI preflight is not ready. Keep this saved value or choose (server default) until it passes.'
                    : 'This saved model is unavailable. Choose an enabled catalog model or (server default) before publishing or running.';
                const availableEntries = entries.filter((entry) => {
                  if (!entry.enabled) return false;
                  if (harness !== 'claude') return true;
                  if (preflight?.ok !== true || !preflight.authenticated) return false;
                  return preflight?.models?.some((model) => model.model === entry.model);
                });
                const effortOptions =
                  selectedEntry?.efforts ??
                  (harness === 'claude'
                    ? inheritedClaudeEfforts(availableEntries, preflight?.models)
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
                          aria-describedby={stale ? helpId : undefined}
                          onChange={(e) =>
                            save.mutate({
                              harness,
                              values: { model: e.target.value, effort: selectedEffort },
                            })
                          }
                        >
                          <option value="">(server default)</option>
                          {selectedModel &&
                          (!availableEntries.some((entry) => entry.model === selectedModel) ||
                            !selectedEntry?.enabled) ? (
                            <option value={selectedModel}>
                              {selectedEntry
                                ? `${selectedEntry.displayName} (${claudeUnknown ? 'access not verified' : selectedEntry.enabled ? 'unavailable' : 'disabled'})`
                                : catalogQuery.data
                                  ? `${selectedModel} (not in catalog)`
                                  : selectedModel}
                            </option>
                          ) : null}
                          {availableEntries.map((entry) => (
                            <option key={entry.model} value={entry.model}>
                              {entry.displayName}
                            </option>
                          ))}
                        </Select>
                        {stale ? <HelpText id={helpId}>{staleMessage}</HelpText> : null}
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
