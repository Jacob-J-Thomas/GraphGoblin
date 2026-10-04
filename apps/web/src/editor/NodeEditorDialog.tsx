import {
  NodeConfigSchemas,
  SlugSchema,
  type LoopDefinitionInput,
  type NodeInput,
} from '@graphgoblin/contracts';
import { useState, type ReactNode } from 'react';
import { Icon } from '../components/icons/index.js';
import {
  Button,
  Dialog,
  FieldGroup,
  HelpText,
  Input,
  Label,
  type DialogCloseReason,
} from '../components/ui/index.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { canvasFocusTarget } from './Canvas.js';
import { KindChip } from './KindChip.js';
import { KIND_INFO, type EditorIssue } from './model.js';
import { NodeConnections } from './NodeConnections.js';
import { SubloopPicker } from './SubloopPicker.js';
import { useEditorStore } from './store.js';

/** Why `draft` cannot become the id of node `nodeId`, or undefined when it can (or is unchanged). */
export function idProblem(
  draft: string,
  nodeId: string,
  definition: LoopDefinitionInput,
): string | undefined {
  if (draft === nodeId) return undefined;
  if (!SlugSchema.safeParse(draft).success)
    return 'Use a letter first, then letters, digits, _ or -';
  if (definition.nodes.some((n) => n.id === draft)) return `"${draft}" is already used`;
  return undefined;
}

function subloopId(config: unknown): string {
  const ref = (config as { loopRef?: { loopId?: unknown } } | undefined)?.loopRef;
  return typeof ref?.loopId === 'string' ? ref.loopId : '';
}

/**
 * The id being typed for a node. It applies on Enter, on leaving the field, and when the dialog
 * closes; `warned` is the text the user was already stopped for once.
 */
interface IdDraft {
  /** The node id this draft was typed for; a draft for another id is stale. */
  for: string;
  value: string;
  error?: string | undefined;
  warned?: string | undefined;
}

/**
 * The editor of one node, in a modal dialog named "Edit <kind> <id>": id, label, the subloop
 * picker, the config form generated from the kind's schema, the node's issues, its connections
 * with the Connect form (the keyboard path for edges), and Delete node. Every edit goes to the
 * store as it is made (and autosaves from there), so closing never discards anything, with one
 * exception handled here: an id still being typed. A valid one is applied on close; an invalid one
 * keeps the dialog open once, with the reason, and is dropped if the user closes again.
 */
export function NodeEditorDialog({
  node,
  definition,
  issues,
  loopId,
  notice,
}: {
  node: NodeInput;
  definition: LoopDefinitionInput;
  issues: EditorIssue[];
  loopId: string;
  /** Shown at the top of the dialog, for notices that need an answer while it is open. */
  notice?: ReactNode;
}) {
  const fieldErrors = useEditorStore((s) => s.fieldErrors);
  const [epoch, setEpoch] = useState(0);
  const [idState, setIdState] = useState<IdDraft>({ for: node.id, value: node.id });
  // After a rename the node has its new id, which the draft already holds.
  const id: IdDraft = idState.for === node.id ? idState : { for: node.id, value: node.id };
  const { updateNode, removeNode, renameNode, closeNodeDialog, setFieldError } =
    useEditorStore.getState();
  const info = KIND_INFO[node.kind];
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);

  const commitId = () => {
    const error = idProblem(id.value, node.id, definition);
    setIdState({ ...id, error });
    if (!error && id.value !== node.id) renameNode(node.id, id.value);
  };

  const requestClose = (reason: DialogCloseReason) => {
    const error = idProblem(id.value, node.id, definition);
    if (!error && id.value !== node.id) {
      renameNode(node.id, id.value);
    } else if (error && reason !== 'dismissed' && id.warned !== id.value) {
      // Stop once for an id that cannot apply, so typed text is never dropped unseen.
      setIdState({ ...id, error, warned: id.value });
      document.getElementById('node-id')?.focus();
      return;
    }
    closeNodeDialog();
  };

  return (
    <Dialog
      open
      onClose={requestClose}
      icon={<KindChip kind={node.kind} />}
      title={
        <>
          Edit {info.label.toLowerCase()}{' '}
          <span className="block font-mono text-sm font-regular text-muted">{node.id}</span>
        </>
      }
      returnFocus={() => canvasFocusTarget(useEditorStore.getState().selectedNodeId)}
      footer={
        <>
          <Button size="sm" variant="destructive" onClick={() => removeNode(node.id)}>
            <Icon name="trash" />
            Delete node
          </Button>
          <Button size="sm" className="ml-auto" onClick={() => requestClose('button')}>
            Done
          </Button>
        </>
      }
    >
      <section aria-label="Node properties" className="grid gap-field">
        {notice}
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <FieldGroup>
            <Label htmlFor="node-id">Node id</Label>
            <Input
              id="node-id"
              className="font-mono text-sm"
              value={id.value}
              aria-invalid={id.error ? true : undefined}
              aria-describedby={id.error ? 'node-id-error' : undefined}
              onChange={(e) => setIdState({ ...id, value: e.target.value })}
              onBlur={commitId}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitId();
              }}
            />
            {id.error ? (
              <HelpText id="node-id-error" role="alert" tone="bad">
                {id.error}
              </HelpText>
            ) : null}
          </FieldGroup>
          <FieldGroup>
            <Label htmlFor="node-label">Label</Label>
            <Input
              id="node-label"
              value={node.label}
              onChange={(e) => updateNode(node.id, { label: e.target.value })}
            />
          </FieldGroup>
        </div>
        {node.kind === 'subloop' ? (
          <SubloopPicker
            currentLoopId={loopId}
            value={subloopId(node.config)}
            onPick={(picked) => {
              const cfg = (node.config ?? {}) as Record<string, unknown>;
              const ref = (cfg['loopRef'] ?? {}) as Record<string, unknown>;
              updateNode(node.id, { config: { ...cfg, loopRef: { ...ref, loopId: picked } } });
              setEpoch((e) => e + 1);
            }}
          />
        ) : null}
        {/* Not keyed by the node id: a rename keeps the form (and focus) where it is. */}
        <SchemaForm
          key={`${node.kind}:${epoch}`}
          schema={NodeConfigSchemas[node.kind]}
          value={node.config}
          label={`${node.id} config`}
          onChange={(config) => updateNode(node.id, { config })}
          parseErrors={fieldErrors[`node:${node.id}`]}
          onParseError={(path, error) => setFieldError(`node:${node.id}`, path, error)}
        />
        {nodeIssues.length > 0 ? (
          <ul
            className="list-disc pl-4 text-xs leading-snug text-status-bad-fg"
            aria-label="Node issues"
          >
            {nodeIssues.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
        ) : null}
        <NodeConnections
          node={node}
          definition={definition}
          onChange={(port) => {
            // Connecting or removing an exit's loop-back also sets or clears its config.
            if (port === 'loopBack') setEpoch((e) => e + 1);
          }}
        />
      </section>
    </Dialog>
  );
}
