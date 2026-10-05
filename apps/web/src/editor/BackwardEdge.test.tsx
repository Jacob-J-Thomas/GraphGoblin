import { render } from '@testing-library/react';
import { Position, type EdgeProps } from '@xyflow/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BackwardEdge, type BackwardFlowEdge } from './BackwardEdge.js';
import type { RoutedEdge } from './routing.js';
import { createRouteChannels } from './route-channels.js';
const channel = (route: RoutedEdge) => createRouteChannels().edge('return', route);

const route: RoutedEdge = {
  points: [
    { x: 100, y: 0 },
    { x: 130, y: 0 },
    { x: 130, y: 180 },
    { x: -20, y: 180 },
    { x: -20, y: 40 },
    { x: 0, y: 40 },
  ],
  label: { x: 55, y: 180 },
  labelWidth: 118,
  blocked: false,
  unavailable: false,
  radius: 8,
  radii: [0, 8, 8, 8, 8, 0],
  padding: 32,
  lanePadding: 32,
  bounds: { id: '', left: -20, right: 130, top: 0, bottom: 180 },
};
const props: EdgeProps<BackwardFlowEdge> = {
  id: 'return',
  source: 'done',
  target: 'work',
  sourceX: 100,
  sourceY: 0,
  targetX: 0,
  targetY: 40,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  data: channel(route),
  label: 'loopBack',
  selected: false,
  selectable: true,
  deletable: true,
};

beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: vi.fn(() => ({ x: 0, y: 0, width: 56, height: 11 })),
  });
});

describe('BackwardEdge', () => {
  it('draws rounded geometry, a label on the lane, and xyflow hit targets', () => {
    const view = render(
      <svg>
        <BackwardEdge {...props} />
      </svg>,
    );
    const path = view.container.querySelector('.react-flow__edge-path')!;
    expect(path.getAttribute('d')).toContain('Q');
    expect(view.container.querySelector('.react-flow__edge-interaction')).toHaveAttribute(
      'd',
      path.getAttribute('d'),
    );
    expect(view.container.querySelector('.react-flow__edge-text')).toHaveTextContent('loopBack');
    expect(view.container.querySelector('.react-flow__edge-textwrapper')).toHaveAttribute(
      'transform',
      'translate(27 174.5)',
    );
  });

  it('shortens long labels to the straight segment and preserves their full title', () => {
    const label = 'a-very-long-decision-route-label-that-would-cross-a-corner';
    const view = render(
      <svg>
        <BackwardEdge {...props} label={label} />
      </svg>,
    );
    expect(view.container.querySelector('title')).toHaveTextContent(label);
    expect(view.container.querySelector('.react-flow__edge-text')!.textContent).toMatch(/…$/);
    view.rerender(
      <svg>
        <BackwardEdge {...props} label={label} data={channel({ ...route, labelWidth: 7 })} />
      </svg>,
    );
    expect(view.container.querySelector('.react-flow__edge-text')).toHaveTextContent(/^…$/);
    view.rerender(
      <svg>
        <BackwardEdge {...props} label={undefined} />
      </svg>,
    );
    expect(view.container.querySelector('.react-flow__edge-text')).toBeNull();
    const { data: _data, ...unmeasured } = props;
    view.rerender(
      <svg>
        <BackwardEdge {...unmeasured} />
      </svg>,
    );
    expect(view.container.querySelector('path')).toBeNull();
  });

  it('keeps an obstructed connection labelled without a colliding path', () => {
    const view = render(
      <svg>
        <BackwardEdge
          {...props}
          label={undefined}
          data={channel({ ...route, points: [], blocked: true })}
        />
      </svg>,
    );
    expect(view.container.querySelector('.react-flow__edge-path')).toHaveAttribute('d', '');
    expect(view.container.querySelector('.react-flow__edge-text')).toHaveTextContent(
      'Connection: Port covered by a card; move the card',
    );
  });
});
