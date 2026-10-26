import { LoopDefinitionSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { useEffect, useMemo } from 'react';
import { useApi } from '../api/context.js';
import { NodeEditorDialog } from '../editor/NodeEditorDialog.js';
import { fieldErrorIssues, mergeIssues, validateDraft } from '../editor/model.js';
import { useEditorStore } from '../editor/store.js';
import { useAutosave } from '../editor/useAutosave.js';
import { useUndoShortcuts } from '../editor/useUndoShortcuts.js';
import type { FakeApi } from './fake-api.js';
import { renderWith } from './render.js';

function Autosave() {
  useAutosave(useApi());
  return null;
}

/** Real dialog, validation and history shortcuts, without the canvas or app shell. */
function NodeEditor() {
  const { definition, fieldErrors, nodeDialogOpen, nodeDialogSession, selectedNodeId, loopId } =
    useEditorStore();
  useUndoShortcuts();
  useEffect(() => () => useEditorStore.getState().reset(), []);
  const issues = useMemo(
    () =>
      definition ? mergeIssues(validateDraft(definition), [], fieldErrorIssues(fieldErrors)) : [],
    [definition, fieldErrors],
  );
  const node = nodeDialogOpen && definition?.nodes.find((entry) => entry.id === selectedNodeId);
  return node && definition && loopId ? (
    <NodeEditorDialog
      key={nodeDialogSession}
      node={node}
      definition={definition}
      issues={issues}
      loopId={loopId}
    />
  ) : null;
}

/** Load a known fake-API draft through the public store, then mount its node editor. */
export function renderNodeEditor(
  loopId: string,
  definition: LoopDefinitionInput,
  nodeId: string,
  api: FakeApi,
  { autosave = false }: { autosave?: boolean } = {},
) {
  // The API client's loop read applies the contract defaults before the page loads the store.
  useEditorStore.getState().load(loopId, LoopDefinitionSchema.parse(definition), {
    baseToken: api.draftToken(loopId)!,
  });
  useEditorStore.getState().openNode(nodeId);
  return renderWith(
    <>
      {autosave ? <Autosave /> : null}
      <NodeEditor />
    </>,
    '/',
    api,
  );
}
