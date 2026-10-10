import {
  V2ContextThreadSchema as ContextThreadSchema,
  V2DecisionPayloadSchema as DecisionPayloadSchema,
  V2RunEventSchema as RunEventSchema,
  type V2ContextThread as ContextThread,
  type V2DecisionPayload as DecisionPayload,
  PROGRESS_SUMMARY_MAX,
  type EvaluationProvenance,
  type JsonValue,
  type V2RunEvent as RunEvent,
} from '@graphgoblin/contracts';
import { replayStateAt, replayThread } from './replay.js';
import { stableStringify, validateJson } from './json-schema.js';
import { LEGACY_V1_SCHEMA } from './upgrade-v1-schema.js';
import type { UpgradeIssue, UpgradeResult } from './upgrade.js';

/** Replay reads only these unchanged event fields, never the versioned decision/exit evidence. */
const replayEvents = (events: readonly RunEvent[]) =>
  events.filter(
    (
      event,
    ): event is Extract<
      RunEvent,
      { type: 'node.started' | 'node.finished' | 'iteration.incremented' }
    > =>
      event.type === 'node.started' ||
      event.type === 'node.finished' ||
      event.type === 'iteration.incremented',
  );

type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const problem = (code: string, path: string, message: string): UpgradeIssue => ({
  code,
  path,
  message,
});

/** Frozen from engine handlers/inference.ts progressSummary; keep historical redaction identical. */
function historicalProgressSummary(item: { type: unknown; summary: string }): string {
  if (item.type === 'error') return 'Harness reported an error';
  if (item.type === 'tool-call') {
    const diagnostic = item.summary.indexOf(' failed: ');
    if (diagnostic >= 0)
      return `${item.summary.slice(0, diagnostic)} failed`.slice(0, PROGRESS_SUMMARY_MAX);
  }
  return item.summary.slice(0, PROGRESS_SUMMARY_MAX);
}

function provenance(strategy: unknown, classifierId: unknown = null): EvaluationProvenance {
  if (!['jev', 'codex', 'expression'].includes(String(strategy)))
    throw new Error('invalid historical strategy');
  return {
    kind: strategy === 'jev' ? 'classifier' : strategy === 'codex' ? 'llm' : 'expression',
    provider: strategy === 'codex' ? 'codex' : null,
    classifierId: typeof classifierId === 'string' ? classifierId : null,
    model: null,
    effort: null,
  };
}
/** Historical alternatives are not calibrated probabilities. Their exact source survives in the audit archive. */
export function upgradeDecisionFactV1(value: unknown): DecisionPayload {
  if (!object(value) || typeof value.route !== 'string')
    throw new Error('invalid historical decision output');
  return DecisionPayloadSchema.parse({
    answer: {
      type: 'choice',
      optionId: value.route,
      confidence: value.confidence ?? null,
      probabilities: null,
    },
    portId: value.route,
    provenance: provenance(value.strategy, value.classifierModel),
  });
}

function convertOutput(value: unknown, decisions: Set<string>): unknown {
  if (
    !object(value) ||
    typeof value.nodeId !== 'string' ||
    !object(value.value) ||
    !('route' in value.value) ||
    !('strategy' in value.value)
  )
    return value;
  if (!decisions.has(value.nodeId)) return value; // Other node/user output JSON is not a decision fact.
  return { ...value, value: upgradeDecisionFactV1(value.value) };
}
/** Only documented thread output envelopes are decision provenance; arbitrary JSON is preserved. */
function convertThread(value: unknown, decisions: Set<string>): unknown {
  if (!object(value)) return value;
  return {
    ...value,
    ...(object(value.outputs)
      ? {
          outputs: Object.fromEntries(
            Object.entries(value.outputs).map(([id, output]) => [
              id,
              convertOutput(output, decisions),
            ]),
          ),
        }
      : {}),
    ...(value.lastOutput !== undefined
      ? { lastOutput: convertOutput(value.lastOutput, decisions) }
      : {}),
  };
}
/** Rewrites exact output patch locations, retaining arbitrary vars/messages/payload values. */
function convertPatch(event: Obj, decisions: Set<string>, oldThread: ContextThread): unknown {
  if (!Array.isArray(event.patch)) throw new Error('invalid historical node patch');
  return event.patch.map((entry: unknown): unknown => {
    if (!object(entry) || !('value' in entry)) return entry;
    const pointer = String(entry.path);
    let value: unknown = entry.value;
    if (pointer === '') value = convertThread(value, decisions);
    else if (pointer === '/outputs' && object(value))
      value = Object.fromEntries(
        Object.entries(value).map(([id, output]) => [id, convertOutput(output, decisions)]),
      );
    else if (pointer === '/lastOutput' || /^\/outputs\/[^/]+$/.test(pointer))
      value = convertOutput(value, decisions);
    const match = /^\/outputs\/([^/]+)\/value(?:\/|$)/.exec(pointer);
    const nodeId =
      match?.[1]?.replaceAll('~1', '/').replaceAll('~0', '~') ??
      (pointer.startsWith('/lastOutput/value') ? oldThread.lastOutput?.nodeId : undefined);
    if (nodeId && decisions.has(nodeId)) {
      if (
        /^\/(?:outputs\/[^/]+|lastOutput)\/value\/(?:route|strategy|confidence)(?:\/|$)/.test(
          pointer,
        )
      )
        throw new Error('partial historical decision output write at ' + pointer);
      if (
        (pointer === '/lastOutput/value' || /^\/outputs\/[^/]+\/value$/.test(pointer)) &&
        object(value) &&
        'route' in value &&
        'strategy' in value
      )
        value = upgradeDecisionFactV1(value);
    }
    return { ...entry, value };
  });
}
export interface UpgradeRunHistoryInput {
  initialThread: unknown;
  events: readonly unknown[];
  decisionNodeIds: readonly string[];
  snapshot?: unknown;
  snapshotSeq?: number;
}
export interface UpgradedRunHistory {
  initialThread: ContextThread;
  events: RunEvent[];
  finalThread: ContextThread;
  snapshot?: ContextThread;
}
/** Strict canonical history conversion with full replay/checkpoint equality before any I/O commit. */
export function upgradeRunHistoryV1(
  input: UpgradeRunHistoryInput,
): UpgradeResult<UpgradedRunHistory> {
  const issues: UpgradeIssue[] = [];
  try {
    const decisions = new Set(input.decisionNodeIds);
    const oldInitial = ContextThreadSchema.parse(input.initialThread);
    const initialThread = ContextThreadSchema.parse(convertThread(oldInitial, decisions));
    let oldState: { openNodeId?: string | undefined; strict?: boolean } = {};
    const events: RunEvent[] = [];
    let oldThread = oldInitial;
    let lastSeq = 0;
    for (const raw of input.events) {
      const valid = validateJson(LEGACY_V1_SCHEMA.event, raw);
      const current = RunEventSchema.safeParse(raw);
      if ((!valid.ok && !current.success) || !object(raw)) throw new Error('invalid stored event');
      if (typeof raw.seq !== 'number' || raw.seq <= lastSeq)
        throw new Error('event order is not strictly increasing');
      lastSeq = raw.seq;
      const next: Obj = clone(raw);
      if (raw.type === 'decision.made' && !current.success) {
        if (typeof raw.nodeId !== 'string' || !decisions.has(raw.nodeId))
          throw new Error('unresolved recorded decision origin');
        // An empty diagnostics list means no skips were recorded, not proof none occurred.
        const skipped = Array.isArray(raw.skipped) ? raw.skipped : [];
        const diagnostics = skipped.map((entry) => {
          if (!object(entry)) throw new Error('invalid skipped-strategy evidence');
          return {
            provenance: provenance(entry.strategy),
            code: entry.code,
            message: entry.message,
          };
        });
        const converted = upgradeDecisionFactV1(raw);
        for (const key of [
          'strategy',
          'classifierModel',
          'route',
          'confidence',
          'alternatives',
          'skipped',
        ])
          delete next[key];
        Object.assign(next, converted, { diagnostics });
      } else if (
        raw.type === 'node.progress' &&
        object(raw.progress) &&
        object(raw.progress.item)
      ) {
        const item = raw.progress.item;
        // The frozen/current validators establish the string summary and allowlisted item fields.
        // Current commands require a lifecycle status; generic items can honestly omit it.
        // The audit preserves original command classification and provider diagnostics.
        next.progress = {
          item: {
            ...item,
            ...(item.type === 'command' && !('status' in item) ? { type: 'other' } : {}),
            summary: historicalProgressSummary({
              type: item.type,
              summary: item.summary as string,
            }),
          },
        };
      } else if (raw.type === 'node.finished') next.patch = convertPatch(raw, decisions, oldThread);
      else if (raw.type === 'run.queued' && raw.initialThread !== undefined)
        next.initialThread = convertThread(raw.initialThread, decisions);
      const parsed = RunEventSchema.safeParse(next);
      if (!parsed.success) throw new Error('converted event violates v2 at seq ' + String(raw.seq));
      events.push(parsed.data);
      // The frozen validator establishes the legacy event shape; replay touches only unchanged patch fields.
      oldThread = replayThread(
        oldThread,
        replayEvents([raw as unknown as RunEvent]),
        undefined,
        oldState,
      );
      if (raw.type === 'node.started') oldState = { strict: true, openNodeId: String(raw.nodeId) };
      else if (
        raw.type === 'node.finished' &&
        (!oldState.strict || oldState.openNodeId === raw.nodeId)
      )
        oldState = { ...oldState, openNodeId: undefined };
    }
    const finalThread = replayThread(initialThread, replayEvents(events));
    const convertedOldFinal = ContextThreadSchema.parse(convertThread(oldThread, decisions));
    if (stableStringify(finalThread) !== stableStringify(convertedOldFinal))
      throw new Error('converted full replay does not equal transformed historical replay');
    let snapshot: ContextThread | undefined;
    if (input.snapshot !== undefined) {
      const checkpointSeq =
        input.snapshotSeq ??
        (stableStringify(input.snapshot) === stableStringify(oldInitial) ? 0 : undefined);
      if (
        checkpointSeq === undefined ||
        !Number.isInteger(checkpointSeq) ||
        checkpointSeq < 0 ||
        (checkpointSeq !== 0 && !events.some((event) => event.seq === checkpointSeq))
      )
        throw new Error('snapshot has no recorded checkpoint sequence');
      snapshot = ContextThreadSchema.parse(convertThread(input.snapshot, decisions));
      {
        const expected = replayThread(initialThread, replayEvents(events), checkpointSeq);
        if (stableStringify(snapshot) !== stableStringify(expected))
          throw new Error('snapshot is not the recorded checkpoint');
        const tail = events.filter((event) => event.seq > checkpointSeq);
        const resumed = replayThread(
          snapshot,
          replayEvents(tail),
          undefined,
          replayStateAt(replayEvents(events), checkpointSeq),
        );
        if (stableStringify(resumed) !== stableStringify(finalThread))
          throw new Error('checkpoint replay differs from full replay');
      }
    }
    return {
      ok: true,
      value: { initialThread, events, finalThread, ...(snapshot ? { snapshot } : {}) },
      notices: [],
    };
  } catch (error) {
    issues.push(
      problem(
        'UPGRADE_HISTORY_REFUSED',
        '/',
        error instanceof Error ? error.message : 'historical conversion failed',
      ),
    );
    return { ok: false, issues };
  }
}

/** JSON-preserving change to the approved failed-run disposition; the old failure is archived. */
export function upgradedFailure(
  value: unknown,
  approval: { approvedAt: string; reason: string; version?: 2 | 3 },
): JsonValue {
  if (!object(value)) throw new Error('failed run has no failure record');
  return {
    ...value,
    resumable: false,
    details: {
      original: (value.details ?? null) as JsonValue,
      upgrade: {
        version: approval.version ?? 2,
        disposition: 'nonresumable-replay',
        approvedAt: approval.approvedAt,
        reason: approval.reason,
      },
    },
  };
}
