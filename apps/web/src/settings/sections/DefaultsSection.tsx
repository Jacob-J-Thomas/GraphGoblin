import { settings } from '@graphgoblin/api-client';
import { EffortSchema, JsonValueSchema } from '@graphgoblin/contracts';
import { useMutation } from '@tanstack/react-query';
import { useApi } from '../../api/context.js';
import { keys, useModelCatalog, useSettings } from '../../api/queries.js';
import { QueryState } from '../../components/status.js';
import { Card, FieldGroup, FieldRow, HelpText, Label, Select } from '../../components/ui/index.js';
import { MutationError, useInvalidate } from '../shared.js';

interface CodexDefaults {
  model?: string;
  effort?: string;
}
interface DefaultsValue {
  byHarness?: Record<string, CodexDefaults>;
}

/** The owner's Codex defaults, using the same harness-keyed value as loops and the engine. */
export function DefaultsSection() {
  const client = useApi();
  const invalidate = useInvalidate();
  const settingsQuery = useSettings();
  const catalogQuery = useModelCatalog();
  const entries = (catalogQuery.data ?? []).filter((entry) => entry.harness === 'codex');
  const save = useMutation({
    mutationFn: async (next: CodexDefaults) => {
      const saved = settingsQuery.data?.['defaults'];
      const current =
        saved !== null && typeof saved === 'object' && !Array.isArray(saved)
          ? ((saved as DefaultsValue).byHarness ?? {})
          : {};
      const byHarness = { ...current };
      if (next.model || next.effort)
        byHarness['codex'] = {
          ...(next.model ? { model: next.model } : {}),
          ...(next.effort ? { effort: next.effort } : {}),
        };
      else delete byHarness['codex'];
      if (Object.keys(byHarness).length === 0) await settings.remove(client, 'defaults');
      else await settings.update(client, { defaults: JsonValueSchema.parse({ byHarness }) });
    },
    onSuccess: () => invalidate(keys.settings),
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
          const current = valuesByHarness['codex'] ?? {};
          const selectedModel = current.model ?? '';
          const selectedEffort = current.effort ?? '';
          const selectedEntry = entries.find((entry) => entry.model === selectedModel);
          const stale = Boolean(selectedModel && catalogQuery.data && !selectedEntry?.enabled);
          return (
            <FieldRow>
              <FieldGroup className="w-[240px]">
                <Label htmlFor="default-model">Default model</Label>
                <Select
                  id="default-model"
                  value={selectedModel}
                  disabled={save.isPending}
                  aria-describedby={stale ? 'default-model-help' : undefined}
                  onChange={(e) => save.mutate({ model: e.target.value, effort: selectedEffort })}
                >
                  <option value="">(server default)</option>
                  {selectedModel && !selectedEntry?.enabled ? (
                    <option value={selectedModel}>
                      {selectedEntry
                        ? `${selectedEntry.displayName} (disabled)`
                        : catalogQuery.data
                          ? `${selectedModel} (not in catalog)`
                          : selectedModel}
                    </option>
                  ) : null}
                  {entries
                    .filter((entry) => entry.enabled)
                    .map((entry) => (
                      <option key={entry.model} value={entry.model}>
                        {entry.displayName}
                      </option>
                    ))}
                </Select>
                {stale ? (
                  <HelpText id="default-model-help">
                    This saved model is unavailable. Choose an enabled catalog model or (server
                    default) before publishing or running.
                  </HelpText>
                ) : null}
              </FieldGroup>
              <FieldGroup className="w-[200px]">
                <Label htmlFor="default-effort">Default effort</Label>
                <Select
                  id="default-effort"
                  value={selectedEffort}
                  disabled={save.isPending}
                  onChange={(e) => save.mutate({ model: selectedModel, effort: e.target.value })}
                >
                  <option value="">(server default)</option>
                  {EffortSchema.options.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </Select>
              </FieldGroup>
            </FieldRow>
          );
        }}
      </QueryState>
      <MutationError error={save.error} />
    </Card>
  );
}
