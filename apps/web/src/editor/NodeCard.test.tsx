import type { NodeProps } from '@xyflow/react';
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { expect, it, vi } from 'vitest';
import { NodeCard, type FlowNode } from './NodeCard.js';

const update = vi.hoisted(() => vi.fn());
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useUpdateNodeInternals: () => update,
  Handle: ({ 'aria-label': label }: { 'aria-label': string }) => <span aria-label={label} />,
}));

it('refreshes committed handle ids and order once, including same-height changes, without refreshing unrelated data', () => {
  const props: NodeProps<FlowNode> = {
    id: 'pick',
    type: 'gg',
    selected: false,
    dragging: false,
    isConnectable: true,
    draggable: true,
    selectable: true,
    deletable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      node: {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config: {
          answer: { type: 'choice', options: [] },
          evaluation: { kind: 'expression', jsonata: '"yes"' },
        },
      },
      ports: ['yes', 'no'],
      portLabels: { yes: 'Yes', no: 'No' },
      issues: [],
    },
  };
  const card = () => (
    <StrictMode>
      <NodeCard {...props} />
    </StrictMode>
  );
  const view = render(card());
  expect(update).not.toHaveBeenCalled();
  for (const ports of [
    ['yes', 'no', 'third'],
    ['yes', 'no', 'other'],
    ['other', 'yes', 'no'],
    ['other', 'no'],
  ]) {
    const count = update.mock.calls.length;
    update.mockImplementationOnce(() => {
      // The refresh runs after React commits the new handles, not while rendering stale rows.
      for (const port of ports)
        expect(
          screen.getByLabelText(`pick output ${props.data.portLabels[port] ?? port} (${port})`),
        ).toBeInTheDocument();
    });
    props.data = { ...props.data, ports };
    view.rerender(card());
    expect(update).toHaveBeenCalledTimes(count + 1);
    expect(update).toHaveBeenLastCalledWith('pick');
  }
  props.data = {
    ...props.data,
    ports: [...props.data.ports],
    portLabels: { ...props.data.portLabels },
    node: { ...props.data.node, label: 'Choose' },
  };
  props.selected = true;
  view.rerender(card());
  expect(update).toHaveBeenCalledTimes(4);
});
