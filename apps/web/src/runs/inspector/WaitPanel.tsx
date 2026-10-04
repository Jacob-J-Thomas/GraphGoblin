import { runs, type RunSnapshot } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../api/context.js';
import { keys } from '../../api/queries.js';
import { Alert, Card } from '../../components/ui/index.js';
import { KindChip } from '../../editor/KindChip.js';
import { JsonSchemaForm } from '../../forms/JsonSchemaForm.js';
import { errorMessage, formatDateTime } from '../../lib/utils.js';

/** The run waits on input or a signal: a form for it, generated from the wait node's schema. */
export function WaitPanel({ run }: { run: RunSnapshot }) {
  const client = useApi();
  const queryClient = useQueryClient();
  const waiting = run.waiting;
  const respond = useMutation({
    mutationFn: async (value: unknown) => {
      if (waiting?.kind === 'signal') {
        await runs.signal(client, run.id, waiting.signalName ?? '', value as never);
      } else {
        await runs.provideInput(client, run.id, (value ?? null) as never);
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.run(run.id) }),
  });
  if (run.status !== 'waiting' || !waiting) return null;
  if (waiting.kind !== 'input' && waiting.kind !== 'signal') {
    return (
      <Alert tone="info">
        Waiting for {waiting.kind}
        {waiting.until ? ` until ${formatDateTime(waiting.until)}` : ''} at{' '}
        <code>{waiting.nodeId}</code>.
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
        {waiting.prompt ? (
          <p className="text-lg font-semibold whitespace-pre-wrap">{waiting.prompt}</p>
        ) : null}
        <JsonSchemaForm
          schema={waiting.kind === 'input' ? waiting.inputSchema : undefined}
          submitLabel={waiting.kind === 'input' ? 'Submit input' : 'Send signal'}
          busy={respond.isPending}
          onSubmit={(value) => respond.mutate(value)}
        />
        {respond.isError ? <Alert>{errorMessage(respond.error)}</Alert> : null}
      </div>
    </Card>
  );
}
