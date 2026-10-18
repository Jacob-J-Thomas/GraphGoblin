import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { createContext, use, useState } from 'react';
import { Button, Disclosure, HelpText } from '../components/ui/index.js';
import type { PreviewKind } from './preview.js';

/** Only node-dialog fields receive this context; loop settings and owner settings do not. */
export const NodeOutputsContext = createContext<
  { node: NodeInput; definition: LoopDefinitionInput } | undefined
>(undefined);

/** Reverse breadth-first traversal: shortest nonempty path to this node, including a prior visit. */
export function earlierNodes(definition: LoopDefinitionInput, nodeId: string): NodeInput[] {
  const incoming = new Map<string, string[]>();
  for (const edge of definition.edges) {
    const sources = incoming.get(edge.to.node) ?? [];
    sources.push(edge.from.node);
    incoming.set(edge.to.node, sources);
  }
  const distances = new Map<string, number>();
  const pending = [{ id: nodeId, distance: 0 }];
  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index]!;
    for (const id of incoming.get(current.id) ?? []) {
      if (distances.has(id)) continue;
      const distance = current.distance + 1;
      distances.set(id, distance);
      pending.push({ id, distance });
    }
  }
  return definition.nodes
    .filter((node) => distances.has(node.id))
    .sort(
      (a, b) =>
        distances.get(a.id)! - distances.get(b.id)! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

/** These scopes have a different root; a bare outputs reference would be misleading. */
export function usesRunThread(node: NodeInput, path: string, kind: PreviewKind): boolean {
  if (node.kind === 'trigger') return false;
  if (node.kind === 'wait' && path === 'filter') return false;
  if (node.kind === 'heartbeat' && path === 'until') return false;
  if (node.kind === 'subloop' && path.startsWith('output.')) return false;
  // Selection and mutation predicates see each item, with the thread available as a binding.
  // A subloop variable named "where" is a mapping over the parent thread, not a predicate.
  if (
    kind === 'expression' &&
    path.endsWith('.where') &&
    !(node.kind === 'subloop' && path === 'input.vars.where')
  )
    return false;
  return true;
}

/** Automatic outputs only. Arbitrary mutations/patches cannot promise a per-node entry. */
export function outputNote(node: NodeInput): string | undefined {
  switch (node.kind) {
    case 'trigger':
      return 'The trigger payload.';
    case 'inference':
      return 'Schema output candidate (raw on continue-raw); otherwise final text, parsed as JSON when possible. Output transforms may change it.';
    case 'script':
      return (node.config.stdout ?? 'last-output') === 'last-output'
        ? 'Standard output itself, parsed as JSON when possible; otherwise text (no stdout wrapper).'
        : undefined;
    case 'decision':
      return 'Decision evidence: observation, provenance and portId, plus gate details for a repeat gate.';
    case 'subloop':
      return node.config.output?.mode !== 'custom' &&
        (node.config.output?.resultTo?.lastOutput ?? true)
        ? 'Child summary: status, outcome, result and childRunId.'
        : undefined;
    case 'wait':
      return 'Input or signal payload; timer wake {wokeAt, reason}; continuing timeout {timedOut: true}.';
    case 'heartbeat':
      return 'Completion summary: beat, probe and satisfied: true or exhausted: true.';
    case 'mutate':
    case 'exit':
      return undefined;
  }
}

export function outputReference(id: string, kind: PreviewKind): string {
  const plain =
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) &&
    !(kind === 'expression' && ['true', 'false', 'null'].includes(id));
  const path = plain
    ? `outputs.${id}.value`
    : kind === 'template'
      ? `outputs[${JSON.stringify(id)}].value`
      : `outputs.${JSON.stringify(id)}.value`;
  return kind === 'template' ? `{{ ${path} }}` : path;
}

/** Interim authoring help, not validation or a prediction of the path a run will take. */
export function EarlierNodeOutputs({
  kind,
  path,
}: {
  kind: PreviewKind;
  path?: string | undefined;
}) {
  const context = use(NodeOutputsContext);
  const [status, setStatus] = useState('');
  if (!context || path === undefined || !usesRunThread(context.node, path, kind)) return null;
  const rows = earlierNodes(context.definition, context.node.id).flatMap((node) => {
    const note = outputNote(node);
    return note ? [{ node, note, reference: outputReference(node.id, kind) }] : [];
  });
  if (!rows.length) return null;
  const copy = async (reference: string) => {
    setStatus('');
    try {
      await navigator.clipboard.writeText(reference);
      setStatus('Copied');
    } catch {
      setStatus('Copy failed. Select the reference and copy it manually.');
    }
  };
  return (
    <Disclosure label={`Earlier node outputs (${rows.length})`} variant="row" className="mt-2">
      <HelpText>
        Help, not validation. A branch may not run; a previous visit has no value on the first
        visit. Renaming a node does not update references already in your fields.
      </HelpText>
      <ul className="grid min-w-0 gap-3">
        {rows.map(({ node, note, reference }) => (
          <li key={node.id} className="grid min-w-0 gap-1 text-sm">
            <div className="break-words">
              {node.label} (<code>{node.id}</code>) · {node.kind}
              {node.id === context.node.id ? ' · previous visit' : ''}
            </div>
            <code className="select-text whitespace-pre-wrap break-all">{reference}</code>
            <div>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Copy reference for ${node.label} (${node.id})`}
                onClick={() => void copy(reference)}
              >
                Copy
              </Button>
            </div>
            <HelpText>{note}</HelpText>
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className="text-sm">
        {status}
      </p>
    </Disclosure>
  );
}
