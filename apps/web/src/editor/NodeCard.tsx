import type { NodeInput } from '@graphgoblin/contracts';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { memo, useLayoutEffect, useRef } from 'react';
import { cn } from '../lib/utils.js';
import { canvasFocusTarget } from './canvas-focus.js';
import { IssueBadge } from './IssueBadge.js';
import { KindChip, kindStyle } from './KindChip.js';
import { KIND_INFO, type EditorIssue } from './model.js';
import { useEditorStore } from './store.js';

export interface NodeCardData extends Record<string, unknown> {
  node: NodeInput;
  ports: string[];
  /** Display-only labels keyed by stable port IDs. */
  portLabels: Readonly<Record<string, string>>;
  /** The node's validation issues, from the same merged list Publish checks. */
  issues: readonly EditorIssue[];
}

export type FlowNode = Node<NodeCardData, 'gg'>;

/**
 * One loop node on the canvas: a header band tinted with the kind's colour (chip, kind name, and
 * the issue badge, whose popover lists the issues), then the label, the id, and a labelled output
 * handle per port. A selected card wears the magenta ring. Memoised: the canvas keeps a node's data
 * object while the node and its issues are unchanged, so an edit elsewhere does not re-render it.
 */
export const NodeCard = memo(function NodeCard({ data, selected }: NodeProps<FlowNode>) {
  const { node, ports, portLabels, issues } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  const portKey = JSON.stringify(ports);
  const measuredPortsRef = useRef(portKey);
  useLayoutEffect(() => {
    if (measuredPortsRef.current === portKey) return;
    measuredPortsRef.current = portKey;
    // xyflow caches ids and positions, even when the card's height stays the same. Measure the
    // committed handles once per port-list change; labels, issues and unrelated edits do nothing.
    updateNodeInternals(node.id);
  }, [node.id, portKey, updateNodeInternals]);
  const info = KIND_INFO[node.kind];
  return (
    <div
      style={kindStyle(node.kind)}
      className={cn(
        'w-[184px] rounded-lg border bg-surface-raised text-xs text-default',
        selected
          ? 'glow-node-selected border-canvas-node-selected outline-2 outline-canvas-node-selected'
          : 'border-default shadow-2',
      )}
      data-testid={`node-${node.id}`}
    >
      {node.kind !== 'trigger' ? (
        <Handle type="target" position={Position.Left} id="in" aria-label={`${node.id} input`} />
      ) : null}
      <div className="flex h-9 items-center gap-2 rounded-t-[11px] border-b border-default bg-kind-subtle pr-2 pl-[7px]">
        <KindChip kind={node.kind} size="sm" />
        <span className="text-2xs font-bold tracking-[0.08em] text-muted uppercase">
          {info.label}
        </span>
        {issues.length > 0 ? (
          <IssueBadge
            nodeId={node.id}
            issues={issues}
            className="ml-auto"
            onChoose={(issue) => useEditorStore.getState().openNode(node.id, { field: issue.path })}
            fallbackFocus={() => canvasFocusTarget(node.id)}
          />
        ) : null}
      </div>
      <div className="px-3 pt-2 pb-2.5">
        <div className="truncate text-md leading-5 font-semibold">{node.label}</div>
        <div className="truncate font-mono text-[11.5px] leading-4 text-muted">{node.id}</div>
        {ports.length > 0 ? (
          <div className="gg-node-ports mt-1 flex flex-col items-end gap-0.5">
            {ports.map((port) => (
              <div
                key={port}
                className="gg-node-port relative h-[18px] pr-2 font-mono text-2xs leading-[18px] font-medium text-muted"
              >
                {portLabels[port] ?? port}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={port}
                  aria-label={`${node.id} output ${portLabels[port] ?? port} (${port})`}
                  style={{ right: -14 }}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
});
