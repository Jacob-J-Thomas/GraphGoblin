import {
  NodeConfigSchemas,
  SlugSchema,
  type LoopDefinitionInput,
  type NodeInput,
} from '@graphgoblin/contracts';
import { useState } from 'react';
import { Button, Input, Label, Select } from '../components/ui/index.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { canvasPorts, KIND_INFO, type EditorIssue } from './model.js';
import { SubloopPicker } from './SubloopPicker.js';
import { useEditorStore } from './store.js';

function NodeIdField({ nodeId, definition }: { nodeId: string; definition: LoopDefinitionInput }) {
  const [draft, setDraft] = useState(nodeId);
  const [error, setError] = useState<string | undefined>();
  const commit = () => {
    if (draft === nodeId) return setError(undefined);
    if (!SlugSchema.safeParse(draft).success)
      return setError('Use a letter first, then letters, digits, _ or -');
    if (definition.nodes.some((n) => n.id === draft)) return setError(`"${draft}" is already used`);
    setError(undefined);
    useEditorStore.getState().renameNode(nodeId, draft);
  };
  return (
    <div className="mb-2">
      <Label htmlFor="node-id">Node id</Label>
      <Input
        id="node-id"
        className="font-mono"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      {error ? (
        <p role="alert" className="text-xs text-orange-800">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The keyboard path for drawing an edge: pick one of this node's free output ports and a target.
 * Applies the same rules as dragging on the canvas.
 */
function ConnectForm({ node, definition }: { node: NodeInput; definition: LoopDefinitionInput }) {
  const used = new Set(
    definition.edges.filter((e) => e.from.node === node.id).map((e) => e.from.port),
  );
  const ports = canvasPorts(node).filter((p) => !used.has(p));
  const targets = definition.nodes.filter((n) => n.kind !== 'trigger');
  const [port, setPort] = useState(ports[0] ?? '');
  const [target, setTarget] = useState(targets.find((n) => n.id !== node.id)?.id ?? '');
  const chosenPort = ports.includes(port) ? port : (ports[0] ?? '');
  if (ports.length === 0 || targets.length === 0) return null;
  return (
    <form
      aria-label={`Connect ${node.id}`}
      className="mt-2 flex items-end gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        useEditorStore.getState().connect({ source: node.id, sourceHandle: chosenPort, target });
      }}
    >
      <div>
        <Label htmlFor="connect-port">Output</Label>
        <Select id="connect-port" value={chosenPort} onChange={(e) => setPort(e.target.value)}>
          {ports.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </Select>
      </div>
      <div className="flex-1">
        <Label htmlFor="connect-target">To</Label>
        <Select id="connect-target" value={target} onChange={(e) => setTarget(e.target.value)}>
          {targets.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label} ({n.id})
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={!target}>
        Connect
      </Button>
    </form>
  );
}

/** Properties of the selected node: id, label, the generated config form, and its connections. */
function subloopId(config: unknown): string {
  const ref = (config as { loopRef?: { loopId?: unknown } } | undefined)?.loopRef;
  return typeof ref?.loopId === 'string' ? ref.loopId : '';
}

export function PropertyPanel({
  definition,
  issues,
  loopId,
}: {
  definition: LoopDefinitionInput;
  issues: EditorIssue[];
  loopId: string;
}) {
  const selectedId = useEditorStore((s) => s.selectedNodeId);
  const fieldErrors = useEditorStore((s) => s.fieldErrors);
  const [epoch, setEpoch] = useState(0);
  const node = definition.nodes.find((n) => n.id === selectedId);
  if (!node) {
    return <p className="text-sm text-slate-500">Select a node to edit its properties.</p>;
  }
  const { updateNode, removeNode, removeEdge, setFieldError } = useEditorStore.getState();
  const outgoing = definition.edges.filter((e) => e.from.node === node.id);
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);
  return (
    <section aria-label="Node properties">
      <h2 className="mb-2 text-sm font-semibold">
        {KIND_INFO[node.kind].label} <span className="font-mono text-slate-500">{node.id}</span>
      </h2>
      <NodeIdField key={node.id} nodeId={node.id} definition={definition} />
      <div className="mb-2">
        <Label htmlFor="node-label">Label</Label>
        <Input
          id="node-label"
          value={node.label}
          onChange={(e) => updateNode(node.id, { label: e.target.value })}
        />
      </div>
      {node.kind === 'subloop' ? (
        <SubloopPicker
          currentLoopId={loopId}
          value={subloopId(node.config)}
          onPick={(id) => {
            const cfg = (node.config ?? {}) as Record<string, unknown>;
            const ref = (cfg['loopRef'] ?? {}) as Record<string, unknown>;
            updateNode(node.id, { config: { ...cfg, loopRef: { ...ref, loopId: id } } });
            setEpoch((e) => e + 1);
          }}
        />
      ) : null}
      <SchemaForm
        key={`${node.id}:${node.kind}:${epoch}`}
        schema={NodeConfigSchemas[node.kind]}
        value={node.config}
        label={`${node.id} config`}
        onChange={(config) => updateNode(node.id, { config })}
        parseErrors={fieldErrors[`node:${node.id}`]}
        onParseError={(path, error) => setFieldError(`node:${node.id}`, path, error)}
      />
      {nodeIssues.length > 0 ? (
        <ul className="mt-2 list-disc pl-4 text-xs text-orange-900" aria-label="Node issues">
          {nodeIssues.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
      <h3 className="mt-3 text-xs font-semibold text-slate-600">Connections</h3>
      {outgoing.length === 0 ? <p className="text-xs text-slate-500">No outgoing edges.</p> : null}
      <ul className="text-xs">
        {outgoing.map((edge) => (
          <li key={edge.id} className="flex items-center justify-between gap-2">
            <span>
              <code>{edge.from.port}</code> → <code>{edge.to.node}</code>
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove edge ${edge.id}`}
              onClick={() => removeEdge(edge.id)}
            >
              ✕
            </Button>
          </li>
        ))}
      </ul>
      <ConnectForm key={`${node.id}:${outgoing.length}`} node={node} definition={definition} />
      <Button className="mt-3" size="sm" variant="destructive" onClick={() => removeNode(node.id)}>
        Delete node
      </Button>
    </section>
  );
}
