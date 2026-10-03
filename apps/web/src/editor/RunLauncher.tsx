import { runs } from '@graphgoblin/api-client';
import type { LoopDefinition } from '@graphgoblin/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api/context.js';
import { Alert, Label, Select } from '../components/ui.js';
import { JsonSchemaForm } from '../forms/JsonSchemaForm.js';
import { errorMessage } from '../lib/utils.js';

/** Start a run of the published version from one of its manual triggers. */
export function RunLauncher({ loopId, published }: { loopId: string; published: LoopDefinition }) {
  const client = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const triggers = published.nodes.filter(
    (n): n is Extract<typeof n, { kind: 'trigger' }> =>
      n.kind === 'trigger' && n.config.subtype === 'manual',
  );
  const [triggerId, setTriggerId] = useState(triggers[0]?.id ?? '');
  const start = useMutation({
    mutationFn: (input: unknown) =>
      runs.start(client, loopId, {
        triggerNodeId: triggerId,
        ...(input !== undefined ? { input: input as never } : {}),
      }),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void navigate(`/runs/${run.id}`);
    },
  });
  if (triggers.length === 0) {
    return <Alert tone="warn">The published version has no manual trigger.</Alert>;
  }
  const trigger = triggers.find((t) => t.id === triggerId);
  const inputSchema = trigger?.config.subtype === 'manual' ? trigger.config.inputSchema : undefined;
  return (
    <section aria-label="Start a run" className="rounded border border-slate-200 p-2">
      <Label htmlFor="run-trigger">Trigger</Label>
      <Select id="run-trigger" value={triggerId} onChange={(e) => setTriggerId(e.target.value)}>
        {triggers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label} ({t.id})
          </option>
        ))}
      </Select>
      <div className="mt-2">
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
    </section>
  );
}
