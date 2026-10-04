import { settings } from '@graphgoblin/api-client';
import { useMutation } from '@tanstack/react-query';
import { useApi } from '../../api/context.js';
import { keys, useModelCatalog, useSettings } from '../../api/queries.js';
import { QueryState } from '../../components/status.js';
import { Card, FieldGroup, Label, Select } from '../../components/ui/index.js';
import { EFFORTS, MutationError, useInvalidate } from '../shared.js';

/** The owner's default model and effort, read by the engine at run start. */
export function DefaultsSection() {
  const client = useApi();
  const invalidate = useInvalidate();
  const settingsQuery = useSettings();
  const catalogQuery = useModelCatalog();
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
          <div className="flex flex-wrap gap-4">
            <FieldGroup className="w-[240px]">
              <Label htmlFor="default-model">Default model</Label>
              <Select
                id="default-model"
                value={typeof values['defaultModel'] === 'string' ? values['defaultModel'] : ''}
                onChange={(e) => save.mutate(['defaultModel', e.target.value])}
              >
                <option value="">(server default)</option>
                {(catalogQuery.data ?? [])
                  .filter((m) => m.enabled)
                  .map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.displayName}
                    </option>
                  ))}
              </Select>
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
          </div>
        )}
      </QueryState>
      <MutationError error={save.error} />
    </Card>
  );
}
