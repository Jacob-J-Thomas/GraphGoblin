import { createContext, use } from 'react';

/**
 * How a change of a schema-driven form counts for undo (#17). `commit` is a discrete choice: a
 * select or picker, a switch, a segmented control, a checkbox, a button that sets a value, or
 * adding or removing a collection's rows; each is an undo step of its own. `typing` is text entry
 * (text, number, code, JSON, a record key): typing in one field is one step for as long as it
 * continues, and typing in another field is another step.
 */
export type ChangeKind = 'commit' | 'typing';

/** What SchemaForm reports with each change: where it was made, and how it counts for undo. */
export interface FormChange {
  /**
   * The field the change was made in, relative to the form's value (`model`, `env.HOME`). Typing
   * merges per path. A record key's rename names its row (`env#key3`), since the key itself changes.
   */
  path: string;
  kind: ChangeKind;
  /**
   * The action this change belongs to. Every write one commit makes (its value, and the unparsed
   * text it moves or drops) carries the same id, so they are one undo step.
   */
  id: number;
}

/**
 * Runs `write` as one change of the form; SchemaForm reports every value and unparsed text it
 * causes with this description. A change already under way keeps its description, so an action
 * stays what its outermost caller says it is: a collection's Remove is one commit through the
 * field writes it makes, and typing in a record's value is typing at that value's path.
 */
export type ChangeScope = (change: Omit<FormChange, 'id'>, write: () => void) => void;

/** Outside a SchemaForm a change is just its write. */
export const FormChangeContext = createContext<ChangeScope>((_change, write) => write());

export function useFormChange(): ChangeScope {
  return use(FormChangeContext);
}

let changes = 0;

/** A fresh change id, unique for the page's lifetime (forms remount; ids must not repeat). */
export function nextChangeId(): number {
  changes += 1;
  return changes;
}
