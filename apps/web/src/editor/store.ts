import type { EdgeSchema, LoopDefinitionInput, NodeInput, NodeKind } from '@graphgoblin/contracts';
import type { z } from 'zod';
import { create } from 'zustand';
import {
  connectionProblem,
  defaultConfig,
  KIND_INFO,
  nextEdgeId,
  nextNodeId,
  type ConnectionRequest,
} from './model.js';

type EdgeInput = z.input<typeof EdgeSchema>;

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'offline' | 'error';

export interface EditorState {
  loopId: string | undefined;
  definition: LoopDefinitionInput | undefined;
  selectedNodeId: string | undefined;
  /** Bumped on every edit; autosave compares it with `savedRevision`. */
  revision: number;
  savedRevision: number;
  saveState: SaveState;
  saveMessage: string | undefined;
  /** Why the last attempted connection was refused. */
  connectionError: string | undefined;

  load: (loopId: string, definition: LoopDefinitionInput, options?: { dirty?: boolean }) => void;
  reset: () => void;
  select: (nodeId: string | undefined) => void;
  addNode: (kind: NodeKind, position: { x: number; y: number }) => string;
  updateNode: (nodeId: string, changes: { label?: string; config?: unknown }) => void;
  renameNode: (nodeId: string, nextId: string) => void;
  moveNode: (nodeId: string, position: { x: number; y: number }) => void;
  removeNode: (nodeId: string) => void;
  connect: (connection: ConnectionRequest) => string | null;
  removeEdge: (edgeId: string) => void;
  updateMeta: (changes: { name?: string; description?: string }) => void;
  updateSettings: (settings: unknown) => void;
  updateVariables: (variables: unknown) => void;
  setSaveState: (state: SaveState, message?: string, revision?: number) => void;
}

function config(node: NodeInput): Record<string, unknown> {
  return typeof node.config === 'object' && node.config !== null ? node.config : {};
}

const INITIAL = {
  loopId: undefined,
  definition: undefined,
  selectedNodeId: undefined,
  revision: 0,
  savedRevision: 0,
  saveState: 'idle' as SaveState,
  saveMessage: undefined,
  connectionError: undefined,
};

export const useEditorStore = create<EditorState>((set, get) => {
  /** Apply an edit to the definition and bump the revision. */
  const edit = (fn: (def: LoopDefinitionInput) => LoopDefinitionInput) => {
    const def = get().definition;
    if (!def) return;
    set((s) => ({ definition: fn(def), revision: s.revision + 1, saveState: 'pending' }));
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
      }),

    reset: () => set(INITIAL),

    select: (nodeId) => set({ selectedNodeId: nodeId }),

    addNode: (kind, position) => {
      const def = get().definition;
      const id = def ? nextNodeId(def, kind) : kind;
      edit((d) => ({
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
      }));
      set({ selectedNodeId: id });
      return id;
    },

    updateNode: (nodeId, changes) =>
      edit((d) => ({
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
      })),

    renameNode: (nodeId, nextId) => {
      if (nodeId === nextId) return;
      edit((d) => ({
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
      }));
      if (get().selectedNodeId === nodeId) set({ selectedNodeId: nextId });
    },

    moveNode: (nodeId, position) =>
      edit((d) => ({
        ...d,
        nodes: d.nodes.map((n) => (n.id === nodeId ? { ...n, ui: position } : n)),
      })),

    removeNode: (nodeId) => {
      edit((d) => ({
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
      }));
      if (get().selectedNodeId === nodeId) set({ selectedNodeId: undefined });
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
      edit((d) => ({
        ...d,
        edges: [...d.edges, edge],
        nodes: d.nodes.map((n) =>
          n.id === connection.source && n.kind === 'exit' && port === 'loopBack'
            ? { ...n, config: { ...config(n), loopBack: { targetNodeId: connection.target } } }
            : n,
        ),
      }));
      return null;
    },

    removeEdge: (edgeId) =>
      edit((d) => {
        const edge = d.edges.find((e) => e.id === edgeId);
        return {
          ...d,
          edges: d.edges.filter((e) => e.id !== edgeId),
          nodes: d.nodes.map((n) => {
            if (
              !edge ||
              n.id !== edge.from.node ||
              n.kind !== 'exit' ||
              edge.from.port !== 'loopBack'
            )
              return n;
            const { loopBack: _removed, ...rest } = config(n);
            return { ...n, config: rest };
          }),
        };
      }),

    updateMeta: (changes) =>
      edit((d) => {
        const next = { ...d, ...(changes.name !== undefined ? { name: changes.name } : {}) };
        if (changes.description === undefined) return next;
        if (changes.description === '') {
          const { description: _removed, ...rest } = next;
          return rest;
        }
        return { ...next, description: changes.description };
      }),

    updateSettings: (settings) =>
      edit((d) => ({ ...d, settings: settings as LoopDefinitionInput['settings'] })),

    updateVariables: (variables) =>
      edit((d) => ({ ...d, variables: variables as LoopDefinitionInput['variables'] })),

    setSaveState: (saveState, message, revision) =>
      set((s) => ({
        saveState,
        saveMessage: message,
        savedRevision: revision ?? s.savedRevision,
      })),
  };
});
