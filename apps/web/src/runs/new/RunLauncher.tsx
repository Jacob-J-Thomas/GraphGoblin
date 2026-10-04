import { runs } from '@graphgoblin/api-client';
import type { LoopVersionRecord } from '@graphgoblin/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../../api/context.js';
import { useLoopVersions } from '../../api/queries.js';
import { QueryState } from '../../components/status.js';
import { Alert, FieldGroup, HelpText, Label, Select } from '../../components/ui/index.js';
import { JsonSchemaForm } from '../../forms/JsonSchemaForm.js';
import { errorMessage, formatDateTime } from '../../lib/utils.js';

/** The trigger choice and input form for one published version, and the Start run button. */
function StartForm({ loopId, version }: { loopId: string; version: LoopVersionRecord }) {
  const client = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const triggers = version.definition.nodes.filter(
    (n): n is Extract<typeof n, { kind: 'trigger' }> =>
      n.kind === 'trigger' && n.config.subtype === 'manual',
  );
  const [triggerId, setTriggerId] = useState(triggers[0]?.id ?? '');
  const start = useMutation({
    mutationFn: (input: unknown) =>
      runs.start(client, loopId, {
        triggerNodeId: triggerId,
        versionId: version.id,
        ...(input !== undefined ? { input: input as never } : {}),
      }),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void navigate(`/runs/${run.id}`);
    },
  });
  if (triggers.length === 0) {
    return (
      <Alert tone="warn">
        Version {version.version} has no manual trigger, so it cannot be started from here.
      </Alert>
    );
  }
  const trigger = triggers.find((t) => t.id === triggerId);
  const inputSchema = trigger?.config.subtype === 'manual' ? trigger.config.inputSchema : undefined;
  return (
    <>
      <FieldGroup className="max-w-[420px]">
        <Label htmlFor="run-trigger">Trigger</Label>
        <Select id="run-trigger" value={triggerId} onChange={(e) => setTriggerId(e.target.value)}>
          {triggers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({t.id})
            </option>
          ))}
        </Select>
      </FieldGroup>
      <div>
        <JsonSchemaForm
          key={triggerId}
          schema={inputSchema}
          submitLabel="Start run"
          busy={start.isPending}
          onSubmit={(input) => start.mutate(input)}
        />
      </div>
      {start.isError ? (
        <Alert title="Could not start the run">{errorMessage(start.error)}</Alert>
      ) : null}
    </>
  );
}

/**
 * Start a run of one of the loop's published versions (the current one unless another is chosen)
 * from a manual trigger, with an input form generated from the trigger's `inputSchema` and checked
 * against it before sending. Runs of a loop may run at the same time; nothing here waits for an
 * earlier one. A started run opens in the inspector.
 */
export function RunLauncher({
  loopId,
  currentVersionId,
}: {
  loopId: string;
  currentVersionId: string;
}) {
  const query = useLoopVersions(loopId);
  const [chosen, setChosen] = useState(currentVersionId);
  return (
    <QueryState query={query} what="Versions">
      {(items) => {
        const published = items
          .filter((v) => v.status === 'published')
          .sort((a, b) => b.version - a.version);
        const version = published.find((v) => v.id === chosen) ?? published[0];
        if (!version) return <Alert tone="warn">This loop has no published version yet.</Alert>;
        return (
          <section aria-label="Start a run" className="grid gap-field">
            <FieldGroup className="max-w-[420px]">
              <Label htmlFor="run-version">Version</Label>
              <Select
                id="run-version"
                value={version.id}
                aria-describedby="run-version-help"
                onChange={(e) => setChosen(e.target.value)}
              >
                {published.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version}
                    {v.id === currentVersionId ? ' (current)' : ''}
                    {v.publishedAt ? `, published ${formatDateTime(v.publishedAt)}` : ''}
                  </option>
                ))}
              </Select>
              <HelpText id="run-version-help">
                The run keeps this version to the end. Runs of a loop can run at the same time.
              </HelpText>
            </FieldGroup>
            <StartForm key={version.id} loopId={loopId} version={version} />
          </section>
        );
      }}
    </QueryState>
  );
}
