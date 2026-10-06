import {
  EdgeRouteSchema,
  type EdgeSchema,
  type LoopDefinitionInput,
  type NodeInput,
  type NodeKind,
} from '@graphgoblin/contracts';
import type { z } from 'zod';
import { create } from 'zustand';
import type { FormChange } from '../forms/changes.js';
import type { ParseError, ParseErrorReason } from '../forms/parse-errors.js';
import {
  historyClock,
  recordStep,
  sameValue,
  travel,
  type History,
  type HistoryEntry,
  type HistoryStep,
  type OpenStep,
  type Snapshot,
} from './history.js';
import {
  connectionProblem,
  defaultConfig,
  KIND_INFO,
  nextEdgeId,
  nextNodeId,
  type ConnectionRequest,
} from './model.js';

type EdgeInput = z.input<typeof EdgeSchema>;

export type SaveState =
  'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'offline' | 'error' | 'conflict';

export interface EditorState {
  loopId: string | undefined;
  definition: LoopDefinitionInput | undefined;
  selectedNodeId: string | undefined;
  /**
   * Whether the node editor dialog is open for the selected node. Selecting alone does not open
   * it; closing it keeps the selection. It closes when the node is deleted or a loop loads.
   */
  nodeDialogOpen: boolean;
  /**
   * Bumped when the dialog opens on a node (not by a rename), so the editor remounts its forms for
   * that node even when it was already open on another one.
   */
  nodeDialogSession: number;
  /**
   * Where the node editor puts focus when it opens (or at once, when it is already open on the
   * node): the field at an issue's path. The dialog consumes it once and clears it; without one,
   * focus lands on the dialog's heading.
   */
  nodeFocus: NodeFocusTarget | undefined;
  /** Bumped on every edit; autosave compares it with `savedRevision`. */
  revision: number;
  savedRevision: number;
  /**
   * The newest revision whose copy on this device (the IndexedDB mirror) was written, so the
   * editor says "saved on this device" only once that write succeeded. Undefined until one has.
   */
  deviceRevision: number | undefined;
  /** Where the server copy stands (`saveState`), with the server's reason when a save failed. */
  saveState: SaveState;
  saveMessage: string | undefined;
  /** Why the last attempted connection was refused. */
  connectionError: string | undefined;
  /**
   * Field text that does not parse, per form scope ("node:<id>", "settings", "variables"), by
   * path. It stays here, with the raw text, until the field parses or the user discards it, so
   * leaving the field never drops the publish blocker or the text.
   */
  fieldErrors: Record<string, Record<string, FieldError>>;
  /** Bumped by every load and reset; an autosave that started under another value is stale. */
  generation: number;
  /** The server draft token the edits are based on; autosave sends it as `If-Match`. */
  baseToken: string | undefined;
  /**
   * Set when a save was refused because the server draft changed since `baseToken` (409
   * `DRAFT_CONFLICT`). Autosave stops until the user reloads the server draft or overwrites it.
   */
  conflict: { serverToken: string | undefined } | undefined;
  /**
   * The undo history (#17, `history.ts`): `past` holds the state before each step, newest last;
   * `future` the steps undone since the last change, for redo. A load or reset clears both.
   */
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** The newest step, while a change with the same key may still merge into it. */
  openStep: OpenStep | undefined;
  /**
   * Bumped by every undo and redo. The forms that keep their own state (the node editor's config
   * form, the loop panel's forms) include it in their keys, so they show the restored values.
   */
  historyEpoch: number;

  load: (
    loopId: string,
    definition: LoopDefinitionInput,
    options?: { dirty?: boolean; baseToken?: string | undefined },
  ) => void;
  reset: () => void;
  select: (nodeId: string | undefined) => void;
  /**
   * Select a node and open its editor dialog; with `field`, the dialog focuses the field at that
   * path (an issue's path, such as `config.prompt`) instead of its heading.
   */
  openNode: (nodeId: string, focus?: { field?: string | undefined }) => void;
  /** Close the node editor dialog; the node stays selected. */
  closeNodeDialog: () => void;
  /** Forget the pending focus target once the dialog has used it. */
  clearNodeFocus: () => void;
  addNode: (kind: NodeKind, position: { x: number; y: number }) => string;
  /**
   * Change a node's label or config. `change` says how a config change counts for undo (the
   * config form's `FormChange`): a commit is a step of its own, typing merges per field. A config
   * change without one (a subloop pick) is a step of its own.
   */
  updateNode: (
    nodeId: string,
    changes: { label?: string; config?: unknown },
    change?: FormChange,
  ) => void;
  renameNode: (nodeId: string, nextId: string) => void;
  moveNode: (nodeId: string, position: { x: number; y: number }) => void;
  removeNode: (nodeId: string) => void;
  connect: (connection: ConnectionRequest) => string | null;
  removeEdge: (edgeId: string) => void;
  /**
   * Store an edge's manual route (`edge.ui.route`, #44), or with `undefined` remove it so the edge
   * routes automatically again. A drag ends in one call; a run of arrow-key nudges of one edge's
   * segments merges into one step, like a node's; a reset is a step of its own.
   */
  setEdgeRoute: (
    edgeId: string,
    route: readonly number[] | undefined,
    /** Merge into the open step with this key: a node move that resets a route it now crosses. */
    coalesceKey?: string,
  ) => void;
  updateMeta: (changes: { name?: string; description?: string }) => void;
  /** Replace the loop's settings; `change` as for `updateNode`'s config. */
  updateSettings: (settings: unknown, change?: FormChange) => void;
  /** Replace the loop's variables; `change` as for `updateNode`'s config. */
  updateVariables: (variables: unknown, change?: FormChange) => void;
  setSaveState: (state: SaveState, message?: string, revision?: number) => void;
  setBaseToken: (token: string | undefined) => void;
  /** Record that the device copy of `revision` was written (see `deviceRevision`). */
  setDeviceRevision: (revision: number) => void;
  setConflict: (conflict: { serverToken: string | undefined } | undefined) => void;
  /**
   * Record (or, with `undefined`, clear) the unparsed text of a form field. It is a change like
   * any other for undo: typed text merges into the step of the typing in that field, text a
   * commit moves or drops (a row's removal) is part of that commit's step (`change`), and a
   * discard (`reason` `'discard'`, the user's "Discard the unparsed text") is a step of its own.
   */
  setFieldError: (
    scope: string,
    path: string,
    error: FieldError | undefined,
    reason?: ParseErrorReason,
    change?: FormChange,
  ) => void;
  /**
   * Go back one step, or forward one undone step. Either is an edit of the draft (the revision
   * goes up and autosave runs) unless only unparsed field text changed. The renamed node stays
   * selected; a node that no longer exists is deselected and its editor closes.
   */
  undo: () => void;
  redo: () => void;
  /** End the open step, so the next change starts a new one even with the same key (a new drag). */
  closeStep: () => void;
}

export type FieldError = ParseError;

/** A pending focus request for the node editor: the node, and the issue path to focus there. */
export interface NodeFocusTarget {
  nodeId: string;
  field: string;
}

let generations = 0;

function config(node: NodeInput): Record<string, unknown> {
  return typeof node.config === 'object' && node.config !== null ? node.config : {};
}

const INITIAL = {
  loopId: undefined,
  definition: undefined,
  selectedNodeId: undefined,
  nodeDialogOpen: false,
  nodeDialogSession: 0,
  nodeFocus: undefined,
  revision: 0,
  savedRevision: 0,
  deviceRevision: undefined,
  saveState: 'idle' as SaveState,
  saveMessage: undefined,
  connectionError: undefined,
  fieldErrors: {},
  generation: 0,
  baseToken: undefined,
  conflict: undefined,
  past: [] as HistoryEntry[],
  future: [] as HistoryEntry[],
  openStep: undefined,
  historyEpoch: 0,
};

/**
 * The undo step of a change to a form's unparsed text: part of the change that made it (typing in
 * that field unless `change` says otherwise). A discard is a step of its own that never merges, so
 * undo always brings the text back.
 */
function fieldErrorStep(
  scope: string,
  path: string,
  reason: ParseErrorReason | undefined,
  change: FormChange | undefined,
): HistoryStep {
  if (reason === 'discard') return { label: `discard text in ${path} of ${scopeName(scope)}` };
  const typed = change ?? { path, kind: 'typing', id: 0 };
  if (scope.startsWith('node:')) return configStep(scope.slice('node:'.length), typed);
  if (scope === 'settings') return formStep('edit loop settings', 'settings', typed);
  if (scope === 'variables') return formStep('edit variables', 'variables', typed);
  return formStep(`edit ${scope}`, scope, typed);
}

/**
 * The undo step of a form's change (`FormChange`): typing merges with more typing in the same
 * field (the key names the form and the field's path), a commit is a step of its own (the key
 * names that one commit, so the writes it makes are one step). Without a change, a step of its own.
 */
function formStep(label: string, form: string, change: FormChange | undefined): HistoryStep {
  if (!change) return { label };
  return {
    label,
    coalesceKey: change.kind === 'typing' ? `${form}:${change.path}` : `${form}#commit${change.id}`,
  };
}

/** A form scope in an undo label: the node's id, "loop settings", or "variables". */
function scopeName(scope: string): string {
  if (scope.startsWith('node:')) return scope.slice('node:'.length);
  return scope === 'settings' ? 'loop settings' : scope;
}

function configStep(nodeId: string, change: FormChange | undefined): HistoryStep {
  return formStep(`edit config of ${nodeId}`, `config:${nodeId}`, change);
}

/** An edge in an undo label: "start to done", or "decide yes to infer" from a named port. */
function edgeName(edge: EdgeInput): string {
  const port = edge.from.port === 'out' ? '' : ` ${edge.from.port}`;
  return `${edge.from.node}${port} to ${edge.to.node}`;
}

export const useEditorStore = create<EditorState>((set, get) => {
  const historyOf = (s: EditorState): History => ({
    past: s.past,
    future: s.future,
    openStep: s.openStep,
  });

  /**
   * Apply an edit to the definition: bump the revision and record the step for undo. Every change
   * of the definition goes through here. An edit that changes nothing is not one.
   */
  const edit = (fn: (def: LoopDefinitionInput) => LoopDefinitionInput, step: HistoryStep) => {
    const s = get();
    const def = s.definition;
    if (!def) return;
    const definition = fn(def);
    if (sameValue(definition, def)) return;
    const { fieldErrors } = s;
    set({
      definition,
      revision: s.revision + 1,
      saveState: 'pending',
      ...recordStep(
        historyOf(s),
        { definition: def, fieldErrors },
        { definition, fieldErrors },
        step,
        historyClock.now(),
      ),
    });
  };

  /** Undo or redo one step: restore its state as an edit, and keep the selection meaningful. */
  const travelTo = (direction: 'undo' | 'redo') => {
    const s = get();
    if (!s.definition) return;
    const current: Snapshot = { definition: s.definition, fieldErrors: s.fieldErrors };
    const moved = travel(historyOf(s), current, direction);
    if (!moved) return;
    const { history, entry } = moved;
    let selected = s.selectedNodeId;
    if (entry.renamed) {
      const { from, to } = entry.renamed;
      if (direction === 'undo' && selected === to) selected = from;
      if (direction === 'redo' && selected === from) selected = to;
    }
    const kept = selected !== undefined && entry.definition.nodes.some((n) => n.id === selected);
    set({
      ...history,
      definition: entry.definition,
      fieldErrors: entry.fieldErrors,
      historyEpoch: s.historyEpoch + 1,
      // Only unparsed text changed: nothing for autosave to send.
      ...(sameValue(entry.definition, s.definition)
        ? {}
        : { revision: s.revision + 1, saveState: 'pending' as SaveState }),
      selectedNodeId: kept ? selected : undefined,
      ...(kept ? {} : { nodeDialogOpen: false, nodeFocus: undefined }),
    });
  };

  return {
    ...INITIAL,

    load: (loopId, definition, options = {}) =>
      set({
        ...INITIAL,
        loopId,
        definition,
        revision: options.dirty ? 1 : 0,
        saveState: options.dirty ? 'pending' : 'saved',
        baseToken: options.baseToken,
        generation: (generations += 1),
      }),

    reset: () => set({ ...INITIAL, generation: (generations += 1) }),

    select: (nodeId) => set({ selectedNodeId: nodeId }),

    openNode: (nodeId, focus) => {
      if (!get().definition?.nodes.some((n) => n.id === nodeId)) return;
      set((s) => ({
        selectedNodeId: nodeId,
        nodeDialogOpen: true,
        nodeDialogSession:
          s.nodeDialogOpen && s.selectedNodeId === nodeId
            ? s.nodeDialogSession
            : s.nodeDialogSession + 1,
        nodeFocus: focus?.field ? { nodeId, field: focus.field } : undefined,
      }));
    },

    closeNodeDialog: () => set({ nodeDialogOpen: false, nodeFocus: undefined }),

    clearNodeFocus: () => set({ nodeFocus: undefined }),

    addNode: (kind, position) => {
      const def = get().definition;
      const id = def ? nextNodeId(def, kind) : kind;
      edit(
        (d) => ({
          ...d,
          nodes: [
            ...d.nodes,
            {
              id,
              kind,
              label: KIND_INFO[kind].label,
              config: defaultConfig(kind),
              ui: position,
            } as NodeInput,
          ],
        }),
        { label: `add ${KIND_INFO[kind].label.toLowerCase()}` },
      );
      set({ selectedNodeId: id });
      return id;
    },

    updateNode: (nodeId, changes, change) =>
      edit(
        (d) => ({
          ...d,
          nodes: d.nodes.map((n) =>
            n.id === nodeId
              ? ({
                  ...n,
                  ...(changes.label !== undefined ? { label: changes.label } : {}),
                  ...(changes.config !== undefined ? { config: changes.config } : {}),
                } as NodeInput)
              : n,
          ),
        }),
        // Typing in one field is one step: the label, and each field of the config form.
        changes.config === undefined
          ? { label: `edit label of ${nodeId}`, coalesceKey: `label:${nodeId}` }
          : changes.label === undefined
            ? configStep(nodeId, change)
            : { label: `edit ${nodeId}`, coalesceKey: `node:${nodeId}` },
      ),

    renameNode: (nodeId, nextId) => {
      if (nodeId === nextId) return;
      const step = {
        label: `rename ${nodeId} to ${nextId}`,
        renamed: { from: nodeId, to: nextId },
      };
      edit(
        (d) => ({
          ...d,
          nodes: d.nodes.map((n) => {
            const renamed = n.id === nodeId ? { ...n, id: nextId } : n;
            const cfg = config(renamed);
            const loopBack = cfg['loopBack'] as { targetNodeId?: string } | undefined;
            if (renamed.kind === 'exit' && loopBack?.targetNodeId === nodeId) {
              return { ...renamed, config: { ...cfg, loopBack: { targetNodeId: nextId } } };
            }
            return renamed;
          }),
          edges: d.edges.map((e) => ({
            ...e,
            from: e.from.node === nodeId ? { ...e.from, node: nextId } : e.from,
            to: e.to.node === nodeId ? { ...e.to, node: nextId } : e.to,
          })),
        }),
        step,
      );
      if (get().selectedNodeId === nodeId) set({ selectedNodeId: nextId });
      // Unparsed field text follows the node to its new id (part of the same step).
      set((s) => {
        const { [`node:${nodeId}`]: moved, ...rest } = s.fieldErrors;
        return { fieldErrors: moved ? { ...rest, [`node:${nextId}`]: moved } : rest };
      });
    },

    // A drag ends in one move; a run of arrow-key nudges of one node merges into one step.
    moveNode: (nodeId, position) =>
      edit(
        (d) => ({
          ...d,
          nodes: d.nodes.map((n) => (n.id === nodeId ? { ...n, ui: position } : n)),
        }),
        { label: `move ${nodeId}`, coalesceKey: `move:${nodeId}` },
      ),

    removeNode: (nodeId) => {
      edit(
        (d) => ({
          ...d,
          nodes: d.nodes
            .filter((n) => n.id !== nodeId)
            .map((n) => {
              const loopBack = config(n)['loopBack'] as { targetNodeId?: string } | undefined;
              if (n.kind !== 'exit' || loopBack?.targetNodeId !== nodeId) return n;
              const { loopBack: _removed, ...rest } = config(n);
              return { ...n, config: rest };
            }),
          edges: d.edges.filter((e) => e.from.node !== nodeId && e.to.node !== nodeId),
        }),
        { label: `delete ${nodeId}` },
      );
      // Its unparsed field text goes with it (part of the same step, so undo brings it back).
      set((s) => {
        const { [`node:${nodeId}`]: removed, ...fieldErrors } = s.fieldErrors;
        return {
          ...(removed ? { fieldErrors } : {}),
          ...(s.selectedNodeId === nodeId
            ? { selectedNodeId: undefined, nodeDialogOpen: false }
            : {}),
        };
      });
    },

    connect: (connection) => {
      const def = get().definition;
      if (!def) return 'no loop loaded';
      const problem = connectionProblem(def, connection);
      set({ connectionError: problem ?? undefined });
      if (problem) return problem;
      const port = connection.sourceHandle ?? 'out';
      const edge: EdgeInput = {
        id: nextEdgeId(def),
        from: { node: connection.source, port },
        to: { node: connection.target, port: 'in' },
      };
      edit(
        (d) => ({
          ...d,
          edges: [...d.edges, edge],
          nodes: d.nodes.map((n) =>
            n.id === connection.source && n.kind === 'exit' && port === 'loopBack'
              ? { ...n, config: { ...config(n), loopBack: { targetNodeId: connection.target } } }
              : n,
          ),
        }),
        { label: `connect ${edgeName(edge)}` },
      );
      return null;
    },

    removeEdge: (edgeId) => {
      const edge = get().definition?.edges.find((e) => e.id === edgeId);
      if (!edge) return;
      edit(
        (d) => ({
          ...d,
          edges: d.edges.filter((e) => e.id !== edgeId),
          nodes: d.nodes.map((n) => {
            if (n.id !== edge.from.node || n.kind !== 'exit' || edge.from.port !== 'loopBack')
              return n;
            const { loopBack: _removed, ...rest } = config(n);
            return { ...n, config: rest };
          }),
        }),
        { label: `remove edge ${edgeName(edge)}` },
      );
    },

    setEdgeRoute: (edgeId, route, coalesceKey) => {
      if (route !== undefined && !EdgeRouteSchema.safeParse(route).success) return;
      const edge = get().definition?.edges.find((e) => e.id === edgeId);
      if (!edge) return;
      edit(
        (d) => ({
          ...d,
          edges: d.edges.map((e) => {
            if (e.id !== edgeId) return e;
            const { ui: _previous, ...rest } = e;
            return route ? { ...rest, ui: { route: [...route] } } : rest;
          }),
        }),
        route
          ? { label: `reroute ${edgeName(edge)}`, coalesceKey: coalesceKey ?? `route:${edgeId}` }
          : { label: `reset route of ${edgeName(edge)}`, coalesceKey },
      );
    },

    updateMeta: (changes) =>
      edit(
        (d) => {
          const next = { ...d, ...(changes.name !== undefined ? { name: changes.name } : {}) };
          if (changes.description === undefined) return next;
          if (changes.description === '') {
            const { description: _removed, ...rest } = next;
            return rest;
          }
          return { ...next, description: changes.description };
        },
        changes.description === undefined
          ? { label: 'edit loop name', coalesceKey: 'meta:name' }
          : changes.name === undefined
            ? { label: 'edit loop description', coalesceKey: 'meta:description' }
            : { label: 'edit loop name and description', coalesceKey: 'meta' },
      ),

    updateSettings: (settings, change) =>
      edit(
        (d) => ({ ...d, settings: settings as LoopDefinitionInput['settings'] }),
        formStep('edit loop settings', 'settings', change),
      ),

    updateVariables: (variables, change) =>
      edit(
        (d) => ({ ...d, variables: variables as LoopDefinitionInput['variables'] }),
        formStep('edit variables', 'variables', change),
      ),

    setSaveState: (saveState, message, revision) =>
      set((s) => ({
        saveState,
        saveMessage: message,
        savedRevision: revision ?? s.savedRevision,
      })),

    setBaseToken: (baseToken) => set({ baseToken }),

    setDeviceRevision: (revision) =>
      set((s) => ({ deviceRevision: Math.max(revision, s.deviceRevision ?? revision) })),

    setConflict: (conflict) => set({ conflict }),

    setFieldError: (scope, path, error, reason, change) => {
      const s = get();
      const previous = s.fieldErrors[scope]?.[path];
      if (
        previous?.message === error?.message &&
        previous?.text === error?.text &&
        previous?.input === error?.input
      )
        return;
      const { [path]: _previous, ...others } = s.fieldErrors[scope] ?? {};
      const scoped = error ? { ...others, [path]: error } : others;
      const { [scope]: _scope, ...rest } = s.fieldErrors;
      const fieldErrors = Object.keys(scoped).length > 0 ? { ...rest, [scope]: scoped } : rest;
      const { definition } = s;
      set({
        fieldErrors,
        ...(definition
          ? recordStep(
              historyOf(s),
              { definition, fieldErrors: s.fieldErrors },
              { definition, fieldErrors },
              fieldErrorStep(scope, path, reason, change),
              historyClock.now(),
            )
          : {}),
      });
    },

    undo: () => travelTo('undo'),

    redo: () => travelTo('redo'),

    closeStep: () => set({ openStep: undefined }),
  };
});
