import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import type { ParseError } from '../forms/parse-errors.js';
import type { DecisionRoutes } from './decision-route-edges.js';

/**
 * The editor's undo history (#17). Every change of the draft is a step: the store's `edit` records
 * the state before it, and undo and redo move between those states. A step covers both the
 * definition, decision-row ownership, and unparsed field text (`fieldErrors`), so connections and text follow undo
 * and redo with the field it belongs to. Selection, the open dialog, and save state are not part of
 * a step. The history lives in memory only: a load, a reload of the server draft, or leaving the
 * editor starts it afresh.
 */

/** What a change is called in the Undo and Redo buttons, and which changes merge into one step. */
export interface HistoryStep {
  /** Lower-case words naming the change, read after "Undo" or "Redo" ("move start"). */
  label: string;
  /**
   * Changes with the same key in quick succession are one step: typing in one field, a run of
   * arrow-key nudges of one node. A step without a key never merges.
   */
  coalesceKey?: string | undefined;
  /** A rename, so undo and redo keep the renamed node selected (and its editor open). */
  renamed?: { from: string; to: string } | undefined;
}

/** Field text that does not parse, per form scope and path (the store's `fieldErrors`). */
export type FieldErrors = Record<string, Record<string, ParseError>>;

/** The part of the editor state a step changes. */
export interface Snapshot {
  definition: LoopDefinitionInput;
  fieldErrors: FieldErrors;
  decisionRoutes: DecisionRoutes;
}

/**
 * One step: the state on the far side of it, and what it was. In `past` that is the state before
 * the step (undo restores it); in `future`, the state after it (redo restores it).
 */
export interface HistoryEntry extends Snapshot {
  label: string;
  renamed?: { from: string; to: string } | undefined;
}

/** The step that later changes may still merge into: its key and when it last changed. */
export interface OpenStep {
  key: string;
  at: number;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
  openStep: OpenStep | undefined;
}

/** Undo keeps at most this many steps; older ones are forgotten. */
export const HISTORY_LIMIT = 100;

/** Changes with the same key less than this far apart (ms) merge into one step. */
export const COALESCE_MS = 1000;

/** The clock the merge window is measured with; tests replace `now`. */
export const historyClock = { now: (): number => performance.now() };

export const EMPTY_HISTORY: History = { past: [], future: [], openStep: undefined };

/**
 * Whether two JSON-like values are equal. A property holding `undefined` counts as absent, as it
 * does once the draft is saved, so an edit that only spells a value differently changes nothing.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  const otherKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  return keys.length === otherKeys.length && keys.every((key) => sameValue(left[key], right[key]));
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return (
    sameValue(a.definition, b.definition) &&
    sameValue(a.fieldErrors, b.fieldErrors) &&
    sameValue(a.decisionRoutes, b.decisionRoutes)
  );
}

/**
 * The history after a change from `before` to `after`. A change whose key matches the open step,
 * within `COALESCE_MS` of its last change, merges into it (and a merged step that ends where it
 * started is dropped); any other change pushes a new step, forgetting the oldest beyond
 * `HISTORY_LIMIT`. Either way the redo steps are gone.
 */
export function recordStep(
  history: History,
  before: Snapshot,
  after: Snapshot,
  step: HistoryStep,
  now: number,
): History {
  const { past, openStep } = history;
  const key = step.coalesceKey;
  if (key !== undefined && openStep?.key === key && now - openStep.at < COALESCE_MS) {
    const top = past.at(-1);
    // Typed and then deleted again: the step changed nothing after all.
    if (top && sameSnapshot(top, after)) {
      return { past: past.slice(0, -1), future: [], openStep: undefined };
    }
    return { past, future: [], openStep: { key, at: now } };
  }
  const entry: HistoryEntry = {
    ...before,
    label: step.label,
    ...(step.renamed ? { renamed: step.renamed } : {}),
  };
  return {
    past: [...past, entry].slice(-HISTORY_LIMIT),
    future: [],
    openStep: key === undefined ? undefined : { key, at: now },
  };
}

/** Where undo (`past`) or redo (`future`) goes from `current`, or undefined when it has nowhere. */
export function travel(
  history: History,
  current: Snapshot,
  direction: 'undo' | 'redo',
): { history: History; entry: HistoryEntry } | undefined {
  const from = direction === 'undo' ? history.past : history.future;
  const entry = from.at(-1);
  if (!entry) return undefined;
  const back: HistoryEntry = {
    ...current,
    label: entry.label,
    ...(entry.renamed ? { renamed: entry.renamed } : {}),
  };
  const rest = from.slice(0, -1);
  const other = direction === 'undo' ? history.future : history.past;
  // A step undone or redone is closed: the next change starts a new one.
  return direction === 'undo'
    ? { history: { past: rest, future: [...other, back], openStep: undefined }, entry }
    : { history: { past: [...other, back], future: rest, openStep: undefined }, entry };
}
