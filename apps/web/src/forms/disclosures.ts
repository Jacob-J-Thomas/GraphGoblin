import { createContext, use, type Dispatch, type SetStateAction } from 'react';

/**
 * Which disclosures of a schema-driven form are open, by key: `#advanced` for the form's Advanced
 * group, a collapsible list item's path (`operations.0`), and a control's own disclosure under its
 * field's path (`expression#advanced`, the cron schedule's raw expression). A key with no entry
 * is at its disclosure's default.
 */
export type DisclosureStates = Readonly<Record<string, boolean>>;

/**
 * The open states and their setter. SchemaForm takes them from its caller when the caller keeps
 * them (the node editor does, so the remount an undo or redo causes keeps what the user opened),
 * and otherwise keeps them itself for the life of the form.
 */
export interface DisclosureStore {
  open: DisclosureStates;
  setOpen: Dispatch<SetStateAction<DisclosureStates>>;
}

/** The key of a form's Advanced group. */
export const ADVANCED_KEY = '#advanced';

export const DisclosureStoreContext = createContext<DisclosureStore | undefined>(undefined);

/**
 * The open state of the disclosure under `key`, for its `open` and `onOpenChange`: the form's
 * record, else `defaultOpen`. Outside a form (no store), the disclosure keeps its own state.
 */
export function useDisclosureState(
  key: string,
  defaultOpen: boolean,
): { open?: boolean; onOpenChange?: (open: boolean) => void; defaultOpen: boolean } {
  const store = use(DisclosureStoreContext);
  if (!store) return { defaultOpen };
  return {
    defaultOpen,
    open: store.open[key] ?? defaultOpen,
    onOpenChange: (open) => store.setOpen((all) => ({ ...all, [key]: open })),
  };
}

/** Whether `key` is `path` or lies under it (`path.…` or `path#…`). */
function isUnder(key: string, path: string): boolean {
  return key === path || key.startsWith(`${path}.`) || key.startsWith(`${path}#`);
}

/**
 * Record a disclosure as open, or move or drop the states under some paths when the rows they
 * belong to move (a list item's removal shifts the items after it up one).
 */
export function useDisclosureStore() {
  const store = use(DisclosureStoreContext);
  return {
    open: (key: string) => store?.setOpen((all) => ({ ...all, [key]: true })),
    repath: (changes: readonly { from: string; to?: string }[]) =>
      store?.setOpen((all) => {
        const next: Record<string, boolean> = {};
        for (const [key, open] of Object.entries(all)) {
          const change = changes.find(({ from }) => isUnder(key, from));
          if (!change) next[key] = open;
        }
        for (const [key, open] of Object.entries(all)) {
          const change = changes.find(({ from }) => isUnder(key, from));
          if (change?.to !== undefined) next[change.to + key.slice(change.from.length)] = open;
        }
        return next;
      }),
  };
}
