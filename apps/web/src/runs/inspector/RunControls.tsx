import { runs, type RunSnapshot } from '@graphgoblin/api-client';
import { isTerminal } from '@graphgoblin/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApi } from '../../api/context.js';
import { keys } from '../../api/queries.js';
import { Icon } from '../../components/icons/index.js';
import { Button, Checkbox, Dialog, HelpText, Select } from '../../components/ui/index.js';
import { ReplayConsequences } from './ReplayConsequences.js';
import { errorMessage } from '../../lib/utils.js';

/** Recovery decisions and their explanations always come from the server. */
export function RunControls({ run }: { run: RunSnapshot }) {
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [nodeId, setNodeId] = useState('');
  const [consent, setConsent] = useState(false);
  const [replaySeq, setReplaySeq] = useState(run.recovery.observedSeq);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.run(run.id) });
  const action = useMutation({
    mutationFn: (kind: 'cancel' | 'pause' | 'resume' | 'replay') =>
      kind === 'replay'
        ? runs.replay(client, run.id, nodeId, {
            observedSeq: replaySeq,
            ...(consent ? { retryUncertainScript: true } : {}),
          })
        : kind === 'resume'
          ? runs.resume(client, run.id, { observedSeq: run.recovery.observedSeq })
          : runs[kind](client, run.id),
    onSuccess: (next, kind) => {
      refresh();
      if (kind === 'replay') {
        setOpen(false);
        void navigate(`/runs/${next.id}`);
      }
    },
    onError: refresh,
  });
  const { resume, replay } = run.recovery;
  const selected = replay.find((node) => node.nodeId === nodeId);
  const needsConsent =
    selected && !selected.action.allowed && selected.action.code === 'SCRIPT_CONSENT_REQUIRED';
  // A second pointer click stays in the same intent even if a fast retry already failed again.
  // Use the browser's click count instead of introducing a debounce window; keyboard clicks are 0.
  const recover = (kind: 'resume' | 'replay', clickCount: number) => {
    if (clickCount > 1) return;
    action.mutate(kind);
  };
  return (
    <div className="grid min-w-0 max-w-xl gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!isTerminal(run.status) && run.status !== 'paused' ? (
          <Button
            variant="outline"
            onClick={() => action.mutate('pause')}
            disabled={action.isPending}
          >
            <Icon name="paused" /> Pause
          </Button>
        ) : null}
        <Button
          variant="outline"
          onClick={(event) => recover('resume', event.detail)}
          disabled={action.isPending || !resume.allowed}
          aria-describedby={`resume-reason-${run.id}`}
        >
          <Icon name="running" /> Resume
        </Button>
        {!isTerminal(run.status) ? (
          <Button
            variant="destructive"
            onClick={() => action.mutate('cancel')}
            disabled={action.isPending}
          >
            <Icon name="cancelled" /> Cancel run
          </Button>
        ) : null}
        <Button
          variant="outline"
          onClick={() => {
            action.reset();
            setReplaySeq(run.recovery.observedSeq);
            setConsent(false);
            setNodeId(
              replay.find((node) => node.action.allowed)?.nodeId ?? replay[0]?.nodeId ?? '',
            );
            setOpen(true);
          }}
          disabled={action.isPending}
        >
          Replay...
        </Button>
      </div>
      <p id={`resume-reason-${run.id}`} className="text-sm text-muted">
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
      {action.isError && !open ? (
        <HelpText tone="bad" role="alert">
          {errorMessage(action.error)}
        </HelpText>
      ) : null}
      <Dialog
        open={open}
        title="Replay as a new run"
        onClose={() => {
          if (!action.isPending) setOpen(false);
        }}
        footer={
          <>
            <Button
              disabled={
                action.isPending || !(selected?.action.allowed || (needsConsent && consent))
              }
              onClick={(event) => recover('replay', event.detail)}
            >
              Create replay run
            </Button>
            <Button variant="outline" disabled={action.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <p>Source run {run.id}. The fork starts from recorded state before the selected node.</p>
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
          <Link to={`/runs/${selected.action.replayRunId}`}>
            Open existing replay {selected.action.replayRunId}
          </Link>
        ) : null}
        {action.isError && open ? (
          <HelpText tone="bad" role="alert">
            {errorMessage(action.error)}
          </HelpText>
        ) : null}
      </Dialog>
    </div>
  );
}
