import type { NodeInput } from '@graphgoblin/contracts';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Icon } from '../components/icons/index.js';
import { Badge } from '../components/ui/index.js';
import { cn } from '../lib/utils.js';
import { KindChip, kindStyle } from './KindChip.js';
import { KIND_INFO } from './model.js';

export interface NodeCardData extends Record<string, unknown> {
  node: NodeInput;
  ports: string[];
  issueCount: number;
}

export type FlowNode = Node<NodeCardData, 'gg'>;

/**
 * One loop node on the canvas: a header band tinted with the kind's colour (chip, kind name, and
 * an issue count), then the label, the id, and a labelled output handle per port. A selected card
 * wears the magenta ring.
 */
export function NodeCard({ data, selected }: NodeProps<FlowNode>) {
  const { node, ports, issueCount } = data;
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
        {issueCount > 0 ? (
          <Badge tone="bad" size="sm" className="ml-auto" title="Validation issues">
            <Icon name="failed" />
            {issueCount} issue{issueCount === 1 ? '' : 's'}
          </Badge>
        ) : null}
      </div>
      <div className="px-3 pt-2 pb-2.5">
        <div className="truncate text-md leading-5 font-semibold">{node.label}</div>
        <div className="truncate font-mono text-[11.5px] leading-4 text-muted">{node.id}</div>
        {ports.length > 0 ? (
          <div className="mt-1 flex flex-col items-end gap-0.5">
            {ports.map((port) => (
              <div
                key={port}
                className="relative h-[18px] pr-2 font-mono text-2xs leading-[18px] font-medium text-muted"
              >
                {port}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={port}
                  aria-label={`${node.id} ${port}`}
                  style={{ right: -14 }}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
