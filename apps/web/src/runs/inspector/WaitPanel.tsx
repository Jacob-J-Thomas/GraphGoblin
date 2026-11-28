import type { RunRecord } from '@graphgoblin/contracts';
import type { LoopDefinition } from '@graphgoblin/contracts';
import { nodeName } from '../projections.js';
import { runs } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../api/context.js';
import { CredentialChangedError } from '../../api/credential-dispatch.js';
import { keys } from '../../api/queries.js';
import { Alert, BoundedValue, Card } from '../../components/ui/index.js';
import { KindChip } from '../../editor/KindChip.js';
import { JsonSchemaForm } from '../../forms/JsonSchemaForm.js';
import { errorMessage, formatDateTime } from '../../lib/utils.js';
import {
  crossed,
  notSentByKey,
  OPEN_GATE,
  requestedBeforeKey,
  sameCredential,
  sendWrite,
  type WriteGate,
} from './RunControls.js';

type Answer = {
  runId: string;
  waitId: string;
  value: unknown;
  target: { kind: 'input' } | { kind: 'signal'; name: string };
  gate: WriteGate;
};

const answerName = (answer: Answer) =>
  answer.target.kind === 'signal' ? 'Send signal' : 'Submit input';

/** The run waits on input or a signal: a form for it, generated from the wait node's schema. */
export function WaitPanel({
  run,
  definition,
  availability = OPEN_GATE,
}: {
  run: RunRecord;
  definition?: LoopDefinition | undefined;
  availability?: WriteGate;
}) {
  const client = useApi();
  const queryClient = useQueryClient();
  const waiting = run.waiting;
  // An answer that settled under a later accepted credential than it was sent under (#562).
  const [requested, setRequested] = useState<Answer>();
  const respond = useMutation({
    // A refetch may replace mutation callbacks while onMutate is pending. Keep the
    // submitted snapshot in variables so answer A can never acquire wait B's identity, and
    // check its gate again right before sending: an outage meanwhile sends nothing (#416), and
    // neither does another accepted API key (#562).
    mutationFn: ({ runId, waitId, value, target, gate }: Answer) =>
      sendWrite(client, gate, async (client) => {
        if (target.kind === 'signal') {
          await runs.signal(client, runId, target.name, waitId, value as never);
        } else {
          await runs.provideInput(client, runId, waitId, (value ?? null) as never);
        }
      }),
    onSuccess: (_result, answer) => {
      void queryClient.invalidateQueries({ queryKey: keys.run(answer.runId) });
      if (crossed(answer.gate)) setRequested(answer);
    },
    onError: (error, answer) => {
      if (!(error instanceof CredentialChangedError) && crossed(answer.gate)) setRequested(answer);
    },
  });
  const answer = respond.variables;
  // An outcome is shown only under the accepted credential its answer was chosen under.
  const notice =
    answer && requested === answer && !respond.isPending ? (
      <Alert tone="info">{requestedBeforeKey(answerName(answer))}</Alert>
    ) : null;
  const failure =
    answer && respond.isError
      ? respond.error instanceof CredentialChangedError
        ? notSentByKey(answerName(answer))
        : requested !== answer && sameCredential(answer.gate, availability)
          ? errorMessage(respond.error)
          : undefined
      : undefined;
  // The answer is reported even once the run has moved on from the wait it answered.
  if (run.status !== 'waiting' || !waiting) return notice;
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
      {/* One column that shrinks with the card, whose text breaks anywhere when a word cannot
          fit: the prompt, the form and its labels stay inside the card at 320 px with 200%
          text (#563). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 wrap-anywhere">
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
          // The draft stays editable during an outage; only sending waits for a fresh read.
          busy={respond.isPending || availability.blocked !== undefined}
          onSubmit={(value) => {
            // Keyboard submission reaches here even while the button is disabled.
            if (!availability.open()) return;
            respond.mutate({
              runId: run.id,
              waitId: waiting.waitId,
              value,
              target:
                waiting.kind === 'signal'
                  ? { kind: 'signal', name: waiting.signalName ?? '' }
                  : { kind: 'input' },
              gate: availability,
            });
          }}
        />
        {failure !== undefined ? <Alert>{failure}</Alert> : null}
        {notice}
      </div>
    </Card>
  );
}
