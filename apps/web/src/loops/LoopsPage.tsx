import { GraphGoblinApiError, loops } from '@graphgoblin/api-client';
import type { ChatDevice } from '@graphgoblin/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useOwnerChatClient } from '../app/useOwnerChatClient.js';
import { useApi } from '../api/context.js';
import { keys, useCreateTemplateDraft, useLoops, useTemplates } from '../api/queries.js';
import { Icon } from '../components/icons/index.js';
import { Page, PageHeader } from '../components/layout/index.js';
import {
  focusById,
  LoopNameRetryForm,
  LoopNameTakenHelp,
  refusedNow,
} from '../components/loop-name-conflict.js';
import { QueryState, RunStatusBadge } from '../components/status.js';
import { TemplateGallery } from './TemplateGallery.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmAction,
  buttonStyles,
  FIELD_ROW,
  FieldGroup,
  FilePicker,
  HelpText,
  Input,
  Label,
  RequiredNote,
  Table,
  Td,
  Th,
} from '../components/ui/index.js';
import { clearLocalDraft } from '../drafts/local-drafts.js';
import { newLoopDefinition } from '../editor/model.js';
import {
  importedLoopName,
  LOOP_NAME_RULE,
  loopNameConflict,
  type LoopNameConflict,
} from '../lib/loop-names.js';
import {
  cn,
  downloadJson,
  errorMessage,
  fileSlug,
  formatDateTime,
  isOfflineError,
  parseJson,
  problemIssues,
} from '../lib/utils.js';

function PublishState({ loop }: { loop: ListedLoop }) {
  if (!loop.currentVersionId) return <Badge>draft only</Badge>;
  if (loop.draftVersionId) return <Badge tone="warn">published, unpublished changes</Badge>;
  return <Badge tone="good">published</Badge>;
}

function CreateLoop() {
  const client = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  // The API's name refusal, kept while the field still holds the refused name (#209).
  const [conflict, setConflict] = useState<LoopNameConflict>();
  const create = useMutation({
    mutationFn: (loopName: string) => loops.create(client, newLoopDefinition(loopName) as never),
    onMutate: () => setConflict(undefined),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: keys.loops });
      void navigate(`/loops/${created.loop.id}/edit`);
    },
    onError: (error, loopName) => setConflict(loopNameConflict(error, loopName)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  };
  const taken = conflict !== undefined && refusedNow(conflict, name);
  const failed = create.isError && conflict === undefined;
  return (
    <form
      onSubmit={submit}
      // The form sits beside Import in a wrapping row; on its own line it takes the whole width.
      className={cn(FIELD_ROW, 'items-end max-sm:w-full')}
      aria-label="Create loop"
    >
      <RequiredNote className="basis-full" />
      <FieldGroup className="w-[300px]">
        <Label htmlFor="new-loop-name" required>
          New loop name
        </Label>
        <Input
          id="new-loop-name"
          value={name}
          aria-required
          aria-invalid={failed || taken || undefined}
          aria-describedby={taken ? 'new-loop-taken' : failed ? 'new-loop-error' : undefined}
          onChange={(e) => setName(e.target.value)}
          placeholder="nightly-triage"
        />
      </FieldGroup>
      <Button type="submit" disabled={!name.trim() || create.isPending}>
        Create
      </Button>
      {failed ? (
        <HelpText id="new-loop-error" role="alert" tone="bad" className="basis-full">
          {errorMessage(create.error)}
        </HelpText>
      ) : null}
      {taken ? (
        <LoopNameTakenHelp
          id="new-loop-taken"
          className="basis-full"
          conflict={conflict}
          onUseSuggestion={(suggested) => {
            // Replace the text only; Create stays the user's deliberate next attempt.
            setName(suggested);
            focusById('new-loop-name');
          }}
        />
      ) : null}
    </form>
  );
}

/**
 * One choice of a file in the import picker (#209). The newest choice owns the import's result and
 * its retry panel; the picker stays enabled, and a newer choice or Cancel ends the current one.
 * Whatever an ended choice still has under way (its file read, its request, its retry) then changes
 * neither: an unread file is not sent, and a late answer only refreshes the loop list, since the
 * import may have been created. `key` keeps one retry form per choice.
 */
interface ImportSelection {
  readonly key: number;
}

/** An import the API refused for its name, kept until the user retries under another or cancels. */
interface HeldImport {
  selection: ImportSelection;
  fileName: string;
  /** The parsed upload, sent unchanged on every retry; the chosen name travels in the query. */
  document: Record<string, unknown>;
  /** The first refusal, of the name the document itself carries. */
  original: LoopNameConflict;
  /** The latest refusal, which may be of a retried name. */
  latest: LoopNameConflict;
  /** Any other failure of the last retry; `uncertain` when the request may have committed. */
  error?: { text: string; uncertain: boolean } | undefined;
}

/** A failure after which the request may still have reached the API (no answer, or a 5xx). */
function mayHaveCommitted(error: unknown): boolean {
  return !(error instanceof GraphGoblinApiError) || isOfflineError(error) || error.status >= 500;
}

function ImportLoop() {
  const client = useApi();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<
    { tone: 'good' | 'bad'; text: string; issues?: string[] } | undefined
  >();
  const [held, setHeld] = useState<HeldImport>();
  // The current choice (`ImportSelection`), and the one whose retry is being sent, read at once
  // rather than at the next render so neither a late answer nor a second activation slips by.
  const choicesRef = useRef(0);
  const currentRef = useRef<ImportSelection | undefined>(undefined);
  const retryingRef = useRef<ImportSelection | undefined>(undefined);
  const importLoop = useMutation({
    mutationFn: ({
      document,
      name,
    }: {
      selection: ImportSelection;
      fileName: string;
      document: Record<string, unknown>;
      name?: string;
    }) => loops.import(client, document, name === undefined ? undefined : { name }),
    onSuccess: (created, { selection }) => {
      void queryClient.invalidateQueries({ queryKey: keys.loops });
      if (currentRef.current !== selection) return;
      setHeld(undefined);
      setMessage({
        tone: 'good',
        text: `Imported "${created.loop.name}".`,
        issues: created.issues.map((i) => `${i.code}: ${i.message}`),
      });
    },
    onError: (error, { selection, fileName, document, name }) => {
      const refused = loopNameConflict(error, name ?? importedLoopName(document));
      // The list refresh shows the loop that holds the name, or an import that committed without
      // an answer, whether or not this choice is still the current one.
      if (refused || name !== undefined || mayHaveCommitted(error))
        void queryClient.invalidateQueries({ queryKey: keys.loops });
      if (currentRef.current !== selection) return;
      if (name !== undefined) {
        // A retry: keep the held document and say why this attempt failed too.
        setHeld((now) =>
          now?.selection !== selection
            ? now
            : refused
              ? { ...now, latest: refused, error: undefined }
              : {
                  ...now,
                  error: { text: errorMessage(error), uncertain: mayHaveCommitted(error) },
                },
        );
        return;
      }
      if (refused) {
        setHeld({ selection, fileName, document, original: refused, latest: refused });
        return;
      }
      setMessage({ tone: 'bad', text: errorMessage(error), issues: problemIssues(error) });
    },
    onSettled: (_created, _error, { selection, name }) => {
      if (name !== undefined && retryingRef.current === selection) retryingRef.current = undefined;
    },
  });
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    // A new choice starts over: the last result no longer describes the picker.
    const selection: ImportSelection = { key: (choicesRef.current += 1) };
    currentRef.current = selection;
    setMessage(undefined);
    setHeld(undefined);
    let text: string;
    try {
      text = await file.text();
    } catch {
      if (currentRef.current === selection)
        setMessage({ tone: 'bad', text: `${file.name} could not be read.` });
      return;
    }
    // Another file was chosen while this one was read: only that one is sent.
    if (currentRef.current !== selection) return;
    const parsed = parseJson(text);
    if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) {
      setMessage({ tone: 'bad', text: `${file.name} is not a JSON document.` });
      return;
    }
    importLoop.mutate({
      selection,
      fileName: file.name,
      document: parsed.value as Record<string, unknown>,
    });
  };
  return (
    <>
      <FieldGroup>
        <Label htmlFor="import-loop">Import an exported loop (JSON)</Label>
        {/* A refused file describes the picker and marks it invalid until the next choice. */}
        <FilePicker
          id="import-loop"
          accept="application/json,.json"
          aria-invalid={message?.tone === 'bad' || undefined}
          aria-describedby={
            message?.tone === 'bad'
              ? 'import-loop-result'
              : held
                ? 'import-name-conflict-text'
                : undefined
          }
          onChange={(e) => void onFile(e)}
        />
        {message ? (
          <div id="import-loop-result">
            <Alert tone={message.tone} title={message.text}>
              {message.issues && message.issues.length > 0 ? (
                <ul className="list-disc pl-4 text-xs">
                  {message.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          </div>
        ) : null}
      </FieldGroup>
      {held ? (
        // Its own full-width line, so the taller panel never pushes the Create form down.
        <section aria-label="Import under another name" className="grid min-w-0 basis-full gap-3">
          <div id="import-name-conflict-text">
            <Alert tone="warn" title={`${held.fileName} was not imported`}>
              {held.original.name === undefined
                ? 'Another loop already has the name this file uses.'
                : `Another loop already has the name “${held.original.name.trim()}”.`}{' '}
              {LOOP_NAME_RULE} Import it as a separate loop under another name, or cancel. Neither
              the file nor the existing loop is changed.
            </Alert>
          </div>
          <LoopNameRetryForm
            // One form per choice: the typed name stays across this upload's retries only.
            key={held.selection.key}
            label="Name for the imported loop"
            submitLabel="Import as new loop"
            pendingLabel="Importing…"
            initialName={held.original.suggestedName ?? held.original.name ?? ''}
            conflict={held.latest}
            pending={importLoop.isPending && importLoop.variables.selection === held.selection}
            describedBy="import-name-conflict-text"
            onSubmit={(name) => {
              // One retry at a time, even when activated twice before the next render.
              if (retryingRef.current === held.selection) return;
              retryingRef.current = held.selection;
              setHeld({ ...held, error: undefined });
              importLoop.mutate({
                selection: held.selection,
                fileName: held.fileName,
                document: held.document,
                name,
              });
            }}
            onCancel={() => {
              // Ends this choice: nothing it still has under way brings the panel back.
              currentRef.current = undefined;
              setHeld(undefined);
              focusById('import-loop');
            }}
          />
          {held.error ? (
            <Alert title="The import was not completed">
              <p>{held.error.text}</p>
              {held.error.uncertain ? (
                <p className="mt-2">
                  If the request timed out, check the loop list for the import before trying again.
                </p>
              ) : null}
            </Alert>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function LoopActions({ loop, runCount }: { loop: ListedLoop; runCount: number }) {
  const client = useApi();
  const queryClient = useQueryClient();
  const exportingRef = useRef(false);
  const exportLoop = useMutation({
    mutationFn: () => loops.export(client, loop.id, { draft: !loop.currentVersionId }),
    onSuccess: (document) => downloadJson(`${fileSlug(loop.name)}.graphgoblin.json`, document),
    onSettled: () => {
      exportingRef.current = false;
    },
  });
  return (
    <div className="relative flex flex-col items-end gap-2 max-lg:items-start max-lg:pt-2">
      <div className="flex items-center justify-end gap-2 max-lg:flex-wrap max-lg:justify-start">
        <Link
          to={`/loops/${loop.id}/edit`}
          className={buttonStyles({ variant: 'outline', size: 'sm' })}
          aria-label={`Edit ${loop.name}`}
        >
          <Icon name="edit" />
          Edit
        </Link>
        <Button
          size="sm"
          variant="outline"
          aria-disabled={exportLoop.isPending}
          aria-busy={exportLoop.isPending}
          onClick={() => {
            if (exportingRef.current) return;
            exportingRef.current = true;
            exportLoop.mutate();
          }}
          aria-label={`Export ${loop.name}`}
        >
          <Icon name="export" />
          {exportLoop.isPending ? 'Exporting…' : 'Export'}
        </Button>
        <span role="status" className="sr-only">
          {exportLoop.isPending ? `Exporting ${loop.name}…` : ''}
        </span>
        {!loop.system ? (
          <ConfirmAction
            name={loop.name}
            returnFocusTo="loops-heading"
            consequences={
              <p>
                The loop, all its versions, its triggers and all its runs
                {` (${runCount})`} will be deleted, including run history and artifact references.
                Loops using it as a subloop will no longer be able to start it. Cancel active runs
                first.
              </p>
            }
            onConfirm={async () => {
              await loops.remove(client, loop.id);
              await clearLocalDraft(loop.id);
              await queryClient.invalidateQueries({ queryKey: keys.loops });
              await queryClient.invalidateQueries({ queryKey: ['runs'] });
            }}
          />
        ) : null}
      </div>
      {exportLoop.isError ? (
        <Alert title={`Could not export “${loop.name}”.`}>{errorMessage(exportLoop.error)}</Alert>
      ) : null}
    </div>
  );
}

type ListedLoop = NonNullable<ReturnType<typeof useLoops>['data']>[number];
function LoopTable({
  items,
  devices,
  system = false,
}: {
  items: ListedLoop[];
  devices: ChatDevice[] | undefined;
  system?: boolean;
}) {
  return (
    <Card title={system ? 'System loops' : 'Your loops'} flush>
      {system ? (
        <p className="border-b border-default px-5 py-3 text-sm text-muted">
          GraphGoblin keeps one chat loop for this gateway and one for each paired device, including
          revoked ones. Change the steps between the chat trigger and its exits.
        </p>
      ) : null}
      {/* Rows stack below 1024 px; the update time sits under the name, so the name
                  column keeps room for itself at 1024 px. */}
      <Table stack="lg">
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>State</Th>
            <Th>Last run</Th>
            <Th className="w-px text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((loop) => {
            const run = loop.latestRun;
            return (
              <tr key={loop.id}>
                <Td className="min-w-56 wrap-anywhere">
                  <Link
                    to={`/loops/${loop.id}/edit`}
                    className="touch-target text-[15px] font-semibold text-default no-underline hover:underline"
                  >
                    {loop.name}
                  </Link>
                  {loop.description ? (
                    <p className="mt-0.5 text-sm text-muted">{loop.description}</p>
                  ) : null}
                  {loop.system ? (
                    <p className="mt-1 text-sm text-muted">
                      Answers{' '}
                      <Link
                        className="touch-target"
                        to={
                          loop.system.audience.kind === 'gateway'
                            ? '/chat'
                            : `/chat/devices#device-${loop.system.audience.deviceId}`
                        }
                      >
                        {loop.system.audience.kind === 'gateway'
                          ? 'Chat on this gateway'
                          : (devices?.find(
                              (device) =>
                                loop.system?.audience.kind === 'device' &&
                                device.id === loop.system.audience.deviceId,
                            )?.label ?? 'paired device')}
                      </Link>
                      {devices?.some(
                        (device) =>
                          loop.system?.audience.kind === 'device' &&
                          device.id === loop.system.audience.deviceId &&
                          device.revokedAt,
                      )
                        ? ' · Revoked device'
                        : ''}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-subtle">
                    Updated <time dateTime={loop.updatedAt}>{formatDateTime(loop.updatedAt)}</time>
                  </p>
                </Td>
                <Td label="State">
                  <PublishState loop={loop} />
                </Td>
                <Td label="Last run">
                  {run ? (
                    <Link to={`/runs/${run.id}`} className="touch-target inline-flex w-fit">
                      <RunStatusBadge status={run.status} />
                    </Link>
                  ) : (
                    <div className="text-sm text-muted">
                      <span>{loop.runCount === 0 ? 'never run' : 'latest run unavailable'}</span>
                      {loop.runCount > 0 ? <p>Check run history diagnostics.</p> : null}
                    </div>
                  )}
                </Td>
                <Td>
                  <LoopActions loop={loop} runCount={loop.runCount} />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

export function LoopsPage() {
  const loopsQuery = useLoops(5000);
  const chatClient = useOwnerChatClient();
  const devices = useQuery({
    queryKey: ['chat', 'devices'],
    queryFn: () => chatClient.devices(),
    enabled: Boolean(loopsQuery.data?.some((loop) => loop.system?.audience.kind === 'device')),
    retry: false,
  });
  const templatesQuery = useTemplates();
  const createTemplateDraft = useCreateTemplateDraft();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (
    <Page>
      <PageHeader title="Loops" titleId="loops-heading" />
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <CreateLoop />
          <ImportLoop />
        </div>
        <div className="mt-5 border-t border-default pt-5">
          {loopsQuery.isError &&
          templatesQuery.isError &&
          isOfflineError(loopsQuery.error) &&
          isOfflineError(templatesQuery.error) ? null : (
            <QueryState query={templatesQuery} what="Templates">
              {(items) => (
                <TemplateGallery
                  templates={items}
                  onCreateDraft={(templateId, name) =>
                    createTemplateDraft.mutateAsync(
                      name === undefined ? { templateId } : { templateId, name },
                    )
                  }
                  onCreated={async (loopId) => {
                    await queryClient.invalidateQueries({ queryKey: keys.loops });
                    await navigate(`/loops/${loopId}/edit`);
                  }}
                  onCreateFailed={() => queryClient.invalidateQueries({ queryKey: keys.loops })}
                />
              )}
            </QueryState>
          )}
        </div>
      </Card>
      <QueryState query={loopsQuery} what="Loops">
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-muted">
              No loops yet. Create one above or import an export.
            </p>
          ) : (
            <div className="grid gap-section">
              {items.some((loop) => !loop.system) ? (
                <LoopTable items={items.filter((loop) => !loop.system)} devices={devices.data} />
              ) : (
                <p className="text-sm text-muted">
                  No loops of your own yet. Create one above or import an export.
                </p>
              )}
              {items.some((loop) => loop.system) ? (
                <LoopTable
                  system
                  devices={devices.data}
                  items={items
                    .filter((loop) => loop.system)
                    .toSorted((a, b) => {
                      const aDevice = devices.data?.find(
                        (device) =>
                          a.system?.audience.kind === 'device' &&
                          device.id === a.system.audience.deviceId,
                      );
                      const bDevice = devices.data?.find(
                        (device) =>
                          b.system?.audience.kind === 'device' &&
                          device.id === b.system.audience.deviceId,
                      );
                      return (
                        Number(b.system?.audience.kind === 'gateway') -
                          Number(a.system?.audience.kind === 'gateway') ||
                        Number(Boolean(aDevice?.revokedAt)) - Number(Boolean(bDevice?.revokedAt)) ||
                        (aDevice?.label ?? a.name).localeCompare(bDevice?.label ?? b.name)
                      );
                    })}
                />
              ) : null}
            </div>
          )
        }
      </QueryState>
    </Page>
  );
}
