import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import type { RunEvent, RunRecord, RunRecovery, RecoveryAction } from '@graphgoblin/contracts';
import type { EnginePorts } from './ports.js';
import { childSessionRecovered } from './session-recovery.js';
import { definitionUpgradeRequired } from './stored-definition.js';

const allowed: RecoveryAction = { allowed: true };
export const refused = (
  code: Exclude<RecoveryAction, { allowed: true }>['code'],
  message: string,
): Exclude<RecoveryAction, { allowed: true }> => ({ allowed: false, code, message });

/** Read and command paths share this policy. It never repairs or advances execution. */
export async function runRecovery(
  ports: EnginePorts,
  run: RunRecord,
  events: readonly RunEvent[],
  owningParent?: string,
): Promise<RunRecovery> {
  const observedSeq = events.at(-1)?.seq ?? 0;
  const version = await ports.loops.getVersion(run.versionId);
  const parsed = version ? LoopDefinitionSchema.safeParse(version.definition) : undefined;
  const definition = parsed?.success ? parsed.data : undefined;
  const initial = await ports.runs.getInitialThread(run.id);
  let common: RecoveryAction | undefined;
  if (run.cancelRequestedAt || run.status === 'cancelled')
    common = refused('RUN_CANCELLED', 'This run was cancelled; recovery is unavailable.');
  else if (
    ['queued', 'running', 'waiting'].includes(run.status) ||
    (run.status === 'failed' &&
      events.findLast((event) =>
        ['run.resumed', 'run.failed', 'run.finished', 'run.cancelled'].includes(event.type),
      )?.type === 'run.resumed')
  )
    common = refused(
      'RUN_ACTIVE',
      'This run is still active. Pause it before continuing with Resume.',
    );
  else if (!version || !definition || definitionUpgradeRequired(version))
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

  // Only a parent still awaiting this exact child owns ordinary recovery. A missing-session
  // fresh-start choice remains available on the child through its separate explicit endpoint.
  if (!common && run.parentRunId && owningParent !== run.parentRunId) {
    const parent = await ports.runs.get(run.parentRunId);
    const details = parent?.failure?.details;
    const failedChild =
      typeof details === 'object' && details !== null && !Array.isArray(details)
        ? details.childRunId
        : undefined;
    if (parent?.status === 'failed' && failedChild === run.id)
      common = {
        ...refused(
          'PARENT_RECOVERY_REQUIRED',
          `Recovery belongs to parent run ${run.parentRunId}. Open that parent to review its recovery choices.`,
        ),
        parentRunId: run.parentRunId,
      };
  }

  const uncertain = run.status === 'failed' && run.failure?.code === 'SCRIPT_OUTCOME_UNCERTAIN';
  const uncertainNode = run.failure?.nodeId ?? run.currentNodeId;
  const missing =
    run.status === 'failed' &&
    run.failure?.code === 'HARNESS_SESSION_MISSING' &&
    !(await childSessionRecovered(ports, run));
  const resume =
    common ??
    (missing
      ? refused(
          'SESSION_RECOVERY_REQUIRED',
          'Choose Start fresh session on the failed inference run before resuming.',
        )
      : run.failure?.script?.state === 'completed' || run.failure?.code === 'SCRIPT_EXIT_CODE'
        ? refused(
            'EXTERNAL_EFFECT_CONSUMED',
            'The failed script already executed. Resume would repeat its external work; start a deliberate new execution instead.',
          )
        : uncertain && run.failure?.resumable
          ? refused(
              'SCRIPT_CONSENT_REQUIRED',
              'The script may already have produced its effect. Choose Recover script to explicitly retry.',
            )
          : run.status === 'paused' ||
              (run.status === 'failed' &&
                (run.failure?.resumable || run.failure?.code === 'HARNESS_SESSION_MISSING'))
            ? allowed
            : run.status === 'failed'
              ? refused(
                  'FAILURE_NOT_RESUMABLE',
                  'This failure cannot be resumed. Inspect its cause or choose an eligible Replay node.',
                )
              : refused(
                  'RUN_FINISHED',
                  'This run has finished. Resume only continues paused runs or supported failures.',
                ));
  const replayCommon =
    common ??
    (run.status === 'paused'
      ? refused('RUN_PAUSED', 'This run is paused. Resume continues this existing run.')
      : missing
        ? refused(
            'SESSION_RECOVERY_REQUIRED',
            'Choose Start fresh session on the failed inference run before replaying.',
          )
        : undefined);
  const nodes = (definition?.nodes ?? []).map((node) => {
    const first = events.find((e) => e.type === 'node.started' && e.nodeId === node.id);
    let action = replayCommon;
    if (!action && !first)
      action = refused('REPLAY_NODE_NOT_REACHED', 'This run never reached this node.');
    if (!action && first) {
      // A fork is a new execution, not an undo operation. Conservatively refuse a suffix that
      // consumed external work, including children and provider turns. A proven pre-start
      // script refusal consumed nothing. Only the current uncertain script has a consent path.
      const reachable = new Set([node.id]);
      const pending = [node.id];
      for (const id of pending) {
        for (const edge of definition?.edges ?? []) {
          if (edge.from.node === id && !reachable.has(edge.to.node)) {
            reachable.add(edge.to.node);
            pending.push(edge.to.node);
          }
        }
      }
      const refusedDispatches = new Set(
        events.flatMap((event) =>
          event.type === 'run.failed' &&
          event.failure.script?.state === 'definitely-not-started' &&
          event.failure.script.dispatchId
            ? [event.failure.script.dispatchId]
            : [],
        ),
      );
      const effects = events.filter(
        (e) =>
          (!('nodeId' in e) || reachable.has(e.nodeId)) &&
          (e.type === 'script.dispatched' ||
            e.type === 'child_run.started' ||
            (e.type === 'node.finished' &&
              definition?.nodes.some(
                (finished) =>
                  finished.id === e.nodeId &&
                  ['script', 'inference', 'subloop'].includes(finished.kind),
              )) ||
            (e.type === 'harness.turn' &&
              !events.some(
                (submission) =>
                  submission.type === 'harness.submission' &&
                  submission.turnId === e.turnId &&
                  submission.submission === 'definitely-not-submitted',
              )) ||
            e.type === 'delivery.queued' ||
            (e.type === 'return.delivered' && e.channel.kind === 'file') ||
            (e.type === 'return.failed' && e.channel.kind === 'file')),
      );
      const consumedEffects = effects.filter(
        (event) => event.type !== 'script.dispatched' || !refusedDispatches.has(event.dispatchId),
      );
      // An uncertain visit is evidence even when the dispatch marker/acknowledgement is absent.
      // Replaying an earlier node must not bypass the failed script's dedicated consent choice.
      const consumed =
        consumedEffects.length > 0 ||
        (uncertain && (!uncertainNode || reachable.has(uncertainNode)));
      const consentOnly =
        uncertain &&
        run.failure?.resumable &&
        node.id === uncertainNode &&
        consumedEffects.every(
          (e) =>
            e.type === 'script.dispatched' &&
            e.nodeId === node.id &&
            e.visitId === run.failure?.script?.visitId,
        );
      action = consentOnly
        ? refused(
            'SCRIPT_CONSENT_REQUIRED',
            'Replay would retry an uncertain script. Choose Recover script to explicitly allow this effect.',
          )
        : consumed
          ? refused(
              'EXTERNAL_EFFECT_CONSUMED',
              'Replay here could repeat recorded external work or deliveries. Choose a node after that work.',
            )
          : allowed;
    }
    return { nodeId: node.id, label: node.label, action: action ?? allowed };
  });
  const failed = events.findLast((e) => e.type === 'run.failed');
  return {
    observedSeq,
    resume,
    replayDefault:
      replayCommon ?? refused('REPLAY_NODE_NOT_REACHED', 'This run never reached this node.'),
    replay: nodes,
    ...(uncertain && !common && run.failure?.resumable && failed
      ? {
          scriptConsent: {
            failureSeq: failed.seq,
            nodeId: run.failure.nodeId ?? run.currentNodeId!,
          },
        }
      : {}),
    ...(initial?.invocation.replayOf ? { replayOf: initial.invocation.replayOf } : {}),
  };
}

/** A requested node absent from the pinned definition is a typed refusal as well. */
export function replayAction(recovery: RunRecovery, nodeId: string): RecoveryAction {
  return recovery.replay.find((node) => node.nodeId === nodeId)?.action ?? recovery.replayDefault;
}
