import type { NodeInput } from '@graphgoblin/contracts';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { cn } from '../lib/utils.js';
import { KIND_INFO } from './model.js';

export interface NodeCardData extends Record<string, unknown> {
  node: NodeInput;
  ports: string[];
  issueCount: number;
}

export type FlowNode = Node<NodeCardData, 'gg'>;

/** One loop node on the canvas: kind, label, id, an input handle, and a labelled handle per port. */
export function NodeCard({ data, selected }: NodeProps<FlowNode>) {
  const { node, ports, issueCount } = data;
  const info = KIND_INFO[node.kind];
  return (
    <div
      className={cn(
        'min-w-40 rounded-md border-2 bg-white px-3 py-2 text-xs shadow-sm',
        info.color,
        selected && 'ring-2 ring-emerald-400',
      )}
      data-testid={`node-${node.id}`}
    >
      {node.kind !== 'trigger' ? (
        <Handle type="target" position={Position.Left} id="in" aria-label={`${node.id} input`} />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wide text-slate-500">{info.label}</span>
        {issueCount > 0 ? (
          <span className="rounded bg-orange-100 px-1 text-orange-900" title="Validation issues">
            {issueCount} issue{issueCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
      <div className="text-sm font-medium text-slate-900">{node.label}</div>
      <div className="font-mono text-slate-500">{node.id}</div>
      {ports.length > 0 ? (
        <div className="mt-1 flex flex-col items-end gap-1">
          {ports.map((port) => (
            <div key={port} className="relative pr-2 text-[10px] text-slate-600">
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
  );
}
