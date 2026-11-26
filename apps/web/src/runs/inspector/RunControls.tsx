import { runs, type GraphGoblinClient, type RunSnapshot } from '@graphgoblin/api-client';
import { isTerminal } from '@graphgoblin/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { isCurrentCredential } from '../../api/api-key.js';
import { useApi } from '../../api/context.js';
import {
  CredentialChangedError,
  sendUnder,
  type Credential,
} from '../../api/credential-dispatch.js';
import { keys } from '../../api/queries.js';
import { Icon } from '../../components/icons/index.js';
import { Button, Checkbox, Dialog, HelpText, Select } from '../../components/ui/index.js';
import { ReplayConsequences } from './ReplayConsequences.js';
import { errorMessage } from '../../lib/utils.js';

/**
 * Whether the inspector may send a write for the run it shows (#416). The inspector issues a new
 * gate whenever the visit, the run, the outage boundary or the accepted credential changes, so a
 * gate captured earlier (by an open review, a queued mutation or a pending preview) stays spent
 * after a reconnect, an A→B→A visit or an API-key change (#562). Outside the inspector, `OPEN_GATE`
 * keeps ordinary behaviour.
 */
export interface WriteGate {
  /** Why this view cannot send writes now; undefined while it can. */
  readonly blocked: string | undefined;
  /** This gate is still the view's current one and its live connectivity and read checks pass. */
  readonly open: () => boolean;
  /** The visit that issued this gate is still shown (an outage alone does not end it). */
  readonly shown: () => boolean;
  /**
   * The accepted credential this gate was issued under (#562). A write chosen under it is sent only
   * while it is still the accepted one, checked where the key to send is read, and an outcome that
   * settles under another is not shown. Without one, writes keep ordinary behaviour.
   */
  readonly credential?: Credential | undefined;
}

export const OPEN_GATE: WriteGate = { blocked: undefined, open: () => true, shown: () => true };

export const NOT_SENT =
  'Not sent: this view lost its connection to the run. Read the run again before retrying.';

/** A review closed because this browser's accepted API key changed (#562); `trigger` reopens it. */
export const reviewClosedByKey = (trigger: string) =>
  `Review closed: this browser's API key changed. Nothing was sent. Open ${trigger} again to choose with the current key.`;

/** A write chosen before this browser's accepted API key changed, refused before it was sent. */
export const notSentByKey = (action: string) =>
  `Not sent: this browser's API key changed before ${action} was sent. Choose it again to send with the current key.`;

/** A write sent before this browser's accepted API key changed, settled after it (#562). */
export const requestedBeforeKey = (action: string) =>
  `${action} was requested before this browser's API key changed. Its outcome isn't shown under the current key; check Runs before trying again.`;

/** A write chosen under `gate` whose credential is no longer the accepted one, checked live. */
export function crossed(gate: WriteGate): boolean {
  return gate.credential !== undefined && !isCurrentCredential(gate.credential);
}

/** Whether two gates were issued under the same accepted credential. */
export function sameCredential(a: WriteGate, b: WriteGate): boolean {
  return (
    a.credential?.generation === b.credential?.generation &&
    a.credential?.rejected === b.credential?.rejected
  );
}

/** Checked immediately before each API write, after any queued or delayed mutation step. */
export function assertOpen(gate: WriteGate): void {
  if (crossed(gate)) throw new CredentialChangedError();
  if (!gate.open()) throw new Error(NOT_SENT);
}

/**
 * Send one write chosen under `gate`: its checks pass now, and the request is sent only under the
 * gate's credential, compared again where the key is read after every later await (#562).
 */
export async function sendWrite<T>(
  client: GraphGoblinClient,
  gate: WriteGate,
  send: (client: GraphGoblinClient) => Promise<T>,
): Promise<T> {
  assertOpen(gate);
  return sendUnder(client, gate.credential, send);
}

/**
 * Whether a review open under the view's previous gate was closed by an accepted API-key change
 * (#562), rather than by an outage or the reader (`expired`). `shown` is the gate of the review
 * shown open now, if any. It says that nothing was sent (`closed`) only when no write it sent is
 * still unsettled (`sending`): that write reports its own outcome. Reopening, or choosing anything
 * else, clears it.
 */
export function useClosedByKey(
  availability: WriteGate,
  shown: WriteGate | undefined,
  sending: boolean,
): { readonly expired: boolean; readonly closed: boolean; readonly clear: () => void } {
  const [seen, setSeen] = useState({ availability, shown });
  const [expiry, setExpiry] = useState<'closed' | 'sending'>();
  if (seen.availability !== availability || seen.shown !== shown) {
    setSeen({ availability, shown });
    if (
      seen.availability !== availability &&
      seen.shown !== undefined &&
      seen.shown === seen.availability &&
      !sameCredential(seen.availability, availability)
    )
      setExpiry(sending ? 'sending' : 'closed');
  }
  return {
    expired: expiry !== undefined,
    closed: expiry === 'closed',
    clear: () => setExpiry(undefined),
  };
}

/**
 * Where focus goes when a review closes: one an API-key change expired returns to its trigger while
 * that can take focus, otherwise to the status line that reports it. Other closings keep the
 * dialog's own return. The API-key prompt asks for focus only after every dialog has closed, so
 * this never takes focus from it.
 */
export function expiredReviewFocus(
  expired: boolean,
  trigger: HTMLButtonElement | null,
  status: HTMLElement | null,
): HTMLElement | null | undefined {
  if (!expired) return undefined;
  return trigger && !trigger.disabled ? trigger : status;
}

/**
 * Buttons whose label wraps onto further lines, growing the button, where a narrow viewport or
 * enlarged text cannot hold it on one line, instead of cutting it short (#563). A label that fits
 * is the same one-line button: the minimum height is the size's own height.
 */
export const WRAPPING_LABEL = {
  sm: 'h-auto min-h-8 py-1.5 [&>span]:whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-11',
  md: 'h-auto min-h-9 py-1.5 [&>span]:whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-11',
} as const;

/** Everything a command sends, frozen when it is chosen: a refetch can replace these options. */
type Command =
  | { kind: 'cancel' | 'pause'; runId: string; gate: WriteGate }
  | { kind: 'resume'; runId: string; gate: WriteGate; observedSeq: number }
  | {
      kind: 'replay';
      runId: string;
      gate: WriteGate;
      nodeId: string;
      observedSeq: number;
      consent: boolean;
    };

/** The control each command is chosen with, as its outcome names it. */
const COMMAND_NAME: Record<Command['kind'], string> = {
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel run',
  replay: 'Replay',
};

/** Recovery decisions and their explanations always come from the server. */
export function RunControls({
  run,
  availability = OPEN_GATE,
}: {
  run: RunSnapshot;
  availability?: WriteGate;
}) {
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // The gate a replay review was opened under. A new gate (an outage, a reconnect, another
  // accepted API key) expires it.
  const [review, setReview] = useState<WriteGate>();
  const open = review !== undefined && review === availability;
  const [nodeId, setNodeId] = useState('');
  const [consent, setConsent] = useState(false);
  const [replaySeq, setReplaySeq] = useState(run.recovery.observedSeq);
  // A command sent under an earlier accepted credential that settled under a later one (#562):
  // only that it was requested is shown, never its IDs, error text or new run.
  const [requested, setRequested] = useState<Command>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const refresh = (runId: string) =>
    void queryClient.invalidateQueries({ queryKey: keys.run(runId) });
  const action = useMutation({
    mutationFn: (command: Command) =>
      sendWrite(client, command.gate, (client) => {
        switch (command.kind) {
          case 'replay':
            return runs.replay(client, command.runId, command.nodeId, {
              observedSeq: command.observedSeq,
              ...(command.consent ? { retryUncertainScript: true } : {}),
            });
          case 'resume':
            return runs.resume(client, command.runId, { observedSeq: command.observedSeq });
          default:
            return runs[command.kind](client, command.runId);
        }
      }),
    onSuccess: (next, command) => {
      refresh(command.runId);
      if (command.kind === 'replay') setReview(undefined);
      if (crossed(command.gate)) setRequested(command);
      // A sent replay opens its new run only while the visit that asked for it is shown, under
      // the credential it was sent with.
      else if (command.kind === 'replay' && command.gate.shown()) void navigate(`/runs/${next.id}`);
    },
    onError: (error, command) => {
      refresh(command.runId);
      if (!(error instanceof CredentialChangedError) && crossed(command.gate))
        setRequested(command);
    },
  });
  const expiry = useClosedByKey(availability, open ? review : undefined, action.isPending);
  const { resume, replay } = run.recovery;
  const unavailable = availability.blocked !== undefined;
  const selected = replay.find((node) => node.nodeId === nodeId);
  const needsConsent =
    selected && !selected.action.allowed && selected.action.code === 'SCRIPT_CONSENT_REQUIRED';
  // An outcome is shown only under the accepted credential its command was chosen under; one
  // refused at dispatch for that reason says only that.
  const command = action.variables;
  const failure =
    action.isError && command
      ? action.error instanceof CredentialChangedError
        ? notSentByKey(COMMAND_NAME[command.kind])
        : sameCredential(command.gate, availability) && requested !== command
          ? errorMessage(action.error)
          : undefined
      : undefined;
  const notice = requested
    ? requestedBeforeKey(COMMAND_NAME[requested.kind])
    : expiry.closed
      ? reviewClosedByKey('Replay...')
      : undefined;
  // A second pointer click stays in the same intent even if a fast retry already failed again.
  // Use the browser's click count instead of introducing a debounce window; keyboard clicks are 0.
  // Nothing is queued once the gate the command captured is spent.
  const send = (command: Command, clickCount = 0) => {
    if (clickCount > 1 || !command.gate.open()) return;
    setRequested(undefined);
    expiry.clear();
    action.mutate(command);
  };
  return (
    <div className="grid min-w-0 max-w-xl gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!isTerminal(run.status) && run.status !== 'paused' ? (
          <Button
            variant="outline"
            className={WRAPPING_LABEL.md}
            onClick={() => send({ kind: 'pause', runId: run.id, gate: availability })}
            disabled={action.isPending || unavailable}
          >
            <Icon name="paused" /> Pause
          </Button>
        ) : null}
        <Button
          variant="outline"
          className={WRAPPING_LABEL.md}
          onClick={(event) =>
            send(
              {
                kind: 'resume',
                runId: run.id,
                gate: availability,
                observedSeq: run.recovery.observedSeq,
              },
              event.detail,
            )
          }
          disabled={action.isPending || !resume.allowed || unavailable}
          aria-describedby={`resume-reason-${run.id}`}
        >
          <Icon name="running" /> Resume
        </Button>
        {!isTerminal(run.status) ? (
          <Button
            variant="destructive"
            className={WRAPPING_LABEL.md}
            onClick={() => send({ kind: 'cancel', runId: run.id, gate: availability })}
            disabled={action.isPending || unavailable}
          >
            <Icon name="cancelled" /> Cancel run
          </Button>
        ) : null}
        <Button
          ref={triggerRef}
          variant="outline"
          className={WRAPPING_LABEL.md}
          onClick={() => {
            if (!availability.open()) return;
            action.reset();
            setRequested(undefined);
            expiry.clear();
            setReplaySeq(run.recovery.observedSeq);
            setConsent(false);
            setNodeId(
              replay.find((node) => node.action.allowed)?.nodeId ?? replay[0]?.nodeId ?? '',
            );
            setReview(availability);
          }}
          disabled={action.isPending || unavailable}
        >
          Replay...
        </Button>
      </div>
      <p id={`resume-reason-${run.id}`} className="text-sm wrap-anywhere text-muted">
        {resume.allowed
          ? `Resume continues run ${run.id}.`
          : `Resume unavailable: ${resume.message}`}
        {!resume.allowed && resume.parentRunId ? (
          <>
            {' '}
            <Link to={`/runs/${resume.parentRunId}`} className="text-link underline">
              Open parent {resume.parentRunId}
            </Link>
          </>
        ) : null}
      </p>
      {/* Always present, so a polite announcement is heard; it takes no space while empty. */}
      <p ref={statusRef} role="status" tabIndex={-1} className="text-sm empty:absolute">
        {notice}
      </p>
      {failure !== undefined && !open ? (
        <HelpText tone="bad" role="alert">
          {failure}
        </HelpText>
      ) : null}
      <Dialog
        open={open}
        title="Replay as a new run"
        returnFocus={() =>
          expiredReviewFocus(expiry.expired, triggerRef.current, statusRef.current)
        }
        onClose={() => {
          if (!action.isPending) setReview(undefined);
        }}
        footer={
          <>
            <Button
              className={WRAPPING_LABEL.md}
              disabled={
                action.isPending ||
                unavailable ||
                !(selected?.action.allowed || (needsConsent && consent))
              }
              onClick={(event) => {
                if (!review) return;
                send(
                  {
                    kind: 'replay',
                    runId: run.id,
                    gate: review,
                    nodeId,
                    observedSeq: replaySeq,
                    consent,
                  },
                  event.detail,
                );
              }}
            >
              Create replay run
            </Button>
            <Button
              variant="outline"
              className={WRAPPING_LABEL.md}
              disabled={action.isPending}
              onClick={() => setReview(undefined)}
            >
              Cancel
            </Button>
          </>
        }
      >
        <p className="wrap-anywhere">
          Source run {run.id}. The fork starts from recorded state before the selected node.
        </p>
        <ReplayConsequences effects={selected?.effects ?? []} />
        <label htmlFor={`replay-node-${run.id}`}>Replay from node</label>
        <Select
          id={`replay-node-${run.id}`}
          value={nodeId}
          onChange={(event) => {
            setNodeId(event.target.value);
            setConsent(false);
          }}
          aria-describedby={`replay-reason-${run.id}`}
        >
          {replay.map((node) => (
            <option key={node.nodeId} value={node.nodeId}>
              {node.label} ({node.nodeId})
            </option>
          ))}
        </Select>
        <p id={`replay-reason-${run.id}`} aria-live="polite">
          {selected
            ? selected.action.allowed
              ? 'Replay is available at this node.'
              : selected.action.message
            : run.recovery.replayDefault.allowed
              ? 'No replay node selected.'
              : run.recovery.replayDefault.message}
        </p>
        {needsConsent ? (
          <label>
            <Checkbox checked={consent} onChange={(event) => setConsent(event.target.checked)} />I
            explicitly allow the current uncertain script to run again; its effect may already have
            happened.
          </label>
        ) : null}
        {selected && !selected.action.allowed && selected.action.replayRunId ? (
          <Link to={`/runs/${selected.action.replayRunId}`} className="wrap-anywhere">
            Open existing replay {selected.action.replayRunId}
          </Link>
        ) : null}
        {failure !== undefined && open ? (
          <HelpText tone="bad" role="alert">
            {failure}
          </HelpText>
        ) : null}
      </Dialog>
    </div>
  );
}
