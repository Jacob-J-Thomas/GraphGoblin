import type { LoopDefinition } from '@graphgoblin/contracts';
import { nodeName } from '../projections.js';
import { runs, type RunSnapshot } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../api/context.js';
import { keys } from '../../api/queries.js';
import { Alert, BoundedValue, Card } from '../../components/ui/index.js';
import { KindChip } from '../../editor/KindChip.js';
import { JsonSchemaForm } from '../../forms/JsonSchemaForm.js';
import { errorMessage, formatDateTime } from '../../lib/utils.js';

type Answer = {
  runId: string;
  waitId: string;
  value: unknown;
  target: { kind: 'input' } | { kind: 'signal'; name: string };
};

/** The run waits on input or a signal: a form for it, generated from the wait node's schema. */
export function WaitPanel({
  run,
  definition,
}: {
  run: RunSnapshot;
  definition?: LoopDefinition | undefined;
}) {
  const client = useApi();
  const queryClient = useQueryClient();
  const waiting = run.waiting;
  const respond = useMutation({
    // A refetch may replace mutation callbacks while onMutate is pending. Keep the
    // submitted snapshot in variables so answer A can never acquire wait B's identity.
    mutationFn: async ({ runId, waitId, value, target }: Answer) => {
      if (target.kind === 'signal') {
        await runs.signal(client, runId, target.name, waitId, value as never);
      } else {
        await runs.provideInput(client, runId, waitId, (value ?? null) as never);
      }
    },
    onSuccess: (_result, { runId }) =>
      void queryClient.invalidateQueries({ queryKey: keys.run(runId) }),
  });
  if (run.status !== 'waiting' || !waiting) return null;
  if (waiting.kind !== 'input' && waiting.kind !== 'signal') {
    return (
      <Alert tone="info">
        Waiting for {waiting.kind}
        {waiting.until ? ` until ${formatDateTime(waiting.until)}` : ''} at{' '}
        <code className="wrap-anywhere">{nodeName(definition, waiting.nodeId)}</code>.
      </Alert>
    );
  }
  return (
    <Card
      title={
        <>
          <KindChip kind="wait" size="sm" />
          {waiting.kind === 'input'
            ? 'Input requested'
            : `Waiting for signal "${waiting.signalName ?? ''}"`}
        </>
      }
    >
      <div className="grid gap-5">
        <p className="min-w-0 text-sm wrap-anywhere text-muted">
          At {nodeName(definition, waiting.nodeId)}
        </p>
        {waiting.prompt ? (
          <BoundedValue
            value={waiting.prompt}
            text
            tone="heading"
            label="Prompt"
            labelled
            className="-mx-3"
          />
        ) : null}
        <JsonSchemaForm
          // One form per wait: the next wait (even at the same node) starts empty, while a refetch
          // of the same wait keeps what was typed. `waitId` is the observed park identity.
          key={JSON.stringify([
            waiting.nodeId,
            waiting.kind,
            waiting.waitId,
            waiting.signalName ?? null,
            waiting.inputSchema ?? null,
          ])}
          schema={waiting.kind === 'input' ? waiting.inputSchema : undefined}
          submitLabel={waiting.kind === 'input' ? 'Submit input' : 'Send signal'}
          busy={respond.isPending}
          onSubmit={(value) =>
            respond.mutate({
              runId: run.id,
              waitId: waiting.waitId,
              value,
              target:
                waiting.kind === 'signal'
                  ? { kind: 'signal', name: waiting.signalName ?? '' }
                  : { kind: 'input' },
            })
          }
        />
        {respond.isError ? <Alert>{errorMessage(respond.error)}</Alert> : null}
      </div>
    </Card>
  );
}
