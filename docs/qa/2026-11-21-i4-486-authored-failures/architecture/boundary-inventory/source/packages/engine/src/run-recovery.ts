import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { stableStringify } from '@graphgoblin/domain';
import type { RunRecord, RunRecovery, RecoveryAction } from '@graphgoblin/contracts';
import type { EnginePorts, RecoveryFacts } from './ports.js';
import { childSessionRecovered } from './session-recovery.js';
import { definitionUpgradeRequired } from './stored-definition.js';

const allowed: RecoveryAction = { allowed: true };
export const refused = (
  code: Exclude<RecoveryAction, { allowed: true }>['code'],
  message: string,
): Exclude<RecoveryAction, { allowed: true }> => ({ allowed: false, code, message });

/** Main's execution rules, exposed without advancing or repairing execution. */
export async function runRecovery(
  ports: EnginePorts,
  run: RunRecord,
  facts: RecoveryFacts,
  owningParent?: string,
): Promise<RunRecovery> {
  const { observedSeq } = facts;
  const version = await ports.loops.getVersion(run.versionId);
  const parsed = version ? LoopDefinitionSchema.safeParse(version.definition) : undefined;
  const definition = parsed?.success ? parsed.data : undefined;
  const initial = await ports.runs.getInitialThread(run.id);
  let common: RecoveryAction | undefined;
  if (!version || !definition || definitionUpgradeRequired(version))
    common = refused(
      'DEFINITION_UNAVAILABLE',
      'The pinned definition is unavailable or cannot execute.',
    );
  else if (
    !initial ||
    (run.currentNodeId && !definition.nodes.some((node) => node.id === run.currentNodeId))
  )
    common = refused(
      'STATE_UNAVAILABLE',
      'The recorded starting state or current node is unavailable.',
    );

  // Appending a lifecycle event and projecting its status are separate durable operations.
  // An equal tail sequence does not prove that the projection includes the failure payload.
  // Preserve the readable record, but authorize neither recovery action during that gap.
  const lifecycle = facts.lifecycle;
  if (
    !common &&
    ((lifecycle?.type === 'run.failed' &&
      (run.status !== 'failed' ||
        stableStringify(run.failure ?? null) !== stableStringify(lifecycle.failure))) ||
      (lifecycle?.type === 'run.finished' && run.status !== lifecycle.status) ||
      (lifecycle?.type === 'run.cancelled' && run.status !== 'cancelled') ||
      (lifecycle?.type === 'run.resumed' && run.status === 'paused') ||
      ((lifecycle?.type === 'run.started' || lifecycle?.type === 'run.resumed') &&
        ['failed', 'succeeded', 'exhausted', 'cancelled'].includes(run.status)))
  )
    common = refused(
      'RECOVERY_STALE',
      'The recorded lifecycle and run status are still being synchronized. Refresh and review its current recovery choices.',
    );

  if (!common && run.parentRunId && owningParent !== run.parentRunId) {
    const parent = await ports.runs.get(run.parentRunId);
    const details = parent?.failure?.details;
    const child =
      typeof details === 'object' && details !== null && !Array.isArray(details)
        ? details.childRunId
        : undefined;
    const pending =
      parent &&
      ['queued', 'running', 'waiting', 'paused'].includes(parent.status) &&
      (['queued', 'running', 'waiting', 'paused'].includes(run.status) ||
        (run.status === 'failed' && run.failure !== undefined))
        ? (await ports.events.recoveryFacts(parent.id, [])).resumed?.childRecovery
        : undefined;
    if ((parent?.status === 'failed' && child === run.id) || pending?.runId === run.id)
      common = {
        ...refused(
          'PARENT_RECOVERY_REQUIRED',
          `Recovery belongs to parent run ${run.parentRunId}. Open that parent to review its recovery choices.`,
        ),
        parentRunId: run.parentRunId,
      };
  }

  const uncertain =
    run.status === 'failed' &&
    (run.failure?.code === 'SCRIPT_OUTCOME_UNCERTAIN' ||
      run.failure?.script?.state === 'outcome-uncertain');
  const uncertainNode = run.failure?.nodeId ?? run.currentNodeId;
  const missing =
    run.status === 'failed' &&
    run.failure?.code === 'HARNESS_SESSION_MISSING' &&
    !(await childSessionRecovered(ports, run));
  const active =
    ['queued', 'running', 'waiting'].includes(run.status) ||
    (run.status === 'failed' && facts.lifecycle?.type === 'run.resumed');
  const resume =
    common ??
    (run.cancelRequestedAt || run.status === 'cancelled'
      ? refused('RUN_CANCELLED', 'This run was cancelled; Resume is unavailable.')
      : active
        ? refused('RUN_ACTIVE', 'This run is still active. Pause it before continuing with Resume.')
        : missing
          ? refused(
              'SESSION_RECOVERY_REQUIRED',
              'Choose Start fresh session on the failed inference run before resuming, or use Replay for a deliberate new run.',
            )
          : run.status === 'paused'
            ? allowed
            : run.status === 'failed' &&
                (run.failure?.resumable || run.failure?.code === 'HARNESS_SESSION_MISSING')
              ? uncertain
                ? refused(
                    'SCRIPT_CONSENT_REQUIRED',
                    'The script may already have produced its effect. Choose Recover script to explicitly retry.',
                  )
                : allowed
              : run.status === 'failed'
                ? refused(
                    'FAILURE_NOT_RESUMABLE',
                    'This failure cannot be resumed. Inspect its cause or choose a reached Replay node for a new run.',
                  )
                : refused(
                    'RUN_FINISHED',
                    'This run has finished. Resume only continues paused runs or supported failures.',
                  ));
  const nodes = await Promise.all(
    (definition?.nodes ?? []).map(async (node) => {
      const reachable = new Set([node.id]);
      const pending = [node.id];
      for (const id of pending)
        for (const edge of definition?.edges ?? [])
          if (edge.from.node === id && !reachable.has(edge.to.node)) {
            reachable.add(edge.to.node);
            pending.push(edge.to.node);
          }
      const effects: RunRecovery['replay'][number]['effects'] = [];
      for (const target of definition?.nodes ?? []) {
        if (!reachable.has(target.id)) continue;
        if (target.kind === 'script' || target.kind === 'inference' || target.kind === 'subloop')
          effects.push({ nodeId: target.id, label: target.label, kind: target.kind });
        else if (
          target.kind === 'exit' &&
          target.config.returns !== 'none' &&
          target.config.destinations.length
        )
          effects.push({ nodeId: target.id, label: target.label, kind: 'delivery' });
      }
      let action = common;
      if (!action && !facts.reachedNodeIds.includes(node.id))
        action = refused('REPLAY_NODE_NOT_REACHED', 'This run never reached this node.');
      if (!action) {
        const existing = await ports.admission.findReplay(run.id, node.id, observedSeq);
        if (existing)
          action = {
            ...refused(
              'RECOVERY_STALE',
              `This Replay intent already created run ${existing.id}. Open that run instead of submitting the same intent again.`,
            ),
            replayRunId: existing.id,
          };
        else if (uncertain && (!uncertainNode || reachable.has(uncertainNode)))
          action = refused(
            'SCRIPT_CONSENT_REQUIRED',
            'This path runs the current uncertain script again. Explicitly confirm that its effect may repeat.',
          );
      }
      return { nodeId: node.id, label: node.label, effects, action: action ?? allowed };
    }),
  );
  const failed = facts.failed;
  return {
    observedSeq,
    resume,
    replayDefault:
      common ?? refused('REPLAY_NODE_NOT_REACHED', 'This run never reached this node.'),
    replay: nodes,
    ...(uncertain && !common && failed && uncertainNode
      ? { scriptConsent: { failureSeq: failed.seq, nodeId: uncertainNode } }
      : {}),
    ...(initial?.invocation.replayOf ? { replayOf: initial.invocation.replayOf } : {}),
  };
}

export function replayAction(recovery: RunRecovery, nodeId: string): RecoveryAction {
  return recovery.replay.find((node) => node.nodeId === nodeId)?.action ?? recovery.replayDefault;
}
