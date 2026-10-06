import { settings } from '@graphgoblin/api-client';
import { useMutation } from '@tanstack/react-query';
import { useApi } from '../../api/context.js';
import { keys, useModelCatalog, useSettings } from '../../api/queries.js';
import { QueryState } from '../../components/status.js';
import { Card, FieldGroup, FieldRow, HelpText, Label, Select } from '../../components/ui/index.js';
import { EFFORTS, MutationError, useInvalidate } from '../shared.js';

/** The owner's default model and effort, read by the engine at run start. */
export function DefaultsSection() {
  const client = useApi();
  const invalidate = useInvalidate();
  const settingsQuery = useSettings();
  const catalogQuery = useModelCatalog();
  const storedModel = settingsQuery.data?.['defaultModel'];
  const defaultModel = typeof storedModel === 'string' ? storedModel : '';
  const currentEntry = catalogQuery.data?.find((entry) => entry.model === defaultModel);
  const unavailable = Boolean(defaultModel && catalogQuery.data && !currentEntry?.enabled);
  // "(server default)" removes the setting, so the server's configured default applies again.
  const save = useMutation({
    mutationFn: async ([key, value]: [string, string]) => {
      if (value === '') {
        if (settingsQuery.data?.[key] !== undefined) await settings.remove(client, key);
        return;
      }
      await settings.update(client, { [key]: value });
    },
    onSuccess: () => invalidate(keys.settings),
  });
  return (
    <Card title="Defaults">
      <QueryState query={settingsQuery} what="Settings">
        {(values) => (
          <FieldRow>
            <FieldGroup className="w-[240px]">
              <Label htmlFor="default-model">Default model</Label>
              <Select
                id="default-model"
                value={defaultModel}
                aria-describedby={unavailable ? 'default-model-help' : undefined}
                onChange={(e) => save.mutate(['defaultModel', e.target.value])}
              >
                <option value="">(server default)</option>
                {defaultModel && !currentEntry?.enabled ? (
                  <option value={defaultModel}>
                    {currentEntry
                      ? `${currentEntry.displayName} (disabled)`
                      : catalogQuery.data
                        ? `${defaultModel} (not in catalog)`
                        : defaultModel}
                  </option>
                ) : null}
                {(catalogQuery.data ?? [])
                  .filter((m) => m.enabled)
                  .map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.displayName}
                    </option>
                  ))}
              </Select>
              {unavailable ? (
                <HelpText id="default-model-help">
                  Runs keep using this model until you choose another model or (server default).
                </HelpText>
              ) : null}
            </FieldGroup>
            <FieldGroup className="w-[200px]">
              <Label htmlFor="default-effort">Default effort</Label>
              <Select
                id="default-effort"
                value={typeof values['defaultEffort'] === 'string' ? values['defaultEffort'] : ''}
                onChange={(e) => save.mutate(['defaultEffort', e.target.value])}
              >
                <option value="">(server default)</option>
                {EFFORTS.map((e) => (
                  <option key={e}>{e}</option>
                ))}
              </Select>
            </FieldGroup>
          </FieldRow>
        )}
      </QueryState>
      <MutationError error={save.error} />
    </Card>
  );
}
