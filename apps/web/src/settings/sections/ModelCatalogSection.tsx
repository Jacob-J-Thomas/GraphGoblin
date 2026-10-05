import { GraphGoblinApiError, modelCatalog } from '@graphgoblin/api-client';
import type { Effort } from '@graphgoblin/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useApi } from '../../api/context.js';
import { keys, useModelCatalog } from '../../api/queries.js';
import { Icon } from '../../components/icons/index.js';
import { QueryState } from '../../components/status.js';
import {
  Button,
  Card,
  Checkbox,
  ConfirmAction,
  FieldGroup,
  Input,
  Label,
  Legend,
  RequiredNote,
  Select,
  Switch,
  Table,
  Td,
  Th,
} from '../../components/ui/index.js';
import { EFFORTS, MutationError, useInvalidate, type CatalogEntry } from '../shared.js';

function ModelForm({ initial, onDone }: { initial?: CatalogEntry; onDone: () => void }) {
  const client = useApi();
  const invalidate = useInvalidate();
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
        enabled: initial?.enabled ?? true,
        ...(!initial ? { source: 'litellm' as const } : {}),
      }),
    onSuccess: () => {
      invalidate(keys.catalog);
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
      <div className="flex flex-wrap gap-3">
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
            <label key={e} className="flex cursor-pointer items-center gap-2 font-medium">
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
        <MutationError error={save.error} announce />
      </div>
    </form>
  );
}

/** Each row owns its request so other models remain operable while it saves. */
function ModelEnabled({ entry }: { entry: CatalogEntry }) {
  const client = useApi();
  const queryClient = useQueryClient();
  const id = useId();
  const restoreFocusRef = useRef(false);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      modelCatalog.setEnabled(client, entry.harness, entry.model, enabled),
    onSuccess: async (updated) => {
      queryClient.setQueryData<CatalogEntry[]>(keys.catalog, (items) =>
        items?.map((item) =>
          item.harness === updated.harness && item.model === updated.model ? updated : item,
        ),
      );
      await queryClient.invalidateQueries({ queryKey: keys.catalog });
    },
  });
  useEffect(() => {
    if (toggle.isPending || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    // Native disabled buttons lose focus in Edge. Preserve a deliberate move to another control.
    if (document.activeElement === document.body) document.getElementById(`${id}-switch`)?.focus();
  }, [id, toggle.isPending]);
  // Only the in-flight control is optimistic; a refusal leaves the catalog and defaults intact.
  const checked = toggle.isPending ? toggle.variables : entry.enabled;
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Switch
          id={`${id}-switch`}
          aria-label={`Enable ${entry.displayName}`}
          aria-describedby={`${id}-status${toggle.error ? ` ${id}-error` : ''}`}
          aria-busy={toggle.isPending}
          checked={checked}
          disabled={toggle.isPending}
          onCheckedChange={(enabled) => {
            restoreFocusRef.current = document.activeElement?.id === `${id}-switch`;
            toggle.mutate(enabled);
          }}
        />
        <span id={`${id}-status`} role="status" aria-atomic="true" className="text-xs text-muted">
          <span className="sr-only">{entry.displayName}:</span>{' '}
          {toggle.isPending ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="wait" />
              {checked ? 'Enabling…' : 'Disabling…'}
            </span>
          ) : entry.enabled ? (
            'Enabled'
          ) : (
            'Disabled'
          )}
        </span>
      </div>
      <MutationError id={`${id}-error`} error={toggle.error} announce />
    </div>
  );
}

/** Harness models offer enable controls; local LiteLLM rows also offer metadata actions. */
export function ModelCatalogSection() {
  const client = useApi();
  const queryClient = useQueryClient();
  const query = useModelCatalog();
  const [editing, setEditing] = useState<string | undefined>();
  const hasLocalModels = query.data?.some((entry) => entry.source === 'litellm') ?? false;
  return (
    <Card
      flush
      title="Model catalog"
      actions={
        hasLocalModels ? (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Icon name="plus" />
            Add model
          </Button>
        ) : (
          <p className="max-w-prose text-sm text-muted">
            Local models served through LiteLLM will appear here once the LiteLLM adapter is
            configured.{' '}
            <a
              href="https://github.com/Jacob-J-Thomas/GraphGoblin/blob/main/docs/guide/06-settings-and-secrets.md#choose-a-model-and-effort"
              className="rounded-sm text-link underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Learn about local models
            </a>
          </p>
        )
      }
    >
      {hasLocalModels && editing === 'new' ? (
        <div className="border-b border-default p-5">
          <ModelForm onDone={() => setEditing(undefined)} />
        </div>
      ) : null}
      {/* Loading and error states keep the card padding; the table runs edge to edge. */}
      <div className={query.isSuccess ? undefined : 'p-5'}>
        <QueryState query={query} what="Model catalog">
          {(items) => (
            <Table>
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
                    <Td className="text-sm text-muted">
                      {entry.efforts.join(', ')} (default {entry.defaultEffort})
                    </Td>
                    <Td>
                      <ModelEnabled entry={entry} />
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
                                  return queryClient.invalidateQueries({ queryKey: keys.catalog });
                              }}
                              consequences={
                                <p>
                                  Model: “{entry.displayName}” ({entry.harness}/{entry.model}).
                                  Removing a LiteLLM model leaves its loops referencing it.
                                </p>
                              }
                              onConfirm={async () => {
                                await modelCatalog.remove(client, entry.harness, entry.model);
                                await queryClient.invalidateQueries({ queryKey: keys.catalog });
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
