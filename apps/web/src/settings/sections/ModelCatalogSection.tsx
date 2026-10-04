import { modelCatalog } from '@graphgoblin/api-client';
import type { Effort } from '@graphgoblin/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useApi } from '../../api/context.js';
import { keys, useModelCatalog } from '../../api/queries.js';
import { Icon } from '../../components/icons/index.js';
import { QueryState } from '../../components/status.js';
import {
  Button,
  Card,
  FieldGroup,
  Input,
  Label,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui/index.js';
import { CHECKBOX, EFFORTS, MutationError, useInvalidate, type CatalogEntry } from '../shared.js';

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
      <div className="flex flex-wrap gap-3">
        <FieldGroup className="w-[220px]">
          <Label htmlFor="model-id">Model id</Label>
          <Input
            id="model-id"
            className="font-mono text-sm"
            value={model}
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
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <legend className="mb-2 text-sm font-medium">Allowed efforts</legend>
        {EFFORTS.map((e) => (
          <label key={e} className="flex cursor-pointer items-center gap-2 font-medium">
            <input
              type="checkbox"
              className={CHECKBOX}
              checked={efforts.includes(e)}
              onChange={(ev) =>
                setEfforts(ev.target.checked ? [...efforts, e] : efforts.filter((x) => x !== e))
              }
            />
            {e}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!model || save.isPending}>
          Save model
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <MutationError error={save.error} />
      </div>
    </form>
  );
}

/** The models runs may use, per harness: add, edit, enable or disable, and delete. */
export function ModelCatalogSection() {
  const client = useApi();
  const invalidate = useInvalidate();
  const query = useModelCatalog();
  const [editing, setEditing] = useState<string | undefined>();
  const toggle = useMutation({
    mutationFn: (entry: CatalogEntry) =>
      modelCatalog.upsert(client, entry.harness, entry.model, {
        displayName: entry.displayName,
        efforts: entry.efforts,
        defaultEffort: entry.defaultEffort,
        enabled: !entry.enabled,
      }),
    onSuccess: () => invalidate(keys.catalog),
  });
  const remove = useMutation({
    mutationFn: (entry: CatalogEntry) => modelCatalog.remove(client, entry.harness, entry.model),
    onSuccess: () => invalidate(keys.catalog),
  });
  const error = toggle.error ?? remove.error;
  return (
    <Card
      flush
      title="Model catalog"
      actions={
        <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
          <Icon name="plus" />
          Add model
        </Button>
      }
    >
      {editing === 'new' ? (
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
                  <Th className="w-px text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={`${entry.harness}/${entry.model}`}>
                    <Td>
                      {editing === entry.model ? (
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
                      <input
                        type="checkbox"
                        className={CHECKBOX}
                        aria-label={`Enable ${entry.model}`}
                        checked={entry.enabled}
                        onChange={() => toggle.mutate(entry)}
                      />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(entry.model)}
                        aria-label={`Edit ${entry.model}`}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove.mutate(entry)}
                        aria-label={`Delete ${entry.model}`}
                      >
                        Delete
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </QueryState>
      </div>
      {error ? (
        <div className="border-t border-default px-5 py-3">
          <MutationError error={error} />
        </div>
      ) : null}
    </Card>
  );
}
