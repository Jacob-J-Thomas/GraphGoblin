import { loops } from '@graphgoblin/api-client';
import type { LoopRecord, RunRecord } from '@graphgoblin/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApi } from '../api/context.js';
import { keys, useLoops, useRuns } from '../api/queries.js';
import { Page, PageHeader } from '../components/layout/index.js';
import { QueryState, RunStatusBadge } from '../components/status.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  FieldGroup,
  HelpText,
  Input,
  Label,
  Table,
  Td,
  Th,
} from '../components/ui/index.js';
import { clearLocalDraft } from '../drafts/local-drafts.js';
import { newLoopDefinition } from '../editor/model.js';
import { downloadJson, errorMessage, fileSlug, formatDateTime, parseJson } from '../lib/utils.js';

/** The native file picker, its button drawn like an outline button. */
const FILE_INPUT = [
  'max-w-full cursor-pointer text-sm text-muted',
  'file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-strong',
  'file:bg-surface-raised file:px-[11px] file:text-sm file:font-semibold file:text-default',
  'file:shadow-ledge hover:file:bg-surface-hover',
].join(' ');

function PublishState({ loop }: { loop: LoopRecord }) {
  if (!loop.currentVersionId) return <Badge>draft only</Badge>;
  if (loop.draftVersionId) return <Badge tone="warn">published, unpublished changes</Badge>;
  return <Badge tone="good">published</Badge>;
}

/** The most recent run per loop, from one runs listing. */
function latestRuns(runs: RunRecord[]): Map<string, RunRecord> {
  const latest = new Map<string, RunRecord>();
  for (const run of runs) {
    const seen = latest.get(run.loopId);
    if (!seen || run.createdAt > seen.createdAt) latest.set(run.loopId, run);
  }
  return latest;
}

function CreateLoop() {
  const client = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: (loopName: string) => loops.create(client, newLoopDefinition(loopName) as never),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: keys.loops });
      void navigate(`/loops/${created.loop.id}/edit`);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  };
  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-2 max-sm:w-full"
      aria-label="Create loop"
    >
      <FieldGroup className="w-[300px] max-sm:flex-1">
        <Label htmlFor="new-loop-name">New loop name</Label>
        <Input
          id="new-loop-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="nightly-triage"
        />
      </FieldGroup>
      <Button type="submit" disabled={!name.trim() || create.isPending}>
        Create
      </Button>
      {create.isError ? (
        <HelpText tone="bad" className="basis-full">
          {errorMessage(create.error)}
        </HelpText>
      ) : null}
    </form>
  );
}

function ImportLoop() {
  const client = useApi();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<
    { tone: 'good' | 'bad'; text: string; issues?: string[] } | undefined
  >();
  const importLoop = useMutation({
    mutationFn: (document: Record<string, unknown>) => loops.import(client, document),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: keys.loops });
      setMessage({
        tone: 'good',
        text: `Imported "${created.loop.name}".`,
        issues: created.issues.map((i) => `${i.code}: ${i.message}`),
      });
    },
    onError: (error) => setMessage({ tone: 'bad', text: errorMessage(error) }),
  });
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const parsed = parseJson(await file.text());
    if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) {
      setMessage({ tone: 'bad', text: `${file.name} is not a JSON document.` });
      return;
    }
    importLoop.mutate(parsed.value as Record<string, unknown>);
  };
  return (
    <FieldGroup>
      <Label htmlFor="import-loop">Import an exported loop (JSON)</Label>
      <input
        id="import-loop"
        type="file"
        accept="application/json,.json"
        className={FILE_INPUT}
        onChange={(e) => void onFile(e)}
      />
      {message ? (
        <Alert tone={message.tone} title={message.text}>
          {message.issues && message.issues.length > 0 ? (
            <ul className="list-disc pl-4 text-xs">
              {message.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
    </FieldGroup>
  );
}

function LoopActions({ loop }: { loop: LoopRecord }) {
  const client = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const exportLoop = useMutation({
    mutationFn: () => loops.export(client, loop.id, { draft: !loop.currentVersionId }),
    onSuccess: (document) => downloadJson(`${fileSlug(loop.name)}.graphgoblin.json`, document),
  });
  const remove = useMutation({
    mutationFn: async () => {
      await loops.remove(client, loop.id);
      await clearLocalDraft(loop.id);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.loops }),
  });
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Link
        to={`/loops/${loop.id}/edit`}
        className="rounded-md px-2.5 py-1.5 text-sm font-semibold text-link hover:bg-surface-hover"
      >
        Edit
      </Link>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => exportLoop.mutate()}
        aria-label={`Export ${loop.name}`}
      >
        Export
      </Button>
      {confirming ? (
        <>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => remove.mutate()}
            aria-label={`Confirm delete ${loop.name}`}
          >
            Confirm delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${loop.name}`}
        >
          Delete
        </Button>
      )}
      {exportLoop.isError ? (
        <HelpText tone="bad" className="basis-full text-right">
          {errorMessage(exportLoop.error)}
        </HelpText>
      ) : null}
      {remove.isError ? (
        <HelpText tone="bad" className="basis-full text-right">
          {errorMessage(remove.error)}
        </HelpText>
      ) : null}
    </div>
  );
}

export function LoopsPage() {
  const loopsQuery = useLoops();
  const runsQuery = useRuns({ limit: 500 }, 5000);
  const latest = latestRuns(runsQuery.data ?? []);
  return (
    <Page>
      <PageHeader title="Loops" />
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <CreateLoop />
          <ImportLoop />
        </div>
      </Card>
      <QueryState query={loopsQuery} what="Loops">
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-muted">
              No loops yet. Create one above or import an export.
            </p>
          ) : (
            <Card flush>
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>State</Th>
                    <Th>Last run</Th>
                    <Th>Updated</Th>
                    <Th className="w-px text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((loop) => {
                    const run = latest.get(loop.id);
                    return (
                      <tr key={loop.id}>
                        <Td>
                          <Link
                            to={`/loops/${loop.id}/edit`}
                            className="text-[15px] font-semibold text-default no-underline hover:underline"
                          >
                            {loop.name}
                          </Link>
                          {loop.description ? (
                            <p className="mt-0.5 text-sm text-muted">{loop.description}</p>
                          ) : null}
                        </Td>
                        <Td>
                          <PublishState loop={loop} />
                        </Td>
                        <Td>
                          {run ? (
                            <Link to={`/runs/${run.id}`}>
                              <RunStatusBadge status={run.status} />
                            </Link>
                          ) : (
                            <span className="text-sm text-muted">never run</span>
                          )}
                        </Td>
                        <Td className="text-sm whitespace-nowrap text-muted">
                          {formatDateTime(loop.updatedAt)}
                        </Td>
                        <Td>
                          <LoopActions loop={loop} />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          )
        }
      </QueryState>
    </Page>
  );
}
