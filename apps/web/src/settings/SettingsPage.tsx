import { apiKeys, modelCatalog, secrets, settings } from '@graphgoblin/api-client';
import { EffortSchema, type Effort } from '@graphgoblin/contracts';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useApiKeyStore } from '../api/api-key.js';
import { useApi } from '../api/context.js';
import {
  keys,
  useApiKeys,
  useModelCatalog,
  usePreflight,
  useSecrets,
  useSettings,
} from '../api/queries.js';
import { QueryState } from '../components/status.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Label,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui.js';
import { errorMessage, formatDateTime } from '../lib/utils.js';

const EFFORTS = EffortSchema.options;

type CatalogEntry = {
  harness: string;
  model: string;
  displayName: string;
  efforts: Effort[];
  defaultEffort: Effort;
  enabled: boolean;
};

function useInvalidate() {
  const queryClient = useQueryClient();
  return (key: QueryKey) => void queryClient.invalidateQueries({ queryKey: key });
}

function MutationError({ error }: { error: unknown }) {
  return error ? <p className="text-xs text-orange-800">{errorMessage(error)}</p> : null;
}

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
      className="space-y-2 rounded bg-slate-50 p-2"
    >
      <div className="flex gap-2">
        <div>
          <Label htmlFor="model-id">Model id</Label>
          <Input
            id="model-id"
            value={model}
            disabled={Boolean(initial)}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="model-name">Display name</Label>
          <Input
            id="model-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div>
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
        </div>
      </div>
      <fieldset className="flex flex-wrap gap-2 text-sm">
        <legend className="text-xs font-medium">Allowed efforts</legend>
        {EFFORTS.map((e) => (
          <label key={e} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={efforts.includes(e)}
              onChange={(ev) =>
                setEfforts(ev.target.checked ? [...efforts, e] : efforts.filter((x) => x !== e))
              }
            />
            {e}
          </label>
        ))}
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!model || save.isPending}>
          Save model
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <MutationError error={save.error} />
    </form>
  );
}

function ModelCatalogSection() {
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
  return (
    <Card
      title="Model catalog"
      actions={
        <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
          Add model
        </Button>
      }
    >
      {editing === 'new' ? <ModelForm onDone={() => setEditing(undefined)} /> : null}
      <QueryState query={query} what="Model catalog">
        {(items) => (
          <Table>
            <thead>
              <tr>
                <Th>Model</Th>
                <Th>Efforts</Th>
                <Th>Enabled</Th>
                <Th>Actions</Th>
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
                        <span className="font-medium">{entry.displayName}</span>{' '}
                        <code className="text-xs text-slate-500">
                          {entry.harness}/{entry.model}
                        </code>
                      </>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {entry.efforts.join(', ')} (default {entry.defaultEffort})
                  </Td>
                  <Td>
                    <input
                      type="checkbox"
                      aria-label={`Enable ${entry.model}`}
                      checked={entry.enabled}
                      onChange={() => toggle.mutate(entry)}
                    />
                  </Td>
                  <Td>
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
      <MutationError error={toggle.error ?? remove.error} />
    </Card>
  );
}

function DefaultsSection() {
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
          <div className="flex flex-wrap gap-3">
            <div>
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
            </div>
            <div>
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
            </div>
          </div>
        )}
      </QueryState>
      <MutationError error={save.error} />
    </Card>
  );
}

/** The API's rule for secret names (PUT /secrets/{name}). */
const SECRET_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

function SecretsSection() {
  const client = useApi();
  const invalidate = useInvalidate();
  const query = useSecrets();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const set = useMutation({
    mutationFn: () => secrets.set(client, name, value),
    onSuccess: () => {
      setValue('');
      setName('');
      invalidate(keys.secrets);
    },
  });
  const remove = useMutation({
    mutationFn: (secretName: string) => secrets.remove(client, secretName),
    onSuccess: () => invalidate(keys.secrets),
  });
  const nameInvalid = name !== '' && !SECRET_NAME.test(name);
  return (
    <Card title="Secrets">
      <p className="mb-2 text-xs text-slate-500">
        Values are write-only: they are never shown again.
      </p>
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        aria-label="Set secret"
        onSubmit={(e) => {
          e.preventDefault();
          set.mutate();
        }}
      >
        <div>
          <Label htmlFor="secret-name">Name</Label>
          <Input
            id="secret-name"
            value={name}
            aria-invalid={nameInvalid}
            aria-describedby="secret-name-hint"
            onChange={(e) => setName(e.target.value)}
          />
          <p
            id="secret-name-hint"
            className={nameInvalid ? 'text-xs text-orange-800' : 'text-xs text-slate-500'}
          >
            A letter, then letters, digits, _ . or - (up to 128).
          </p>
        </div>
        <div>
          <Label htmlFor="secret-value">Value</Label>
          <Input
            id="secret-value"
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm" disabled={!name || nameInvalid || !value || set.isPending}>
          Set secret
        </Button>
      </form>
      <MutationError error={set.error ?? remove.error} />
      <QueryState query={query} what="Secrets">
        {(items) => (
          <ul className="text-sm">
            {items.map((s) => (
              <li
                key={s.name}
                className="flex items-center justify-between border-b border-slate-100 py-1"
              >
                <span>
                  <code>{s.name}</code>{' '}
                  <span className="text-xs text-slate-500">
                    updated {formatDateTime(s.updatedAt)}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove.mutate(s.name)}
                  aria-label={`Delete secret ${s.name}`}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}

function ApiKeysSection() {
  const client = useApi();
  const invalidate = useInvalidate();
  const query = useApiKeys();
  const [label, setLabel] = useState('');
  const create = useMutation({
    mutationFn: () => apiKeys.create(client, { label, scopes: ['*'] }),
    onSuccess: () => {
      setLabel('');
      invalidate(keys.apiKeys);
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiKeys.revoke(client, id),
    onSuccess: () => invalidate(keys.apiKeys),
  });
  return (
    <Card title="API keys">
      <form
        className="mb-3 flex items-end gap-2"
        aria-label="Create API key"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div>
          <Label htmlFor="key-label">Label</Label>
          <Input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <Button type="submit" size="sm" disabled={!label || create.isPending}>
          Create key
        </Button>
      </form>
      {create.data ? (
        <Alert tone="info" title="Copy this key now. It is shown only once.">
          <code className="break-all" data-testid="new-api-key">
            {create.data.token}
          </code>
        </Alert>
      ) : null}
      <MutationError error={create.error ?? revoke.error} />
      <QueryState query={query} what="API keys">
        {(items) => (
          <ul className="text-sm">
            {items.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between border-b border-slate-100 py-1"
              >
                <span>
                  {k.label} <span className="text-xs text-slate-500">({k.scopes.join(', ')})</span>{' '}
                  {k.revokedAt ? <Badge>revoked</Badge> : null}
                </span>
                {k.revokedAt ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revoke.mutate(k.id)}
                    aria-label={`Revoke ${k.label}`}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}

/** The key this browser sends (GG_REQUIRE_API_KEY mode). The value itself is never shown. */
function BrowserKeySection() {
  const stored = useApiKeyStore((s) => s.key);
  const forget = useApiKeyStore((s) => s.forget);
  return (
    <Card title="This browser's API key">
      {stored ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>A key is stored in this browser and sent with every request.</span>
          <Button size="sm" variant="outline" onClick={forget}>
            Forget key
          </Button>
        </div>
      ) : (
        <p className="text-sm text-slate-600">
          No key is stored. The app asks for one if the server requires it.
        </p>
      )}
    </Card>
  );
}

function PreflightSection() {
  const query = usePreflight();
  return (
    <Card title="Harness preflight">
      <QueryState query={query} what="Preflight">
        {(items) => (
          <ul className="text-sm">
            {items.map((p) => (
              <li key={p.harness}>
                <Badge tone={p.ok && p.authenticated ? 'good' : 'bad'}>
                  {p.ok && p.authenticated ? 'ready' : 'not ready'}
                </Badge>{' '}
                <code>{p.harness}</code> {p.version ? `v${p.version}` : ''}
                {p.problems.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs text-orange-800">
                    {p.problems.map((problem, i) => (
                      <li key={i}>{problem}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div className="space-y-3 p-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <ModelCatalogSection />
      <DefaultsSection />
      <SecretsSection />
      <ApiKeysSection />
      <BrowserKeySection />
      <PreflightSection />
      <Card title="Install">
        <p className="text-sm text-slate-600">
          GraphGoblin is a progressive web app: use your browser&apos;s “Install app” action to open
          it in its own window. The app shell then opens offline; anything that needs the API shows
          an offline notice.
        </p>
      </Card>
    </div>
  );
}
