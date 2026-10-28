import { SmoothStepEdge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { OrthogonalEdge, type OrthogonalFlowEdge } from './OrthogonalEdge.js';

/** Keep xyflow's smoothstep type and renderer; only displaced labels need a channel. */
export const ForwardEdge = memo(function ForwardEdge(props: EdgeProps<OrthogonalFlowEdge>) {
  return props.data?.channel ? <OrthogonalEdge {...props} /> : <SmoothStepEdge {...props} />;
});
