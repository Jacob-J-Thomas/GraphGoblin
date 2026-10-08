import {
  RunEventSchema,
  ContextThreadSchema,
  type RunEvent,
  type EvaluationProvenance,
  type ExitCriterionEvaluation,
  type PrimitiveAnswer,
  type V2RunEvent,
  type ContextThread,
} from '@graphgoblin/contracts';
import { upgradeRunHistoryV1, type UpgradeRunHistoryInput } from './upgrade-history.js';
import { stableStringify } from './json-schema.js';
import { replayThread, replayStateAt } from './replay.js';
import type { UpgradeResult } from './upgrade.js';

type V2Exit = Extract<V2RunEvent, { type: 'exit.evaluated' }>;
export interface UpgradeRunHistoryCurrentInput extends UpgradeRunHistoryInput {
  sourceVersion?: 1 | 2 | 3;
}
function criterionProvenance(
  value: V2Exit['criteria'][number],
  kind: EvaluationProvenance['kind'],
): EvaluationProvenance {
  return {
    kind,
    provider: kind === 'llm' ? 'codex' : null,
    classifierId: kind === 'classifier' ? (value.classifierModel ?? null) : null,
    model: value.model ?? null,
    effort: null,
  };
}
function convertCriterion(value: V2Exit['criteria'][number]): ExitCriterionEvaluation {
  const strategy =
    value.strategy === 'jev' ? 'classifier' : value.strategy === 'codex' ? 'llm' : value.strategy;
  if (value.status === 'skipped')
    return { index: value.index, strategy, status: value.status, reason: value.reason };
  if (value.status === 'error')
    return {
      index: value.index,
      strategy,
      status: value.status,
      diagnostic: value.diagnostic,
      ...(strategy === 'expression' || strategy === 'classifier' || strategy === 'llm'
        ? { provenance: criterionProvenance(value, strategy) }
        : {}),
    };
  if (
    strategy === 'max-iterations' ||
    strategy === 'max-duration' ||
    strategy === 'last-output-matches'
  )
    return { index: value.index, strategy, status: value.status, holds: value.holds ?? null };
  const provenance = criterionProvenance(value, strategy);
  const answer: PrimitiveAnswer =
    strategy === 'expression'
      ? { type: 'noul' as const, kind: strategy, holds: value.holds ?? null, confidence: null }
      : strategy === 'classifier'
        ? {
            type: 'noul' as const,
            kind: strategy,
            holds: value.holds ?? null,
            confidence: value.confidence ?? null,
            trueProbability: null,
          }
        : {
            type: 'noul' as const,
            kind: strategy,
            holds: value.holds ?? null,
            confidence: value.confidence ?? null,
            reasoning: value.reasoning ?? null,
          };
  return {
    index: value.index,
    strategy,
    status: value.status,
    answer,
    provenance,
    acceptance: null,
    match: {
      type: 'noul',
      value: true,
      ...(strategy === 'llm' && value.minConfidence !== undefined
        ? { minReportedConfidence: value.minConfidence }
        : {}),
    },
    ...(strategy === 'classifier' && value.minConfidence !== undefined
      ? { configuredMinConfidence: value.minConfidence }
      : {}),
  };
}

/** Canonical factual history, with no reconstructed provider probability or reasoning. */
export function upgradeRunHistoryCurrent(input: UpgradeRunHistoryCurrentInput): UpgradeResult<{
  initialThread: ContextThread;
  events: RunEvent[];
  finalThread: ContextThread;
  snapshot?: ContextThread;
}> {
  if (input.sourceVersion === 3) {
    try {
      const initialThread = ContextThreadSchema.parse(input.initialThread);
      const events = input.events.map((event) => RunEventSchema.parse(event));
      if (events.some((event, index) => index > 0 && event.seq <= events[index - 1]!.seq))
        throw new Error('event order is not strictly increasing');
      const finalThread = replayThread(initialThread, events);
      const snapshot =
        input.snapshot === undefined ? undefined : ContextThreadSchema.parse(input.snapshot);
      if (snapshot) {
        const checkpoint =
          input.snapshotSeq ??
          (stableStringify(snapshot) === stableStringify(initialThread) ? 0 : undefined);
        if (
          checkpoint === undefined ||
          !Number.isInteger(checkpoint) ||
          checkpoint < 0 ||
          (checkpoint !== 0 && !events.some((event) => event.seq === checkpoint)) ||
          stableStringify(snapshot) !==
            stableStringify(replayThread(initialThread, events, checkpoint))
        )
          throw new Error('snapshot is not a recorded checkpoint');
      }
      return {
        ok: true,
        value: { initialThread, events, finalThread, ...(snapshot ? { snapshot } : {}) },
        notices: [],
      };
    } catch (error) {
      return {
        ok: false,
        issues: [
          {
            code: 'UPGRADE_HISTORY_REFUSED',
            path: '/',
            message: error instanceof Error ? error.message : 'current history validation failed',
          },
        ],
      };
    }
  }
  const frozen = upgradeRunHistoryV1(input);
  if (!frozen.ok) return frozen;
  try {
    const events = frozen.value.events.map((event) =>
      RunEventSchema.parse(
        event.type === 'exit.evaluated'
          ? { ...event, criteria: event.criteria.map(convertCriterion) }
          : event,
      ),
    );
    const initialThread = ContextThreadSchema.parse(frozen.value.initialThread);
    const finalThread = replayThread(initialThread, events);
    if (stableStringify(finalThread) !== stableStringify(frozen.value.finalThread))
      throw new Error('exit conversion changed historical replay');
    const snapshot = frozen.value.snapshot && ContextThreadSchema.parse(frozen.value.snapshot);
    if (snapshot) {
      const checkpoint = input.snapshotSeq ?? 0;
      const tail = events.filter((event) => event.seq > checkpoint);
      if (
        stableStringify(
          replayThread(snapshot, tail, undefined, replayStateAt(events, checkpoint)),
        ) !== stableStringify(finalThread)
      )
        throw new Error('exit conversion changed checkpoint replay');
    }
    return {
      ok: true,
      value: { initialThread, events, finalThread, ...(snapshot ? { snapshot } : {}) },
      notices: frozen.notices,
    };
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: 'UPGRADE_HISTORY_REFUSED',
          path: '/',
          message: error instanceof Error ? error.message : 'history conversion failed',
        },
      ],
    };
  }
}
