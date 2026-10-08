import { classifierModels, GraphGoblinApiError } from '@graphgoblin/api-client';
import type { ClassifierModelSummary } from '@graphgoblin/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { useApi } from '../../api/context.js';
import { keys, refreshCatalogState, useClassifierModels } from '../../api/queries.js';
import { Icon } from '../../components/icons/index.js';
import { QueryState } from '../../components/status.js';
import {
  Badge,
  Button,
  Card,
  ConfirmAction,
  HelpText,
  Table,
  Td,
  Th,
} from '../../components/ui/index.js';
import { primitiveLabel } from '../classifier-form.js';
import {
  EnableSwitch,
  restoreVanishedToggleFocus,
  SecretsLink,
  type MutationMessages,
} from '../shared.js';
import { ClassifierModelForm, classifierMessages } from './ClassifierModelForm.js';

/** Refusals of the Enabled switch, as plain sentences. */
export const CLASSIFIER_TOGGLE_MESSAGES: MutationMessages = {
  ...classifierMessages(undefined),
  FORBIDDEN: 'Enabling or disabling classifiers needs an API key with the settings:write scope.',
};

/** What `editing` holds while the Add form is open: never a classifier id, which starts a-z. */
const ADDING = '+add';

const PROVIDERS: Record<ClassifierModelSummary['provider'], string> = {
  typesafe: 'TypeSafe',
  http: 'HTTP endpoint',
};

/** Where an entry is served from and what it sends: the alias, the endpoint, the secret. */
function ProviderCell({ entry }: { entry: ClassifierModelSummary }) {
  return (
    <div className="grid gap-0.5 text-sm">
      <span>{PROVIDERS[entry.provider]}</span>
      <span className="text-xs text-muted">
        Model <code className="font-mono">{entry.providerModel}</code>
      </span>
      {entry.source === 'custom' ? (
        <code className="font-mono text-xs break-all text-muted">{entry.endpoint}</code>
      ) : null}
      <span className="text-xs text-muted">
        {entry.secretRef ? (
          <>
            Secret <code className="font-mono">{entry.secretRef}</code>
          </>
        ) : (
          'No secret'
        )}
      </span>
    </div>
  );
}

/** What the entry can answer; Choice reads "Choice / classification". */
function Capabilities({ entry }: { entry: ClassifierModelSummary }) {
  return (
    <ul className="text-sm">
      {entry.primitives.map((primitive) => (
        <li key={primitive}>{primitiveLabel(primitive)}</li>
      ))}
    </ul>
  );
}

/**
 * Configured or not, from the summary: a missing or unreadable secret shows "Needs a key", the
 * API's reason, and a link to Secrets. Configured never claims the endpoint is reachable.
 */
function StatusCell({ entry }: { entry: ClassifierModelSummary }) {
  if (entry.configured)
    return (
      <Badge tone="good">
        <Icon name="check" />
        Configured
      </Badge>
    );
  return (
    <div className="grid max-w-[24ch] justify-items-start gap-1">
      <Badge tone="warn">
        <Icon name="alert" />
        Needs a key
      </Badge>
      {entry.configurationReason ? <HelpText>{entry.configurationReason}</HelpText> : null}
      <span className="text-xs">
        <SecretsLink>Open Secrets</SecretsLink>
      </span>
    </div>
  );
}

/**
 * Settings → Classifier models (#43), below the LLM catalog: built-in Jev and registered HTTP
 * classifiers, each with its capabilities, whether it is configured (its secret), and an Enabled
 * switch. Jev can only be enabled or disabled; custom entries can also be edited and deleted.
 */
export function ClassifierModelsSection() {
  const client = useApi();
  const queryClient = useQueryClient();
  const query = useClassifierModels();
  const sectionId = useId();
  const [editing, setEditing] = useState<string | undefined>();
  const [notice, setNotice] = useState('');
  // The element (by id) to focus once it is on the page: a saved row's Edit button may only
  // appear after the refreshed list renders, so every render after closing a form looks for it.
  const focusTargetRef = useRef<string | undefined>(undefined);
  const headingRef = useRef<HTMLSpanElement>(null);
  const hasCustom = query.data?.some((entry) => entry.source === 'custom') ?? false;
  const existingIds = (query.data ?? []).map((entry) => entry.id);
  const addButtonId = `${sectionId}-add`;
  const editButtonId = (id: string) => `${sectionId}-edit-${id}`;
  const heading = () => headingRef.current?.closest('h2') ?? null;
  // Catalog writes also refresh the editor's API checks, whose classifier issues read the catalog.
  const refresh = () => refreshCatalogState(queryClient);
  // Adding needs the current catalog: until it has loaded, a new id cannot be checked against it.
  const catalogReady = query.isSuccess;
  const addHintId = `${sectionId}-add-hint`;

  useEffect(() => {
    const id = focusTargetRef.current;
    const target = id === undefined ? null : document.getElementById(id);
    if (!target) return;
    focusTargetRef.current = undefined;
    target.focus();
  });

  /** Open a form; a focus still waiting from the last one is dropped. */
  const openForm = (which: string) => {
    focusTargetRef.current = undefined;
    setEditing(which);
  };
  /** Close the form and put focus back on what opened it, or on the saved row's Edit button. */
  const closeForm = (returnTo: string) => {
    focusTargetRef.current = returnTo;
    setEditing(undefined);
  };

  return (
    <Card
      flush
      title={<span ref={headingRef}>Classifier models</span>}
      actions={
        <>
          {/* aria-disabled, not disabled: it keeps its place in the Tab order and says why. */}
          <Button
            id={addButtonId}
            size="sm"
            variant="outline"
            aria-expanded={editing === ADDING}
            aria-disabled={!catalogReady}
            aria-describedby={catalogReady ? undefined : addHintId}
            onClick={() => {
              if (catalogReady) openForm(ADDING);
            }}
          >
            <Icon name="plus" />
            Add classifier
          </Button>
          {catalogReady ? null : (
            <span id={addHintId} className="sr-only">
              Available once the classifier list has loaded.
            </span>
          )}
        </>
      }
    >
      <div className="grid gap-1 border-b border-default px-5 py-3">
        <HelpText>
          Classifier evaluators choose one option for a Choice decision. Jev is built in; register a
          classifier you host, such as Kev at http://127.0.0.1:8008, with Add classifier. See the
          Settings guide, Configure classifier models.
        </HelpText>
        <div
          role="status"
          aria-atomic="true"
          className={notice ? 'text-sm text-status-bad-fg' : 'sr-only'}
        >
          {notice}
        </div>
      </div>
      {editing === ADDING ? (
        <div className="border-b border-default p-5">
          <ClassifierModelForm
            existingIds={existingIds}
            catalogReady={catalogReady}
            onDone={(saved) => closeForm(saved ? editButtonId(saved.id) : addButtonId)}
          />
        </div>
      ) : null}
      {/* Loading and error states keep the card padding; the table runs edge to edge. */}
      <div className={query.isSuccess ? undefined : 'p-5'}>
        <QueryState query={query} what="Classifier models">
          {(items) => (
            <Table stack="md">
              <thead>
                <tr>
                  <Th>Model</Th>
                  {/* Below 1024 px these two fold into the Model cell, so the table fits. */}
                  <Th className="hidden lg:table-cell">Provider</Th>
                  <Th className="hidden lg:table-cell">Capabilities</Th>
                  <Th>Status</Th>
                  <Th>Enabled</Th>
                  {hasCustom ? <Th className="w-px text-right">Actions</Th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr>
                      <Td>
                        <span className="font-semibold">{entry.displayName}</span>{' '}
                        <code className="text-xs text-muted">{entry.id}</code>
                        {entry.source === 'builtin' ? (
                          <span className="block text-xs text-muted">Built in</span>
                        ) : null}
                        <div className="mt-2 grid gap-2 lg:hidden">
                          <ProviderCell entry={entry} />
                          <Capabilities entry={entry} />
                        </div>
                      </Td>
                      <Td className="hidden lg:table-cell">
                        <ProviderCell entry={entry} />
                      </Td>
                      <Td className="hidden lg:table-cell">
                        <Capabilities entry={entry} />
                      </Td>
                      <Td label="Status">
                        <StatusCell entry={entry} />
                      </Td>
                      <Td label="Enabled">
                        <EnableSwitch
                          name={entry.displayName}
                          enabled={entry.enabled}
                          messages={CLASSIFIER_TOGGLE_MESSAGES}
                          description={
                            entry.source === 'builtin'
                              ? 'Disabling Jev also stops Exit predicates that use Jev.'
                              : undefined
                          }
                          onToggle={async (enabled) => {
                            // A new toggle replaces the previous vanished-classifier notice.
                            setNotice('');
                            const updated = await classifierModels.setEnabled(
                              client,
                              entry.id,
                              enabled,
                            );
                            queryClient.setQueryData<ClassifierModelSummary[]>(
                              keys.classifiers,
                              (list) =>
                                list?.map((item) => (item.id === updated.id ? updated : item)),
                            );
                            await refresh();
                          }}
                          onError={async (error, failure) => {
                            if (!(error instanceof GraphGoblinApiError) || error.status !== 404)
                              return;
                            setNotice(
                              `${entry.displayName}: ${CLASSIFIER_TOGGLE_MESSAGES['CLASSIFIER_MODEL_NOT_FOUND']}`,
                            );
                            const refreshed = refresh();
                            restoreVanishedToggleFocus(failure, heading(), refreshed);
                            await refreshed;
                          }}
                        />
                      </Td>
                      {hasCustom ? (
                        <Td className="text-right whitespace-nowrap">
                          {entry.source === 'custom' ? (
                            // One above the other from 768 to 1023 px, side by side above that
                            // and in a stacked row (below 768 px).
                            <div className="flex flex-col items-end gap-1 max-md:flex-row max-md:flex-wrap max-md:items-center lg:flex-row lg:justify-end">
                              <Button
                                id={editButtonId(entry.id)}
                                size="sm"
                                variant="ghost"
                                aria-expanded={editing === entry.id}
                                onClick={() => openForm(entry.id)}
                                aria-label={`Edit classifier ${entry.id}`}
                              >
                                Edit
                              </Button>
                              <ConfirmAction
                                name={entry.id}
                                accessibleName={`Delete classifier ${entry.id}`}
                                onDismiss={(error) => {
                                  if (error instanceof GraphGoblinApiError && error.status === 404)
                                    return refresh();
                                }}
                                consequences={
                                  <>
                                    <p>
                                      Classifier: “{entry.displayName}” ({entry.id}).
                                    </p>
                                    <p>
                                      Decision nodes that select {entry.id} keep the id. Their
                                      classifier evaluation fails with EVALUATION_UNAVAILABLE until
                                      you restore it or choose another classifier; drafts that still
                                      select it cannot be published.
                                    </p>
                                    {entry.secretRef ? (
                                      <p>Its secret {entry.secretRef} stays in Secrets.</p>
                                    ) : null}
                                  </>
                                }
                                onConfirm={async () => {
                                  await classifierModels.remove(client, entry.id);
                                  await refresh();
                                }}
                              />
                            </div>
                          ) : null}
                        </Td>
                      ) : null}
                    </tr>
                    {entry.source === 'custom' && editing === entry.id ? (
                      <tr>
                        <Td colSpan={6}>
                          <ClassifierModelForm
                            initial={entry}
                            existingIds={existingIds}
                            catalogReady={catalogReady}
                            onDone={() => closeForm(editButtonId(entry.id))}
                          />
                        </Td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          )}
        </QueryState>
      </div>
    </Card>
  );
}
