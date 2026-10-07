import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { useState } from 'react';
import { Icon } from '../components/icons/index.js';
import { Button, FieldGroup, FieldRow, HelpText, Label, Select } from '../components/ui/index.js';
import { canvasPortLabels, canvasPorts } from './model.js';
import { useEditorStore } from './store.js';

/**
 * The keyboard path for drawing an edge: pick one of this node's free output ports and a target.
 * Applies the same rules as dragging on the canvas, and says why when it refuses.
 */
function ConnectForm({
  node,
  definition,
  onConnected,
}: {
  node: NodeInput;
  definition: LoopDefinitionInput;
  onConnected: (port: string) => void;
}) {
  const used = new Set(
    definition.edges.filter((e) => e.from.node === node.id).map((e) => e.from.port),
  );
  const ports = canvasPorts(node).filter((p) => !used.has(p));
  const portLabels = canvasPortLabels(node);
  const targets = definition.nodes.filter((n) => n.kind !== 'trigger');
  const [port, setPort] = useState(ports[0] ?? '');
  const [target, setTarget] = useState(targets.find((n) => n.id !== node.id)?.id ?? '');
  const [refused, setRefused] = useState<string | undefined>();
  const chosenPort = ports.includes(port) ? port : (ports[0] ?? '');
  if (ports.length === 0 || targets.length === 0) return null;
  return (
    <form
      aria-label={`Connect ${node.id}`}
      className="grid gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const problem = useEditorStore
          .getState()
          .connect({ source: node.id, sourceHandle: chosenPort, target });
        setRefused(problem ?? undefined);
        if (!problem) onConnected(chosenPort);
      }}
    >
      <FieldRow>
        <FieldGroup className="min-w-28">
          <Label htmlFor="connect-port">Output</Label>
          <Select id="connect-port" value={chosenPort} onChange={(e) => setPort(e.target.value)}>
            {ports.map((p) => (
              <option key={p} value={p}>
                {portLabels[p] && portLabels[p] !== p
                  ? `${portLabels[p]} (${p})`
                  : (portLabels[p] ?? p)}
              </option>
            ))}
          </Select>
        </FieldGroup>
        <FieldGroup className="flex-1">
          <Label htmlFor="connect-target">To</Label>
          <Select
            id="connect-target"
            value={target}
            aria-describedby={refused ? 'connect-refused' : undefined}
            onChange={(e) => setTarget(e.target.value)}
          >
            {targets.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label} ({n.id})
              </option>
            ))}
          </Select>
        </FieldGroup>
        <Button type="submit" variant="outline" disabled={!target}>
          Connect
        </Button>
      </FieldRow>
      {refused ? (
        <HelpText id="connect-refused" role="alert" tone="bad">
          Connection refused: {refused}
        </HelpText>
      ) : null}
    </form>
  );
}

/**
 * The node's outgoing edges, each with a Remove button, and the Connect form. `onChange` reports
 * the port of each edge added or removed here (an exit's `loopBack` edge also changes its config).
 */
export function NodeConnections({
  node,
  definition,
  onChange,
}: {
  node: NodeInput;
  definition: LoopDefinitionInput;
  onChange: (port: string) => void;
}) {
  const outgoing = definition.edges.filter((e) => e.from.node === node.id);
  const portLabels = canvasPortLabels(node);
  return (
    <section aria-label="Connections" className="grid gap-2">
      <h3 className="text-sm font-semibold">Connections</h3>
      {outgoing.length === 0 ? (
        <p className="text-xs text-muted">No outgoing edges.</p>
      ) : (
        <ul className="grid gap-1">
          {outgoing.map((edge) => (
            <li
              key={edge.id}
              className="flex items-center justify-between gap-2 rounded-md border border-default py-1 pr-1 pl-3 text-sm"
            >
              <span>
                {portLabels[edge.from.port] ?? edge.from.port}{' '}
                {portLabels[edge.from.port] && portLabels[edge.from.port] !== edge.from.port ? (
                  <code>({edge.from.port})</code>
                ) : null}{' '}
                → <code>{edge.to.node}</code>
              </span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove edge ${edge.id}`}
                onClick={() => {
                  useEditorStore.getState().removeEdge(edge.id);
                  onChange(edge.from.port);
                }}
              >
                <Icon name="close" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConnectForm
        key={`${node.id}:${outgoing.length}`}
        node={node}
        definition={definition}
        onConnected={onChange}
      />
    </section>
  );
}
