import { createContext, use, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Which disclosures of a schema-driven form are open, by key: `#advanced` for the form's Advanced
 * group, `#context-tab` for Context selection, a stable collection row id, and a control's own disclosure under its
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
  /** Row identities for form values retained by undo history, shared across remounts. */
  identities?: DisclosureIdentities;
}

type CollectionRows = Readonly<Record<string, readonly number[]>>;

export interface DisclosureIdentities {
  snapshots: WeakMap<object, CollectionRows>;
  nextId: number;
}

export function createDisclosureIdentities(): DisclosureIdentities {
  return { snapshots: new WeakMap(), nextId: 0 };
}

/**
 * Row ids follow collection actions, not row contents (identical rows are still distinct).
 * Immutable id maps are associated with the same form values that history restores. Open states
 * stay separate, so a later toggle follows its row through undo and redo rather than being undone.
 */
export function createCollectionIdentities(identities: DisclosureIdentities, value: unknown) {
  let current = value;
  let rows: CollectionRows =
    typeof value === 'object' && value !== null ? (identities.snapshots.get(value) ?? {}) : {};
  const remember = (next: unknown) => {
    current = next;
    if (typeof next === 'object' && next !== null) identities.snapshots.set(next, rows);
  };
  return {
    remember,
    get: (name: string, count: number): readonly number[] => {
      const previous = rows[name] ?? [];
      if (rows[name] === undefined || previous.length !== count) {
        rows = {
          ...rows,
          [name]: Array.from({ length: count }, (_, i) => previous[i] ?? identities.nextId++),
        };
        remember(current);
      }
      return rows[name]!;
    },
    add: (name: string) => {
      const id = identities.nextId++;
      rows = { ...rows, [name]: [...(rows[name] ?? []), id] };
      return id;
    },
    remove: (name: string, index: number) => {
      const next: Record<string, readonly number[]> = {};
      for (const [path, ids] of Object.entries(rows)) {
        const suffix = path.startsWith(`${name}.`) ? path.slice(name.length + 1) : undefined;
        const row = suffix === undefined ? undefined : Number(suffix.split('.')[0]);
        if (row === index) continue;
        const moved =
          row !== undefined && row > index
            ? `${name}.${row - 1}${suffix!.slice(String(row).length)}`
            : path;
        next[moved] = path === name ? ids.filter((_, i) => i !== index) : ids;
      }
      rows = next;
    },
    key: (path: string): string => {
      // The innermost known row also identifies disclosures nested inside that row.
      const parents = Object.keys(rows).sort((a, b) => b.length - a.length);
      for (const name of parents) {
        if (!path.startsWith(`${name}.`)) continue;
        const suffix = path.slice(name.length + 1);
        const index = /^\d+(?=\.|#|$)/.exec(suffix)?.[0];
        const id = index === undefined ? undefined : rows[name]?.[Number(index)];
        if (id !== undefined) return `#row:${id}${suffix.slice(index!.length)}`;
      }
      return path;
    },
  };
}

export const CollectionIdentitiesContext = createContext<
  ReturnType<typeof createCollectionIdentities> | undefined
>(undefined);

export function useCollectionIdentities() {
  const rows = use(CollectionIdentitiesContext);
  // Field also works directly under react-hook-form; its rows then live for that field's mount.
  const [ownRows] = useState(() =>
    createCollectionIdentities(createDisclosureIdentities(), undefined),
  );
  return rows ?? ownRows;
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
  const rows = use(CollectionIdentitiesContext);
  const identity = rows?.key(key) ?? key;
  if (!store) return { defaultOpen };
  return {
    defaultOpen,
    open: store.open[identity] ?? defaultOpen,
    onOpenChange: (open) => store.setOpen((all) => ({ ...all, [identity]: open })),
  };
}

/** Record a disclosure as open under its stable identity. */
export function useDisclosureStore() {
  const store = use(DisclosureStoreContext);
  const rows = use(CollectionIdentitiesContext);
  return {
    open: (key: string) => store?.setOpen((all) => ({ ...all, [rows?.key(key) ?? key]: true })),
  };
}
