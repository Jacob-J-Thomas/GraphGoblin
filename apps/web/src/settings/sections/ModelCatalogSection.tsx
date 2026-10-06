import { GraphGoblinApiError, modelCatalog } from '@graphgoblin/api-client';
import type { Effort } from '@graphgoblin/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useApi } from '../../api/context.js';
import { keys, refreshCatalogState, useModelCatalog } from '../../api/queries.js';
import { Icon } from '../../components/icons/index.js';
import { QueryState } from '../../components/status.js';
import {
  Button,
  Card,
  CHECKBOX_LABEL,
  Checkbox,
  ConfirmAction,
  FIELD_ROW,
  FieldGroup,
  Input,
  Label,
  Legend,
  RequiredNote,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui/index.js';
import { cn } from '../../lib/utils.js';
import {
  EnableSwitch,
  EFFORTS,
  MutationError,
  restoreVanishedToggleFocus,
  type CatalogEntry,
  type MutationMessages,
} from '../shared.js';

export const CATALOG_MESSAGES: MutationMessages = {
  MODEL_MANAGED_BY_HARNESS: 'Harness models can only be enabled or disabled.',
  LITELLM_NOT_CONFIGURED: 'LiteLLM is not configured. Adding local models is not available yet.',
  MODEL_NOT_FOUND: 'This model is no longer in the catalog.',
};

function ModelForm({ initial, onDone }: { initial?: CatalogEntry; onDone: () => void }) {
  const client = useApi();
  const queryClient = useQueryClient();
  const [model, setModel] = useState(initial?.model ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [efforts, setEfforts] = useState<Effort[]>(initial?.efforts ?? ['low', 'medium', 'high']);
  const [defaultEffort, setDefaultEffort] = useState<Effort>(initial?.defaultEffort ?? 'low');
  const save = useMutation({
    mutationFn: () =>
      modelCatalog.upsert(client, initial?.harness ?? 'codex', model, {
        displayName: displayName || model,
        efforts,
        defaultEffort,
        ...(!initial ? { source: 'litellm' as const, enabled: true } : {}),
      }),
    onSuccess: () => {
      // The editor's checks of saved drafts read the catalog too.
      void refreshCatalogState(queryClient);
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form
      onSubmit={submit}
      aria-label={initial ? `Edit ${initial.model}` : 'Add model'}
      className="grid gap-4 rounded-md border border-default bg-surface-sunken p-4"
    >
      {initial ? null : <RequiredNote />}
      <div className={FIELD_ROW}>
        <FieldGroup className="w-[220px]">
          <Label htmlFor="model-id" required={!initial}>
            Model id
          </Label>
          <Input
            id="model-id"
            className="font-mono text-sm"
            value={model}
            aria-required={!initial || undefined}
            disabled={Boolean(initial)}
            onChange={(e) => setModel(e.target.value)}
          />
        </FieldGroup>
        <FieldGroup className="w-[220px]">
          <Label htmlFor="model-name">Display name</Label>
          <Input
            id="model-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </FieldGroup>
        <FieldGroup className="w-[160px]">
          <Label htmlFor="model-default-effort">Default effort</Label>
          <Select
            id="model-default-effort"
            value={defaultEffort}
            onChange={(e) => setDefaultEffort(e.target.value as Effort)}
          >
            {EFFORTS.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </Select>
        </FieldGroup>
      </div>
      <fieldset className="min-w-0">
        <Legend variant="label">Allowed efforts</Legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {EFFORTS.map((e) => (
            <label key={e} className={cn(CHECKBOX_LABEL, 'font-medium')}>
              <Checkbox
                checked={efforts.includes(e)}
                onChange={(ev) =>
                  setEfforts(ev.target.checked ? [...efforts, e] : efforts.filter((x) => x !== e))
                }
              />
              {e}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!model || save.isPending}>
          Save model
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <MutationError error={save.error} messages={CATALOG_MESSAGES} announce />
      </div>
    </form>
  );
}

/** Harness models offer enable controls; local LiteLLM rows also offer metadata actions. */
export function ModelCatalogSection() {
  const client = useApi();
  const queryClient = useQueryClient();
  const query = useModelCatalog();
  const [editing, setEditing] = useState<string | undefined>();
  const [notice, setNotice] = useState('');
  const headingRef = useRef<HTMLSpanElement>(null);
  const hasLocalModels = query.data?.some((entry) => entry.source === 'litellm') ?? false;
  return (
    <Card
      flush
      title={<span ref={headingRef}>Model catalog</span>}
      actions={
        hasLocalModels ? (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Icon name="plus" />
            Add model
          </Button>
        ) : query.data ? (
          <p className="max-w-prose text-sm text-muted">
            Local models served through LiteLLM will appear here once the LiteLLM adapter is
            configured; see the Settings guide, Choose a model and effort.
          </p>
        ) : null
      }
    >
      <div
        role="status"
        aria-atomic="true"
        className={notice ? 'px-5 py-3 text-sm text-status-bad-fg' : 'sr-only'}
      >
        {notice}
      </div>
      {hasLocalModels && editing === 'new' ? (
        <div className="border-b border-default p-5">
          <ModelForm onDone={() => setEditing(undefined)} />
        </div>
      ) : null}
      {/* Loading and error states keep the card padding; the table runs edge to edge. */}
      <div className={query.isSuccess ? undefined : 'p-5'}>
        <QueryState query={query} what="Model catalog">
          {(items) => (
            <Table stack="md">
              <thead>
                <tr>
                  <Th>Model</Th>
                  <Th>Efforts</Th>
                  <Th>Enabled</Th>
                  {hasLocalModels ? <Th className="w-px text-right">Actions</Th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={`${entry.harness}/${entry.model}`}>
                    <Td>
                      {entry.source === 'litellm' &&
                      editing === `${entry.harness}/${entry.model}` ? (
                        <ModelForm initial={entry} onDone={() => setEditing(undefined)} />
                      ) : (
                        <>
                          <span className="font-semibold">{entry.displayName}</span>{' '}
                          <code className="text-xs text-muted">
                            {entry.harness}/{entry.model}
                          </code>
                        </>
                      )}
                    </Td>
                    <Td label="Efforts" className="text-sm text-muted">
                      {entry.efforts.join(', ')} (default {entry.defaultEffort})
                    </Td>
                    <Td label="Enabled">
                      <EnableSwitch
                        name={entry.displayName}
                        enabled={entry.enabled}
                        messages={CATALOG_MESSAGES}
                        onToggle={async (enabled) => {
                          // A new toggle replaces the previous vanished-model notice.
                          setNotice('');
                          const updated = await modelCatalog.setEnabled(
                            client,
                            entry.harness,
                            entry.model,
                            enabled,
                          );
                          queryClient.setQueryData<CatalogEntry[]>(keys.catalog, (items) =>
                            items?.map((item) =>
                              item.harness === updated.harness && item.model === updated.model
                                ? updated
                                : item,
                            ),
                          );
                          await refreshCatalogState(queryClient);
                        }}
                        onError={async (error, failure) => {
                          if (!(error instanceof GraphGoblinApiError) || error.status !== 404)
                            return;
                          setNotice(`${entry.displayName}: ${CATALOG_MESSAGES['MODEL_NOT_FOUND']}`);
                          await refreshCatalogState(queryClient);
                          restoreVanishedToggleFocus(
                            failure,
                            headingRef.current?.closest('h2') ?? null,
                          );
                        }}
                      />
                    </Td>
                    {hasLocalModels ? (
                      <Td className="text-right whitespace-nowrap">
                        {entry.source === 'litellm' ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing(`${entry.harness}/${entry.model}`)}
                              aria-label={`Edit ${entry.model}`}
                            >
                              Edit
                            </Button>
                            <ConfirmAction
                              name={entry.model}
                              onDismiss={(error) => {
                                if (error instanceof GraphGoblinApiError && error.status === 404)
                                  return refreshCatalogState(queryClient);
                              }}
                              consequences={
                                <p>
                                  Model: “{entry.displayName}” ({entry.harness}/{entry.model}).
                                  Removing a LiteLLM model leaves its loops referencing it.
                                </p>
                              }
                              onConfirm={async () => {
                                await modelCatalog.remove(client, entry.harness, entry.model);
                                await refreshCatalogState(queryClient);
                              }}
                            />
                          </>
                        ) : null}
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </QueryState>
      </div>
    </Card>
  );
}
