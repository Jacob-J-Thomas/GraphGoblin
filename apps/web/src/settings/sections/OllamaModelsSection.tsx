import { GraphGoblinApiError, modelCatalog, ollama } from '@graphgoblin/api-client';
import {
  OllamaConnectionUpdateSchema,
  type OllamaConnectionView,
  type OllamaDiscoveryStatus,
} from '@graphgoblin/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useApi } from '../../api/context.js';
import { refreshOllamaState, useOllamaConnection } from '../../api/ollama.js';
import { keys, refreshCatalogState, useModelCatalog } from '../../api/queries.js';
import { Icon } from '../../components/icons/index.js';
import { QueryState } from '../../components/status.js';
import {
  Badge,
  Button,
  CHECKBOX_LABEL,
  Checkbox,
  Disclosure,
  FieldGroup,
  HelpText,
  Input,
  Label,
  Table,
  Td,
  Th,
} from '../../components/ui/index.js';
import { effortOptionLabel } from '../../forms/fields/model.js';
import { errorMessage, formatDateTime } from '../../lib/utils.js';
import { EnableSwitch, restoreVanishedToggleFocus, type CatalogEntry } from '../shared.js';

export function discoveryRelativeTime(timestamp: string, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - Date.parse(timestamp)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function DiscoveryTime({ value }: { value: string }) {
  return (
    <time dateTime={value} title={formatDateTime(value)}>
      {discoveryRelativeTime(value)}
    </time>
  );
}

function DiscoveryLine({ view }: { view: OllamaConnectionView }) {
  const { connection, discovery } = view;
  const problem = discovery.error?.message?.trim() || 'The Ollama server could not be reached.';
  if (!connection.enabled) return <>Not refreshing while off.</>;
  if (discovery.state === 'refreshing') return <>Refreshing models…</>;
  if (discovery.state === 'error')
    return discovery.lastSuccessAt ? (
      <>
        Last refresh failed{' '}
        {discovery.lastAttemptAt ? <DiscoveryTime value={discovery.lastAttemptAt} /> : null}:{' '}
        {problem}
        {/[.!?]$/.test(problem) ? ' ' : '. '}Showing models from{' '}
        <DiscoveryTime value={discovery.lastSuccessAt} />.
      </>
    ) : (
      <>Couldn’t list models: {problem}</>
    );
  return discovery.lastSuccessAt ? (
    <>
      Models refreshed <DiscoveryTime value={discovery.lastSuccessAt} />
    </>
  ) : (
    <>Not refreshed yet</>
  );
}

function connectionOutcome(view: OllamaConnectionView): string {
  if (!view.connection.enabled) return 'Ollama connection saved. Ollama is off.';
  if (view.discovery.state === 'error')
    return `Ollama connection saved, but models couldn’t be listed: ${view.discovery.error?.message ?? 'The discovery failed.'}`;
  return 'Ollama connection saved. Models refreshed.';
}

function refreshOutcome(status: OllamaDiscoveryStatus): string {
  return status.state === 'error'
    ? `Couldn’t refresh Ollama models: ${status.error?.message ?? 'The discovery failed.'}`
    : 'Ollama models refreshed.';
}

function ConnectionForm({
  view,
  onOutcome,
}: {
  view: OllamaConnectionView;
  onOutcome: (message: string) => void;
}) {
  const client = useApi();
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState(view.connection.baseUrl);
  const [enabled, setEnabled] = useState(view.connection.enabled);
  const [fieldError, setFieldError] = useState('');
  const save = useMutation({
    mutationFn: (input: { enabled: boolean; baseUrl: string }) => ollama.configure(client, input),
    onSuccess: async (saved) => {
      setBaseUrl(saved.connection.baseUrl);
      setEnabled(saved.connection.enabled);
      onOutcome(connectionOutcome(saved));
      await refreshOllamaState(queryClient, saved);
    },
    onError: (error) => {
      if (error instanceof GraphGoblinApiError && error.status === 400) {
        setFieldError(error.detail ?? error.message);
        document.getElementById('ollama-server-address')?.focus();
      }
    },
  });
  const failure =
    save.error instanceof GraphGoblinApiError && save.error.status === 403
      ? 'This API key can’t change the Ollama connection. Use the gateway owner key.'
      : save.error && !fieldError
        ? errorMessage(save.error)
        : '';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending) return;
    setFieldError('');
    const parsed = OllamaConnectionUpdateSchema.safeParse({ enabled, baseUrl: baseUrl.trim() });
    if (!parsed.success) {
      setFieldError(
        /\/api\/?$/.test(baseUrl.trim())
          ? 'Leave off /api. Enter only the address, like http://127.0.0.1:11434.'
          : 'Enter an http:// or https:// address with only a host and port, like http://127.0.0.1:11434.',
      );
      document.getElementById('ollama-server-address')?.focus();
      return;
    }
    save.mutate(parsed.data);
  };
  return (
    <Disclosure
      label="Connection"
      variant="row"
      defaultOpen={
        !view.connection.enabled ||
        (view.discovery.state === 'error' && !view.discovery.lastSuccessAt)
      }
    >
      <form
        aria-label="Ollama connection"
        onSubmit={submit}
        noValidate
        className="grid gap-4 rounded-md bg-surface-sunken p-4"
      >
        <FieldGroup>
          <Label htmlFor="ollama-server-address" required>
            Server address
          </Label>
          <Input
            id="ollama-server-address"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full max-w-[28rem] font-mono text-sm"
            value={baseUrl}
            readOnly={save.isPending}
            aria-required="true"
            aria-invalid={Boolean(fieldError) || undefined}
            aria-describedby={`ollama-address-help${fieldError ? ' ollama-address-error' : ''}`}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setFieldError('');
              save.reset();
            }}
          />
          <HelpText id="ollama-address-help">
            The Ollama server this gateway uses, like http://127.0.0.1:11434. Refreshing only lists
            installed models; it never downloads or loads them. Servers that need sign-in aren’t
            supported yet.
          </HelpText>
          {fieldError ? (
            <HelpText id="ollama-address-error" role="alert" tone="bad">
              {fieldError}
            </HelpText>
          ) : null}
        </FieldGroup>
        <div className="grid gap-1.5">
          <label className={CHECKBOX_LABEL}>
            <Checkbox
              checked={enabled}
              disabled={save.isPending}
              aria-describedby="ollama-enabled-help"
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Use Ollama on this gateway
          </label>
          <HelpText id="ollama-enabled-help">
            While off, GraphGoblin doesn’t refresh Ollama models. Saving with Ollama off blocks new
            Ollama requests and closes open requests. Work on the server may continue.
          </HelpText>
        </div>
        {baseUrl !== view.connection.baseUrl ? (
          <HelpText tone="warn">
            Saving checks every Ollama model against this address. Your Enabled choices are kept.
          </HelpText>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save connection'}
          </Button>
          {failure ? (
            <HelpText role="alert" tone="bad">
              {failure}
            </HelpText>
          ) : null}
        </div>
      </form>
    </Disclosure>
  );
}

/** Ollama's connection, discovered facts and owner enablement remain independent. */
export function OllamaModelsSection() {
  const client = useApi();
  const queryClient = useQueryClient();
  const connection = useOllamaConnection();
  const catalog = useModelCatalog();
  const [notice, setNotice] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const refreshBusyRef = useRef(false);
  const refresh = useMutation({
    mutationFn: () => ollama.refresh(client),
    onSuccess: async (status) => {
      setNotice(refreshOutcome(status));
      await refreshOllamaState(queryClient);
    },
    onError: (error) =>
      setNotice(
        error instanceof GraphGoblinApiError && error.status === 403
          ? 'This API key can’t refresh models. Use a key that can change Settings.'
          : `Couldn’t refresh Ollama models: ${errorMessage(error)}`,
      ),
    onSettled: () => {
      refreshBusyRef.current = false;
    },
  });
  const busy = refresh.isPending || connection.data?.discovery.state === 'refreshing';
  const canRefresh = Boolean(connection.data?.connection.enabled) && !busy && !connection.isError;
  const items = (catalog.data ?? [])
    .filter((entry) => entry.harness === 'ollama')
    .sort((a, b) => a.model.localeCompare(b.model));
  return (
    <section id="ollama" aria-labelledby="ollama-heading" className="border-t border-default">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h3 id="ollama-heading" ref={headingRef} tabIndex={-1} className="text-base font-semibold">
          Ollama
        </h3>
        <Button
          size="sm"
          variant="outline"
          aria-disabled={!canRefresh}
          aria-busy={busy}
          aria-describedby="ollama-status ollama-refresh-help"
          onClick={() => {
            if (!canRefresh || refreshBusyRef.current) return;
            refreshBusyRef.current = true;
            setNotice('');
            refresh.mutate();
          }}
        >
          <Icon name="refresh" className={busy ? 'motion-safe:animate-spin' : undefined} />
          Refresh Ollama models
        </Button>
      </div>
      <span
        role="status"
        aria-atomic="true"
        className={notice ? 'block px-5 pt-3 text-sm wrap-anywhere' : 'sr-only'}
      >
        {notice}
      </span>
      <div className="grid gap-3 px-5 pt-3 pb-4">
        <QueryState query={connection} what="Ollama connection" keepDataOnError>
          {(view) => (
            <>
              <p id="ollama-status" className="text-sm text-muted wrap-anywhere">
                {view.connection.enabled ? 'On' : 'Off'} · <code>{view.connection.baseUrl}</code> ·{' '}
                <DiscoveryLine view={view} />
              </p>
              <ConnectionForm view={view} onOutcome={setNotice} />
            </>
          )}
        </QueryState>
        {connection.isError ? (
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={() => void connection.refetch()}
          >
            Retry connection
          </Button>
        ) : null}
        <p id="ollama-refresh-help" className="text-xs text-muted">
          {connection.data?.connection.enabled
            ? 'Installed models refresh automatically every 5 minutes. Refresh Ollama models checks now.'
            : 'Turn Ollama on and save to refresh.'}
        </p>
        <p className="text-sm">
          <a href="#model-defaults" className="underline underline-offset-2">
            Choose the default Ollama model
          </a>
          <span className="text-xs text-muted">
            {' '}
            · Loops with an explicit model keep their selection.
          </span>
        </p>
        <p className="text-xs text-muted">
          Missing and unsupported models keep their Enabled choice but can’t be chosen for new runs.
        </p>
      </div>
      <div className={catalog.isSuccess ? undefined : 'px-5 pb-4'}>
        <QueryState query={catalog} what="Ollama models">
          {() =>
            items.length ? (
              <Table stack="md" aria-label="Ollama models">
                <thead>
                  <tr>
                    <Th>Model</Th>
                    <Th>Availability</Th>
                    <Th>Efforts</Th>
                    <Th>Enabled</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((entry) => {
                    const availability = entry.availability;
                    const state = availability?.state ?? 'unsupported';
                    return (
                      <tr key={entry.model}>
                        <Td>
                          <code className="text-sm wrap-anywhere">{entry.model}</code>
                          {entry.displayName !== entry.model ? (
                            <p className="text-xs text-muted wrap-anywhere">{entry.displayName}</p>
                          ) : null}
                        </Td>
                        <Td label="Availability">
                          <Badge
                            tone={
                              state === 'available'
                                ? 'good'
                                : state === 'missing'
                                  ? 'neutral'
                                  : 'warn'
                            }
                          >
                            <Icon
                              name={
                                state === 'available'
                                  ? 'check-circle'
                                  : state === 'missing'
                                    ? 'exhausted'
                                    : 'alert'
                              }
                            />
                            {state === 'available'
                              ? 'Available'
                              : state === 'missing'
                                ? 'Missing'
                                : 'Unsupported'}
                          </Badge>
                          {state === 'missing' ? (
                            <p className="mt-1 text-xs text-muted wrap-anywhere">
                              {availability?.reason ?? (
                                <>
                                  Not on the server at the last refresh
                                  {availability ? (
                                    <>
                                      ,{' '}
                                      <time
                                        dateTime={availability.checkedAt}
                                        title={formatDateTime(availability.checkedAt)}
                                      >
                                        {new Date(availability.checkedAt).toLocaleTimeString([], {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </time>
                                    </>
                                  ) : null}
                                  .
                                </>
                              )}
                            </p>
                          ) : state === 'unsupported' && availability?.reason ? (
                            <p className="mt-1 text-xs text-muted wrap-anywhere">
                              {availability.reason}
                            </p>
                          ) : null}
                        </Td>
                        <Td label="Efforts" className="text-sm text-muted">
                          {state === 'unsupported' ? (
                            <>
                              —<span className="sr-only">No supported thinking setting</span>
                            </>
                          ) : (
                            <>
                              {entry.efforts.map(effortOptionLabel).join(', ')} (default{' '}
                              {entry.defaultEffort})
                            </>
                          )}
                        </Td>
                        <Td label="Enabled">
                          <EnableSwitch
                            name={entry.displayName}
                            enabled={entry.enabled}
                            onToggle={async (enabled) => {
                              const updated = await modelCatalog.setEnabled(
                                client,
                                entry.harness,
                                entry.model,
                                enabled,
                              );
                              queryClient.setQueryData<CatalogEntry[]>(keys.catalog, (current) =>
                                current?.map((item) =>
                                  item.harness === updated.harness && item.model === updated.model
                                    ? { ...item, ...updated }
                                    : item,
                                ),
                              );
                              await refreshCatalogState(queryClient);
                            }}
                            onError={async (error, failure) => {
                              if (!(error instanceof GraphGoblinApiError) || error.status !== 404)
                                return;
                              setNotice(`${entry.model}: This model is no longer in the catalog.`);
                              const pending = refreshCatalogState(queryClient);
                              restoreVanishedToggleFocus(failure, headingRef.current, pending);
                              await pending;
                            }}
                          />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted">
                {connection.data?.connection.enabled === false
                  ? 'Ollama is off. Turn it on under Connection and save to list its models.'
                  : connection.data?.discovery.state === 'refreshing'
                    ? 'Looking for installed models…'
                    : connection.data?.discovery.lastSuccessAt
                      ? 'The server listed no installed models at the last refresh.'
                      : 'No Ollama models listed yet.'}
              </p>
            )
          }
        </QueryState>
      </div>
    </section>
  );
}
