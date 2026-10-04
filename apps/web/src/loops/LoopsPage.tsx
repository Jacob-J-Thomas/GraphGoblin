import { loops } from '@graphgoblin/api-client';
import type { LoopRecord, RunRecord } from '@graphgoblin/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApi } from '../api/context.js';
import { keys, useLoops, useRuns } from '../api/queries.js';
import { QueryState, RunStatusBadge } from '../components/status.js';
import { Alert, Badge, Button, Card, Input, Label, Table, Td, Th } from '../components/ui/index.js';
import { clearLocalDraft } from '../drafts/local-drafts.js';
import { newLoopDefinition } from '../editor/model.js';
import { downloadJson, errorMessage, fileSlug, formatDateTime, parseJson } from '../lib/utils.js';

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
    <form onSubmit={submit} className="flex items-end gap-2" aria-label="Create loop">
      <div>
        <Label htmlFor="new-loop-name">New loop name</Label>
        <Input
          id="new-loop-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="nightly-triage"
        />
      </div>
      <Button type="submit" disabled={!name.trim() || create.isPending}>
        Create
      </Button>
      {create.isError ? (
        <span className="text-xs text-orange-800">{errorMessage(create.error)}</span>
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
    <div>
      <Label htmlFor="import-loop">Import an exported loop (JSON)</Label>
      <input
        id="import-loop"
        type="file"
        accept="application/json,.json"
        className="text-sm"
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
    </div>
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
    <div className="flex flex-wrap items-center gap-1">
      <Link
        to={`/loops/${loop.id}/edit`}
        className="rounded px-2 py-1 text-sm text-sky-800 hover:bg-slate-100"
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
        <span className="text-xs text-orange-800">{errorMessage(exportLoop.error)}</span>
      ) : null}
      {remove.isError ? (
        <span className="text-xs text-orange-800">{errorMessage(remove.error)}</span>
      ) : null}
    </div>
  );
}

export function LoopsPage() {
  const loopsQuery = useLoops();
  const runsQuery = useRuns({ limit: 500 }, 5000);
  const latest = latestRuns(runsQuery.data ?? []);
  return (
    <div className="space-y-3 p-4">
      <h1 className="text-lg font-semibold">Loops</h1>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <CreateLoop />
          <ImportLoop />
        </div>
      </Card>
      <QueryState query={loopsQuery} what="Loops">
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-slate-500">
              No loops yet. Create one above or import an export.
            </p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>State</Th>
                  <Th>Last run</Th>
                  <Th>Updated</Th>
                  <Th>Actions</Th>
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
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {loop.name}
                        </Link>
                        {loop.description ? (
                          <p className="text-xs text-slate-500">{loop.description}</p>
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
                          <span className="text-xs text-slate-500">never run</span>
                        )}
                      </Td>
                      <Td className="text-xs">{formatDateTime(loop.updatedAt)}</Td>
                      <Td>
                        <LoopActions loop={loop} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )
        }
      </QueryState>
    </div>
  );
}
